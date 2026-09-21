import "server-only";

/**
 * Wrapper fino sobre a API v2 do Firecrawl.
 *
 * Usamos o formato `changeTracking`, que compara o scrape atual com o anterior
 * da mesma URL (o Firecrawl guarda o historico por conta) e devolve
 * `changeStatus` + um diff em git-diff. Isso evita ter que diffar markdown na
 * mao — o `lib/events.ts` so traduz o resultado em `change_events`.
 *
 * Docs: https://docs.firecrawl.dev/features/change-tracking
 */

const DEFAULT_API_URL = "https://api.firecrawl.dev";

export type ChangeStatus = "new" | "same" | "changed" | "removed";

export interface FirecrawlChangeTracking {
  changeStatus: ChangeStatus;
  visibility?: "visible" | "hidden";
  previousScrapeAt?: string | null;
  diff?: { text?: string; json?: unknown } | null;
}

export interface FirecrawlScrape {
  url: string;
  markdown: string;
  title: string | null;
  description: string | null;
  statusCode: number | null;
  changeTracking: FirecrawlChangeTracking | null;
  raw: unknown;
}

function apiUrl(path: string): string {
  const base = process.env.FIRECRAWL_API_URL?.replace(/\/+$/, "") ?? DEFAULT_API_URL;
  return `${base}${path}`;
}

function apiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY nao definida (ver .env.example)");
  return key;
}

/**
 * Faz o scrape de uma URL pedindo markdown + changeTracking.
 *
 * `tag` isola o historico do changeTracking: duas fontes que apontam pra mesma
 * URL com tags diferentes nao se atrapalham.
 */
export async function scrape(
  url: string,
  opts: { tag?: string; onlyMainContent?: boolean; timeoutMs?: number } = {},
): Promise<FirecrawlScrape> {
  const res = await fetch(apiUrl("/v2/scrape"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: [
        "markdown",
        {
          type: "changeTracking",
          modes: ["git-diff"],
          ...(opts.tag ? { tag: opts.tag } : {}),
        },
      ],
      onlyMainContent: opts.onlyMainContent ?? true,
      timeout: opts.timeoutMs ?? 60_000,
    }),
    signal: AbortSignal.timeout((opts.timeoutMs ?? 60_000) + 15_000),
  });

  const body = (await res.json()) as {
    success?: boolean;
    error?: string;
    data?: {
      markdown?: string;
      changeTracking?: FirecrawlChangeTracking;
      metadata?: {
        title?: string;
        description?: string;
        statusCode?: number;
        sourceURL?: string;
      };
    };
  };

  if (!res.ok || !body.success || !body.data) {
    throw new Error(
      `Firecrawl falhou em ${url}: ${res.status} ${body.error ?? "sem detalhe"}`,
    );
  }

  const data = body.data;

  return {
    url: data.metadata?.sourceURL ?? url,
    markdown: data.markdown ?? "",
    title: data.metadata?.title ?? null,
    description: data.metadata?.description ?? null,
    statusCode: data.metadata?.statusCode ?? null,
    changeTracking: data.changeTracking ?? null,
    raw: data,
  };
}

/** Scrape de varias URLs em paralelo, sem deixar uma falha derrubar as outras. */
export async function scrapeMany(
  urls: string[],
  opts: Parameters<typeof scrape>[1] = {},
): Promise<Array<{ url: string; ok: true; data: FirecrawlScrape } | { url: string; ok: false; error: string }>> {
  return Promise.all(
    urls.map(async (url) => {
      try {
        return { url, ok: true as const, data: await scrape(url, opts) };
      } catch (err) {
        return { url, ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}
