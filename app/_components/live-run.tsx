"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { BarChart, LineChart, type LinePoint } from "./charts";
import { Logo } from "./logo";
import { DASH, int, pct, shortDate, signed } from "@/lib/format";

/**
 * Coleta ao vivo: tabela "semana passada × hoje" + graficos.
 *
 * Parado, mostra a ultima coleta contra a anterior. Com o botao (so em
 * DEMO_MODE), chama /api/demo/run e vai preenchendo linha a linha conforme
 * o NDJSON chega: a linha em coleta acende, a coluna "Hoje" ganha o numero,
 * a barra do grafico cresce e a linha do concorrente ganha o ponto de hoje.
 * No fim, router.refresh() atualiza o feed e o placar com os alertas novos.
 */

export type LiveCompetitor = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  handle: string | null;
};

export type LiveSnapshot = {
  competitor_id: string;
  captured_at: string;
  followers_count: number | null;
};

type RowState =
  | { status: "queued" }
  | { status: "fetching" }
  | {
      status: "done";
      prevFollowers: number | null;
      prevAt: string | null;
      followers: number;
      at: string;
      newPosts: number;
    }
  | { status: "failed"; error: string };

type Phase = "idle" | "running" | "done" | "error";

type LogLine = { id: number; tone: "info" | "ok" | "warn"; text: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function LiveRun({
  competitors,
  history,
  demoEnabled,
}: {
  competitors: LiveCompetitor[];
  history: LiveSnapshot[];
  demoEnabled: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [log, setLog] = useState<LogLine[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const logSeq = useRef(0);

  // Serie de cada concorrente, em ordem cronologica.
  const series = useMemo(() => {
    const map = new Map<string, LiveSnapshot[]>();
    for (const s of history) {
      if (s.followers_count === null) continue;
      const list = map.get(s.competitor_id) ?? [];
      list.push(s);
      map.set(s.competitor_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    return map;
  }, [history]);

  // Ordem fixa por seguidores: a tabela nao pula enquanto o run preenche.
  const tracked = useMemo(() => {
    const latest = (id: string) => series.get(id)?.at(-1)?.followers_count ?? -1;
    return competitors
      .filter((c) => c.handle !== null)
      .sort((a, b) => latest(b.id) - latest(a.id));
  }, [competitors, series]);

  const live = phase !== "idle";

  /** Parado: ultima captura contra a anterior. Rodando: a de "semana passada" (>1 dia). */
  function baseline(id: string) {
    const list = series.get(id) ?? [];
    const old = live ? list.filter((s) => Date.now() - Date.parse(s.captured_at) > DAY_MS) : list;
    return { last: old.at(-1) ?? null, before: old.at(-2) ?? null, list: old };
  }

  function view(id: string) {
    const b = baseline(id);
    const r = rows[id];

    if (!live) {
      return {
        prev: b.before?.followers_count ?? null,
        prevAt: b.before?.captured_at ?? null,
        curr: b.last?.followers_count ?? null,
        currAt: b.last?.captured_at ?? null,
        newPosts: null as number | null,
        state: "idle" as const,
        points: b.list.map((s) => ({ t: s.captured_at, v: s.followers_count as number })),
      };
    }

    const points: LinePoint[] = b.list.map((s) => ({ t: s.captured_at, v: s.followers_count as number }));
    if (r?.status === "done") points.push({ t: r.at, v: r.followers });

    return {
      prev: r?.status === "done" ? r.prevFollowers : (b.last?.followers_count ?? null),
      prevAt: r?.status === "done" ? r.prevAt : (b.last?.captured_at ?? null),
      curr: r?.status === "done" ? r.followers : null,
      currAt: r?.status === "done" ? r.at : null,
      newPosts: r?.status === "done" ? r.newPosts : null,
      state: r?.status ?? "queued",
      points,
    };
  }

  function addLog(tone: LogLine["tone"], text: string) {
    logSeq.current += 1;
    const id = logSeq.current;
    setLog((l) => [...l.slice(-40), { id, tone, text }]);
  }

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  async function run() {
    setPhase("running");
    setLog([]);
    setRows(Object.fromEntries(tracked.map((c) => [c.id, { status: "queued" } as RowState])));
    setSelectedId(null);
    addLog("info", "POST /api/demo/run");

    let bestMover: { id: string; pct: number } | null = null;

    try {
      const res = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: tracked.map((c) => c.id) }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          const msg = JSON.parse(line) as Record<string, unknown>;

          switch (msg.type) {
            case "start": {
              const list = msg.competitors as Array<{ name: string }>;
              addLog("info", `run ${String(msg.runId).slice(0, 8)} aberto · ${list.length} concorrentes na fila`);
              break;
            }
            case "fetching": {
              const id = msg.competitorId as string;
              setActiveId(id);
              setRows((r) => ({ ...r, [id]: { status: "fetching" } }));
              addLog("info", `${msg.name} · buscando perfil @${msg.handle}…`);
              break;
            }
            case "result": {
              const id = msg.competitorId as string;
              const prev = msg.previous as { followers: number | null; capturedAt: string | null };
              const curr = msg.current as { followers: number; capturedAt: string; newPosts: number };
              setRows((r) => ({
                ...r,
                [id]: {
                  status: "done",
                  prevFollowers: prev.followers,
                  prevAt: prev.capturedAt,
                  followers: curr.followers,
                  at: curr.capturedAt,
                  newPosts: curr.newPosts,
                },
              }));
              const delta = prev.followers === null ? null : curr.followers - prev.followers;
              if (prev.followers) {
                const p = (100 * (curr.followers - prev.followers)) / prev.followers;
                if (!bestMover || p > bestMover.pct) bestMover = { id, pct: p };
              }
              addLog(
                "ok",
                `${msg.name} · ${int(prev.followers)} → ${int(curr.followers)} seguidores (${signed(delta)})` +
                  (curr.newPosts ? ` · ${curr.newPosts} post(s) novo(s)` : ""),
              );
              break;
            }
            case "failed": {
              const id = msg.competitorId as string;
              setRows((r) => ({ ...r, [id]: { status: "failed", error: String(msg.error) } }));
              addLog("warn", `${msg.name} · falhou: ${msg.error}`);
              break;
            }
            case "events:start":
              setActiveId(null);
              addLog("info", "fn_generate_change_events · comparando com a semana passada…");
              break;
            case "done": {
              const events = Number(msg.events);
              addLog(
                "ok",
                `${events} alerta(s) novo(s) no feed · run concluído em ${(Number(msg.ms) / 1000).toFixed(1).replace(".", ",")} s`,
              );
              setPhase("done");
              const mover = bestMover as { id: string; pct: number } | null;
              if (mover) setSelectedId(mover.id);
              router.refresh();
              break;
            }
            case "error":
              throw new Error(String(msg.error));
          }
        }
      }
    } catch (err) {
      setActiveId(null);
      setPhase("error");
      addLog("warn", `erro: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const doneCount = Object.values(rows).filter((r) => r.status === "done" || r.status === "failed").length;
  const focusId = selectedId ?? activeId ?? tracked[0]?.id ?? null;
  const focus = tracked.find((c) => c.id === focusId) ?? null;
  const focusView = focus ? view(focus.id) : null;

  if (tracked.length === 0) return null;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="eyebrow">Coleta da semana · Instagram</h2>
          {phase === "running" ? (
            <span className="tnum text-xs text-muted">
              {doneCount} de {tracked.length}
            </span>
          ) : null}
        </div>

        {demoEnabled ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted" title="DEMO_MODE=1: os números de hoje são simulados a partir da tendência">
              modo demo
            </span>
            <button
              type="button"
              onClick={run}
              disabled={phase === "running"}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-plane transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-60"
            >
              {phase === "running" ? (
                <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-plane border-t-transparent" />
              ) : (
                <span aria-hidden>▶</span>
              )}
              {phase === "running" ? "Coletando…" : phase === "idle" ? "Rodar coleta" : "Rodar de novo"}
            </button>
          </div>
        ) : null}
      </header>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {log.length > 0 ? (
          <ol
            ref={logRef}
            aria-live="polite"
            className="max-h-32 overflow-y-auto border-b border-line bg-plane px-4 py-2.5 font-mono text-xs leading-relaxed"
          >
            {log.map((l) => (
              <li key={l.id} className={l.tone === "warn" ? "text-critical" : l.tone === "ok" ? "text-ink" : "text-muted"}>
                <span aria-hidden className="mr-2 text-muted">
                  {l.tone === "ok" ? "✓" : l.tone === "warn" ? "!" : "›"}
                </span>
                {l.text}
              </li>
            ))}
          </ol>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="eyebrow px-4 py-2.5 text-left font-normal">Concorrente</th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">
                  {live ? "Semana passada" : "Coleta anterior"}
                </th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">
                  {live ? "Hoje" : "Última coleta"}
                </th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">Δ</th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">Δ %</th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">Posts novos</th>
                <th scope="col" className="eyebrow px-4 py-2.5 text-right font-normal">Tendência</th>
              </tr>
            </thead>
            <tbody>
              {tracked.map((c) => {
                const v = view(c.id);
                const delta = v.curr !== null && v.prev !== null ? v.curr - v.prev : null;
                const deltaPct = delta !== null && v.prev ? (100 * delta) / v.prev : null;
                const fetching = v.state === "fetching";
                const isFocus = c.id === focusId;

                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`cursor-pointer border-b border-line transition-colors last:border-0 ${
                      fetching ? "bg-accent/10" : isFocus ? "bg-plane" : "hover:bg-plane"
                    }`}
                  >
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <span className="flex items-center gap-2.5">
                        <Logo name={c.name} src={c.logo_url} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{c.name}</span>
                          <span className="block truncate text-xs text-muted">@{c.handle}</span>
                        </span>
                      </span>
                    </th>
                    <td className="tnum px-3 py-2.5 text-right text-ink-2" title={v.prevAt ? shortDate(v.prevAt) : undefined}>
                      {int(v.prev)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right font-medium text-ink">
                      {fetching ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-normal text-accent">
                          <span aria-hidden className="size-2.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                          coletando
                        </span>
                      ) : v.state === "queued" ? (
                        <span className="text-xs font-normal text-muted">na fila</span>
                      ) : v.state === "failed" ? (
                        <span className="text-xs font-normal text-critical">falhou</span>
                      ) : (
                        <span key={v.currAt ?? ""} className={live ? "row-in inline-block" : ""}>
                          {int(v.curr)}
                        </span>
                      )}
                    </td>
                    <td className={`tnum px-3 py-2.5 text-right ${tone(delta)}`}>{delta === null ? DASH : signed(delta)}</td>
                    <td className={`tnum px-3 py-2.5 text-right ${tone(delta)}`}>{pct(deltaPct, 1)}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-2">
                      {v.newPosts === null ? DASH : int(v.newPosts)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Sparkline points={v.points} fresh={live && v.state === "done"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="eyebrow">Variação de seguidores na semana</p>
          <p className="mt-1 text-xs text-muted">Clique num concorrente para ver a série ao lado.</p>
          <div className="mt-4">
            <BarChart
              onSelect={setSelectedId}
              rows={tracked.map((c) => {
                const v = view(c.id);
                const d = v.curr !== null && v.prev ? (100 * (v.curr - v.prev)) / v.prev : null;
                return { id: c.id, label: c.name, value: d, active: c.id === focusId };
              })}
            />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          {focus && focusView ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Logo name={focus.name} src={focus.logo_url} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{focus.name}</p>
                    <p className="eyebrow">Seguidores por coleta</p>
                  </div>
                </div>
                <p className="tnum text-right text-2xl font-medium tracking-tight text-ink">
                  {int(focusView.curr)}
                </p>
              </div>
              <div className="mt-3">
                <LineChart
                  key={focus.id}
                  label="Seguidores"
                  points={focusView.points}
                  highlightLast={live && focusView.state === "done"}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function tone(delta: number | null): string {
  if (delta === null || delta === 0) return "text-muted";
  return delta > 0 ? "text-up" : "text-down";
}

/** Mini serie na linha da tabela; o ponto de hoje aparece quando chega. */
function Sparkline({ points, fresh }: { points: LinePoint[]; fresh: boolean }) {
  const w = 96;
  const h = 26;
  if (points.length < 2) return <span className="block text-right text-xs text-muted">{DASH}</span>;

  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const x = (i: number) => 3 + (i / (points.length - 1)) * (w - 6);
  const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = points.length - 1;

  return (
    <svg width={w} height={h} className="ml-auto block" aria-hidden>
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle
        key={points[last].t}
        cx={x(last)}
        cy={y(points[last].v)}
        r={fresh ? 3.5 : 2.5}
        fill="var(--color-accent)"
        stroke="var(--color-surface)"
        strokeWidth={1.5}
        className={fresh ? "chart-pop" : undefined}
      />
    </svg>
  );
}
