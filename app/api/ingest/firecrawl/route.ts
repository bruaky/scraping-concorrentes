import { assertAuthorized, errorResponse } from "@/lib/auth";
import { hashContent, saveEvents, webEvents } from "@/lib/events";
import { headlinePrice, jobsCount } from "@/lib/extract";
import { scrape } from "@/lib/firecrawl";
import { activeSources, type SourceRow } from "@/lib/sources";
import { supabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  competitorSlug?: string;
  sourceIds?: string[];
  runId?: string;
};

/** Captura os sites dos concorrentes e transforma o changeTracking em eventos. */
export async function POST(req: Request): Promise<Response> {
  try {
    assertAuthorized(req);

    const body = (await req.json().catch(() => ({}))) as Body;

    const sources = await activeSources("website", {
      competitorSlug: body.competitorSlug,
      sourceIds: body.sourceIds,
    });

    const results = await Promise.all(
      sources.map((s) => ingestSource(s, body.runId ?? null)),
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

type Result =
  | { ok: true; sourceId: string; target: string; events: number; status: string }
  | { ok: false; sourceId: string; target: string; error: string };

async function ingestSource(source: SourceRow, runId: string | null): Promise<Result> {
  const db = supabaseAdmin();

  try {
    const page = await scrape(source.target, {
      pageType: source.page_type,
      tag: source.id,
    });

    const { data: previous } = await db
      .from("web_snapshots")
      .select("id, content_hash, visibility, extracted, jobs_count, headline_price")
      .eq("source_id", source.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const price = headlinePrice(page.extracted);

    const { data: snapshot, error: snapError } = await db
      .from("web_snapshots")
      .insert({
        competitor_id: source.competitor_id,
        source_id: source.id,
        run_id: runId,
        change_status: page.tracking.changeStatus,
        tracking_warning: page.warning,
        previous_scrape_at: page.tracking.previousScrapeAt,
        visibility: page.tracking.visibility,
        status_code: page.statusCode,
        title: page.title,
        content_hash: hashContent(page.markdown),
        markdown: page.markdown,
        diff_text: page.tracking.diffText,
        diff_json: (page.tracking.diffJson ?? null) as Json,
        extracted: (page.extracted ?? null) as Json,
        jobs_count: source.page_type === "careers" ? jobsCount(page.extracted) : null,
        headline_price: source.page_type === "pricing" ? (price?.price ?? null) : null,
        price_currency: source.page_type === "pricing" ? (price?.currency ?? null) : null,
      })
      .select("id, captured_at")
      .single();

    if (snapError || !snapshot) {
      throw new Error(`Falha ao gravar snapshot: ${snapError?.message ?? "sem retorno"}`);
    }

    const events = webEvents({
      competitorId: source.competitor_id,
      sourceId: source.id,
      pageType: source.page_type,
      runId,
      scrape: page,
      capturedAt: snapshot.captured_at,
      previous: previous ?? null,
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
      // "unknown" quando o changeTracking nao veio: nao e "same".
      status: page.tracking.changeStatus ?? "unknown",
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
