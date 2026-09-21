/**
 * Formatacao compartilhada entre as telas.
 *
 * O tema aqui e um so: ausencia nao e zero. Valor desconhecido vira travessao,
 * nunca "0" — um zero inventado numa celula de views ou de curtidas e lido
 * como fato e destrói a leitura da tabela.
 */

export const DASH = "—";

export function int(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : value.toLocaleString("pt-BR");
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return DASH;
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

export function signed(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR")}`;
}

export function money(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined) return DASH;
  const n = value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** "seg 15/set", como no feed. */
export function feedDate(iso: string): string {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return `${weekday} ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")}`;
}

/** Iniciais pro monograma quando o concorrente nao tem logo. */
export function monogram(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
