import Link from "next/link";
import { notFound } from "next/navigation";

import { EventRow } from "../../_components/event-row";
import { Logo } from "../../_components/logo";
import { Empty, Panel } from "../../_components/panel";
import { Stat } from "../../_components/stat";
import { fullDate, int, money, pct, signed } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import type {
  ChangeEvent,
  Competitor,
  CompetitorWeeklyStats,
  Source,
} from "@/lib/database.types";

export const dynamic = "force-dynamic";

/**
 * Nivel 3: drill-down.
 *
 * A timeline mistura site e Instagram no mesmo eixo de tempo de proposito — e
 * ai que aparece a correlacao que justifica o sistema inteiro ("mudaram o
 * pricing na semana que abriram 4 vagas de vendas").
 */
export default async function CompetitorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = supabaseAdmin();

  const { data: competitorRow } = await db
    .from("competitors")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!competitorRow) notFound();
  const competitor = competitorRow as Competitor;

  const [statsRes, sourcesRes, eventsRes] = await Promise.all([
    db
      .from("competitor_weekly_stats")
      .select("*")
      .eq("competitor_id", competitor.id)
      .maybeSingle(),
    db.from("sources").select("*").eq("competitor_id", competitor.id).order("kind"),
    db
      .from("change_events")
      .select("*")
      .eq("competitor_id", competitor.id)
      .order("occurred_at", { ascending: false })
      .limit(150),
  ]);

  const stats = statsRes.data as CompetitorWeeklyStats | null;
  const sources = (sourcesRes.data ?? []) as Source[];
  const events = (eventsRes.data ?? []) as ChangeEvent[];

  // Qual fonte gerou cada evento, pro marcador de canal na timeline.
  const sourceKind = new Map(sources.map((s) => [s.id, s.kind]));

  const groups = groupByDay(events);

  return (
    <div className="space-y-10">
      <div>
        <Link href="/" className="text-xs text-muted hover:text-ink">
          ← Todos os concorrentes
        </Link>

        <div className="mt-4 flex items-center gap-4">
          <Logo name={competitor.name} src={competitor.logo_url} size={52} />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{competitor.name}</h1>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
              {competitor.website ? (
                <a
                  href={competitor.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-ink"
                >
                  {hostOf(competitor.website)}
                </a>
              ) : null}
              {competitor.instagram ? (
                <a
                  href={`https://instagram.com/${competitor.instagram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-ink"
                >
                  @{competitor.instagram}
                </a>
              ) : null}
              {stats?.tracking_since ? (
                <span>Monitorado desde {fullDate(stats.tracking_since)}</span>
              ) : null}
            </p>
          </div>
        </div>

        {competitor.notes ? (
          <p className="mt-4 max-w-2xl text-sm text-ink-2">{competitor.notes}</p>
        ) : null}
      </div>

      {stats ? <Metrics stats={stats} /> : null}

      <Panel title="Timeline" bare>
        {events.length === 0 ? (
          <Empty>
            {stats && !stats.has_comparison && stats.tracking_since ? (
              <>
                Baseline coletado em {fullDate(stats.tracking_since)}.
                <br />A comparação começa na próxima coleta.
              </>
            ) : (
              "Nada detectado ainda."
            )}
          </Empty>
        ) : (
          <div>
            {groups.map(([day, dayEvents]) => (
              <section key={day}>
                <h3 className="eyebrow sticky top-0 border-b border-line bg-surface px-4 py-2">
                  {fullDate(day)}
                </h3>
                <ul>
                  {dayEvents.map((event) => (
                    <li key={event.id} className="flex">
                      <span className="w-20 shrink-0 border-b border-line py-3.5 pl-4 text-xs text-muted">
                        {channelLabel(event.source_id, sourceKind)}
                      </span>
                      <ul className="min-w-0 flex-1">
                        <EventRow event={event} />
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Fontes monitoradas" bare>
        {sources.length === 0 ? (
          <Empty>Nenhuma fonte cadastrada para este concorrente.</Empty>
        ) : (
          <ul>
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-sm last:border-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="eyebrow w-16 shrink-0">
                    {s.kind === "instagram" ? "Instagram" : s.page_type}
                  </span>
                  <span className="truncate text-ink-2">{s.target}</span>
                </span>
                <span className="text-xs text-muted">
                  {s.is_active ? "" : "pausada · "}
                  {s.last_run_at ? `coletada ${fullDate(s.last_run_at)}` : "nunca coletada"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Metrics({ stats }: { stats: CompetitorWeeklyStats }) {
  const delta = stats.followers_delta_7d;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Stat label="Seguidores" value={int(stats.followers_count)} />

      <Stat
        label="Δ 7 dias"
        value={stats.has_comparison ? signed(delta) : "baseline"}
        tone={!stats.has_comparison || delta === null ? "neutral" : delta > 0 ? "up" : delta < 0 ? "down" : "neutral"}
        note={
          stats.has_comparison
            ? stats.followers_delta_pct_7d !== null
              ? pct(stats.followers_delta_pct_7d, 1)
              : null
            : "comparação começa na próxima coleta"
        }
      />

      <Stat label="Posts 7d" value={int(stats.posts_7d)} />

      <Stat
        label="Eng. médio"
        hint="Média de curtidas + comentários dos posts da semana"
        value={int(
          stats.avg_engagement_7d === null ? null : Math.round(stats.avg_engagement_7d),
        )}
        note={
          stats.posts_unknown_likes > 0
            ? `${stats.posts_unknown_likes} post(s) escondem curtidas`
            : null
        }
      />

      <Stat
        label="ER"
        hint="(curtidas + comentários) ÷ seguidores"
        value={pct(stats.engagement_rate_pct, 2)}
      />

      <Stat label="Vagas abertas" value={int(stats.jobs_open)} />

      <Stat
        label="Preço"
        hint="Plano pago mais barato"
        value={money(stats.headline_price, stats.price_currency)}
      />
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function channelLabel(
  sourceId: string | null,
  kinds: Map<string, string>,
): string {
  const kind = sourceId ? kinds.get(sourceId) : null;
  if (kind === "instagram") return "Instagram";
  if (kind === "website") return "Site";
  return "";
}

/** Agrupa por dia mantendo a ordem decrescente. */
function groupByDay(events: ChangeEvent[]): Array<[string, ChangeEvent[]]> {
  const map = new Map<string, ChangeEvent[]>();

  for (const event of events) {
    const day = event.occurred_at.slice(0, 10);
    const bucket = map.get(day);
    if (bucket) bucket.push(event);
    else map.set(day, [event]);
  }

  return [...map.entries()];
}
