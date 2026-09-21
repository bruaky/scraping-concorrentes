import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedRow } from "../../_components/feed-row";
import { Logo } from "../../_components/logo";
import { Empty, Panel } from "../../_components/panel";
import { SetupNeeded } from "../../_components/setup-needed";
import { Stat } from "../../_components/stat";
import { missingEnv, missingIngestEnv } from "@/lib/config";
import { DASH, fullDate, int, pct, shortDate, signed } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import type {
  Competitor,
  CompetitorTimelineRow,
  DashboardFeedRow,
  DashboardScoreboardRow,
  TrackedPage,
  TrackingReadinessRow,
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

  const missing = missingEnv();
  if (missing.length > 0) {
    return <SetupNeeded missing={missing} missingIngest={missingIngestEnv()} />;
  }

  const db = supabaseAdmin();

  const { data: row } = await db.from("competitors").select("*").eq("slug", slug).maybeSingle();
  if (!row) notFound();
  const competitor = row as Competitor;

  const [statsRes, timelineRes, feedRes, pagesRes, readinessRes] = await Promise.all([
    db.from("v_dashboard_scoreboard").select("*").eq("slug", slug).maybeSingle(),
    db
      .from("v_competitor_timeline")
      .select("*")
      .eq("competitor_slug", slug)
      .order("occurred_at", { ascending: false })
      .limit(200),
    db
      .from("v_dashboard_feed")
      .select("*")
      .eq("competitor_slug", slug)
      .limit(30),
    db.from("tracked_pages").select("*").eq("competitor_id", competitor.id).order("page_type"),
    db.from("v_tracking_readiness").select("*").eq("slug", slug).maybeSingle(),
  ]);

  const stats = statsRes.data as DashboardScoreboardRow | null;
  const timeline = (timelineRes.data ?? []) as CompetitorTimelineRow[];
  const feed = (feedRes.data ?? []) as DashboardFeedRow[];
  const pages = (pagesRes.data ?? []) as TrackedPage[];
  const readiness = readinessRes.data as TrackingReadinessRow | null;

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
              {competitor.category ? <span>{competitor.category}</span> : null}
              {competitor.website ? (
                <a href={competitor.website} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
                  {hostOf(competitor.website)}
                </a>
              ) : null}
              {competitor.instagram_handle ? (
                <a
                  href={`https://instagram.com/${competitor.instagram_handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-ink"
                >
                  @{competitor.instagram_handle}
                </a>
              ) : null}
              {competitor.linkedin_url ? (
                <a href={competitor.linkedin_url} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
                  LinkedIn
                </a>
              ) : null}
              {readiness?.primeiro_scrape ? (
                <span>Monitorado desde {fullDate(readiness.primeiro_scrape)}</span>
              ) : null}
            </p>
          </div>
        </div>

        {competitor.notes ? (
          <p className="mt-4 max-w-2xl text-sm text-ink-2">{competitor.notes}</p>
        ) : null}
      </div>

      {stats ? <Metrics stats={stats} /> : null}

      {feed.length > 0 ? (
        <Panel title="Alertas" bare>
          <ul>
            {feed.map((event) => (
              <FeedRow key={event.id} event={event} showCompetitor={false} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Timeline" bare>
        {timeline.length === 0 ? (
          <Empty>
            {readiness?.status === "baseline" && readiness.primeiro_scrape ? (
              <>
                Baseline coletado em {fullDate(readiness.primeiro_scrape)}.
                <br />A comparação começa na próxima coleta.
              </>
            ) : (
              "Nada detectado ainda."
            )}
          </Empty>
        ) : (
          <div>
            {groupByDay(timeline).map(([day, entries]) => (
              <section key={day}>
                <h3 className="eyebrow sticky top-0 border-b border-line bg-surface px-4 py-2">
                  {fullDate(day)}
                </h3>
                <ul>
                  {entries.map((entry, i) => (
                    <TimelineRow key={`${day}-${i}`} entry={entry} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Páginas monitoradas" bare>
        {pages.length === 0 ? (
          <Empty>Nenhuma página cadastrada em <code>tracked_pages</code>.</Empty>
        ) : (
          <ul>
            {pages.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-sm last:border-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="eyebrow w-20 shrink-0">{p.page_type}</span>
                  <span className="truncate text-ink-2">{p.url}</span>
                </span>
                <span className="text-xs text-muted">
                  {p.is_active ? "" : "pausada · "}
                  {p.extraction_schema ? "extração json · " : ""}
                  {p.firecrawl_tag}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function TimelineRow({ entry }: { entry: CompetitorTimelineRow }) {
  return (
    <li className="flex border-b border-line last:border-0">
      <span className="w-24 shrink-0 py-3.5 pl-4 text-xs text-muted">
        {entry.source === "instagram" ? "Instagram" : "Site"}
      </span>
      <span className="min-w-0 flex-1 py-3.5 pr-4">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="eyebrow">{entry.kind}</span>
        </span>
        {entry.url ? (
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block text-sm text-ink hover:underline"
          >
            {entry.title}
          </a>
        ) : (
          <span className="mt-0.5 block text-sm text-ink">{entry.title}</span>
        )}
        {entry.detail ? (
          <span className="mt-1 block truncate text-sm text-muted">{entry.detail}</span>
        ) : null}
      </span>
    </li>
  );
}

function Metrics({ stats }: { stats: DashboardScoreboardRow }) {
  const delta = stats.followers_delta_7d;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Stat label="Seguidores" value={int(stats.followers_count)} />

      <Stat
        label="Δ 7 dias"
        hint="Comparado com a captura mais recente com 7 ou mais dias"
        value={stats.has_comparison ? signed(delta) : "baseline"}
        tone={
          !stats.has_comparison || delta === null
            ? "neutral"
            : delta > 0
              ? "up"
              : delta < 0
                ? "down"
                : "neutral"
        }
        note={
          stats.has_comparison
            ? stats.followers_pct_7d !== null
              ? pct(stats.followers_pct_7d, 1)
              : null
            : "comparação começa na próxima coleta"
        }
      />

      <Stat label="Posts 7d" value={int(stats.posts_7d)} note={reelsNote(stats)} />

      <Stat
        label="Eng. médio"
        hint="Média de curtidas + comentários dos posts da semana"
        value={int(stats.avg_engagement === null ? null : Math.round(stats.avg_engagement))}
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

      <Stat label="Blog 7d" value={int(stats.blog_posts_7d)} />
      <Stat label="Vagas abertas" value={int(stats.open_roles)} />

      <Stat
        label="Último preço"
        hint={
          stats.last_price_field
            ? `${stats.last_price_field}, em ${shortDate(stats.last_price_changed_at)}`
            : undefined
        }
        value={stats.last_price_to ?? DASH}
        note={stats.last_price_from ? `antes: ${stats.last_price_from}` : null}
      />
    </div>
  );
}

function reelsNote(stats: DashboardScoreboardRow): string | null {
  if (stats.reels_7d === null || stats.reels_7d === 0) return null;
  return `${stats.reels_7d} reel(s)`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Agrupa por dia mantendo a ordem decrescente. */
function groupByDay(entries: CompetitorTimelineRow[]): Array<[string, CompetitorTimelineRow[]]> {
  const map = new Map<string, CompetitorTimelineRow[]>();

  for (const entry of entries) {
    const day = entry.occurred_at.slice(0, 10);
    const bucket = map.get(day);
    if (bucket) bucket.push(entry);
    else map.set(day, [entry]);
  }

  return [...map.entries()];
}
