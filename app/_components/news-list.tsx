import { Logo } from "./logo";
import { feedDate } from "@/lib/format";
import type { CompetitorNews, NewsKind } from "@/lib/database.types";

const KIND_LABEL: Record<NewsKind, string> = {
  blog: "Blog",
  site: "Site",
  job: "Vaga",
  mention: "Imprensa",
};

export type NewsRow = CompetitorNews & {
  competitor: string;
  logoUrl: string | null;
};

/**
 * Uma noticia: logo, concorrente, tipo, titulo com link para a fonte.
 *
 * A data e a de publicacao (Google Noticias, ou a que o Google mostra na
 * busca). A home so lista o que tem data.
 */
export function NewsItem({ item }: { item: NewsRow }) {
  const when = item.published_at ?? item.first_seen_at;

  return (
    <li className="border-b border-line last:border-0">
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-plane"
      >
        <Logo name={item.competitor} src={item.logoUrl} size={28} />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-ink">{item.competitor}</span>
            <span className="rounded border border-line px-1.5 py-px text-[0.6875rem] text-ink-2">
              {KIND_LABEL[item.kind]}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-sm text-ink">{item.title ?? item.url}</span>
          {item.snippet ? (
            <span className="mt-0.5 line-clamp-1 block text-xs text-muted">{item.snippet}</span>
          ) : null}
        </span>

        <span className="shrink-0 text-right text-xs text-muted">
          <span className="block">{item.source}</span>
          <span className="block" title="Data de publicação">
            {feedDate(when)}
          </span>
        </span>
      </a>
    </li>
  );
}
