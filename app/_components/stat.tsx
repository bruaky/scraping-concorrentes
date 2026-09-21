import { DASH } from "@/lib/format";

/**
 * Tile de metrica. O valor fica em figuras proporcionais (numero solto, nao
 * coluna); a nota de rodape existe pra dizer quando o numero e parcial ou
 * desconhecido — celula vazia nunca vira zero.
 */
export function Stat({
  label,
  value,
  hint,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  note?: string | null;
  tone?: "neutral" | "up" | "down";
}) {
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";

  return (
    <div className="rounded-xl border border-line bg-surface p-4" title={hint}>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1.5 text-2xl font-medium tracking-tight ${toneClass}`}>
        {value || DASH}
      </p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  );
}
