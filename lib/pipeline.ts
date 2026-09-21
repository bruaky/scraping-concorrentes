import "server-only";

/**
 * Dispara as rotas de ingest.
 *
 * Cada ingest roda como requisicao propria para ter seu `maxDuration` — uma
 * falha do Instagram nao derruba a coleta do site, e o custo de cada um fica
 * separado em `collection_runs`.
 */
export type IngestSummary = {
  job: "firecrawl" | "instagram";
  ok: boolean;
  runId?: string;
  events?: number | null;
  ok_count?: number;
  failed?: number;
  error?: string;
};

const ENDPOINTS = {
  firecrawl: "/api/ingest/firecrawl",
  instagram: "/api/ingest/instagram",
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

export async function runFullPipeline(): Promise<IngestSummary[]> {
  return [await runIngest("firecrawl"), await runIngest("instagram")];
}

/** URL da propria app, para o cron e o webhook chamarem as rotas de ingest. */
export function baseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (host) return `https://${host}`;

  return "http://localhost:3000";
}
