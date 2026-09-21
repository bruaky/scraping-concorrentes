import { fetchProfileWithPosts, type Post } from "@/lib/apify";
import { assertAuthorized, errorResponse } from "@/lib/auth";
import { instagramEvents, saveEvents } from "@/lib/events";
import { activeSources, type SourceRow } from "@/lib/sources";
import { supabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  competitorSlug?: string;
  sourceIds?: string[];
  runId?: string;
  /** Quantos posts buscar por perfil (default 12). */
  postLimit?: number;
};

/** Captura perfil + posts do Instagram e gera os eventos correspondentes. */
export async function POST(req: Request): Promise<Response> {
  try {
    assertAuthorized(req);

    const body = (await req.json().catch(() => ({}))) as Body;

    const sources = await activeSources("instagram", {
      competitorSlug: body.competitorSlug,
      sourceIds: body.sourceIds,
    });

    // Sequencial de proposito: os actors do Apify sao pagos por execucao e a
    // conta costuma ter poucos slots simultaneos.
    const results: Result[] = [];
    for (const source of sources) {
      results.push(await ingestSource(source, body.runId ?? null, body.postLimit ?? 12));
    }

    return Response.json({
      ok: true,
      sources: results.length,
      succeeded: results.filter((r) => r.ok).length,
      events: results.reduce((sum, r) => sum + (r.ok ? r.events : 0), 0),
      results,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

type Result =
  | { ok: true; sourceId: string; target: string; events: number; posts: number; newPosts: number }
  | { ok: false; sourceId: string; target: string; error: string };

async function ingestSource(
  source: SourceRow,
  runId: string | null,
  postLimit: number,
): Promise<Result> {
  const db = supabaseAdmin();

  try {
    const { profile, posts } = await fetchProfileWithPosts(source.target, postLimit);

    const { data: previous } = await db
      .from("instagram_profile_snapshots")
      .select("id, followers_count, biography, external_url, is_private")
      .eq("source_id", source.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: snapshot, error: snapError } = await db
      .from("instagram_profile_snapshots")
      .insert({
        competitor_id: source.competitor_id,
        source_id: source.id,
        run_id: runId,
        followers_count: profile?.followersCount ?? null,
        follows_count: profile?.followsCount ?? null,
        posts_count: profile?.postsCount ?? null,
        biography: profile?.biography ?? null,
        external_url: profile?.externalUrl ?? null,
        is_verified: profile?.isVerified ?? null,
        is_business_account: profile?.isBusinessAccount ?? null,
        business_category_name: profile?.businessCategoryName ?? null,
        is_private: profile?.isPrivate ?? false,
        account_type: profile?.accountType ?? null,
        raw: (profile?.raw ?? {}) as Json,
      })
      .select("id, captured_at")
      .single();

    if (snapError || !snapshot) {
      throw new Error(`Falha ao gravar snapshot: ${snapError?.message ?? "sem retorno"}`);
    }

    const { newPosts } = await persistPosts(source, posts, runId);

    const events = instagramEvents({
      competitorId: source.competitor_id,
      sourceId: source.id,
      handle: source.target,
      runId,
      profile,
      newPosts,
      capturedAt: snapshot.captured_at,
      previous: previous ?? null,
    });

    const saved = await saveEvents(events);

    await db
      .from("sources")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", source.id);

    return {
      ok: true,
      sourceId: source.id,
      target: source.target,
      events: saved,
      posts: posts.length,
      newPosts: newPosts.length,
    };
  } catch (err) {
    return {
      ok: false,
      sourceId: source.id,
      target: source.target,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Grava posts e metricas.
 *
 * O post em si e upsert por (competitor_id, ig_id) — a identidade nao muda, so
 * o que o Instagram deixa a gente reler (caption editada, pin ligado/desligado).
 * As metricas entram como linha nova a cada coleta, formando a serie temporal.
 */
async function persistPosts(
  source: SourceRow,
  posts: Post[],
  runId: string | null,
): Promise<{ newPosts: Post[] }> {
  const db = supabaseAdmin();
  if (posts.length === 0) return { newPosts: [] };

  // Quais desses ig_id ja conheciamos, pra saber o que e novo de verdade.
  const { data: known } = await db
    .from("instagram_posts")
    .select("ig_id")
    .eq("competitor_id", source.competitor_id)
    .in(
      "ig_id",
      posts.map((p) => p.igId),
    );

  const knownIds = new Set((known ?? []).map((k) => k.ig_id));
  const newPosts = posts.filter((p) => !knownIds.has(p.igId));

  const now = new Date().toISOString();

  const { data: rows, error } = await db
    .from("instagram_posts")
    .upsert(
      posts.map((p) => ({
        competitor_id: source.competitor_id,
        source_id: source.id,
        ig_id: p.igId,
        short_code: p.shortCode,
        url: p.url,
        posted_at: p.timestamp,
        media_type: p.mediaType,
        product_type: p.productType,
        caption: p.caption,
        hashtags: p.hashtags,
        mentions: p.mentions,
        tagged_users: p.taggedUsers,
        display_url: p.displayUrl,
        is_pinned: p.isPinned,
        last_seen_at: now,
      })),
      { onConflict: "competitor_id,ig_id" },
    )
    .select("id, ig_id");

  if (error) throw new Error(`Falha ao gravar posts: ${error.message}`);

  const idByIgId = new Map((rows ?? []).map((r) => [r.ig_id, r.id]));

  const metrics = posts
    .map((p) => {
      const postId = idByIgId.get(p.igId);
      if (!postId) return null;
      return {
        post_id: postId,
        run_id: runId,
        // likesCount ja vem normalizado: -1 do Apify virou null em lib/apify.
        likes_count: p.likesCount,
        comments_count: p.commentsCount,
        // Ausentes em post de imagem. Ficam null, nunca 0.
        video_play_count: p.videoPlayCount,
        video_view_count: p.videoViewCount,
        latest_comments: p.latestComments as Json,
      };
    })
    .filter((m) => m !== null);

  if (metrics.length > 0) {
    const { error: metricsError } = await db.from("instagram_post_metrics").insert(metrics);
    if (metricsError) throw new Error(`Falha ao gravar metricas: ${metricsError.message}`);
  }

  return { newPosts };
}
