import "server-only";

/**
 * Dispara as rotas de ingest.
 *
 * Cada ingest roda como requisicao propria para ter seu `maxDuration`, e o
 * custo de cada um fica separado em `collection_runs`.
 */
export type IngestSummary = {
  job: "instagram" | "news";
  ok: boolean;
  runId?: string;
  events?: number | null;
  ok_count?: number;
  failed?: number;
  error?: string;
};

const ENDPOINTS = {
  instagram: "/api/ingest/instagram",
  news: "/api/ingest/news",
} as const;

export async function runIngest(job: keyof typeof ENDPOINTS): Promise<IngestSummary> {
  try {
    const res = await fetch(`${baseUrl()}${ENDPOINTS[job]}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const body = (await res.json()) as Record<string, unknown>;

    if (!res.ok || body.ok !== true) {
      return { job, ok: false, error: String(body.error ?? `HTTP ${res.status}`) };
    }

    return {
      job,
      ok: true,
      runId: body.runId as string,
      events: body.events as number | null,
      ok_count: body.ok_count as number,
      failed: body.failed as number,
    };
  } catch (err) {
    return { job, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Em paralelo: cada ingest e uma funcao propria com 300 s, mas o cron espera
 * as duas — em sequencia, ~3 min de Instagram + ~2 min de noticias
 * estourariam o limite dele.
 */
export async function runFullPipeline(): Promise<IngestSummary[]> {
  return Promise.all([runIngest("instagram"), runIngest("news")]);
}

/** URL da propria app, para o cron chamar as rotas de ingest. */
export function baseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (host) return `https://${host}`;

  return "http://localhost:3000";
}
