import Link from "next/link";

import type { ChangeEvent, ChangeKind } from "@/lib/database.types";

const KIND_LABEL: Record<ChangeKind, string> = {
  page_changed: "Página mudou",
  page_added: "Página nova",
  page_removed: "Página saiu do ar",
  pricing_changed: "Preço mudou",
  new_post: "Post novo",
  bio_changed: "Bio mudou",
  followers_jump: "Seguidores",
};

const SEVERITY_STYLE = [
  "bg-slate-800 text-slate-300",
  "bg-sky-950 text-sky-300",
  "bg-amber-950 text-amber-300",
  "bg-rose-950 text-rose-300",
];

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function EventCard({
  event,
  competitor,
}: {
  event: ChangeEvent;
  /** Mostrado só no dashboard, onde a timeline mistura concorrentes. */
  competitor?: { slug: string; name: string } | null;
}) {
  const severity = SEVERITY_STYLE[event.severity] ?? SEVERITY_STYLE[0];

  return (
    <article className="rounded-lg border border-[--color-edge] bg-[--color-panel] p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${severity}`}>
          {KIND_LABEL[event.kind]}
        </span>
        {competitor ? (
          <Link
            href={`/competitors/${competitor.slug}`}
            className="text-slate-300 hover:underline"
          >
            {competitor.name}
          </Link>
        ) : null}
        <span className="text-[--color-muted]">{formatDate(event.occurred_at)}</span>
      </div>

      <h3 className="mt-2 text-sm font-medium text-slate-100">{event.title}</h3>

      {event.summary ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-[--color-muted]">{event.summary}</p>
      ) : null}

      {event.url ? (
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block break-all text-xs text-sky-400 hover:underline"
        >
          {event.url}
        </a>
      ) : null}

      {event.diff ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-[--color-muted]">Ver diff</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-black/40 p-3 text-xs leading-relaxed text-slate-300">
            {event.diff}
          </pre>
        </details>
      ) : null}
    </article>
  );
}
