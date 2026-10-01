"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { BarChart, LineChart, type LinePoint } from "./charts";
import { Logo } from "./logo";
import { DASH, int, pct, shortDate, signed } from "@/lib/format";

/**
 * Coleta ao vivo: baseline x hoje, com graficos.
 *
 * A coluna da esquerda e o baseline — a ultima captura antes de agora, com a
 * data. Ela fica parada; o botao (so com LIVE_RUN) chama /api/live/run e
 * preenche "Hoje" linha a linha conforme o NDJSON chega: a linha em coleta
 * acende, a barra de variacao cresce e a serie do concorrente ganha o ponto
 * de hoje. No fim, router.refresh() atualiza o feed e o placar.
 *
 * Concorrente sem Instagram confirmado aparece no fim, marcado, em vez de
 * sumir: a ausencia tambem e informacao.
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
  posts_count: number | null;
};

type Base = { followers: number | null; posts: number | null; at: string | null };

type RowState =
  | { status: "queued" }
  | { status: "fetching" }
  | { status: "done"; base: Base; followers: number; posts: number; at: string; newPosts: number }
  | { status: "failed"; error: string };

type Phase = "idle" | "running" | "done" | "error";
type Mode = "apify" | "simulated";
type LogLine = { id: number; tone: "info" | "ok" | "warn"; text: string };

export function LiveRun({
  competitors,
  history,
  mode,
}: {
  competitors: LiveCompetitor[];
  history: LiveSnapshot[];
  mode: Mode | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [log, setLog] = useState<LogLine[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Serie congelada no clique: o refresh do fim traz a captura de hoje no
  // historico, e sem isso o baseline "andaria" para ela.
  const [frozen, setFrozen] = useState<Map<string, LiveSnapshot[]> | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const logSeq = useRef(0);

  const liveSeries = useMemo(() => {
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

  const series = frozen ?? liveSeries;

  // Com IG primeiro, por seguidores; ordem fixa enquanto o run preenche.
  const ordered = useMemo(() => {
    const latest = (id: string) => series.get(id)?.at(-1)?.followers_count ?? -1;
    const withIg = competitors.filter((c) => c.handle).sort((a, b) => latest(b.id) - latest(a.id));
    const without = competitors.filter((c) => !c.handle).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return { withIg, without };
  }, [competitors, series]);

  const baseOf = (id: string): Base => {
    const s = series.get(id)?.at(-1);
    return { followers: s?.followers_count ?? null, posts: s?.posts_count ?? null, at: s?.captured_at ?? null };
  };

  // Data do baseline no cabecalho, quando todos compartilham o mesmo dia.
  const baseDays = new Set(
    ordered.withIg.map((c) => baseOf(c.id).at?.slice(0, 10)).filter(Boolean) as string[],
  );
  const baseHeader = baseDays.size === 1 ? `Baseline · ${shortDate([...baseDays][0])}` : "Baseline";

  function addLog(tone: LogLine["tone"], text: string) {
    logSeq.current += 1;
    const id = logSeq.current;
    setLog((l) => [...l.slice(-40), { id, tone, text }]);
  }

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  async function run() {
    setFrozen(liveSeries);
    setPhase("running");
    setLog([]);
    setRows(Object.fromEntries(ordered.withIg.map((c) => [c.id, { status: "queued" } as RowState])));
    setSelectedId(null);
    addLog("info", "POST /api/live/run");

    let bestMover: { id: string; pct: number } | null = null;

    try {
      const res = await fetch("/api/live/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: ordered.withIg.map((c) => c.id) }),
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
              const list = msg.competitors as unknown[];
              addLog(
                "info",
                `run ${String(msg.runId).slice(0, 8)} aberto · ${list.length} perfis · ${
                  msg.mode === "apify" ? "Apify (dados reais)" : "simulado"
                }`,
              );
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
              const prev = msg.previous as { followers: number | null; posts: number | null; capturedAt: string | null };
              const curr = msg.current as { followers: number; posts: number; capturedAt: string; newPosts: number };
              setRows((r) => ({
                ...r,
                [id]: {
                  status: "done",
                  base: { followers: prev.followers, posts: prev.posts, at: prev.capturedAt },
                  followers: curr.followers,
                  posts: curr.posts,
                  at: curr.capturedAt,
                  newPosts: curr.newPosts,
                },
              }));
              const delta = prev.followers === null ? null : curr.followers - prev.followers;
              if (prev.followers) {
                const p = (100 * (curr.followers - prev.followers)) / prev.followers;
                if (!bestMover || Math.abs(p) > Math.abs(bestMover.pct)) bestMover = { id, pct: p };
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
              addLog("info", "fn_generate_change_events · comparando com o baseline…");
              break;
            case "done": {
              addLog(
                "ok",
                `${Number(msg.events)} alerta(s) novo(s) no feed · run concluído em ${(Number(msg.ms) / 1000)
                  .toFixed(1)
                  .replace(".", ",")} s`,
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

  function view(id: string) {
    const r = rows[id];
    const base = r?.status === "done" ? r.base : baseOf(id);
    const points: LinePoint[] = (series.get(id) ?? []).map((s) => ({
      t: s.captured_at,
      v: s.followers_count as number,
    }));
    if (r?.status === "done") points.push({ t: r.at, v: r.followers });

    return {
      base,
      today: r?.status === "done" ? r : null,
      state: r?.status ?? ("idle" as const),
      points,
    };
  }

  const doneCount = Object.values(rows).filter((r) => r.status === "done" || r.status === "failed").length;
  const focusId = selectedId ?? activeId ?? ordered.withIg[0]?.id ?? null;
  const focus = ordered.withIg.find((c) => c.id === focusId) ?? null;
  const focusView = focus ? view(focus.id) : null;
  const live = phase !== "idle";

  if (competitors.length === 0) return null;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="eyebrow">Instagram · baseline × hoje</h2>
          {phase === "running" ? (
            <span className="tnum text-xs text-muted">
              {doneCount} de {ordered.withIg.length}
            </span>
          ) : null}
        </div>

        {mode ? (
          <div className="flex items-center gap-3">
            {mode === "simulated" ? (
              <span
                className="rounded border border-warning px-1.5 py-px text-[0.6875rem] text-ink-2"
                title="LIVE_RUN=simulated: os números de hoje são simulados a partir do baseline real"
              >
                simulado
              </span>
            ) : (
              <span className="text-xs text-muted" title="LIVE_RUN=apify: cada clique coleta no Apify">
                coleta real via Apify
              </span>
            )}
            <button
              type="button"
              onClick={run}
              disabled={phase === "running" || ordered.withIg.length === 0}
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
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="eyebrow px-4 py-2.5 text-left font-normal">Concorrente</th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal" title="Última captura antes de agora">
                  {baseHeader}
                </th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">Hoje</th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">Δ</th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">Δ %</th>
                <th scope="col" className="eyebrow px-3 py-2.5 text-right font-normal">Posts</th>
                <th scope="col" className="eyebrow px-4 py-2.5 text-right font-normal">Série</th>
              </tr>
            </thead>
            <tbody>
              {ordered.withIg.map((c) => {
                const v = view(c.id);
                const delta = v.today && v.base.followers !== null ? v.today.followers - v.base.followers : null;
                const deltaPct = delta !== null && v.base.followers ? (100 * delta) / v.base.followers : null;
                const fetching = v.state === "fetching";
                const isFocus = c.id === focusId;

                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`cursor-pointer border-b border-line transition-colors ${
                      fetching ? "bg-accent/10" : isFocus ? "bg-plane" : "hover:bg-plane"
                    }`}
                  >
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <CompetitorCell c={c} />
                    </th>
                    <td className="tnum px-3 py-2.5 text-right">
                      <span className="block font-medium text-ink">{int(v.base.followers)}</span>
                      {baseDays.size > 1 && v.base.at ? (
                        <span className="block text-xs text-muted">{shortDate(v.base.at)}</span>
                      ) : null}
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
                        <span className="text-xs font-normal text-critical" title={(rows[c.id] as { error: string }).error}>
                          falhou
                        </span>
                      ) : v.today ? (
                        <span key={v.today.at} className="row-in inline-block">
                          {int(v.today.followers)}
                        </span>
                      ) : (
                        <span className="font-normal text-muted">{DASH}</span>
                      )}
                    </td>
                    <td className={`tnum px-3 py-2.5 text-right ${tone(delta)}`}>{delta === null ? DASH : signed(delta)}</td>
                    <td className={`tnum px-3 py-2.5 text-right ${tone(delta)}`}>{pct(deltaPct, 1)}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-2">
                      {int(v.today ? v.today.posts : v.base.posts)}
                      {v.today && v.today.newPosts > 0 ? (
                        <span className="ml-1 text-xs text-up">+{v.today.newPosts}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <Sparkline points={v.points} fresh={live && v.state === "done"} />
                    </td>
                  </tr>
                );
              })}

              {ordered.without.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    <CompetitorCell c={c} />
                  </th>
                  <td colSpan={6} className="px-3 py-2.5 text-right text-xs text-muted">
                    sem Instagram oficial encontrado
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ordered.withIg.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="eyebrow">Variação de seguidores desde o baseline</p>
            <p className="mt-1 text-xs text-muted">
              {live ? "Clique num concorrente para ver a série ao lado." : "Preenche quando a coleta rodar."}
            </p>
            <div className="mt-4">
              <BarChart
                onSelect={setSelectedId}
                rows={ordered.withIg.map((c) => {
                  const v = view(c.id);
                  const d = v.today && v.base.followers ? (100 * (v.today.followers - v.base.followers)) / v.base.followers : null;
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
                    {int(focusView.today ? focusView.today.followers : focusView.base.followers)}
                  </p>
                </div>
                <div className="mt-3">
                  <LineChart
                    key={focus.id}
                    label="Seguidores"
                    points={focusView.points}
                    highlightLast={Boolean(focusView.today)}
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CompetitorCell({ c }: { c: LiveCompetitor }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo name={c.name} src={c.logo_url} size={24} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{c.name}</span>
        {c.handle ? <span className="block truncate text-xs text-muted">@{c.handle}</span> : null}
      </span>
    </span>
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
  if (points.length === 0) return <span className="block text-right text-xs text-muted">{DASH}</span>;

  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const x = (i: number) => (points.length === 1 ? w - 3 : 3 + (i / (points.length - 1)) * (w - 6));
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = points.length - 1;

  return (
    <svg width={w} height={h} className="ml-auto block" aria-hidden>
      {points.length > 1 ? (
        <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
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
