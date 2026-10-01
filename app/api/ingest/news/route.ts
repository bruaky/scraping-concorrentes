import { assertAuthorized, errorResponse } from "@/lib/auth";
import { collectNews } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Um run do Google por concorrente, em paralelo: ~1-2 min no total.
export const maxDuration = 300;

/** Competitor news: blog, site, vagas e mencoes no Google (ver lib/news.ts). */
export async function POST(req: Request): Promise<Response> {
  try {
    assertAuthorized(req);
    const { runId, results } = await collectNews();
    const ok = results.filter((r) => r.ok).length;
    return Response.json({
      ok: true,
      runId,
      ok_count: ok,
      failed: results.length - ok,
      fresh: results.reduce((n, r) => n + r.fresh, 0),
      results,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
