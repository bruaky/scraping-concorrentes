import { fetchProfileWithPosts, type Post } from "@/lib/apify";
import { assertAuthorized, errorResponse } from "@/lib/auth";
import { closeRun, generateEvents, openRun } from "@/lib/runs";
import { supabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  competitorSlug?: string;
  runId?: string;
  skipEvents?: boolean;
  /** Quantos posts buscar por perfil (default 12). */
  postLimit?: number;
};

/** Coleta perfil e posts do Instagram dos concorrentes com handle confirmado. */
export async function POST(req: Request): Promise<Response> {
  let runId: string | null = null;
  let ownRun = false;

  try {
    assertAuthorized(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const db = supabaseAdmin();

    let query = db
      .from("competitors")
      .select("id, slug, instagram_handle")
      .eq("is_active", true)
      // handle null = nao tem ou nao foi confirmado. Muito B2B early-stage
      // so tem LinkedIn; nao ha o que coletar.
      .not("instagram_handle", "is", null);

    if (body.competitorSlug) query = query.eq("slug", body.competitorSlug);

    const { data: competitors, error } = await query;
    if (error) throw new Error(`Falha ao listar concorrentes: ${error.message}`);

    runId = body.runId ?? (await openRun("apify_instagram", "ig_details"));
    ownRun = !body.runId;

    // Sequencial: os actors sao pagos por execucao e a conta costuma ter
    // poucos slots simultaneos.
    const results: Result[] = [];
    for (const c of competitors ?? []) {
      results.push(
        await ingestCompetitor(
          { id: c.id, slug: c.slug, handle: c.instagram_handle as string },
          runId,
          body.postLimit ?? 12,
        ),
      );
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;

    if (ownRun) await closeRun(runId, { ok, failed });

    const events = body.skipEvents ? null : await generateEvents(runId);

    return Response.json({
      ok: true,
      runId,
      competitors: results.length,
      ok_count: ok,
      failed,
      events,
      results,
    });
  } catch (err) {
    if (runId && ownRun) {
      await closeRun(runId, {
        ok: 0,
        failed: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return errorResponse(err);
  }
}

type Target = { id: string; slug: string; handle: string };

type Result =
  | { ok: true; slug: string; handle: string; posts: number; isPrivate: boolean }
  | { ok: false; slug: string; handle: string; error: string };

async function ingestCompetitor(
  target: Target,
  runId: string,
  postLimit: number,
): Promise<Result> {
  const db = supabaseAdmin();

  try {
    const { profile, posts } = await fetchProfileWithPosts(target.handle, postLimit);

    if (!profile) throw new Error(`Apify nao devolveu perfil para @${target.handle}`);

    const { error: snapError } = await db.from("instagram_profile_snapshots").insert({
      run_id: runId,
      competitor_id: target.id,
      username: profile.username,
      ig_user_id: profile.igUserId,
      followers_count: profile.followersCount,
      follows_count: profile.followsCount,
      posts_count: profile.postsCount,
      highlight_reel_count: profile.highlightReelCount,
      full_name: profile.fullName,
      biography: profile.biography,
      external_url: profile.externalUrl,
      external_urls: (profile.externalUrls ?? null) as Json,
      is_verified: profile.isVerified,
      is_business_account: profile.isBusinessAccount,
      business_category: profile.businessCategory,
      is_private: profile.isPrivate,
      account_type: profile.accountType,
      raw: profile.raw as Json,
    });

    if (snapError) throw new Error(`Falha ao gravar snapshot: ${snapError.message}`);

    await persistPosts(target, posts, runId);

    return {
      ok: true,
      slug: target.slug,
      handle: target.handle,
      posts: posts.length,
      isPrivate: profile.isPrivate,
    };
  } catch (err) {
    return {
      ok: false,
      slug: target.slug,
      handle: target.handle,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * O post e fato imutavel: upsert pela chave natural (id do Instagram), sem
 * mexer no first_seen_at. As metricas entram como linha nova a cada coleta,
 * com os valores CRUS — inclusive o -1 de curtidas escondidas, que as views
 * normalizam.
 */
async function persistPosts(target: Target, posts: Post[], runId: string): Promise<void> {
  const db = supabaseAdmin();
  if (posts.length === 0) return;

  const { error: postsError } = await db.from("instagram_posts").upsert(
    posts.map((p) => ({
      id: p.igId,
      competitor_id: target.id,
      owner_username: target.handle.replace(/^@/, ""),
      short_code: p.shortCode,
      url: p.url,
      post_type: p.postType,
      product_type: p.productType,
      caption: p.caption,
      hashtags: p.hashtags,
      mentions: p.mentions,
      tagged_users: p.taggedUsers,
      posted_at: p.timestamp as string,
      video_duration: p.videoDuration,
      music_info: (p.musicInfo ?? null) as Json,
      is_pinned: p.isPinned,
      raw: p.raw as Json,
    })),
    { onConflict: "id" },
  );

  if (postsError) throw new Error(`Falha ao gravar posts: ${postsError.message}`);

  const capturedAt = new Date().toISOString();

  const { error: metricsError } = await db.from("instagram_post_metrics").upsert(
    posts.map((p) => ({
      run_id: runId,
      post_id: p.igId,
      competitor_id: target.id,
      captured_at: capturedAt,
      likes_count: p.likesCount,
      comments_count: p.commentsCount,
      video_view_count: p.videoViewCount,
      video_play_count: p.videoPlayCount,
    })),
    { onConflict: "post_id,captured_at" },
  );

  if (metricsError) throw new Error(`Falha ao gravar metricas: ${metricsError.message}`);
}
