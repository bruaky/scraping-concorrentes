import { assertAuthorized, errorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import type { SourceKind } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron semanal (ver `vercel.json`).
 *
 * Abre uma `run` por tipo de fonte, chama as rotas de ingest e fecha a run com
 * o resultado. A Vercel dispara via GET com `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request): Promise<Response> {
  return run(req);
}

/** Mesmo fluxo, pra disparo manual. */
export async function POST(req: Request): Promise<Response> {
  return run(req);
}

async function run(req: Request): Promise<Response> {
  try {
    assertAuthorized(req);

    const trigger = req.method === "GET" ? "cron" : "manual";
    const results = [];

    for (const kind of ["website", "instagram"] as SourceKind[]) {
      results.push(await ingest(kind, trigger));
    }

    const ok = results.every((r) => r.ok);
    return Response.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (err) {
    return errorResponse(err);
  }
}

const ENDPOINTS: Record<SourceKind, string> = {
  website: "/api/ingest/firecrawl",
  instagram: "/api/ingest/instagram",
};

async function ingest(kind: SourceKind, trigger: string) {
  const db = supabaseAdmin();

  const { data: run, error: runError } = await db
    .from("runs")
    .insert({ kind, trigger, status: "running" })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(`Falha ao abrir run: ${runError?.message ?? "sem retorno"}`);
  }

  try {
    const res = await fetch(`${baseUrl()}${ENDPOINTS[kind]}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runId: run.id }),
    });

    const body = (await res.json()) as {
      ok?: boolean;
      sources?: number;
      succeeded?: number;
      events?: number;
      error?: string;
    };

    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? `ingest ${kind} respondeu ${res.status}`);
    }

    await db
      .from("runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        sources_total: body.sources ?? 0,
        sources_ok: body.succeeded ?? 0,
      })
      .eq("id", run.id);

    return { ok: true as const, kind, runId: run.id, ...body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .from("runs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: message })
      .eq("id", run.id);

    return { ok: false as const, kind, runId: run.id, error: message };
  }
}

/** URL da propria app, pro cron chamar as rotas de ingest. */
function baseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (host) return `https://${host}`;

  return "http://localhost:3000";
}
