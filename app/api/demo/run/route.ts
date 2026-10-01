import { closeRun, generateEvents, openRun } from "@/lib/runs";
import {
  DEMO_JOB,
  clearPreviousDemoRun,
  demoEnabled,
  listTargets,
  simulateCompetitor,
  tagDemoEvents,
} from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Coleta de demonstração, ao vivo (ver lib/demo.ts).
 *
 * Responde em NDJSON — uma linha por passo — para a tela ir preenchendo a
 * tabela e o gráfico conforme cada concorrente termina, em vez de esperar o
 * run inteiro. Só existe com DEMO_MODE=1; fora disso é 404.
 *
 * Sem bearer de propósito: o botão roda no browser e não pode carregar o
 * CRON_SECRET. O que protege é o DEMO_MODE desligado em produção e o fato de
 * a rota só escrever dado marcado como demo.
 */
export async function POST(req: Request): Promise<Response> {
  if (!demoEnabled()) return new Response("Not found", { status: 404 });

  // A tela manda a ordem em que a tabela esta, para a linha acesa descer
  // de cima para baixo em vez de pular pela tabela.
  const body = (await req.json().catch(() => ({}))) as { order?: unknown };
  const order = Array.isArray(body.order) ? body.order.map(String) : [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (msg: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(msg)}\n`));

      let runId: string | null = null;
      let ok = 0;
      let failed = 0;
      const startedAt = Date.now();

      try {
        await clearPreviousDemoRun();
        const rank = (id: string) => {
          const i = order.indexOf(id);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        const targets = (await listTargets()).sort((a, b) => rank(a.id) - rank(b.id));

        runId = await openRun("apify_instagram", DEMO_JOB);
        send({
          type: "start",
          runId,
          competitors: targets.map((t) => ({ id: t.id, name: t.name, handle: t.handle })),
        });

        for (const target of targets) {
          send({ type: "fetching", competitorId: target.id, name: target.name, handle: target.handle });

          // O tempo de uma chamada de verdade ao actor, para a tela respirar.
          await sleep(450 + Math.random() * 650);

          try {
            const result = await simulateCompetitor(target, runId);
            ok += 1;
            send({ type: "result", name: target.name, ...result });
          } catch (err) {
            failed += 1;
            send({ type: "failed", competitorId: target.id, name: target.name, error: message(err) });
          }
        }

        send({ type: "events:start" });
        await generateEvents(runId);
        const events = await tagDemoEvents(runId);
        await closeRun(runId, { ok, failed });

        send({ type: "done", runId, ok, failed, events, ms: Date.now() - startedAt });
      } catch (err) {
        if (runId) await closeRun(runId, { ok, failed, error: message(err) }).catch(() => {});
        send({ type: "error", error: message(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Sem isso, proxies seguram a resposta até o fim e o "ao vivo" some.
      "X-Accel-Buffering": "no",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
