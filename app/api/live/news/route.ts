import { liveRunMode } from "@/lib/live-run";
import { collectNews } from "@/lib/news";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LIVE_NEWS_JOB = "news_live";
/** Intervalo minimo entre dois cliques: cada um gasta credito. */
const COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Botao "Atualizar" da secao Competitor news. Mesma regra do botao de
 * coleta (ver /api/live/run): sem bearer, porque roda no browser, e so com
 * LIVE_RUN=apify — no simulado nao ha noticia para simular.
 */
export async function POST(): Promise<Response> {
  if (liveRunMode() !== "apify") return new Response("Not found", { status: 404 });

  try {
    const { data } = await supabaseAdmin()
      .from("collection_runs")
      .select("started_at")
      .eq("job", LIVE_NEWS_JOB)
      .neq("status", "failed")
      .order("started_at", { ascending: false })
      .limit(1);
    const last = data?.[0]?.started_at;
    if (last && Date.now() - Date.parse(last) < COOLDOWN_MS) {
      return Response.json(
        { ok: false, error: "As notícias acabaram de ser atualizadas. Espere 2 minutos." },
        { status: 429 },
      );
    }

    const { results } = await collectNews(LIVE_NEWS_JOB);
    return Response.json({
      ok: results.some((r) => r.ok),
      fresh: results.reduce((n, r) => n + r.fresh, 0),
      results,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
