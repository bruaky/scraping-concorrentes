"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Logo } from "./logo";
import { DASH, int, pct, shortDate, signed } from "@/lib/format";
import type { DashboardScoreboardRow } from "@/lib/database.types";

/**
 * Nivel 2: placar comparativo, uma linha por concorrente, ordenavel por
 * qualquer coluna. Toda a matematica vem de v_dashboard_scoreboard; aqui so
 * se formata.
 */

type Column = {
  key: keyof DashboardScoreboardRow | "competitor_name";
  label: string;
  hint?: string;
  numeric: boolean;
};

const COLUMNS: Column[] = [
  { key: "competitor_name", label: "Concorrente", numeric: false },
  { key: "followers_count", label: "Seguidores", numeric: true },
  {
    key: "followers_delta_7d",
    label: "Δ7d",
    hint: "Comparado com a captura mais recente com 7 ou mais dias",
    numeric: true,
  },
  { key: "posts_7d", label: "Posts", numeric: true },
  {
    key: "avg_engagement",
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
  { key: "blog_posts_7d", label: "Blog 7d", numeric: true },
  { key: "open_roles", label: "Vagas", numeric: true },
  { key: "last_price_to", label: "Preço", hint: "Último valor observado", numeric: true },
];

type Direction = "asc" | "desc";

export function Scoreboard({ rows }: { rows: DashboardScoreboardRow[] }) {
  const [sortKey, setSortKey] = useState<Column["key"]>("followers_count");
  const [direction, setDirection] = useState<Direction>("desc");

  const sorted = useMemo(() => {
    const out = [...rows];

    out.sort((a, b) => {
      if (sortKey === "competitor_name") {
        return direction === "asc"
          ? a.competitor.localeCompare(b.competitor, "pt-BR")
          : b.competitor.localeCompare(a.competitor, "pt-BR");
      }

      const av = a[sortKey];
      const bv = b[sortKey];

      // Desconhecido vai sempre pro fim, independente da direcao: celula
      // vazia no topo de um ranking sugere um valor que ela nao tem.
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;

      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
        return direction === "asc" ? cmp : -cmp;
      }

      const diff = Number(av) - Number(bv);
      return direction === "asc" ? diff : -diff;
    });

    return out;
  }, [rows, sortKey, direction]);

  function toggle(key: Column["key"]) {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "competitor_name" ? "asc" : "desc");
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[840px] border-collapse text-sm">
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
                    className={`eyebrow inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}
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

function Row({ row }: { row: DashboardScoreboardRow }) {
  return (
    <tr className="border-b border-line last:border-0 hover:bg-plane">
      <th scope="row" className="px-3 py-3 text-left font-normal">
        <Link href={`/competitors/${row.slug}`} className="flex items-center gap-2.5">
          <Logo name={row.competitor} src={row.logo_url} size={24} />
          <span className="font-medium text-ink">{row.competitor}</span>
          {row.username === null ? (
            <span
              className="rounded border border-line px-1.5 py-px text-[0.6875rem] text-muted"
              title="Sem handle de Instagram confirmado — as colunas sociais ficam vazias"
            >
              sem IG
            </span>
          ) : null}
          {row.is_private ? (
            <span
              className="rounded border border-line px-1.5 py-px text-[0.6875rem] text-muted"
              title="Perfil privado: não expõe engajamento"
            >
              privado
            </span>
          ) : null}
        </Link>
      </th>

      <Cell>{int(row.followers_count)}</Cell>

      <td className="tnum px-3 py-3 text-right">
        {row.has_comparison ? (
          <Delta value={row.followers_delta_7d} pctValue={row.followers_pct_7d} />
        ) : (
          <span
            className="text-xs text-muted"
            title={`Baseline coletado em ${shortDate(row.tracking_since)}. A comparação começa quando houver captura com 7 dias.`}
          >
            baseline
          </span>
        )}
      </td>

      <Cell>{int(row.posts_7d)}</Cell>

      <td className="tnum px-3 py-3 text-right text-ink-2">
        {int(row.avg_engagement === null ? null : Math.round(row.avg_engagement))}
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
      <Cell>{int(row.blog_posts_7d)}</Cell>
      <Cell>{int(row.open_roles)}</Cell>
      <td className="tnum px-3 py-3 text-right text-ink-2" title={priceTitle(row)}>
        {row.last_price_to ?? DASH}
      </td>
    </tr>
  );
}

function priceTitle(row: DashboardScoreboardRow): string | undefined {
  if (!row.last_price_to) return undefined;
  return `${row.last_price_field}: ${row.last_price_from ?? DASH} → ${row.last_price_to} em ${shortDate(row.last_price_changed_at)}`;
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
      {pctValue !== null ? <span className="ml-1 text-xs text-muted">{pct(pctValue, 1)}</span> : null}
    </span>
  );
}
