"use client";

import { useEffect, useRef, useState } from "react";

import { int, pct, shortDate } from "@/lib/format";

/**
 * Graficos em SVG puro, sem biblioteca.
 *
 * Specs fixas: linha 2px, marcador r=4 com anel da cor da superficie, grade
 * em hairline solida e recessiva, barra de no maximo 14px com ponta
 * arredondada e base reta. Texto sempre nas cores de tinta, nunca na cor da
 * serie — a identidade vem da marca ao lado.
 */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/** Ticks redondos (1, 2, 2.5, 5 × 10^n) cobrindo [min, max]. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function compact(v: number): string {
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR");
}

// ---------------------------------------------------------------------------
// Linha
// ---------------------------------------------------------------------------

export type LinePoint = { t: string; v: number };

export function LineChart({
  points,
  height = 220,
  label,
  highlightLast = false,
}: {
  points: LinePoint[];
  height?: number;
  /** Nome da serie, para o leitor de tela e o tooltip. */
  label: string;
  /** Destaca o ultimo ponto (a captura de hoje). */
  highlightLast?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const padL = 56;
  const padR = 16;
  const padT = 14;
  const padB = 26;
  const w = Math.max(0, width - padL - padR);
  const h = height - padT - padB;

  const values = points.map((p) => p.v);
  const ticks = values.length ? niceTicks(Math.min(...values), Math.max(...values)) : [0, 1];
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const times = points.map((p) => new Date(p.t).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);

  const x = (t: number) => (tMax === tMin ? w / 2 : ((t - tMin) / (tMax - tMin)) * w);
  const y = (v: number) => h - ((v - yMin) / (yMax - yMin || 1)) * h;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(times[i]).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");
  const area = points.length
    ? `${path} L${x(times[times.length - 1]).toFixed(1)},${h} L${x(times[0]).toFixed(1)},${h} Z`
    : "";

  const xLabels = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0;
    let bestDist = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(x(t) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  }

  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && points.length > 0 ? (
        <svg width={width} height={height} role="img" aria-label={`${label}: ${points.length} capturas`}>
          <g transform={`translate(${padL},${padT})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={-10} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-muted text-[11px]">
                  {compact(t)}
                </text>
              </g>
            ))}

            {xLabels.map((i) => (
              <text
                key={i}
                x={x(times[i])}
                y={h + 18}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                className="fill-muted text-[11px]"
              >
                {highlightLast && i === points.length - 1 ? "hoje" : shortDate(points[i].t)}
              </text>
            ))}

            <path d={area} fill="var(--color-accent)" opacity={0.1} />
            <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {highlightLast ? (
              <circle
                key={points[points.length - 1].t}
                cx={x(times[times.length - 1])}
                cy={y(values[values.length - 1])}
                r={5}
                fill="var(--color-accent)"
                stroke="var(--color-surface)"
                strokeWidth={2}
                className="chart-pop"
              />
            ) : null}

            {hp ? (
              <g pointerEvents="none">
                <line x1={x(times[hover!])} x2={x(times[hover!])} y1={0} y2={h} stroke="var(--color-rule)" strokeWidth={1} />
                <circle cx={x(times[hover!])} cy={y(hp.v)} r={4} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={2} />
              </g>
            ) : null}

            <rect
              width={w}
              height={h}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </g>
        </svg>
      ) : null}

      {hp && hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: Math.min(Math.max(padL + x(times[hover]) - 70, 0), Math.max(0, width - 140)),
          }}
        >
          <p className="text-muted">
            {highlightLast && hover === points.length - 1 ? "Hoje" : shortDate(hp.t)}
          </p>
          <p className="tnum font-medium text-ink">
            {int(hp.v)} <span className="font-normal text-muted">{label.toLowerCase()}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais
// ---------------------------------------------------------------------------

export type BarRow = {
  id: string;
  label: string;
  /** null = ainda nao chegou (barra vazia, sem numero). */
  value: number | null;
  active?: boolean;
};

export function BarChart({
  rows,
  format = (v: number) => pct(v, 1),
  onSelect,
}: {
  rows: BarRow[];
  format?: (v: number) => string;
  onSelect?: (id: string) => void;
}) {
  const known = rows.map((r) => r.value).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...known);
  const hi = Math.max(0, ...known, 1);
  const span = hi - lo || 1;
  const zero = (-lo / span) * 100;

  return (
    <ul className="space-y-1.5" aria-label="Variação por concorrente">
      {rows.map((r) => {
        const v = r.value;
        const width = v === null ? 0 : (Math.abs(v) / span) * 100;
        const left = v === null || v >= 0 ? zero : zero - width;

        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect?.(r.id)}
              className={`grid w-full grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-plane ${r.active ? "bg-plane" : ""}`}
              title={v === null ? `${r.label}: aguardando` : `${r.label}: ${format(v)}`}
            >
              <span className="truncate text-xs text-ink-2">{r.label}</span>
              <span className="relative h-3.5">
                <span
                  aria-hidden
                  className="absolute inset-y-[-3px] w-px bg-rule"
                  style={{ left: `${zero}%` }}
                />
                <span
                  aria-hidden
                  className="absolute inset-y-0 bg-accent transition-all duration-700 ease-out"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    borderRadius: v !== null && v < 0 ? "4px 0 0 4px" : "0 4px 4px 0",
                    opacity: r.active || v !== null ? 1 : 0.35,
                  }}
                />
              </span>
              <span className="tnum text-right text-xs text-ink">
                {v === null ? <span className="text-muted">—</span> : format(v)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
