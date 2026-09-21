/**
 * Tipos do schema em supabase/migrations/.
 *
 * Escritos a mao pra manter o repo sem passo de codegen. Se preferir gerar:
 *   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts
 *
 * Sao `type`, nao `interface`: o supabase-js exige que cada Row seja
 * atribuivel a Record<string, unknown>, e interface sem index signature nao e.
 */

export type Source = "firecrawl" | "apify_instagram";

export type PageType =
  | "home"
  | "pricing"
  | "product"
  | "blog_index"
  | "blog_post"
  | "about"
  | "careers"
  | "changelog"
  | "docs"
  | "customers"
  | "other";

export type RunStatus = "running" | "success" | "partial" | "failed";
export type ChangeStatus = "new" | "same" | "changed" | "removed";
export type Visibility = "visible" | "hidden";
export type Severity = "info" | "notable" | "high";

export type EventType =
  | "pricing_changed"
  | "value_prop_changed"
  | "page_changed"
  | "page_removed"
  | "page_hidden"
  | "new_blog_post"
  | "followers_jump"
  | "bio_changed"
  | "bio_link_changed"
  | "posting_resumed"
  | "posting_stopped"
  | "new_profile";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// --- dimensoes --------------------------------------------------------------

export type Competitor = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  instagram_handle: string | null;
  linkedin_url: string | null;
  category: string | null;
  is_active: boolean;
  notes: string | null;
  /** Adicionado em 0003. Null = a UI usa monograma. */
  logo_url: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackedPage = {
  id: string;
  competitor_id: string;
  url: string;
  page_type: PageType;
  /** Isola o historico de comparacao do changeTracking por cadencia. */
  firecrawl_tag: string;
  diff_modes: string[];
  /** Null = nao usa json mode, nao gasta os creditos extras. */
  extraction_schema: Json;
  extraction_prompt: string | null;
  /** Congeladas: mudar invalida a serie de comparacao. */
  scrape_options: Json;
  is_active: boolean;
  created_at: string;
};

export type CollectionRun = {
  id: string;
  source: Source;
  job: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  items_ok: number;
  items_failed: number;
  credits_used: number | null;
  cost_usd: number | null;
  external_ref: string | null;
  error: string | null;
};

// --- web --------------------------------------------------------------------

export type PageScrape = {
  id: string;
  run_id: string | null;
  tracked_page_id: string;
  competitor_id: string;
  scraped_at: string;
  /** null = o Firecrawl nao conseguiu comparar. Ver `warning`. */
  change_status: ChangeStatus | null;
  visibility: Visibility | null;
  previous_scrape_at: string | null;
  http_status: number | null;
  title: string | null;
  description: string | null;
  markdown: string | null;
  markdown_hash: string | null;
  markdown_chars: number | null;
  warning: string | null;
  raw: Json;
};

export type PageDiff = {
  id: string;
  scrape_id: string;
  competitor_id: string;
  diff_text: string | null;
  diff_json: Json;
  lines_added: number | null;
  lines_removed: number | null;
  created_at: string;
};

export type PageFieldChange = {
  id: string;
  scrape_id: string;
  competitor_id: string;
  tracked_page_id: string;
  field_name: string;
  previous_value: string | null;
  current_value: string | null;
  /** Coluna gerada: previous is distinct from current. Nunca enviar no insert. */
  has_changed: boolean;
  observed_at: string;
};

export type BlogPost = {
  id: string;
  competitor_id: string;
  url: string;
  title: string | null;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  author: string | null;
  summary: string | null;
  word_count: number | null;
  is_gone: boolean;
  raw: Json;
};

// --- instagram --------------------------------------------------------------

export type InstagramProfileSnapshot = {
  id: string;
  run_id: string | null;
  competitor_id: string;
  username: string;
  ig_user_id: string | null;
  captured_at: string;
  followers_count: number | null;
  follows_count: number | null;
  posts_count: number | null;
  highlight_reel_count: number | null;
  full_name: string | null;
  biography: string | null;
  external_url: string | null;
  external_urls: Json;
  is_verified: boolean | null;
  is_business_account: boolean | null;
  business_category: string | null;
  is_private: boolean | null;
  account_type: number | null;
  raw: Json;
};

export type InstagramPost = {
  /** post.id do Instagram — chave natural. */
  id: string;
  competitor_id: string;
  owner_username: string;
  short_code: string | null;
  url: string | null;
  post_type: string | null;
  product_type: string | null;
  caption: string | null;
  hashtags: string[] | null;
  mentions: string[] | null;
  tagged_users: string[] | null;
  posted_at: string;
  video_duration: number | null;
  music_info: Json;
  is_pinned: boolean | null;
  first_seen_at: string;
  raw: Json;
};

export type InstagramPostMetric = {
  id: string;
  run_id: string | null;
  post_id: string;
  competitor_id: string;
  captured_at: string;
  /**
   * CRU, como o Apify devolve: -1 significa que o autor escondeu as
   * curtidas. A normalizacao fica nas views (nullif(likes_count, -1)),
   * conforme o modelo do schema — nao normalize na ingestao, senao o dado
   * bruto perde a distincao entre "escondido" e "ausente".
   */
  likes_count: number | null;
  comments_count: number | null;
  /** null em post de imagem: ausencia, nao zero. */
  video_view_count: number | null;
  video_play_count: number | null;
};

export type ChangeEvent = {
  id: string;
  competitor_id: string;
  source: Source;
  event_type: EventType;
  severity: Severity;
  title: string;
  detail: string | null;
  payload: Json;
  occurred_at: string;
  notified_at: string | null;
  acknowledged_at: string | null;
};

// --- views de leitura da dashboard ------------------------------------------

/** Nivel 1. */
export type DashboardFeedRow = {
  id: string;
  occurred_at: string;
  competitor: string;
  competitor_slug: string;
  source: Source;
  event_type: EventType;
  severity: Severity;
  /** high = 1, notable = 2, info = 3. Ordem explicita, nao alfabetica. */
  severity_rank: number;
  title: string;
  detail: string | null;
  payload: Json;
  pending_notification: boolean;
  acknowledged_at: string | null;
};

/** Nivel 2. */
export type DashboardScoreboardRow = {
  competitor_id: string;
  competitor: string;
  slug: string;
  website: string | null;
  category: string | null;
  logo_url: string | null;
  username: string | null;
  followers_count: number | null;
  is_private: boolean | null;
  /** Compara com o snapshot mais recente com 7+ dias. */
  followers_delta_7d: number | null;
  followers_pct_7d: number | null;
  /** Compara com a captura anterior, seja ela quando for. */
  followers_delta_since_last: number | null;
  posts_7d: number;
  /** Posts da semana sem curtida visivel: a media e parcial. */
  posts_unknown_likes: number;
  reels_7d: number | null;
  likes_7d: number | null;
  comments_7d: number | null;
  views_7d: number | null;
  avg_engagement: number | null;
  engagement_rate_pct: number | null;
  blog_posts_7d: number;
  open_roles: number | null;
  pages_changed_7d: number;
  last_price_field: string | null;
  last_price_from: string | null;
  last_price_to: string | null;
  last_price_changed_at: string | null;
  ig_last_seen: string | null;
  tracking_since: string | null;
  /** false = sem snapshot com 7+ dias. Mostrar baseline, nao delta zero. */
  has_comparison: boolean;
};

/** Nivel 3. */
export type CompetitorTimelineRow = {
  competitor_id: string;
  competitor_slug: string;
  occurred_at: string;
  source: "instagram" | "web";
  kind: string;
  title: string;
  detail: string | null;
  url: string | null;
  severity: Severity | null;
};

export type TrackingReadinessRow = {
  competitor: string;
  slug: string;
  scrapes_total: number;
  scrapes_baseline: number;
  scrapes_comparaveis: number;
  primeiro_scrape: string | null;
  ig_snapshots: number;
  status: "baseline" | "ativo";
};

// --- mapa do supabase-js ----------------------------------------------------

type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

/** has_changed e coluna gerada: o insert nao pode envia-la. */
type FieldChangeInsert = Omit<Partial<PageFieldChange>, "has_changed">;

export type Database = {
  public: {
    Tables: {
      competitors: Table<Competitor>;
      tracked_pages: Table<TrackedPage>;
      collection_runs: Table<CollectionRun>;
      page_scrapes: Table<PageScrape>;
      page_diffs: Table<PageDiff>;
      page_field_changes: Table<PageFieldChange, FieldChangeInsert>;
      blog_posts: Table<BlogPost>;
      instagram_profile_snapshots: Table<InstagramProfileSnapshot>;
      instagram_posts: Table<InstagramPost>;
      instagram_post_metrics: Table<InstagramPostMetric>;
      change_events: Table<ChangeEvent>;
    };
    Views: {
      v_dashboard_feed: View<DashboardFeedRow>;
      v_dashboard_scoreboard: View<DashboardScoreboardRow>;
      v_competitor_timeline: View<CompetitorTimelineRow>;
      v_tracking_readiness: View<TrackingReadinessRow>;
    };
    Functions: {
      fn_generate_change_events: {
        Args: { p_run_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** Severidade por tipo de evento — espelha o que a funcao SQL grava. */
export const SEVERITY_BY_EVENT: Record<EventType, Severity> = {
  pricing_changed: "high",
  value_prop_changed: "high",
  page_removed: "notable",
  page_hidden: "notable",
  page_changed: "notable",
  followers_jump: "notable",
  bio_changed: "notable",
  bio_link_changed: "notable",
  posting_stopped: "notable",
  posting_resumed: "info",
  new_blog_post: "info",
  new_profile: "info",
};
