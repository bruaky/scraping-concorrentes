import Link from "next/link";

import { Logo } from "./logo";
import { feedDate } from "@/lib/format";
import type { ChangeEvent, ChangeKind, Severity } from "@/lib/database.types";

const KIND_LABEL: Record<ChangeKind, string> = {
  pricing_changed: "Preço",
  value_prop_changed: "Proposta",
  page_removed: "Fora do ar",
  account_private: "Perfil fechado",
  jobs_changed: "Vagas",
  page_added: "Página nova",
  page_hidden: "Despublicada",
  page_changed: "Site",
  bio_changed: "Bio",
  external_url_changed: "CTA",
  followers_jump: "Seguidores",
  blog_post: "Blog",
  new_post: "Instagram",
};

const DOT: Record<Severity, string> = {
  critical: "bg-critical",
  warning: "bg-warning",
  info: "bg-info",
};

/**
 * Uma linha do feed (Nivel 1).
 *
 * A cor do ponto nunca carrega o significado sozinha — vem sempre colada ao
 * rotulo do tipo. No fundo claro o amarelo fica abaixo de 3:1, entao sem o
 * rotulo a linha seria ilegivel pra parte dos leitores.
 */
export function EventRow({
  event,
  competitor,
}: {
  event: ChangeEvent;
  competitor?: { slug: string; name: string; logo_url: string | null } | null;
}) {
  const body = (
    <>
      <span
        aria-hidden
        className={`mt-2 size-2 shrink-0 rounded-full ${DOT[event.severity]}`}
      />

      {competitor ? <Logo name={competitor.name} src={competitor.logo_url} size={28} /> : null}

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          {competitor ? (
            <span className="text-sm font-medium text-ink">{competitor.name}</span>
          ) : null}
          <span className="eyebrow">{KIND_LABEL[event.kind]}</span>
        </span>

        <span className="mt-0.5 block text-sm text-ink">{event.title}</span>

        {event.summary ? (
          <span className="mt-1 block line-clamp-2 text-sm text-muted">{event.summary}</span>
        ) : null}
      </span>

      <time
        dateTime={event.occurred_at}
        className="tnum shrink-0 pt-0.5 text-xs text-muted"
      >
        {feedDate(event.occurred_at)}
      </time>
    </>
  );

  return (
    <li className="border-b border-line last:border-0">
      <div className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-plane">
        {competitor ? (
          <Link href={`/competitors/${competitor.slug}`} className="flex min-w-0 flex-1 gap-3">
            {body}
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 gap-3">{body}</div>
        )}
      </div>

      {event.diff ? (
        <details className="px-4 pb-3.5">
          <summary className="cursor-pointer text-xs text-muted hover:text-ink-2">
            Ver diff
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-line bg-plane p-3 text-xs leading-relaxed text-ink-2">
            {event.diff}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

export { KIND_LABEL };
