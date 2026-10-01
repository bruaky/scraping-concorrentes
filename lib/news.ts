import "server-only";

import { actorFrom, token } from "./apify";
import { ensureTrackedCompetitors } from "./ensure-tracked";
import { closeRun, openRun } from "./runs";
import { supabaseAdmin } from "./supabase";
import { NEWS_QUERIES, PRESS, TRACKED_SLUGS, type NewsQuery } from "./tracked";
import type { Json, NewsKind } from "./database.types";

/**
 * Competitor news: o que saiu sobre cada concorrente, POR DATA.
 *
 * Duas fontes:
 *   - Imprensa: Google Noticias (data_xplorer/google-news-scraper-fast),
 *     ultimos 30 dias, com data de publicacao. Um run para todos.
 *   - Blog, site e vagas: busca comum do Google (apify/google-search-
 *     scraper) com filtro do ultimo mes. Ele faz uma busca depois da outra
 *     (~20 s cada), entao roda um run por concorrente, em paralelo.
 *
 * A busca comum tambem trazia "mencoes", mas quase nunca com data — eram os
 * links mais relevantes, nao os mais recentes. Sairam: mencao agora e a
 * imprensa do Google Noticias. A tela so mostra o que tem data.
 *
 * Custo medido em 01/10/2026: ~US$ 0,0045 por busca comum + US$ 0,001 por
 * run; US$ 0,004 por noticia do Google Noticias.
 */

const API = "https://api.apify.com/v2";
const DEFAULT_SEARCH_ACTOR = "apify~google-search-scraper";
const DEFAULT_PRESS_ACTOR = "data_xplorer~google-news-scraper-fast";

/** Janela das noticias, na coleta e na tela. */
export const NEWS_WINDOW_DAYS = 30;

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
 * uma vez, com o tipo da primeira.
 */
export function parseNews(pages: SearchPage[], queries: NewsQuery[]): NewsItem[] {
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

type PressItem = {
  title?: unknown;
  url?: unknown;
  source?: unknown;
  publishedAt?: unknown;
  metadata?: { keyword?: unknown };
};

/**
 * Google Noticias -> itens por concorrente. Puro, para teste.
 *
 * Cada noticia diz qual palavra-chave a achou (metadata.keyword), e e por
 * ela que se sabe de quem e. So entra com data e com o nome do concorrente
 * no titulo (ver PRESS). O " - Fonte" que o Google cola no fim do titulo sai.
 */
export function parsePress(
  items: PressItem[],
  press: Record<string, { keyword: string; title: string[] }>,
): Map<string, NewsItem[]> {
  const slugOf = new Map(Object.entries(press).map(([slug, p]) => [p.keyword, slug]));
  const out = new Map<string, NewsItem[]>();
  const seen = new Set<string>();

  for (const item of items) {
    const keyword = typeof item.metadata?.keyword === "string" ? item.metadata.keyword : "";
    const slug = slugOf.get(keyword);
    const url = typeof item.url === "string" ? item.url : null;
    const publishedAt = isoDate(item.publishedAt);
    let title = text(item.title);
    if (!slug || !url || !publishedAt || !title || seen.has(url)) continue;

    if (!press[slug].title.some((t) => title!.includes(t))) continue;
    seen.add(url);

    const source = text(item.source);
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));

    const list = out.get(slug) ?? [];
    list.push({ kind: "mention", url, title, snippet: null, source, publishedAt, query: keyword, raw: item });
    out.set(slug, list);
  }

  return out;
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

async function startRun(actor: string, input: unknown): Promise<Run> {
  return apify<Run>(`/acts/${actor}/runs`, { method: "POST", body: JSON.stringify(input) });
}

function startSearch(queries: NewsQuery[]): Promise<Run> {
  return startRun(actorFrom(process.env.APIFY_GOOGLE_SEARCH_ACTOR, DEFAULT_SEARCH_ACTOR), {
    queries: queries.map((q) => q.query).join("\n"),
    maxPagesPerQuery: 1,
    // So o que o Google datou no ultimo mes.
    quickDateRange: "m1",
    saveHtmlToKeyValueStore: false,
  });
}

function startPress(slugs: string[]): Promise<Run> {
  return startRun(actorFrom(process.env.APIFY_GOOGLE_NEWS_ACTOR, DEFAULT_PRESS_ACTOR), {
    keywords: slugs.map((s) => PRESS[s].keyword),
    maxArticles: 10, // por palavra-chave
    timeframe: `${NEWS_WINDOW_DAYS}d`,
    region_language: "US:en",
    decodeUrls: true,
    extractDescriptions: false,
    extractImages: false,
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

async function datasetItems<T = SearchPage>(run: Run): Promise<T[]> {
  const res = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Apify dataset falhou: ${res.status}`);
  return (await res.json()) as T[];
}

/**
 * Quantos runs ao mesmo tempo. A conta gratuita aceita 5 jobs simultaneos e
 * a coleta semanal roda o Instagram em paralelo (1 job): 4 deixa folga. O
 * run mais lento (Glean, 2 buscas comuns) domina o tempo; os outros
 * terminam em 10-30 s e liberam vaga para o proximo da fila.
 */
const MAX_PARALLEL = 4;

type Found = { items: NewsItem[]; errors: string[] };

/**
 * Busca as noticias de cada concorrente e devolve os itens de cada um, sem
 * gravar. A imprensa e um run so para todos; a busca comum, um run por
 * concorrente. Tudo numa fila de ate MAX_PARALLEL runs.
 */
export async function searchNews(slugs: string[], deadline: number): Promise<Map<string, Found>> {
  const out = new Map<string, Found>(slugs.map((s) => [s, { items: [], errors: [] }]));
  const add = (slug: string, items: NewsItem[]) => out.get(slug)?.items.push(...items);
  const fail = (slug: string, error: string) => out.get(slug)?.errors.push(error);

  const pressSlugs = slugs.filter((s) => PRESS[s]);
  type Task = { kind: "press" } | { kind: "search"; slug: string };
  const queue: Task[] = [
    // Imprensa primeiro: e rapida (~10 s) e e o que mais importa.
    ...(pressSlugs.length ? [{ kind: "press" as const }] : []),
    ...slugs.filter((s) => NEWS_QUERIES[s]?.length).map((slug) => ({ kind: "search" as const, slug })),
  ];

  async function runTask(task: Task) {
    const who = task.kind === "press" ? pressSlugs : [task.slug];
    if (Date.now() >= deadline) return who.forEach((s) => fail(s, "sem tempo para buscar"));
    try {
      if (task.kind === "press") {
        const run = await waitRun(await startPress(pressSlugs), deadline);
        const bySlug = parsePress(await datasetItems<PressItem>(run), PRESS);
        for (const s of pressSlugs) add(s, bySlug.get(s) ?? []);
        if (run.status !== "SUCCEEDED" && bySlug.size === 0) throw new Error(`imprensa: run ${run.status.toLowerCase()}`);
      } else {
        const queries = NEWS_QUERIES[task.slug];
        const run = await waitRun(await startSearch(queries), deadline);
        // TIMED-OUT ainda tem o que deu tempo de buscar; so falha sem dado.
        const items = parseNews(await datasetItems(run), queries);
        add(task.slug, items);
        if (run.status !== "SUCCEEDED" && items.length === 0) throw new Error(`busca: run ${run.status.toLowerCase()}`);
      }
    } catch (err) {
      who.forEach((s) => fail(s, message(err)));
    }
  }

  async function worker() {
    for (let task = queue.shift(); task; task = queue.shift()) await runTask(task);
  }

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, queue.length) }, worker));
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

  const targets = (competitors ?? []).filter((c) => NEWS_QUERIES[c.slug]?.length || PRESS[c.slug]);
  const runId = await openRun("apify_google", job);

  try {
    const found = await searchNews(
      targets.map((c) => c.slug),
      deadline,
    );

    const results = await Promise.all(
      targets.map(async (c): Promise<NewsResult> => {
        const base = { slug: c.slug, name: c.name };
        const r = found.get(c.slug) ?? { items: [], errors: ["sem busca configurada"] };
        // Falhou so se nada veio: uma das duas fontes basta.
        if (r.items.length === 0 && r.errors.length > 0) {
          return { ...base, ok: false, found: 0, fresh: 0, error: r.errors.join("; ") };
        }
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
