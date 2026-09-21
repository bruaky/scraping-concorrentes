import Link from "next/link";

import { Logo } from "./logo";
import type { Competitor } from "@/lib/database.types";

/**
 * Overview de todos os concorrentes, fixo no topo de toda tela.
 * Logo + nome, clicando abre a pagina do concorrente.
 */
export function CompetitorRail({ competitors }: { competitors: Competitor[] }) {
  if (competitors.length === 0) return null;

  return (
    <nav aria-label="Concorrentes" className="-mx-6 overflow-x-auto px-6">
      <ul className="flex gap-2.5 pb-1">
        {competitors.map((c) => (
          <li key={c.id}>
            <Link
              href={`/competitors/${c.slug}`}
              className="flex w-28 flex-col items-center gap-2 rounded-xl border border-line bg-surface px-3 py-4 text-center transition-colors hover:border-rule"
            >
              <Logo name={c.name} src={c.logo_url} size={36} />
              <span className="line-clamp-2 text-xs font-medium leading-tight text-ink">
                {c.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
