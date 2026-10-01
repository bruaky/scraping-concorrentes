import { liveRunMode } from "@/lib/live-run";
import { collectNews } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LIVE_NEWS_JOB = "news_live";

/**
 * Botao "Atualizar" da secao Competitor news. Mesma regra do botao de
 * coleta (ver /api/live/run): sem bearer, porque roda no browser, e so com
 * LIVE_RUN=apify — no simulado nao ha noticia para simular.
 */
export async function POST(): Promise<Response> {
  if (liveRunMode() !== "apify") return new Response("Not found", { status: 404 });

  try {
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
