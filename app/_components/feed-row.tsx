import Link from "next/link";

import { Logo } from "./logo";
import { feedDate } from "@/lib/format";
import type { DashboardFeedRow, EventType, Severity } from "@/lib/database.types";

const EVENT_LABEL: Record<EventType, string> = {
  pricing_changed: "Preço",
  value_prop_changed: "Proposta",
  page_removed: "Fora do ar",
  page_hidden: "Despublicada",
  page_changed: "Site",
  new_blog_post: "Blog",
  followers_jump: "Seguidores",
  bio_changed: "Bio",
  bio_link_changed: "Link da bio",
  posting_stopped: "Parou de postar",
  posting_resumed: "Voltou a postar",
  new_profile: "Perfil novo",
};

/** high vermelho, notable amarelo, info cinza. */
const DOT: Record<Severity, string> = {
  high: "bg-critical",
  notable: "bg-warning",
  info: "bg-info",
};

/**
 * Uma linha do feed (Nivel 1).
 *
 * A cor do ponto nunca carrega o significado sozinha — vem sempre colada ao
 * rotulo do tipo. No fundo claro o amarelo fica abaixo de 3:1, entao sem o
 * rotulo a linha seria ilegivel pra parte dos leitores.
 */
export function FeedRow({
  event,
  logoUrl,
  showCompetitor = true,
}: {
  event: DashboardFeedRow;
  logoUrl?: string | null;
  showCompetitor?: boolean;
}) {
  return (
    <li className="border-b border-line last:border-0">
      <Link
        href={`/competitors/${event.competitor_slug}`}
        className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-plane"
      >
        <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${DOT[event.severity]}`} />

        {showCompetitor ? (
          <Logo name={event.competitor} src={logoUrl ?? null} size={28} />
        ) : null}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            {showCompetitor ? (
              <span className="text-sm font-medium text-ink">{event.competitor}</span>
            ) : null}
            <span className="eyebrow">{EVENT_LABEL[event.event_type]}</span>
            {event.pending_notification ? (
              <span className="eyebrow text-accent" title="Ainda não notificado">
                novo
              </span>
            ) : null}
          </span>

          <span className="mt-0.5 block text-sm text-ink">{event.title}</span>

          {event.detail ? (
            <span className="mt-1 block truncate text-sm text-muted">{event.detail}</span>
          ) : null}
        </span>

        <time dateTime={event.occurred_at} className="tnum shrink-0 pt-0.5 text-xs text-muted">
          {feedDate(event.occurred_at)}
        </time>
      </Link>
    </li>
  );
}

export { EVENT_LABEL };
