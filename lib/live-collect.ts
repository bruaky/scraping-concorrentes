import "server-only";

import { ensureTrackedCompetitors } from "./ensure-tracked";
import { ingestCompetitor } from "./instagram";
import {
  DEMO_JOB,
  LIVE_JOB,
  clearPreviousDemoRun,
  latestSnapshot,
  listTargets,
  simulateCompetitor,
  tagDemoEvents,
  type DemoResult,
  type DemoTarget,
  type LiveRunMode,
} from "./live-run";
import { closeRun, generateEvents, openRun } from "./runs";
import { supabaseAdmin } from "./supabase";

/**
 * A coleta do botao "Rodar coleta", sem o transporte.
 *
 * /api/live/run transforma cada passo numa linha de NDJSON para a tela;
 * scripts/coleta-instagram.ts chama a mesma funcao e imprime no terminal.
 * Os dois gravam igual: run em collection_runs, snapshot + posts + metricas
 * por concorrente e, no fim, fn_generate_change_events.
 */

export type CollectStep = Record<string, unknown> & { type: string };

export async function runLiveCollection(
  mode: LiveRunMode,
  send: (step: CollectStep) => void,
  order: string[] = [],
): Promise<void> {
  let runId: string | null = null;
  let ok = 0;
  let failed = 0;
  const startedAt = Date.now();

  try {
    if (mode === "simulated") await clearPreviousDemoRun();
    await ensureTrackedCompetitors();

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
  }
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
