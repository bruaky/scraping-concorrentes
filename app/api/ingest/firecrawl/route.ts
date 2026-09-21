import { assertAuthorized, errorResponse } from "@/lib/auth";
import { hashContent, saveEvents, websiteEvents } from "@/lib/events";
import { scrape } from "@/lib/firecrawl";
import { supabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  /** Limita a um concorrente. Sem isso, roda todas as fontes ativas. */
  competitorSlug?: string;
  /** Limita a fontes especificas. */
  sourceIds?: string[];
  /** Amarra os snapshots/eventos a uma execucao criada pelo cron. */
  runId?: string;
}

/**
 * Captura os sites dos concorrentes via Firecrawl e transforma o
 * `changeTracking` em `change_events`.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    assertAuthorized(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const db = supabaseAdmin();

    let query = db
      .from("sources")
      .select("id, competitor_id, kind, target, label, competitors!inner(slug)")
      .eq("kind", "website")
      .eq("is_active", true);

    if (body.competitorSlug) query = query.eq("competitors.slug", body.competitorSlug);
    if (body.sourceIds?.length) query = query.in("id", body.sourceIds);

    const { data: sources, error } = await query;
    if (error) throw new Error(`Falha ao listar sources: ${error.message}`);

    const results = await Promise.all(
      (sources ?? []).map((source) => ingestSource(source, body.runId ?? null)),
    );

    return Response.json({
      ok: true,
      sources: results.length,
      succeeded: results.filter((r) => r.ok).length,
      events: results.reduce((sum, r) => sum + (r.ok ? r.events : 0), 0),
      results,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

type SourceRow = {
  id: string;
  competitor_id: string;
  target: string;
  label: string | null;
};

type Result =
  | { ok: true; sourceId: string; target: string; events: number; status: string }
  | { ok: false; sourceId: string; target: string; error: string };

async function ingestSource(source: SourceRow, runId: string | null): Promise<Result> {
  const db = supabaseAdmin();

  try {
    const page = await scrape(source.target, { tag: source.id });

    // Snapshot anterior: usado como fallback quando o Firecrawl nao devolve
    // changeTracking, e como referencia no evento.
    const { data: previous } = await db
      .from("snapshots")
      .select("id, content_hash")
      .eq("source_id", source.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: snapshot, error: snapError } = await db
      .from("snapshots")
      .insert({
        competitor_id: source.competitor_id,
        source_id: source.id,
        run_id: runId,
        kind: "website",
        content_hash: hashContent(page.markdown),
        title: page.title,
        markdown: page.markdown,
        payload: {
          description: page.description,
          statusCode: page.statusCode,
          changeTracking: page.changeTracking,
        } as Json,
      })
      .select("id, content_hash, captured_at")
      .single();

    if (snapError || !snapshot) {
      throw new Error(`Falha ao gravar snapshot: ${snapError?.message ?? "sem retorno"}`);
    }

    const events = websiteEvents({
      source,
      scrape: page,
      snapshot,
      previous: previous ?? null,
      runId,
    });

    const saved = await saveEvents(events);

    await db
      .from("sources")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", source.id);

    return {
      ok: true,
      sourceId: source.id,
      target: source.target,
      events: saved,
      status: page.changeTracking?.changeStatus ?? "unknown",
    };
  } catch (err) {
    return {
      ok: false,
      sourceId: source.id,
      target: source.target,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
