import { assertAuthorized, errorResponse } from "@/lib/auth";
import { ingestCompetitor, type IngestResult } from "@/lib/instagram";
import { closeRun, generateEvents, openRun } from "@/lib/runs";
import { supabaseAdmin } from "@/lib/supabase";
import { TRACKED_SLUGS, instagramHandle } from "@/lib/tracked";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  competitorSlug?: string;
  runId?: string;
  skipEvents?: boolean;
  /** Quantos posts buscar por perfil (default 12). */
  postLimit?: number;
};

/** Coleta perfil e posts do Instagram dos concorrentes com handle confirmado. */
export async function POST(req: Request): Promise<Response> {
  let runId: string | null = null;
  let ownRun = false;

  try {
    assertAuthorized(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const db = supabaseAdmin();

    let query = db
      .from("competitors")
      .select("id, slug, instagram_handle")
      .eq("is_active", true)
      .in("slug", TRACKED_SLUGS);

    if (body.competitorSlug) query = query.eq("slug", body.competitorSlug);

    const { data: competitors, error } = await query;
    if (error) throw new Error(`Falha ao listar concorrentes: ${error.message}`);

    runId = body.runId ?? (await openRun("apify_instagram", "ig_details"));
    ownRun = !body.runId;

    // Sequencial: os actors sao pagos por execucao e a conta costuma ter
    // poucos slots simultaneos.
    const results: IngestResult[] = [];
    for (const c of competitors ?? []) {
      // O handle salvo em lib/tracked.ts vale mais que o do banco.
      const handle = instagramHandle(c.slug) ?? c.instagram_handle;
      if (!handle) continue;
      results.push(
        await ingestCompetitor(
          { id: c.id, slug: c.slug, handle },
          runId,
          body.postLimit ?? 12,
        ),
      );
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;

    if (ownRun) await closeRun(runId, { ok, failed });

    const events = body.skipEvents ? null : await generateEvents(runId);

    return Response.json({
      ok: true,
      runId,
      competitors: results.length,
      ok_count: ok,
      failed,
      events,
      results,
    });
  } catch (err) {
    if (runId && ownRun) {
      await closeRun(runId, {
        ok: 0,
        failed: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return errorResponse(err);
  }
}
