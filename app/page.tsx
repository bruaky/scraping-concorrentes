import Link from "next/link";

import { EventCard, formatDate } from "./_components/event-card";
import { supabaseAdmin } from "@/lib/supabase";
import type { ChangeEvent, Competitor, Run } from "@/lib/database.types";

// Server component: le o Supabase com a service role key direto, sem expor
// nada ao browser. Renderiza sob demanda para que o build nao precise das
// credenciais e para que a timeline reflita o ultimo ingest.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = supabaseAdmin();

  const [competitorsRes, eventsRes, runsRes] = await Promise.all([
    db.from("competitors").select("*").eq("is_active", true).order("name"),
    db.from("change_events").select("*").order("occurred_at", { ascending: false }).limit(50),
    db.from("runs").select("*").order("started_at", { ascending: false }).limit(2),
  ]);

  const competitors = (competitorsRes.data ?? []) as Competitor[];
  const events = (eventsRes.data ?? []) as ChangeEvent[];
  const runs = (runsRes.data ?? []) as Run[];

  const byId = new Map(competitors.map((c) => [c.id, c]));
  const countByCompetitor = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.competitor_id] = (acc[e.competitor_id] ?? 0) + 1;
    return acc;
  }, {});

  const lastRun = runs[0];

  return (
    <main className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Hakutaku CI</h1>
        <p className="mt-1 text-sm text-[--color-muted]">
          Site e Instagram dos concorrentes, varridos toda segunda-feira.
          {lastRun
            ? ` Última execução: ${formatDate(lastRun.started_at)} (${lastRun.status}).`
            : " Nenhuma execução registrada ainda."}
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[--color-muted]">
          Concorrentes
        </h2>
        {competitors.length === 0 ? (
          <EmptyState>
            Nenhum concorrente cadastrado. Insira linhas em <code>competitors</code> e{" "}
            <code>sources</code> no Supabase para começar.
          </EmptyState>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {competitors.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/competitors/${c.slug}`}
                  className="block rounded-lg border border-[--color-edge] bg-[--color-panel] p-4 transition hover:border-slate-600"
                >
                  <p className="font-medium">{c.name}</p>
                  <p className="mt-1 text-xs text-[--color-muted]">
                    {c.website ? new URL(c.website).host : "sem site"}
                    {c.instagram ? ` · @${c.instagram}` : ""}
                  </p>
                  <p className="mt-3 text-xs text-sky-400">
                    {countByCompetitor[c.id] ?? 0} eventos recentes
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[--color-muted]">
          Timeline
        </h2>
        {events.length === 0 ? (
          <EmptyState>
            Nada detectado ainda. Dispare o ingest manualmente com{" "}
            <code>POST /api/cron/weekly</code>.
          </EmptyState>
        ) : (
          <div className="mt-3 space-y-3">
            {events.map((event) => {
              const c = byId.get(event.competitor_id);
              return (
                <EventCard
                  key={event.id}
                  event={event}
                  competitor={c ? { slug: c.slug, name: c.name } : null}
                />
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-dashed border-[--color-edge] p-6 text-sm text-[--color-muted]">
      {children}
    </p>
  );
}
