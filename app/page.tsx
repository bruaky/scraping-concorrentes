import { CompetitorRail } from "./_components/competitor-rail";
import { EventRow } from "./_components/event-row";
import { Empty, Panel } from "./_components/panel";
import { Scoreboard } from "./_components/scoreboard";
import { fullDate } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import type { ChangeEvent, Competitor, CompetitorWeeklyStats, Run } from "@/lib/database.types";

// Server component: le o Supabase com a service role key, sem expor nada ao
// browser. Renderiza sob demanda para o build nao precisar das credenciais.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = supabaseAdmin();

  const [competitorsRes, eventsRes, statsRes, runRes] = await Promise.all([
    db.from("competitors").select("*").eq("is_active", true).order("name"),
    db.from("change_events").select("*").order("occurred_at", { ascending: false }).limit(60),
    db.from("competitor_weekly_stats").select("*"),
    db.from("runs").select("*").order("started_at", { ascending: false }).limit(1),
  ]);

  const competitors = (competitorsRes.data ?? []) as Competitor[];
  const events = (eventsRes.data ?? []) as ChangeEvent[];
  const stats = (statsRes.data ?? []) as CompetitorWeeklyStats[];
  const lastRun = ((runRes.data ?? []) as Run[])[0];

  const byId = new Map(competitors.map((c) => [c.id, c]));

  // Semana 1 e toda "new": sem baseline nao existe comparacao, e o feed vazio
  // precisa dizer isso em vez de parecer quebrado.
  const baselineOnly = stats.length > 0 && stats.every((s) => !s.has_comparison);
  const trackingSince = stats
    .map((s) => s.tracking_since)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return (
    <div className="space-y-12">
      <CompetitorRail competitors={competitors} />

      {competitors.length === 0 ? (
        <Panel>
          <Empty>
            Nenhum concorrente cadastrado. Insira linhas em <code>competitors</code> e{" "}
            <code>sources</code> no Supabase para começar — o README tem o SQL.
          </Empty>
        </Panel>
      ) : null}

      <Panel
        title="O que mudou"
        bare
        action={
          lastRun ? (
            <span className="text-xs text-muted">
              Última coleta {fullDate(lastRun.started_at)}
            </span>
          ) : null
        }
      >
        {events.length === 0 ? (
          <Empty>
            {baselineOnly && trackingSince ? (
              <>
                Baseline coletado em {fullDate(trackingSince)}.
                <br />A comparação começa na próxima coleta — até lá não há o que comparar.
              </>
            ) : (
              <>
                Nada detectado ainda. Dispare a coleta com <code>POST /api/cron/weekly</code>.
              </>
            )}
          </Empty>
        ) : (
          <ul>
            {events.map((event) => (
              <EventRow key={event.id} event={event} competitor={byId.get(event.competitor_id)} />
            ))}
          </ul>
        )}
      </Panel>

      {stats.length > 0 ? (
        <Panel title="Placar da semana" bare>
          <Scoreboard rows={stats} />
        </Panel>
      ) : null}
    </div>
  );
}
