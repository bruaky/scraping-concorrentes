import "server-only";

/**
 * Wrapper sobre a API do Apify.
 *
 * `run-sync-get-dataset-items` roda o actor e ja devolve os itens numa unica
 * chamada — sem polling. Em troca segura a conexao ate terminar, por isso as
 * rotas de ingest declaram `maxDuration`.
 *
 * IMPORTANTE — este wrapper NAO normaliza `likesCount`. O schema guarda o
 * valor cru (-1 = autor escondeu as curtidas) e normaliza nas views, com
 * nullif(likes_count, -1). Normalizar aqui perderia a distincao entre
 * "escondido" e "ausente" no dado bruto, que e justamente o que a tabela de
 * metricas existe para preservar.
 *
 * Os numeros vem da versao DESLOGADA do Instagram e podem ser menores do que
 * o que se ve logado. Conta privada nao expoe engajamento.
 *
 * Docs: https://docs.apify.com/api/v2
 */

const API = "https://api.apify.com/v2";

const DEFAULT_PROFILE_ACTOR = "apify~instagram-profile-scraper";
const DEFAULT_POSTS_ACTOR = "apify~instagram-post-scraper";

export type Profile = {
  username: string;
  igUserId: string | null;
  fullName: string | null;
  biography: string | null;
  externalUrl: string | null;
  externalUrls: unknown[] | null;
  followersCount: number | null;
  followsCount: number | null;
  postsCount: number | null;
  highlightReelCount: number | null;
  isVerified: boolean | null;
  isBusinessAccount: boolean | null;
  businessCategory: string | null;
  isPrivate: boolean;
  /** statistics.account_type: 1 pessoal, 2 business, 3 creator. */
  accountType: number | null;
  raw: unknown;
};

export type Post = {
  igId: string;
  shortCode: string | null;
  url: string | null;
  /** Cadencia real: dia e hora de publicacao. */
  timestamp: string | null;
  postType: string | null;
  /** 'clips' = reel. */
  productType: string | null;
  caption: string | null;
  hashtags: string[];
  mentions: string[];
  taggedUsers: string[];
  videoDuration: number | null;
  musicInfo: unknown | null;
  /** Fixado no topo: reaparece em toda coleta, nao e post da semana. */
  isPinned: boolean;
  /** CRU. -1 = curtidas escondidas pelo autor. Normalizado nas views. */
  likesCount: number | null;
  commentsCount: number | null;
  /** So existe em video. null em imagem = ausencia, nao zero. */
  videoViewCount: number | null;
  videoPlayCount: number | null;
  raw: unknown;
};

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN nao definida (ver .env.example)");
  return t;
}

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

// --- coercoes ---------------------------------------------------------------

/**
 * Numero, ou null quando ausente. Preserva negativos de proposito: -1 e um
 * valor com significado (curtidas escondidas), nao lixo.
 */
export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === "string") return v;
      // taggedUsers vem como { username, full_name, ... }
      const u = (v as { username?: unknown })?.username;
      return typeof u === "string" ? u : null;
    })
    .filter((v): v is string => v !== null);
}

// --- perfil -----------------------------------------------------------------

export async function fetchProfile(handle: string): Promise<Profile | null> {
  const actor = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR ?? DEFAULT_PROFILE_ACTOR;
  const clean = handle.replace(/^@/, "");

  const items = await runActor<Record<string, unknown>>(actor, { usernames: [clean] });
  const item = items[0];
  if (!item) return null;

  const statistics = item.statistics as { account_type?: unknown } | undefined;

  return {
    username: str(item.username) ?? clean,
    igUserId: str(item.id),
    fullName: str(item.fullName),
    biography: str(item.biography),
    externalUrl: str(item.externalUrl),
    externalUrls: Array.isArray(item.externalUrls) ? item.externalUrls : null,
    followersCount: num(item.followersCount),
    followsCount: num(item.followsCount),
    postsCount: num(item.postsCount),
    highlightReelCount: num(item.highlightReelCount),
    isVerified: bool(item.verified) ?? bool(item.isVerified),
    isBusinessAccount: bool(item.isBusinessAccount),
    businessCategory: str(item.businessCategoryName),
    isPrivate: item.private === true || item.isPrivate === true,
    accountType: num(statistics?.account_type),
    raw: item,
  };
}

// --- posts ------------------------------------------------------------------

export async function fetchPosts(handle: string, limit = 12): Promise<Post[]> {
  const actor = process.env.APIFY_INSTAGRAM_POSTS_ACTOR ?? DEFAULT_POSTS_ACTOR;
  const clean = handle.replace(/^@/, "");

  const items = await runActor<Record<string, unknown>>(actor, {
    username: [clean],
    resultsLimit: limit,
  });

  return items
    .map((item) => ({
      igId: str(item.id) ?? str(item.shortCode) ?? "",
      shortCode: str(item.shortCode),
      url: str(item.url),
      timestamp: str(item.timestamp),
      postType: str(item.type),
      productType: str(item.productType),
      caption: str(item.caption),
      hashtags: strArray(item.hashtags),
      mentions: strArray(item.mentions),
      taggedUsers: strArray(item.taggedUsers),
      videoDuration: num(item.videoDuration),
      musicInfo: item.musicInfo ?? null,
      isPinned: item.isPinned === true,
      likesCount: num(item.likesCount),
      commentsCount: num(item.commentsCount),
      videoViewCount: num(item.videoViewCount),
      videoPlayCount: num(item.videoPlayCount),
      raw: item,
    }))
    // posted_at e NOT NULL no schema: post sem timestamp nao entra
    .filter((post) => post.igId.length > 0 && post.timestamp !== null)
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
}

export async function fetchProfileWithPosts(
  handle: string,
  postLimit = 12,
): Promise<{ profile: Profile | null; posts: Post[] }> {
  const profile = await fetchProfile(handle);

  // Perfil privado nao devolve posts: nao gasta run do actor.
  if (profile?.isPrivate) return { profile, posts: [] };

  return { profile, posts: await fetchPosts(handle, postLimit) };
}
