import { fetchProfileWithPosts } from "@/lib/apify";
import { assertAuthorized, errorResponse } from "@/lib/auth";
import { hashContent, instagramEvents, saveEvents } from "@/lib/events";
import { supabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  competitorSlug?: string;
  sourceIds?: string[];
  runId?: string;
  /** Quantos posts buscar por perfil (default 12). */
  postLimit?: number;
}

/**
 * Captura perfil + posts do Instagram via Apify e gera os eventos de
 * post novo, mudanca de bio e salto de seguidores.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    assertAuthorized(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const db = supabaseAdmin();

    let query = db
      .from("sources")
      .select("id, competitor_id, kind, target, label, competitors!inner(slug)")
      .eq("kind", "instagram")
      .eq("is_active", true);

    if (body.competitorSlug) query = query.eq("competitors.slug", body.competitorSlug);
    if (body.sourceIds?.length) query = query.in("id", body.sourceIds);

    const { data: sources, error } = await query;
    if (error) throw new Error(`Falha ao listar sources: ${error.message}`);

    // Sequencial de proposito: os actors do Apify sao pagos por execucao e a
    // conta costuma ter poucos slots simultaneos.
    const results: Result[] = [];
    for (const source of sources ?? []) {
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

type SourceRow = {
  id: string;
  competitor_id: string;
  target: string;
  label: string | null;
};

type Result =
  | { ok: true; sourceId: string; target: string; events: number; posts: number }
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
      .from("snapshots")
      .select("id, followers, payload")
      .eq("source_id", source.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = {
      profile: profile
        ? {
            username: profile.username,
            fullName: profile.fullName,
            biography: profile.biography,
            externalUrl: profile.externalUrl,
            profilePicUrl: profile.profilePicUrl,
            isVerified: profile.isVerified,
            followers: profile.followers,
            follows: profile.follows,
          }
        : null,
      posts: posts.map((p) => ({
        id: p.id,
        shortCode: p.shortCode,
        url: p.url,
        type: p.type,
        caption: p.caption,
        likes: p.likes,
        comments: p.comments,
        timestamp: p.timestamp,
        displayUrl: p.displayUrl,
      })),
    } as unknown as Json;

    const { data: snapshot, error: snapError } = await db
      .from("snapshots")
      .insert({
        competitor_id: source.competitor_id,
        source_id: source.id,
        run_id: runId,
        kind: "instagram",
        title: profile?.fullName ?? `@${source.target}`,
        followers: profile?.followers ?? null,
        posts_count: profile?.postsCount ?? posts.length,
        content_hash: hashContent(JSON.stringify(payload)),
        payload,
      })
      .select("id, captured_at")
      .single();

    if (snapError || !snapshot) {
      throw new Error(`Falha ao gravar snapshot: ${snapError?.message ?? "sem retorno"}`);
    }

    const events = instagramEvents({
      source,
      profile,
      posts,
      snapshot,
      previous: previous ?? null,
      runId,
    });

    const saved = await saveEvents(events);

    await db
      .from("sources")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", source.id);

    return { ok: true, sourceId: source.id, target: source.target, events: saved, posts: posts.length };
  } catch (err) {
    return {
      ok: false,
      sourceId: source.id,
      target: source.target,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
