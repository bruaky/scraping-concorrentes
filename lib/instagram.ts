import "server-only";

import { fetchProfileWithPosts, type Post } from "./apify";
import { supabaseAdmin } from "./supabase";
import type { Json } from "./database.types";

/**
 * Coleta de um perfil do Instagram: Apify -> snapshot + posts + metricas.
 *
 * Usada pelo ingest semanal (/api/ingest/instagram) e pelo botao de coleta
 * ao vivo (/api/live/run), para os dois gravarem exatamente igual.
 */

export type Target = { id: string; slug: string; handle: string };

export type IngestResult =
  | { ok: true; slug: string; handle: string; posts: number; isPrivate: boolean }
  | { ok: false; slug: string; handle: string; error: string };

export async function ingestCompetitor(
  target: Target,
  runId: string,
  postLimit: number,
): Promise<IngestResult> {
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
