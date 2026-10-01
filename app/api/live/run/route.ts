import { ingestCompetitor } from "@/lib/instagram";
import {
  DEMO_JOB,
  LIVE_JOB,
  clearPreviousDemoRun,
  latestSnapshot,
  listTargets,
  liveRunMode,
  simulateCompetitor,
  tagDemoEvents,
  type DemoResult,
  type DemoTarget,
} from "@/lib/live-run";
import { closeRun, generateEvents, openRun } from "@/lib/runs";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O Apify segura a conexao ate o actor terminar: ~20-40 s por perfil.
export const maxDuration = 300;

/** Intervalo minimo entre dois cliques no modo apify: cada clique gasta credito. */
const COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Coleta ao vivo disparada pelo botao do dashboard (ver lib/live-run.ts).
 *
 * Responde em NDJSON — uma linha por passo — para a tela ir preenchendo a
 * tabela e o grafico conforme cada concorrente termina, em vez de esperar o
 * run inteiro. Sem LIVE_RUN, e 404.
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
      const send = (msg: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(msg)}\n`));

      let runId: string | null = null;
      let ok = 0;
      let failed = 0;
      const startedAt = Date.now();

      try {
        if (mode === "apify") await assertCooldown();
        else await clearPreviousDemoRun();

        const rank = (id: string) => {
          const i = order.indexOf(id);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        const targets = (await listTargets()).sort((a, b) => rank(a.id) - rank(b.id));

        runId = await openRun("apify_instagram", mode === "apify" ? LIVE_JOB : DEMO_JOB);
        send({
          type: "start",
          mode,
          runId,
          competitors: targets.map((t) => ({ id: t.id, name: t.name, handle: t.handle })),
        });

        for (const target of targets) {
          send({ type: "fetching", competitorId: target.id, name: target.name, handle: target.handle });

          try {
            const result =
              mode === "apify"
                ? await collectFromApify(target, runId)
                : await simulateWithPause(target, runId);
            ok += 1;
            send({ type: "result", name: target.name, ...result });
          } catch (err) {
            failed += 1;
            send({ type: "failed", competitorId: target.id, name: target.name, error: message(err) });
          }
        }

        send({ type: "events:start" });
        await closeRun(runId, { ok, failed });
        await generateEvents(runId);
        const events = mode === "apify" ? await countEvents(runId) : await tagDemoEvents(runId);

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
      // Sem isso, proxies seguram a resposta ate o fim e o "ao vivo" some.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Coleta real: o mesmo codigo do ingest semanal, com o "antes" lido antes. */
async function collectFromApify(target: DemoTarget, runId: string): Promise<DemoResult> {
  const before = await latestSnapshot(target.id);

  const res = await ingestCompetitor({ id: target.id, slug: target.slug, handle: target.handle }, runId, 12);
  if (!res.ok) throw new Error(res.error);

  const after = await latestSnapshot(target.id);
  if (!after || after.followers_count === null) throw new Error("Apify não devolveu seguidores");

  return {
    competitorId: target.id,
    previous: {
      followers: before?.followers_count ?? null,
      posts: before?.posts_count ?? null,
      capturedAt: before?.captured_at ?? null,
    },
    current: {
      followers: after.followers_count,
      posts: after.posts_count ?? 0,
      capturedAt: after.captured_at,
      newPosts: Math.max(0, (after.posts_count ?? 0) - (before?.posts_count ?? after.posts_count ?? 0)),
    },
  };
}

/** No simulado, o tempo de uma chamada de verdade, para a tela respirar. */
async function simulateWithPause(target: DemoTarget, runId: string): Promise<DemoResult> {
  await new Promise((r) => setTimeout(r, 450 + Math.random() * 650));
  return simulateCompetitor(target, runId);
}

async function assertCooldown(): Promise<void> {
  const { data } = await supabaseAdmin()
    .from("collection_runs")
    .select("started_at")
    .eq("job", LIVE_JOB)
    // run que falhou inteiro nao gastou credito: nao bloqueia o proximo
    .neq("status", "failed")
    .order("started_at", { ascending: false })
    .limit(1);

  const last = data?.[0]?.started_at;
  if (last && Date.now() - Date.parse(last) < COOLDOWN_MS) {
    throw new Error("Uma coleta acabou de rodar. Espere 2 minutos para rodar de novo.");
  }
}

async function countEvents(runId: string): Promise<number> {
  const { data: snaps } = await supabaseAdmin()
    .from("instagram_profile_snapshots")
    .select("id")
    .eq("run_id", runId);
  const refs = (snaps ?? []).map((s) => s.id);
  if (refs.length === 0) return 0;

  const { count } = await supabaseAdmin()
    .from("change_events")
    .select("id", { count: "exact", head: true })
    .in("payload->>ref", refs);
  return count ?? 0;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
