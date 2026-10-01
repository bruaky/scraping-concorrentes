import { CompetitorRail } from "./_components/competitor-rail";
import { FeedRow } from "./_components/feed-row";
import { LiveRun, type LiveSnapshot } from "./_components/live-run";
import { Empty, Panel } from "./_components/panel";
import { Scoreboard } from "./_components/scoreboard";
import { liveRunMode } from "@/lib/live-run";
import { fullDate } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import { TRACKED_SLUGS } from "@/lib/tracked";
import type {
  CollectionRun,
  Competitor,
  DashboardFeedRow,
  DashboardScoreboardRow,
} from "@/lib/database.types";

// Server component: le o Supabase com a service role key, sem expor nada ao
// browser. Renderiza sob demanda para o build nao precisar das credenciais.
export const dynamic = "force-dynamic";

/** Quantos eventos aparecem abertos; o resto fica atras de "mostrar mais". */
const FEED_VISIBLE = 12;

export default async function DashboardPage() {
  const db = supabaseAdmin();

  // Serie de seguidores das ultimas 10 semanas, para a tabela e os graficos
  // da coleta. 4 concorrentes x 10 capturas fica longe do limite de linhas.
  const since10w = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString();

  const [competitorsRes, feedRes, scoreboardRes, runRes, historyRes] = await Promise.all([
    db
      .from("competitors")
      .select("*")
      .eq("is_active", true)
      .in("slug", TRACKED_SLUGS)
      .order("name"),
    // Nivel 1: a tela inicial le SO esta view.
    db.from("v_dashboard_feed").select("*").in("competitor_slug", TRACKED_SLUGS).limit(60),
    db.from("v_dashboard_scoreboard").select("*").in("slug", TRACKED_SLUGS),
    db.from("collection_runs").select("*").order("started_at", { ascending: false }).limit(1),
    db
      .from("instagram_profile_snapshots")
      .select("competitor_id, captured_at, followers_count, posts_count")
      .gte("captured_at", since10w)
      .order("captured_at"),
  ]);

  const competitors = (competitorsRes.data ?? []) as Competitor[];
  const feed = (feedRes.data ?? []) as DashboardFeedRow[];
  const scoreboard = (scoreboardRes.data ?? []) as DashboardScoreboardRow[];
  const lastRun = ((runRes.data ?? []) as CollectionRun[])[0];
  const ids = new Set(competitors.map((c) => c.id));
  const history = ((historyRes.data ?? []) as LiveSnapshot[]).filter((s) => ids.has(s.competitor_id));

  const logoBySlug = new Map(competitors.map((c) => [c.slug, c.logo_url]));

  // Semana 1 e toda baseline. Sem isso o primeiro acesso parece quebrado.
  // tracking_since cobre site E Instagram; primeiro_scrape so o site.
  const allBaseline = scoreboard.length > 0 && scoreboard.every((r) => !r.has_comparison);
  const since = scoreboard
    .map((r) => r.tracking_since)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return (
    <div className="space-y-12">
      <CompetitorRail competitors={competitors} />

      {competitors.length === 0 ? (
        <Panel>
          <Empty>
            Nenhum concorrente ativo. A migration <code>0001</code> e o baseline de 01/10 cadastram
            Glean, Meuze, Bond e Strattum — se esta lista está vazia, eles ainda não foram aplicados.
          </Empty>
        </Panel>
      ) : null}

      <LiveRun
        competitors={competitors.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          logo_url: c.logo_url,
          handle: c.instagram_handle,
        }))}
        history={history}
        mode={liveRunMode()}
      />

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
          <>
            <ul>
              {feed.slice(0, FEED_VISIBLE).map((event) => (
                <FeedRow
                  key={event.id}
                  event={event}
                  logoUrl={logoBySlug.get(event.competitor_slug) ?? null}
                />
              ))}
            </ul>
            {feed.length > FEED_VISIBLE ? (
              <details className="group border-t border-line">
                <summary className="cursor-pointer list-none px-4 py-3 text-center text-xs text-muted hover:text-ink group-open:border-b group-open:border-line">
                  <span className="group-open:hidden">Mostrar mais {feed.length - FEED_VISIBLE}</span>
                  <span className="hidden group-open:inline">Mostrar menos</span>
                </summary>
                <ul>
                  {feed.slice(FEED_VISIBLE).map((event) => (
                    <FeedRow
                      key={event.id}
                      event={event}
                      logoUrl={logoBySlug.get(event.competitor_slug) ?? null}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
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
