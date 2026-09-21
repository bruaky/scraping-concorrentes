"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Logo } from "./logo";
import { DASH, int, money, pct, shortDate, signed } from "@/lib/format";
import type { CompetitorWeeklyStats } from "@/lib/database.types";

/**
 * Nivel 2: placar comparativo, uma linha por concorrente, tudo da semana.
 * Ordenavel por qualquer coluna — Δ e ER sao as que respondem "quem esta
 * acelerando".
 *
 * Toda a matematica vem da view competitor_weekly_stats; aqui so se formata.
 */

type Column = {
  key: keyof CompetitorWeeklyStats | "competitor";
  label: string;
  hint?: string;
  numeric: boolean;
};

const COLUMNS: Column[] = [
  { key: "competitor", label: "Concorrente", numeric: false },
  { key: "followers_count", label: "Seguidores", numeric: true },
  { key: "followers_delta_7d", label: "Δ7d", numeric: true },
  { key: "posts_7d", label: "Posts", numeric: true },
  {
    key: "avg_engagement_7d",
    label: "Eng. médio",
    hint: "Média de curtidas + comentários dos posts da semana",
    numeric: true,
  },
  {
    key: "engagement_rate_pct",
    label: "ER %",
    hint: "(curtidas + comentários) ÷ seguidores",
    numeric: true,
  },
  { key: "blog_7d", label: "Blog 7d", numeric: true },
  { key: "jobs_open", label: "Vagas", numeric: true },
  { key: "headline_price", label: "Preço", hint: "Plano pago mais barato", numeric: true },
];

type Direction = "asc" | "desc";

export function Scoreboard({ rows }: { rows: CompetitorWeeklyStats[] }) {
  const [sortKey, setSortKey] = useState<Column["key"]>("followers_count");
  const [direction, setDirection] = useState<Direction>("desc");

  const sorted = useMemo(() => {
    const out = [...rows];

    out.sort((a, b) => {
      if (sortKey === "competitor") {
        return direction === "asc"
          ? a.name.localeCompare(b.name, "pt-BR")
          : b.name.localeCompare(a.name, "pt-BR");
      }

      const av = a[sortKey];
      const bv = b[sortKey];

      // Desconhecido vai sempre pro fim, independente da direcao: uma celula
      // vazia no topo de um ranking sugere um valor que ela nao tem.
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;

      const diff = Number(av) - Number(bv);
      return direction === "asc" ? diff : -diff;
    });

    return out;
  }, [rows, sortKey, direction]);

  function toggle(key: Column["key"]) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "competitor" ? "asc" : "desc");
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={String(col.key)}
                  scope="col"
                  title={col.hint}
                  className={`px-3 py-2.5 font-normal ${col.numeric ? "text-right" : "text-left"}`}
                  aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    className={`eyebrow inline-flex items-center gap-1 hover:text-ink ${
                      active ? "text-ink" : ""
                    }`}
                  >
                    {col.label}
                    <span aria-hidden className={active ? "" : "opacity-0"}>
                      {direction === "asc" ? "↑" : "↓"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sorted.map((row) => (
            <Row key={row.competitor_id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: CompetitorWeeklyStats }) {
  return (
    <tr className="border-b border-line last:border-0 hover:bg-plane">
      <th scope="row" className="px-3 py-3 text-left font-normal">
        <Link href={`/competitors/${row.slug}`} className="flex items-center gap-2.5">
          <Logo name={row.name} src={row.logo_url} size={24} />
          <span className="font-medium text-ink">{row.name}</span>
          {row.is_private ? (
            <span
              className="rounded border border-line px-1.5 py-px text-[0.6875rem] text-muted"
              title="Perfil privado: a coleta de posts e engajamento parou"
            >
              privado
            </span>
          ) : null}
        </Link>
      </th>

      <Cell>{int(row.followers_count)}</Cell>

      <td className="tnum px-3 py-3 text-right">
        {row.has_comparison ? (
          <Delta value={row.followers_delta_7d} pctValue={row.followers_delta_pct_7d} />
        ) : (
          <span
            className="text-xs text-muted"
            title={`Baseline coletado em ${shortDate(row.tracking_since)}. A comparação começa na próxima captura.`}
          >
            baseline
          </span>
        )}
      </td>

      <Cell>{int(row.posts_7d)}</Cell>

      <td className="tnum px-3 py-3 text-right">
        {int(row.avg_engagement_7d === null ? null : Math.round(row.avg_engagement_7d))}
        {row.posts_unknown_likes > 0 ? (
          <span
            className="ml-1 cursor-help text-muted"
            title={`${row.posts_unknown_likes} post(s) da semana escondem curtidas e ficaram fora da média`}
          >
            *
          </span>
        ) : null}
      </td>

      <Cell>{pct(row.engagement_rate_pct, 2)}</Cell>
      <Cell>{int(row.blog_7d)}</Cell>
      <Cell>{int(row.jobs_open)}</Cell>
      <Cell>{money(row.headline_price, row.price_currency)}</Cell>
    </tr>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="tnum px-3 py-3 text-right text-ink-2">{children}</td>;
}

function Delta({ value, pctValue }: { value: number | null; pctValue: number | null }) {
  if (value === null) return <span className="text-muted">{DASH}</span>;

  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";

  return (
    <span className={tone}>
      {signed(value)}
      {pctValue !== null ? (
        <span className="ml-1 text-xs text-muted">{pct(pctValue, 1)}</span>
      ) : null}
    </span>
  );
}
