import { DASH } from "@/lib/format";

/**
 * Tile de metrica.
 *
 * `value` aceita no no de React para poder receber <NotConnected /> — "nao
 * conectada" precisa ser visualmente diferente de um travessao, que significa
 * "conectada, valor desconhecido".
 */
export function Stat({
  label,
  value,
  hint,
  note,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  note?: string | null;
  tone?: "neutral" | "up" | "down";
}) {
  const toneClass = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";

  return (
    <div className="rounded-xl border border-line bg-surface p-4" title={hint}>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1.5 text-2xl font-medium tracking-tight ${toneClass}`}>
        {value === null || value === undefined || value === "" ? DASH : value}
      </p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  );
}
