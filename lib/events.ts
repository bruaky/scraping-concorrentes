import "server-only";

import { createHash } from "node:crypto";

import type { InstagramPost, InstagramProfile } from "./apify";
import type { FirecrawlScrape } from "./firecrawl";
import { supabaseAdmin } from "./supabase";
import type { ChangeKind, Json, Snapshot, Source } from "./database.types";

/**
 * Traduz o que os scrapers devolveram em linhas de `change_events`.
 *
 * Cada evento carrega um `dedupe_key` estavel, e a insercao e um upsert
 * ignorando conflito nessa chave — rodar o cron duas vezes na mesma semana
 * nao duplica a timeline.
 */

export interface DraftEvent {
  competitor_id: string;
  source_id: string | null;
  snapshot_id: string | null;
  prev_snapshot_id: string | null;
  run_id: string | null;
  kind: ChangeKind;
  severity: number;
  title: string;
  summary: string | null;
  url: string | null;
  diff: string | null;
  payload: Json;
  occurred_at: string;
  dedupe_key: string;
}

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dedupe(parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => String(p ?? "")).join(":");
}

/** Recorta um trecho legivel de texto longo (diff, caption) pro card. */
function excerpt(text: string, max = 400): string {
  const clean = text.trim().replace(/\n{3,}/g, "\n\n");
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

/** Semana ISO usada nas dedupe keys de eventos semanais. */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // quinta-feira da semana corrente define o ano ISO
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Website
// ---------------------------------------------------------------------------

/**
 * Deriva eventos do resultado do Firecrawl.
 *
 * Preferimos o `changeTracking` do proprio Firecrawl; quando ele nao vem
 * (primeira captura numa conta nova, actor sem historico), caimos no
 * comparativo de `content_hash` contra o snapshot anterior.
 */
export function websiteEvents(args: {
  source: Pick<Source, "id" | "competitor_id" | "label" | "target">;
  scrape: FirecrawlScrape;
  snapshot: Pick<Snapshot, "id" | "content_hash" | "captured_at">;
  previous: Pick<Snapshot, "id" | "content_hash"> | null;
  runId: string | null;
}): DraftEvent[] {
  const { source, scrape, snapshot, previous, runId } = args;
  const tracking = scrape.changeTracking;
  const isPricing = (source.label ?? "").toLowerCase().includes("pricing");

  const status =
    tracking?.changeStatus ??
    (previous === null
      ? "new"
      : previous.content_hash === snapshot.content_hash
        ? "same"
        : "changed");

  if (status === "same") return [];

  const base = {
    competitor_id: source.competitor_id,
    source_id: source.id,
    snapshot_id: snapshot.id,
    prev_snapshot_id: previous?.id ?? null,
    run_id: runId,
    url: scrape.url,
    occurred_at: snapshot.captured_at,
  };

  const label = source.label ? `${source.label} — ` : "";
  const diff = tracking?.diff?.text ?? null;

  if (status === "new") {
    // Primeira captura de uma fonte ja existente conta como pagina nova; a
    // primeira captura absoluta (sem snapshot anterior) e so o baseline.
    if (previous === null) return [];
    return [
      {
        ...base,
        kind: "page_added" as const,
        severity: 2,
        title: `${label}${scrape.title ?? scrape.url} entrou no ar`,
        summary: scrape.description,
        diff: null,
        payload: { statusCode: scrape.statusCode } as Json,
        dedupe_key: dedupe(["web", source.id, "added", snapshot.content_hash]),
      },
    ];
  }

  if (status === "removed") {
    return [
      {
        ...base,
        kind: "page_removed" as const,
        severity: 3,
        title: `${label}${scrape.url} saiu do ar`,
        summary: `Firecrawl nao conseguiu mais carregar a pagina (status ${scrape.statusCode ?? "?"}).`,
        diff: null,
        payload: { statusCode: scrape.statusCode } as Json,
        dedupe_key: dedupe(["web", source.id, "removed", isoWeek(new Date(snapshot.captured_at))]),
      },
    ];
  }

  return [
    {
      ...base,
      kind: isPricing ? ("pricing_changed" as const) : ("page_changed" as const),
      severity: isPricing ? 3 : 2,
      title: `${label}${scrape.title ?? scrape.url} mudou`,
      summary: diff ? excerpt(diff) : "Conteudo da pagina mudou desde a ultima captura.",
      diff,
      payload: {
        previousScrapeAt: tracking?.previousScrapeAt ?? null,
        visibility: tracking?.visibility ?? null,
      } as Json,
      dedupe_key: dedupe(["web", source.id, "changed", snapshot.content_hash]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

/** Variacao de seguidores a partir da qual vira evento. */
const FOLLOWERS_JUMP_RATIO = 0.05;
const FOLLOWERS_JUMP_MIN = 100;

export function instagramEvents(args: {
  source: Pick<Source, "id" | "competitor_id" | "target">;
  profile: InstagramProfile | null;
  posts: InstagramPost[];
  snapshot: Pick<Snapshot, "id" | "captured_at">;
  previous: (Pick<Snapshot, "id" | "followers"> & { payload: Json }) | null;
  runId: string | null;
}): DraftEvent[] {
  const { source, profile, posts, snapshot, previous, runId } = args;
  const handle = source.target.replace(/^@/, "");

  const base = {
    competitor_id: source.competitor_id,
    source_id: source.id,
    snapshot_id: snapshot.id,
    prev_snapshot_id: previous?.id ?? null,
    run_id: runId,
    occurred_at: snapshot.captured_at,
    diff: null,
  };

  const events: DraftEvent[] = [];

  // --- posts novos -------------------------------------------------------
  const seen = new Set(previousPostIds(previous?.payload ?? null));
  for (const post of posts) {
    // Sem baseline anterior nao ha como saber o que e novo: so registra.
    if (previous === null) break;
    if (seen.has(post.id)) continue;

    events.push({
      ...base,
      kind: "new_post",
      severity: 1,
      title: `@${handle} publicou${post.type ? ` um ${post.type.toLowerCase()}` : ""}`,
      summary: post.caption ? excerpt(post.caption, 280) : null,
      url: post.url,
      payload: {
        postId: post.id,
        likes: post.likes,
        comments: post.comments,
        displayUrl: post.displayUrl,
      } as Json,
      occurred_at: post.timestamp ?? snapshot.captured_at,
      dedupe_key: dedupe(["ig", source.id, "post", post.id]),
    });
  }

  if (!profile) return events;

  const prevProfile = previousProfile(previous?.payload ?? null);

  // --- bio / link / nome -------------------------------------------------
  if (prevProfile) {
    const changed: string[] = [];
    if (prevProfile.biography !== profile.biography) changed.push("bio");
    if (prevProfile.externalUrl !== profile.externalUrl) changed.push("link");
    if (prevProfile.fullName !== profile.fullName) changed.push("nome");

    if (changed.length > 0) {
      events.push({
        ...base,
        kind: "bio_changed",
        severity: 2,
        title: `@${handle} mudou ${changed.join(", ")}`,
        summary: profile.biography,
        url: `https://instagram.com/${handle}`,
        payload: {
          changed,
          before: {
            biography: prevProfile.biography,
            externalUrl: prevProfile.externalUrl,
            fullName: prevProfile.fullName,
          },
          after: {
            biography: profile.biography,
            externalUrl: profile.externalUrl,
            fullName: profile.fullName,
          },
        } as Json,
        dedupe_key: dedupe([
          "ig",
          source.id,
          "bio",
          hashContent(`${profile.biography}|${profile.externalUrl}|${profile.fullName}`),
        ]),
      });
    }
  }

  // --- salto de seguidores ----------------------------------------------
  const before = previous?.followers ?? null;
  const after = profile.followers;
  if (before !== null && after !== null && before > 0) {
    const delta = after - before;
    const ratio = Math.abs(delta) / before;
    if (Math.abs(delta) >= FOLLOWERS_JUMP_MIN && ratio >= FOLLOWERS_JUMP_RATIO) {
      const sign = delta > 0 ? "+" : "";
      events.push({
        ...base,
        kind: "followers_jump",
        severity: 2,
        title: `@${handle}: ${sign}${delta.toLocaleString("pt-BR")} seguidores`,
        summary: `${before.toLocaleString("pt-BR")} → ${after.toLocaleString("pt-BR")} (${sign}${(ratio * 100).toFixed(1)}%)`,
        url: `https://instagram.com/${handle}`,
        payload: { before, after, delta, ratio } as Json,
        dedupe_key: dedupe(["ig", source.id, "followers", isoWeek(new Date(snapshot.captured_at))]),
      });
    }
  }

  return events;
}

function previousPostIds(payload: Json): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const posts = (payload as Record<string, Json>).posts;
  if (!Array.isArray(posts)) return [];
  return posts
    .map((p) => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, Json>).id : null))
    .filter((id): id is string => typeof id === "string");
}

function previousProfile(payload: Json): Pick<
  InstagramProfile,
  "biography" | "externalUrl" | "fullName"
> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const profile = (payload as Record<string, Json>).profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const p = profile as Record<string, Json>;
  return {
    biography: typeof p.biography === "string" ? p.biography : null,
    externalUrl: typeof p.externalUrl === "string" ? p.externalUrl : null,
    fullName: typeof p.fullName === "string" ? p.fullName : null,
  };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

/** Grava os eventos ignorando os que ja existem (mesmo `dedupe_key`). */
export async function saveEvents(events: DraftEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  // Dedupe dentro do proprio lote antes de mandar pro banco: o Postgres
  // rejeita um upsert com a mesma chave repetida no mesmo comando.
  const unique = [...new Map(events.map((e) => [e.dedupe_key, e])).values()];

  const { data, error } = await supabaseAdmin()
    .from("change_events")
    .upsert(unique, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`Falha ao gravar change_events: ${error.message}`);

  return data?.length ?? 0;
}
