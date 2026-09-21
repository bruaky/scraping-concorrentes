import { assertAuthorized, errorResponse } from "@/lib/auth";
import { runFullPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron semanal (ver `vercel.json`).
 *
 * Continua existindo mesmo com o Firecrawl Monitor ligado: o Monitor cobre as
 * paginas que ele mesmo descobre por busca, e este cron cobre a lista de
 * `tracked_pages`, que e o que alimenta o placar e a timeline. Se o webhook
 * do Monitor estiver ativo, este vira a rede de seguranca.
 *
 * A Vercel dispara via GET com `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request): Promise<Response> {
  return run(req);
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}

async function run(req: Request): Promise<Response> {
  try {
    assertAuthorized(req);

    const results = await runFullPipeline();
    const ok = results.every((r) => r.ok);

    // 207: parte passou, parte nao. Responder 200 esconderia buraco no dado.
    return Response.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (err) {
    return errorResponse(err);
  }
}
