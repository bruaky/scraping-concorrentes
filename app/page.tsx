import { CompetitorRail } from "./_components/competitor-rail";
import { FeedRow } from "./_components/feed-row";
import { ConnectionBanner, SectionNotConnected } from "./_components/not-connected";
import { Empty, Panel } from "./_components/panel";
import { Scoreboard } from "./_components/scoreboard";
import { loadDashboard } from "@/lib/dashboard-data";
import { fullDate } from "@/lib/format";

// Server component: le o Supabase com a service role key, sem expor nada ao
// browser. Renderiza sob demanda — e sempre renderiza: `loadDashboard` nao
// lanca, devolve o estado da conexao.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { connection, competitors, feed, scoreboard, readiness, lastRun, sources } =
    await loadDashboard();

  const connected = connection.status === "ok";
  const logoBySlug = new Map(competitors.map((c) => [c.slug, c.logo_url]));

  // Semana 1 e toda 'new'. Isso e diferente de fonte desconectada: aqui a
  // coleta rodou e ainda nao ha com o que comparar.
  const allBaseline = readiness.length > 0 && readiness.every((r) => r.status === "baseline");
  const since = readiness
    .map((r) => r.primeiro_scrape)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return (
    <div className="space-y-12">
      {competitors.length > 0 ? (
        <CompetitorRail competitors={competitors} />
      ) : (
        <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm text-ink-2">Nenhum concorrente para mostrar</p>
          <p className="mt-1 text-sm text-muted">
            O overview lista os concorrentes de <code>competitors</code> quando a fonte estiver
            conectada.
          </p>
        </div>
      )}

      <ConnectionBanner connection={connection} />

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
        {!connected && feed.length === 0 ? (
          <SectionNotConnected title="Fonte não conectada">
            O feed lê <code>change_events</code>. Quando a coleta rodar, cada mudança aparece aqui
            em ordem, com severidade por cor.
          </SectionNotConnected>
        ) : feed.length === 0 ? (
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

      {/* O placar renderiza sempre: as colunas mostram o que ele mede, mesmo
          antes de existir dado. */}
      <Panel title="Placar da semana" bare>
        <Scoreboard rows={scoreboard} sources={sources} />
      </Panel>
    </div>
  );
}
