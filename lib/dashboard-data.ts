import "server-only";

import { missingEnv, missingIngestEnv } from "./config";
import { supabaseAdmin } from "./supabase";
import type {
  CollectionRun,
  Competitor,
  CompetitorTimelineRow,
  DashboardFeedRow,
  DashboardScoreboardRow,
  TrackedPage,
  TrackingReadinessRow,
} from "./database.types";

/**
 * Leitura da dashboard.
 *
 * Princípio: a tela SEMPRE renderiza. Falta de credencial, consulta recusada
 * ou fonte não cadastrada não derrubam a pagina — cada uma vira um estado que
 * a UI sabe mostrar. Um painel que morre inteiro nao diz onde esta o buraco;
 * um painel que declara "fonte nao conectada" naquela celula, diz.
 *
 * Tres estados distintos, que a UI nunca deve confundir:
 *
 *   disconnected  nao ha de onde ler (sem credencial, consulta recusada, ou
 *                 o concorrente nao tem aquela fonte cadastrada)
 *   empty         a fonte esta ligada e nao coletou nada ainda (baseline)
 *   ok            tem dado
 */

export type Connection =
  | { status: "ok" }
  | { status: "missing_config"; missing: string[]; missingIngest: string[] }
  | { status: "query_failed"; errors: string[] };

/** Fontes de um concorrente, para a UI saber o que e "nao conectado". */
export type CompetitorSources = {
  /** Handle do Instagram confirmado em competitors.instagram_handle. */
  instagram: boolean;
  /** Ao menos uma linha ativa em tracked_pages. */
  web: boolean;
};

export type DashboardData = {
  connection: Connection;
  competitors: Competitor[];
  feed: DashboardFeedRow[];
  scoreboard: DashboardScoreboardRow[];
  readiness: TrackingReadinessRow[];
  lastRun: CollectionRun | null;
  /** Por slug. */
  sources: Map<string, CompetitorSources>;
};

const EMPTY: Omit<DashboardData, "connection"> = {
  competitors: [],
  feed: [],
  scoreboard: [],
  readiness: [],
  lastRun: null,
  sources: new Map(),
};

export async function loadDashboard(): Promise<DashboardData> {
  const missing = missingEnv();
  if (missing.length > 0) {
    return {
      ...EMPTY,
      connection: { status: "missing_config", missing, missingIngest: missingIngestEnv() },
    };
  }

  try {
    const db = supabaseAdmin();

    const [competitorsRes, feedRes, scoreboardRes, readinessRes, runRes, pagesRes] =
      await Promise.all([
        db.from("competitors").select("*").eq("is_active", true).order("name"),
        db.from("v_dashboard_feed").select("*").limit(60),
        db.from("v_dashboard_scoreboard").select("*"),
        db.from("v_tracking_readiness").select("*"),
        db.from("collection_runs").select("*").order("started_at", { ascending: false }).limit(1),
        db.from("tracked_pages").select("competitor_id").eq("is_active", true),
      ]);

    const errors = [...new Set(
      [competitorsRes, feedRes, scoreboardRes, readinessRes, runRes, pagesRes]
        .map((r) => r.error?.message)
        .filter((m): m is string => Boolean(m)),
    )];

    const competitors = (competitorsRes.data ?? []) as Competitor[];
    const withWeb = new Set((pagesRes.data ?? []).map((p) => p.competitor_id));

    return {
      // Consulta recusada nao apaga o que deu certo: o resto da tela usa o
      // que veio, e o aviso aparece por cima.
      connection: errors.length > 0 ? { status: "query_failed", errors } : { status: "ok" },
      competitors,
      feed: (feedRes.data ?? []) as DashboardFeedRow[],
      scoreboard: (scoreboardRes.data ?? []) as DashboardScoreboardRow[],
      readiness: (readinessRes.data ?? []) as TrackingReadinessRow[],
      lastRun: ((runRes.data ?? []) as CollectionRun[])[0] ?? null,
      sources: sourceMap(competitors, withWeb),
    };
  } catch (err) {
    // supabaseAdmin() ou a rede. Sem isso o Next esconderia a causa num digest.
    return {
      ...EMPTY,
      connection: {
        status: "query_failed",
        errors: [err instanceof Error ? err.message : String(err)],
      },
    };
  }
}

function sourceMap(
  competitors: Competitor[],
  withWeb: Set<string>,
): Map<string, CompetitorSources> {
  return new Map(
    competitors.map((c) => [
      c.slug,
      {
        instagram: Boolean(c.instagram_handle),
        web: withWeb.has(c.id),
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Pagina do concorrente
// ---------------------------------------------------------------------------

export type CompetitorData = {
  connection: Connection;
  competitor: Competitor | null;
  stats: DashboardScoreboardRow | null;
  timeline: CompetitorTimelineRow[];
  feed: DashboardFeedRow[];
  pages: TrackedPage[];
  readiness: TrackingReadinessRow | null;
  sources: CompetitorSources;
};

export async function loadCompetitor(slug: string): Promise<CompetitorData> {
  const base = {
    competitor: null,
    stats: null,
    timeline: [] as CompetitorTimelineRow[],
    feed: [] as DashboardFeedRow[],
    pages: [] as TrackedPage[],
    readiness: null,
    sources: { instagram: false, web: false },
  };

  const missing = missingEnv();
  if (missing.length > 0) {
    return {
      ...base,
      connection: { status: "missing_config", missing, missingIngest: missingIngestEnv() },
    };
  }

  try {
    const db = supabaseAdmin();

    const { data: row, error } = await db
      .from("competitors")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      return { ...base, connection: { status: "query_failed", errors: [error.message] } };
    }
    // Slug inexistente e 404 de verdade, nao falta de conexao.
    if (!row) return { ...base, connection: { status: "ok" } };

    const competitor = row as Competitor;

    const [statsRes, timelineRes, feedRes, pagesRes, readinessRes] = await Promise.all([
      db.from("v_dashboard_scoreboard").select("*").eq("slug", slug).maybeSingle(),
      db
        .from("v_competitor_timeline")
        .select("*")
        .eq("competitor_slug", slug)
        .order("occurred_at", { ascending: false })
        .limit(200),
      db.from("v_dashboard_feed").select("*").eq("competitor_slug", slug).limit(30),
      db.from("tracked_pages").select("*").eq("competitor_id", competitor.id).order("page_type"),
      db.from("v_tracking_readiness").select("*").eq("slug", slug).maybeSingle(),
    ]);

    const errors = [...new Set(
      [statsRes, timelineRes, feedRes, pagesRes, readinessRes]
        .map((r) => r.error?.message)
        .filter((m): m is string => Boolean(m)),
    )];

    const pages = (pagesRes.data ?? []) as TrackedPage[];

    return {
      connection: errors.length > 0 ? { status: "query_failed", errors } : { status: "ok" },
      competitor,
      stats: (statsRes.data as DashboardScoreboardRow | null) ?? null,
      timeline: (timelineRes.data ?? []) as CompetitorTimelineRow[],
      feed: (feedRes.data ?? []) as DashboardFeedRow[],
      pages,
      readiness: (readinessRes.data as TrackingReadinessRow | null) ?? null,
      sources: {
        instagram: Boolean(competitor.instagram_handle),
        web: pages.some((p) => p.is_active),
      },
    };
  } catch (err) {
    return {
      ...base,
      connection: {
        status: "query_failed",
        errors: [err instanceof Error ? err.message : String(err)],
      },
    };
  }
}
