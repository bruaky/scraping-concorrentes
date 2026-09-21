import { CompetitorRail } from "./_components/competitor-rail";
import { FeedRow } from "./_components/feed-row";
import { Empty, Panel } from "./_components/panel";
import { Scoreboard } from "./_components/scoreboard";
import { SetupNeeded } from "./_components/setup-needed";
import { missingEnv, missingIngestEnv } from "@/lib/config";
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
  // Antes de qualquer consulta: sem as credenciais o client do Supabase
  // lanca, e o Next esconderia a causa atras de um digest.
  const missing = missingEnv();
  if (missing.length > 0) {
    return <SetupNeeded missing={missing} missingIngest={missingIngestEnv()} />;
  }

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

  // Credencial errada ou migration nao aplicada devolvem erro aqui. Sem
  // mostrar isso, a tela ficaria vazia e pareceria "nada coletado ainda" —
  // que e uma conclusao bem diferente de "a consulta falhou".
  const queryErrors = [competitorsRes, feedRes, scoreboardRes, readinessRes, runRes]
    .map((r) => r.error?.message)
    .filter((m): m is string => Boolean(m));

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

      {queryErrors.length > 0 ? (
        <Panel title="O banco recusou a consulta">
          <p className="text-sm text-ink-2">
            As credenciais estão configuradas, mas o Supabase respondeu com erro. Normalmente é
            a service role key errada, ou as migrations ainda não aplicadas neste projeto.
          </p>
          <ul className="mt-3 space-y-1">
            {[...new Set(queryErrors)].map((message) => (
              <li key={message} className="font-mono text-sm text-critical">
                {message}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {competitors.length === 0 && queryErrors.length === 0 ? (
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
