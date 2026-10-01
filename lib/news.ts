import "server-only";

import { actorFrom, token } from "./apify";
import { ensureTrackedCompetitors } from "./ensure-tracked";
import { closeRun, openRun } from "./runs";
import { supabaseAdmin } from "./supabase";
import { NEWS_KEYWORDS, NEWS_QUERIES, TRACKED_SLUGS, type NewsQuery } from "./tracked";
import type { Json, NewsKind } from "./database.types";

/**
 * Competitor news: o que o Google acha de cada concorrente — posts de blog,
 * paginas novas do site, vagas e mencoes em outros sites.
 *
 * Usa o apify/google-search-scraper. Ele faz uma busca depois da outra
 * (~20 s cada; 12 buscas num run passaram de 4 min), entao aqui roda UM run
 * por concorrente, em paralelo (ate MAX_PARALLEL), sem run-sync: dispara,
 * espera cada um terminar e le o dataset.
 *
 * Custo medido em 01/10/2026: ~US$ 0,0045 por busca + US$ 0,001 por run.
 */

const API = "https://api.apify.com/v2";
const DEFAULT_SEARCH_ACTOR = "apify~google-search-scraper";

export const NEWS_JOB = "news";

export type NewsItem = {
  kind: NewsKind;
  url: string;
  title: string | null;
  snippet: string | null;
  source: string | null;
  publishedAt: string | null;
  query: string;
  raw: unknown;
};

export type NewsResult = {
  slug: string;
  name: string;
  ok: boolean;
  found: number;
  fresh: number;
  error?: string;
};

type SearchPage = {
  searchQuery?: { term?: string };
  organicResults?: Array<Record<string, unknown>>;
};

/**
 * Resultados do Google -> itens de noticia. Puro, para teste.
 *
 * Cada pagina do dataset diz qual busca a gerou (searchQuery.term), e e
 * por ela que sai o tipo (blog, vaga...). Mesma url em duas buscas entra
 * uma vez, com o tipo da primeira. Mencao sem nenhum dos `keywords` no
 * titulo, trecho ou url e descartada (ruido: "stratum", meuze.com...).
 */
export function parseNews(
  pages: SearchPage[],
  queries: NewsQuery[],
  keywords: string[] = [],
): NewsItem[] {
  const kindOf = new Map(queries.map((q) => [q.query.trim(), q.kind]));
  const seen = new Set<string>();
  const items: NewsItem[] = [];

  for (const page of pages) {
    const term = page.searchQuery?.term?.trim() ?? "";
    const kind = kindOf.get(term);
    if (!kind) continue;

    for (const r of page.organicResults ?? []) {
      const url = typeof r.url === "string" ? r.url : null;
      if (!url || seen.has(url)) continue;

      if (kind === "mention" && keywords.length > 0) {
        const blob = `${r.title ?? ""} ${r.description ?? ""} ${url}`.toLowerCase();
        if (!keywords.some((k) => blob.includes(k.toLowerCase()))) continue;
      }
      seen.add(url);

      items.push({
        kind,
        url,
        title: text(r.title),
        snippet: text(r.description),
        source: domain(url),
        publishedAt: isoDate(r.date),
        query: term,
        raw: r,
      });
    }
  }

  return items;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function domain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// --- Apify ------------------------------------------------------------------

async function apify<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Apify ${path.split("?")[0]} falhou: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: T }).data;
}

type Run = { id: string; status: string; defaultDatasetId: string };

const DONE = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

async function startSearch(queries: NewsQuery[]): Promise<Run> {
  const actor = actorFrom(process.env.APIFY_GOOGLE_SEARCH_ACTOR, DEFAULT_SEARCH_ACTOR);
  return apify<Run>(`/acts/${actor}/runs`, {
    method: "POST",
    body: JSON.stringify({
      queries: queries.map((q) => q.query).join("\n"),
      maxPagesPerQuery: 1,
      // Ultimo mes: o bastante para a secao nao nascer vazia; o que ja
      // estava na tabela so atualiza last_seen_at.
      quickDateRange: "m1",
      saveHtmlToKeyValueStore: false,
    }),
  });
}

/** Espera o run terminar, sem passar do prazo (as rotas tem 300 s). */
async function waitRun(run: Run, deadline: number): Promise<Run> {
  let current = run;
  while (!DONE.has(current.status)) {
    const left = Math.floor((deadline - Date.now()) / 1000);
    if (left <= 0) break;
    current = await apify<Run>(`/actor-runs/${current.id}?waitForFinish=${Math.min(60, left)}`);
  }
  return current;
}

async function datasetItems(run: Run): Promise<SearchPage[]> {
  const res = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Apify dataset falhou: ${res.status}`);
  return (await res.json()) as SearchPage[];
}

/**
 * Dispara uma busca por concorrente, todas antes de esperar qualquer uma
 * (e o paralelismo que faz os 4 caberem no limite da rota), e devolve os
 * itens de cada um. Nao grava nada.
 */
/**
 * Quantos runs do Google ao mesmo tempo. A conta gratuita aceita 5 jobs
 * simultaneos e a coleta semanal roda o Instagram em paralelo (1 job): 4
 * deixa folga. O run mais lento (Glean, 3 buscas) domina o tempo; os
 * outros terminam em 10-30 s e liberam vaga para o proximo da fila.
 */
const MAX_PARALLEL = 4;

/**
 * Busca as noticias de cada concorrente — um run por concorrente, ate
 * MAX_PARALLEL de uma vez — e devolve os itens de cada um. Nao grava nada.
 */
export async function searchNews(
  slugs: string[],
  deadline: number,
): Promise<Map<string, { items: NewsItem[]; status: string } | { error: string }>> {
  const out = new Map<string, { items: NewsItem[]; status: string } | { error: string }>();
  const queue = [...slugs];

  async function worker() {
    for (let slug = queue.shift(); slug; slug = queue.shift()) {
      if (Date.now() >= deadline) {
        out.set(slug, { error: "sem tempo para buscar" });
        continue;
      }
      const queries = NEWS_QUERIES[slug] ?? [];
      try {
        const run = await waitRun(await startSearch(queries), deadline);
        // TIMED-OUT ainda tem o que deu tempo de buscar; so falha sem dado.
        const items = parseNews(await datasetItems(run), queries, NEWS_KEYWORDS[slug]);
        if (items.length === 0 && run.status !== "SUCCEEDED") {
          out.set(slug, { error: `run ${run.status.toLowerCase()} sem resultados` });
        } else {
          out.set(slug, { items, status: run.status });
        }
      } catch (err) {
        out.set(slug, { error: message(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, slugs.length) }, worker));
  return out;
}

// --- coleta -----------------------------------------------------------------

/**
 * Busca as noticias dos concorrentes acompanhados e grava em competitor_news.
 * Abre e fecha o proprio run em collection_runs (source apify_google).
 */
export async function collectNews(
  job = NEWS_JOB,
  opts: { budgetMs?: number } = {},
): Promise<{ runId: string; results: NewsResult[] }> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const db = supabaseAdmin();
  await ensureTrackedCompetitors();

  const { data: competitors, error } = await db
    .from("competitors")
    .select("id, slug, name")
    .eq("is_active", true)
    .in("slug", TRACKED_SLUGS);
  if (error) throw new Error(`Falha ao listar concorrentes: ${error.message}`);

  const targets = (competitors ?? []).filter((c) => NEWS_QUERIES[c.slug]?.length);
  const runId = await openRun("apify_google", job);

  try {
    const found = await searchNews(
      targets.map((c) => c.slug),
      deadline,
    );

    const results = await Promise.all(
      targets.map(async (c): Promise<NewsResult> => {
        const base = { slug: c.slug, name: c.name };
        const r = found.get(c.slug);
        if (!r || "error" in r) return { ...base, ok: false, found: 0, fresh: 0, error: r?.error };
        try {
          const fresh = await persist(c.id, runId, r.items);
          return { ...base, ok: true, found: r.items.length, fresh };
        } catch (err) {
          return { ...base, ok: false, found: 0, fresh: 0, error: message(err) };
        }
      }),
    );

    const ok = results.filter((r) => r.ok).length;
    await closeRun(runId, { ok, failed: results.length - ok });
    return { runId, results };
  } catch (err) {
    await closeRun(runId, { ok: 0, failed: 0, error: message(err) }).catch(() => {});
    throw err;
  }
}

/**
 * Upsert por (concorrente, url): noticia que ja existia so atualiza titulo,
 * trecho e last_seen_at — first_seen_at fica, e e ele que ordena a secao.
 * Devolve quantas sao novas.
 */
async function persist(competitorId: string, runId: string, items: NewsItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("competitor_news")
    .select("url")
    .eq("competitor_id", competitorId)
    .in(
      "url",
      items.map((i) => i.url),
    );
  const known = new Set((existing ?? []).map((e) => e.url));

  const now = new Date().toISOString();
  const { error } = await db.from("competitor_news").upsert(
    items.map((i) => ({
      competitor_id: competitorId,
      run_id: runId,
      kind: i.kind,
      url: i.url,
      title: i.title,
      snippet: i.snippet,
      source: i.source,
      published_at: i.publishedAt,
      last_seen_at: now,
      query: i.query,
      raw: i.raw as Json,
    })),
    { onConflict: "competitor_id,url" },
  );
  if (error) throw new Error(`Falha ao gravar noticias: ${error.message}`);

  return items.filter((i) => !known.has(i.url)).length;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
