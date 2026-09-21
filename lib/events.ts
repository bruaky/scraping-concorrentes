import "server-only";

import { createHash } from "node:crypto";

import type { Post, Profile } from "./apify";
import { SEVERITY_BY_KIND } from "./database.types";
import type {
  ChangeEvent,
  ChangeKind,
  InstagramProfileSnapshot,
  Json,
  PageType,
  WebSnapshot,
} from "./database.types";
import { addedLines, type Scrape } from "./firecrawl";
import { supabaseAdmin } from "./supabase";

/**
 * Deteccao de mudanca: transforma o que os scrapers devolveram em linhas de
 * `change_events` — o feed do Nivel 1.
 *
 * As funcoes daqui sao puras (recebem anterior + atual, devolvem eventos) pra
 * poderem ser testadas sem banco. A severidade nao e escolhida caso a caso:
 * sai de SEVERITY_BY_KIND, entao preco nunca vira cinza por descuido.
 *
 * Duas regras atravessam tudo:
 *
 *  1. Sem baseline nao ha evento. A primeira captura de uma fonte e so
 *     referencia — na semana 1 esta tudo "new" e um feed com 40 cards de
 *     "pagina nova" e ruido, nao sinal.
 *
 *  2. Desconhecido nao e "igual". Se o changeTracking veio com warning ou sem
 *     status, nao emitimos nada e a UI mostra "sem comparacao".
 */

export type DraftEvent = {
  competitor_id: string;
  source_id: string | null;
  run_id: string | null;
  kind: ChangeKind;
  title: string;
  summary: string | null;
  url: string | null;
  diff: string | null;
  payload: Json;
  occurred_at: string;
  dedupe_key: string;
};

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dedupe(parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => String(p ?? "")).join(":");
}

function excerpt(text: string, max = 400): string {
  const clean = text.trim().replace(/\n{3,}/g, "\n\n");
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

/** Semana ISO, pra dedupe de eventos que valem "uma vez por semana". */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}W${String(week).padStart(2, "0")}`;
}

/** "13 de set" — o pt-BR devolve o mes abreviado com ponto, que duplicaria o nosso. */
function compactDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    .replace(/\.$/, "");
}

function money(value: number, currency: string | null): string {
  return currency ? `${currency} ${value}` : String(value);
}

// ===========================================================================
// Web
// ===========================================================================

export type WebContext = {
  competitorId: string;
  sourceId: string;
  pageType: PageType;
  runId: string | null;
  scrape: Scrape;
  capturedAt: string;
  /** Snapshot anterior desta fonte. null = baseline, nao gera evento. */
  previous: Pick<
    WebSnapshot,
    "id" | "content_hash" | "visibility" | "extracted" | "jobs_count" | "headline_price"
  > | null;
};

export function webEvents(ctx: WebContext): DraftEvent[] {
  const { scrape, previous, capturedAt } = ctx;
  const t = scrape.tracking;

  const base = {
    competitor_id: ctx.competitorId,
    source_id: ctx.sourceId,
    run_id: ctx.runId,
    url: scrape.url,
    occurred_at: capturedAt,
  };

  // 404 é sempre evento, com ou sem changeTracking.
  if (t.changeStatus === "removed" || scrape.statusCode === 404) {
    return [
      {
        ...base,
        kind: "page_removed",
        title: `${scrape.title ?? scrape.url} saiu do ar`,
        summary: `A pagina respondeu ${scrape.statusCode ?? "erro"}.`,
        diff: null,
        payload: { statusCode: scrape.statusCode } as Json,
        dedupe_key: dedupe(["web", ctx.sourceId, "removed", isoWeek(new Date(capturedAt))]),
      },
    ];
  }

  // Sem baseline: so referencia.
  if (previous === null) return [];

  // Sem status confiavel: "desconhecido", nao "igual". Nao inventa evento.
  if (t.changeStatus === null) return [];

  const events: DraftEvent[] = [];

  // Saiu do sitemap mas ainda abre: pagina sendo aposentada.
  if (t.visibility === "hidden" && previous.visibility !== "hidden") {
    events.push({
      ...base,
      kind: "page_hidden",
      title: `${scrape.title ?? scrape.url} saiu dos links e do sitemap`,
      summary: "A URL ainda abre, mas nao esta mais linkada. Sinal de pagina sendo aposentada.",
      diff: null,
      payload: { visibility: t.visibility } as Json,
      dedupe_key: dedupe(["web", ctx.sourceId, "hidden", isoWeek(new Date(capturedAt))]),
    });
  }

  if (t.changeStatus === "new") {
    events.push({
      ...base,
      kind: "page_added",
      title: `${scrape.title ?? scrape.url} entrou no ar`,
      summary: scrape.description,
      diff: null,
      payload: {} as Json,
      dedupe_key: dedupe(["web", ctx.sourceId, "added", isoWeek(new Date(capturedAt))]),
    });
    return events;
  }

  if (t.changeStatus === "same") return events;

  // --- changed: o tipo da pagina decide o evento ---------------------------
  const diffText = t.diffText;
  const comparedTo = t.previousScrapeAt ? `Comparado com ${compactDate(t.previousScrapeAt)}.` : null;

  switch (ctx.pageType) {
    case "pricing":
      events.push(...pricingEvents(ctx, base, diffText, comparedTo));
      break;
    case "home":
      events.push(...homeEvents(ctx, base, diffText, comparedTo));
      break;
    case "careers":
      events.push(...careersEvents(ctx, base, comparedTo));
      break;
    case "blog":
      events.push(...blogEvents(ctx, base));
      break;
    default:
      events.push({
        ...base,
        kind: "page_changed",
        title: `${scrape.title ?? scrape.url} mudou`,
        summary: comparedTo,
        diff: diffText,
        payload: {} as Json,
        dedupe_key: dedupe(["web", ctx.sourceId, "changed", contentKey(ctx)]),
      });
  }

  return events;
}

function contentKey(ctx: WebContext): string {
  return hashContent(ctx.scrape.markdown).slice(0, 16);
}

type EventBase = {
  competitor_id: string;
  source_id: string;
  run_id: string | null;
  url: string;
  occurred_at: string;
};

/**
 * Preco: o modo json do changeTracking ja entrega previous/current por campo,
 * entao comparamos plano a plano em vez de ler o diff.
 */
function pricingEvents(
  ctx: WebContext,
  base: EventBase,
  diffText: string | null,
  comparedTo: string | null,
): DraftEvent[] {
  const before = plansOf(ctx.previous?.extracted);
  const after = plansOf(ctx.scrape.extracted);

  const changes: Array<{ plan: string; from: string; to: string }> = [];

  for (const [name, price] of after) {
    const prior = before.get(name);
    if (prior === undefined || prior.price === price.price) continue;
    changes.push({
      plan: name,
      from: money(prior.price, prior.currency),
      to: money(price.price, price.currency),
    });
  }

  if (changes.length === 0) {
    // Mudou algo na pagina de preco que a extracao nao pegou. Ainda e critico:
    // pagina de pricing nao muda por acaso.
    return [
      {
        ...base,
        kind: "pricing_changed",
        title: "Pagina de precos mudou",
        summary: comparedTo,
        diff: diffText,
        payload: {} as Json,
        dedupe_key: dedupe(["web", ctx.sourceId, "pricing", contentKey(ctx)]),
      },
    ];
  }

  return changes.map((c) => ({
    ...base,
    kind: "pricing_changed" as const,
    title: `${c.plan} passou de ${c.from} para ${c.to}`,
    summary: comparedTo,
    diff: diffText,
    payload: c as unknown as Json,
    dedupe_key: dedupe(["web", ctx.sourceId, "price", c.plan, c.to]),
  }));
}

function plansOf(extracted: unknown): Map<string, { price: number; currency: string | null }> {
  const plans = (extracted as { plans?: unknown[] } | null)?.plans;
  const out = new Map<string, { price: number; currency: string | null }>();
  if (!Array.isArray(plans)) return out;

  for (const plan of plans) {
    const p = plan as { name?: unknown; price?: unknown; currency?: unknown };
    if (typeof p.name !== "string" || typeof p.price !== "number") continue;
    out.set(p.name, {
      price: p.price,
      currency: typeof p.currency === "string" ? p.currency : null,
    });
  }

  return out;
}

function homeEvents(
  ctx: WebContext,
  base: EventBase,
  diffText: string | null,
  comparedTo: string | null,
): DraftEvent[] {
  const before = (ctx.previous?.extracted as { headline?: unknown } | null)?.headline;
  const after = (ctx.scrape.extracted as { headline?: unknown } | null)?.headline;

  if (typeof after === "string" && typeof before === "string" && before !== after) {
    return [
      {
        ...base,
        kind: "value_prop_changed",
        title: `Nova proposta de valor: "${excerpt(after, 120)}"`,
        summary: `Antes: "${excerpt(before, 120)}". ${comparedTo ?? ""}`.trim(),
        diff: diffText,
        payload: { before, after } as Json,
        dedupe_key: dedupe(["web", ctx.sourceId, "valueprop", hashContent(after).slice(0, 16)]),
      },
    ];
  }

  return [
    {
      ...base,
      kind: "page_changed",
      title: "Home mudou",
      summary: comparedTo,
      diff: diffText,
      payload: {} as Json,
      dedupe_key: dedupe(["web", ctx.sourceId, "changed", contentKey(ctx)]),
    },
  ];
}

function careersEvents(ctx: WebContext, base: EventBase, comparedTo: string | null): DraftEvent[] {
  const before = rolesOf(ctx.previous?.extracted);
  const after = rolesOf(ctx.scrape.extracted);

  const opened = after.filter((r) => !before.includes(r));
  const closed = before.filter((r) => !after.includes(r));
  if (opened.length === 0 && closed.length === 0) return [];

  const parts: string[] = [];
  if (opened.length > 0) parts.push(`${opened.length} vaga(s) nova(s)`);
  if (closed.length > 0) parts.push(`${closed.length} fechada(s)`);

  return [
    {
      ...base,
      kind: "jobs_changed",
      title: opened.length > 0 ? `${parts.join(", ")}: ${opened[0]}` : parts.join(", "),
      summary: [opened.length > 1 ? opened.slice(1).join(" · ") : null, comparedTo]
        .filter(Boolean)
        .join(" — ") || null,
      diff: null,
      payload: { opened, closed, total: after.length } as Json,
      dedupe_key: dedupe([
        "web",
        ctx.sourceId,
        "jobs",
        hashContent(after.slice().sort().join("|")).slice(0, 16),
      ]),
    },
  ];
}

function rolesOf(extracted: unknown): string[] {
  const roles = (extracted as { roles?: unknown[] } | null)?.roles;
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => (r as { title?: unknown })?.title)
    .filter((t): t is string => typeof t === "string");
}

/**
 * Post novo no blog. A extracao estruturada e a fonte preferida; se ela falhar,
 * caimos nas linhas adicionadas do git-diff — que e o que o diff.json serve.
 */
function blogEvents(ctx: WebContext, base: EventBase): DraftEvent[] {
  const before = new Set(postsOf(ctx.previous?.extracted).map((p) => p.title));
  const after = postsOf(ctx.scrape.extracted);

  const fresh = after.filter((p) => !before.has(p.title));

  if (fresh.length > 0) {
    return fresh.map((p) => ({
      ...base,
      kind: "blog_post" as const,
      title: `Post novo: "${p.title}"`,
      summary: null,
      url: p.url ?? base.url,
      diff: null,
      payload: p as unknown as Json,
      dedupe_key: dedupe(["web", ctx.sourceId, "blogpost", hashContent(p.title).slice(0, 16)]),
    }));
  }

  // Fallback: linhas que entraram no diff, quando a extracao nao devolveu nada.
  if (after.length === 0) {
    const added = addedLines(ctx.scrape.tracking.diffJson)
      .map((l) => l.content.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 12 && l.length < 200);

    return added.slice(0, 5).map((line) => ({
      ...base,
      kind: "blog_post" as const,
      title: `Post novo: "${excerpt(line, 120)}"`,
      summary: null,
      diff: null,
      payload: { source: "git-diff", line } as Json,
      dedupe_key: dedupe(["web", ctx.sourceId, "blogpost", hashContent(line).slice(0, 16)]),
    }));
  }

  return [];
}

function postsOf(extracted: unknown): Array<{ title: string; url: string | null }> {
  const posts = (extracted as { posts?: unknown[] } | null)?.posts;
  if (!Array.isArray(posts)) return [];
  return posts
    .map((p) => {
      const o = p as { title?: unknown; url?: unknown };
      return typeof o.title === "string"
        ? { title: o.title, url: typeof o.url === "string" ? o.url : null }
        : null;
    })
    .filter((p): p is { title: string; url: string | null } => p !== null);
}

// ===========================================================================
// Instagram
// ===========================================================================

/** Variacao de seguidores a partir da qual vira evento. */
const FOLLOWERS_JUMP_RATIO = 0.05;
const FOLLOWERS_JUMP_MIN = 100;

export type InstagramContext = {
  competitorId: string;
  sourceId: string;
  handle: string;
  runId: string | null;
  profile: Profile | null;
  /** Posts que ainda nao existiam em instagram_posts. */
  newPosts: Post[];
  capturedAt: string;
  previous: Pick<
    InstagramProfileSnapshot,
    "id" | "followers_count" | "biography" | "external_url" | "is_private"
  > | null;
};

export function instagramEvents(ctx: InstagramContext): DraftEvent[] {
  const { profile, previous, capturedAt } = ctx;
  const handle = ctx.handle.replace(/^@/, "");
  const profileUrl = `https://instagram.com/${handle}`;

  const base = {
    competitor_id: ctx.competitorId,
    source_id: ctx.sourceId,
    run_id: ctx.runId,
    occurred_at: capturedAt,
    diff: null,
  };

  const events: DraftEvent[] = [];

  // Conta fechou: a coleta para aqui, e isso e critico.
  if (profile?.isPrivate && previous?.is_private === false) {
    events.push({
      ...base,
      kind: "account_private",
      title: `@${handle} fechou o perfil`,
      summary: "A conta virou privada. A coleta de posts e engajamento para a partir de agora.",
      url: profileUrl,
      payload: {} as Json,
      dedupe_key: dedupe(["ig", ctx.sourceId, "private", isoWeek(new Date(capturedAt))]),
    });
    return events;
  }

  // Sem baseline, tudo e "novo": so referencia.
  if (previous === null) return events;

  // --- posts novos (fixado nao conta: reaparece em toda coleta) ------------
  for (const post of ctx.newPosts) {
    if (post.isPinned) continue;

    const isReel = post.productType === "clips";
    const kindLabel = isReel ? "um reel" : post.mediaType === "Video" ? "um video" : "um post";

    events.push({
      ...base,
      kind: "new_post",
      title: `@${handle} publicou ${kindLabel}`,
      summary: post.caption ? excerpt(post.caption, 280) : null,
      url: post.url ?? profileUrl,
      payload: {
        igId: post.igId,
        mediaType: post.mediaType,
        productType: post.productType,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        hashtags: post.hashtags,
        taggedUsers: post.taggedUsers,
        displayUrl: post.displayUrl,
      } as Json,
      occurred_at: post.timestamp ?? capturedAt,
      dedupe_key: dedupe(["ig", ctx.sourceId, "post", post.igId]),
    });
  }

  if (!profile) return events;

  // --- bio / nome ---------------------------------------------------------
  if (profile.biography !== null && profile.biography !== previous.biography) {
    events.push({
      ...base,
      kind: "bio_changed",
      title: `@${handle} mudou a bio`,
      summary: profile.biography,
      url: profileUrl,
      payload: { before: previous.biography, after: profile.biography } as Json,
      dedupe_key: dedupe(["ig", ctx.sourceId, "bio", hashContent(profile.biography).slice(0, 16)]),
    });
  }

  // --- CTA da bio ---------------------------------------------------------
  if (profile.externalUrl !== previous.external_url) {
    events.push({
      ...base,
      kind: "external_url_changed",
      title: `@${handle} mudou o link da bio`,
      summary: `${previous.external_url ?? "sem link"} → ${profile.externalUrl ?? "sem link"}`,
      url: profile.externalUrl ?? profileUrl,
      payload: { before: previous.external_url, after: profile.externalUrl } as Json,
      dedupe_key: dedupe(["ig", ctx.sourceId, "cta", String(profile.externalUrl)]),
    });
  }

  // --- salto de seguidores ------------------------------------------------
  const before = previous.followers_count;
  const after = profile.followersCount;
  if (before !== null && after !== null && before > 0) {
    const delta = after - before;
    const ratio = Math.abs(delta) / before;
    if (Math.abs(delta) >= FOLLOWERS_JUMP_MIN && ratio >= FOLLOWERS_JUMP_RATIO) {
      const sign = delta > 0 ? "+" : "";
      events.push({
        ...base,
        kind: "followers_jump",
        title: `@${handle}: ${sign}${delta.toLocaleString("pt-BR")} seguidores`,
        summary: `${before.toLocaleString("pt-BR")} → ${after.toLocaleString("pt-BR")} (${sign}${(ratio * 100).toFixed(1)}%)`,
        url: profileUrl,
        payload: { before, after, delta, ratio } as Json,
        dedupe_key: dedupe(["ig", ctx.sourceId, "followers", isoWeek(new Date(capturedAt))]),
      });
    }
  }

  return events;
}

// ===========================================================================
// Persistencia
// ===========================================================================

/**
 * Grava os eventos ignorando os que ja existem (mesmo `dedupe_key`).
 * A severidade sai da tabela de tipos — nunca e escolhida na chamada.
 */
export async function saveEvents(events: DraftEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  // Dedupe dentro do lote: o Postgres rejeita upsert com chave repetida no
  // mesmo comando.
  const unique = [...new Map(events.map((e) => [e.dedupe_key, e])).values()];

  const rows: Array<Partial<ChangeEvent>> = unique.map((e) => ({
    ...e,
    severity: SEVERITY_BY_KIND[e.kind],
  }));

  const { data, error } = await supabaseAdmin()
    .from("change_events")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`Falha ao gravar change_events: ${error.message}`);

  return data?.length ?? 0;
}
