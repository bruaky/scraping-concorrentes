import { CompetitorRail } from "./_components/competitor-rail";
import { FeedRow } from "./_components/feed-row";
import { Empty, Panel } from "./_components/panel";
import { Scoreboard } from "./_components/scoreboard";
import { fullDate } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import type {
  CollectionRun,
  Competitor,
  DashboardFeedRow,
  DashboardScoreboardRow,
  TrackingReadinessRow,
} from "@/lib/database.types";

// Server component: le o Supabase com a service role key, sem expor nada ao
// browser. Renderiza sob demanda para o build nao precisar das credenciais.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = supabaseAdmin();

  const [competitorsRes, feedRes, scoreboardRes, readinessRes, runRes] = await Promise.all([
    db.from("competitors").select("*").eq("is_active", true).order("name"),
    // Nivel 1: a tela inicial le SO esta view.
    db.from("v_dashboard_feed").select("*").limit(60),
    db.from("v_dashboard_scoreboard").select("*"),
    db.from("v_tracking_readiness").select("*"),
    db.from("collection_runs").select("*").order("started_at", { ascending: false }).limit(1),
  ]);

  const competitors = (competitorsRes.data ?? []) as Competitor[];
  const feed = (feedRes.data ?? []) as DashboardFeedRow[];
  const scoreboard = (scoreboardRes.data ?? []) as DashboardScoreboardRow[];
  const readiness = (readinessRes.data ?? []) as TrackingReadinessRow[];
  const lastRun = ((runRes.data ?? []) as CollectionRun[])[0];

  const logoBySlug = new Map(competitors.map((c) => [c.slug, c.logo_url]));

  // Semana 1 e toda 'new'. Sem isso o primeiro acesso parece quebrado.
  const allBaseline = readiness.length > 0 && readiness.every((r) => r.status === "baseline");
  const since = readiness
    .map((r) => r.primeiro_scrape)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return (
    <div className="space-y-12">
      <CompetitorRail competitors={competitors} />

      {competitors.length === 0 ? (
        <Panel>
          <Empty>
            Nenhum concorrente cadastrado. A migration <code>0001</code> já semeia os 12 — se
            esta lista está vazia, ela ainda não foi aplicada.
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
              {lastRun.status !== "success" ? ` · ${lastRun.status}` : ""}
            </span>
          ) : null
        }
      >
        {feed.length === 0 ? (
          <Empty>
            {allBaseline && since ? (
              <>
                Baseline coletado em {fullDate(since)}.
                <br />
                A comparação começa na próxima coleta — até lá não há o que comparar.
              </>
            ) : (
              <>
                Nada detectado ainda. Dispare a coleta com <code>POST /api/cron/weekly</code>.
              </>
            )}
          </Empty>
        ) : (
          <ul>
            {feed.map((event) => (
              <FeedRow
                key={event.id}
                event={event}
                logoUrl={logoBySlug.get(event.competitor_slug) ?? null}
              />
            ))}
          </ul>
        )}
      </Panel>

      {scoreboard.length > 0 ? (
        <Panel title="Placar da semana" bare>
          <Scoreboard rows={scoreboard} />
        </Panel>
      ) : null}
    </div>
  );
}
