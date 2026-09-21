import "server-only";

/**
 * Wrapper sobre a API do Apify.
 *
 * Usamos `run-sync-get-dataset-items`, que roda o actor e ja devolve os itens
 * do dataset numa unica chamada — sem polling. Em troca, a chamada segura a
 * conexao ate o actor terminar, por isso as rotas de ingest declaram
 * `maxDuration`.
 *
 * Docs: https://docs.apify.com/api/v2
 */

const API = "https://api.apify.com/v2";

const DEFAULT_PROFILE_ACTOR = "apify~instagram-profile-scraper";
const DEFAULT_POSTS_ACTOR = "apify~instagram-post-scraper";

export interface InstagramProfile {
  username: string;
  fullName: string | null;
  biography: string | null;
  externalUrl: string | null;
  followers: number | null;
  follows: number | null;
  postsCount: number | null;
  profilePicUrl: string | null;
  isVerified: boolean;
  raw: unknown;
}

export interface InstagramPost {
  id: string;
  shortCode: string | null;
  url: string | null;
  type: string | null;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  timestamp: string | null;
  displayUrl: string | null;
  raw: unknown;
}

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN nao definida (ver .env.example)");
  return t;
}

/** Roda um actor e devolve os itens do dataset. */
async function runActor<T>(
  actorId: string,
  input: unknown,
  opts: { timeoutSecs?: number } = {},
): Promise<T[]> {
  const timeoutSecs = opts.timeoutSecs ?? 180;
  const url = new URL(`${API}/acts/${actorId}/run-sync-get-dataset-items`);
  url.searchParams.set("token", token());
  url.searchParams.set("timeout", String(timeoutSecs));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
  });

  if (!res.ok) {
    throw new Error(`Apify ${actorId} falhou: ${res.status} ${await res.text()}`);
  }

  const items = (await res.json()) as T[];
  return Array.isArray(items) ? items : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Detalhes do perfil: bio, link, seguidores, contagem de posts. */
export async function fetchProfile(handle: string): Promise<InstagramProfile | null> {
  const actor = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR ?? DEFAULT_PROFILE_ACTOR;
  const clean = handle.replace(/^@/, "");

  const items = await runActor<Record<string, unknown>>(actor, {
    usernames: [clean],
  });

  const item = items[0];
  if (!item) return null;

  return {
    username: str(item.username) ?? clean,
    fullName: str(item.fullName),
    biography: str(item.biography),
    externalUrl: str(item.externalUrl),
    followers: num(item.followersCount),
    follows: num(item.followsCount),
    postsCount: num(item.postsCount),
    profilePicUrl: str(item.profilePicUrlHD) ?? str(item.profilePicUrl),
    isVerified: item.verified === true || item.isVerified === true,
    raw: item,
  };
}

/** Ultimos posts do perfil, mais recentes primeiro. */
export async function fetchPosts(handle: string, limit = 12): Promise<InstagramPost[]> {
  const actor = process.env.APIFY_INSTAGRAM_POSTS_ACTOR ?? DEFAULT_POSTS_ACTOR;
  const clean = handle.replace(/^@/, "");

  const items = await runActor<Record<string, unknown>>(actor, {
    username: [clean],
    resultsLimit: limit,
  });

  return items
    .map((item) => ({
      id: str(item.id) ?? str(item.shortCode) ?? "",
      shortCode: str(item.shortCode),
      url: str(item.url),
      type: str(item.type),
      caption: str(item.caption),
      likes: num(item.likesCount),
      comments: num(item.commentsCount),
      timestamp: str(item.timestamp),
      displayUrl: str(item.displayUrl),
      raw: item,
    }))
    .filter((post) => post.id.length > 0)
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
}

/** Perfil + posts numa tacada so. */
export async function fetchProfileWithPosts(
  handle: string,
  postLimit = 12,
): Promise<{ profile: InstagramProfile | null; posts: InstagramPost[] }> {
  const [profile, posts] = await Promise.all([
    fetchProfile(handle),
    fetchPosts(handle, postLimit),
  ]);
  return { profile, posts };
}
