import { runLiveCollection } from "@/lib/live-collect";
import { liveRunMode } from "@/lib/live-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O Apify segura a conexao ate o actor terminar: ~30-50 s por perfil
// (medido em 01/10: ~3 min para os 4).
export const maxDuration = 300;

/**
 * Coleta ao vivo disparada pelo botao do dashboard (ver lib/live-run.ts).
 *
 * A coleta em si mora em lib/live-collect.ts — a mesma que
 * `npm run coleta` roda no terminal. Aqui so vira NDJSON, uma linha por
 * passo, para a tela ir preenchendo a tabela e o grafico conforme cada
 * concorrente termina, em vez de esperar o run inteiro. Sem LIVE_RUN, e 404.
 *
 * Sem bearer de proposito: o botao roda no browser e nao pode carregar o
 * CRON_SECRET. O que protege e o LIVE_RUN desligado fora da apresentacao e,
 * no modo apify, o intervalo minimo entre runs.
 */
export async function POST(req: Request): Promise<Response> {
  const mode = liveRunMode();
  if (!mode) return new Response("Not found", { status: 404 });

  // A tela manda a ordem em que a tabela esta, para a linha acesa descer
  // de cima para baixo em vez de pular pela tabela.
  const body = (await req.json().catch(() => ({}))) as { order?: unknown };
  const order = Array.isArray(body.order) ? body.order.map(String) : [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runLiveCollection(
          mode,
          (step) => controller.enqueue(encoder.encode(`${JSON.stringify(step)}\n`)),
          order,
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Sem isso, proxies seguram a resposta ate o fim e o "ao vivo" some.
      "X-Accel-Buffering": "no",
    },
  });
}
