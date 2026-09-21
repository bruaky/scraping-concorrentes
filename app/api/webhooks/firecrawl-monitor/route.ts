import { after } from "next/server";

import { errorResponse, HttpError } from "@/lib/auth";
import { runFullPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Webhook do Firecrawl Monitor.
 *
 * O Monitor agenda, detecta e manda o e-mail com os diffs; quando ele termina
 * uma verificacao, esta rota dispara a NOSSA coleta, que e quem persiste no
 * Supabase e sustenta placar e timeline.
 *
 * Por que nao consumir o payload do Monitor como fonte de dados: os targets
 * dele sao queries de busca, nao as URLs de `tracked_pages`. As paginas que
 * ele encontra nao mapeiam para as nossas linhas, e a config de comparacao
 * (tag, schema de extracao, scrape_options) vive em tracked_pages. Ele e o
 * gatilho; a coleta continua nossa.
 *
 * AUTENTICACAO: a documentacao do Monitor nao descreve assinatura de webhook
 * — o que ela oferece e `notification.webhook.headers`. Entao a garantia aqui
 * e o mesmo bearer das demais rotas, configurado no monitor. Trocar o
 * CRON_SECRET exige recriar o monitor (ver scripts/create-monitor.ts).
 */

type MonitorEvent = {
  type?: string;
  id?: string;
  webhookId?: string;
  data?: {
    monitorId?: string;
    checkId?: string;
    status?: string;
    summary?: Record<string, number>;
  };
};

export async function POST(req: Request): Promise<Response> {
  try {
    assertWebhookAuthorized(req);

    const event = (await req.json().catch(() => ({}))) as MonitorEvent;

    // `monitor.page` chega uma vez por pagina; so a reconciliacao final
    // interessa como gatilho, senao dispararíamos a coleta N vezes.
    if (event.type !== "monitor.check.completed") {
      return Response.json({ ok: true, ignored: event.type ?? "sem tipo" });
    }

    // Responde rapido: a coleta leva minutos e o Firecrawl nao deve ficar
    // segurando a conexao nem reentregar por timeout.
    after(async () => {
      await runFullPipeline();
    });

    return Response.json({
      ok: true,
      accepted: true,
      checkId: event.data?.checkId ?? null,
      summary: event.data?.summary ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Aceita o segredo do webhook ou, na falta dele, o mesmo CRON_SECRET.
 * Ter um segredo proprio permite rotacionar o webhook sem mexer no cron.
 */
function assertWebhookAuthorized(req: Request): void {
  const expected = process.env.FIRECRAWL_WEBHOOK_SECRET ?? process.env.CRON_SECRET;
  if (!expected) throw new HttpError(500, "FIRECRAWL_WEBHOOK_SECRET/CRON_SECRET nao configurado");

  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${expected}`) throw new HttpError(401, "nao autorizado");
}
