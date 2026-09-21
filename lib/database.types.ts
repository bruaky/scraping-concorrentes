/**
 * Tipos do schema em supabase/migrations/.
 *
 * Escritos a mao pra manter o repo sem passo de codegen. Se preferir gerar:
 *   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts
 *
 * Nota: sao `type`, nao `interface`. O supabase-js exige que cada Row seja
 * atribuivel a Record<string, unknown>, e interface sem index signature nao e.
 */

export type SourceKind = "website" | "instagram";
export type PageType = "home" | "pricing" | "blog" | "careers" | "changelog" | "other";
export type RunStatus = "running" | "success" | "error";
export type ChangeStatus = "new" | "same" | "changed" | "removed";
export type Severity = "critical" | "warning" | "info";

export type ChangeKind =
  | "pricing_changed"
  | "value_prop_changed"
  | "page_removed"
  | "account_private"
  | "jobs_changed"
  | "page_added"
  | "page_hidden"
  | "page_changed"
  | "bio_changed"
  | "external_url_changed"
  | "followers_jump"
  | "blog_post"
  | "new_post";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Competitor = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  website: string | null;
  instagram: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Source = {
  id: string;
  competitor_id: string;
  kind: SourceKind;
  target: string;
  page_type: PageType;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
};

export type Run = {
  id: string;
  kind: SourceKind;
  status: RunStatus;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  sources_total: number;
  sources_ok: number;
  error: string | null;
};

export type WebSnapshot = {
  id: string;
  competitor_id: string;
  source_id: string;
  run_id: string | null;
  captured_at: string;
  /** null = o Firecrawl nao conseguiu comparar. Ver tracking_warning. */
  change_status: ChangeStatus | null;
  tracking_warning: string | null;
  previous_scrape_at: string | null;
  visibility: "visible" | "hidden" | null;
  status_code: number | null;
  title: string | null;
  content_hash: string | null;
  markdown: string | null;
  diff_text: string | null;
  diff_json: Json;
  extracted: Json;
  jobs_count: number | null;
  headline_price: number | null;
  price_currency: string | null;
};

export type InstagramProfileSnapshot = {
  id: string;
  competitor_id: string;
  source_id: string;
  run_id: string | null;
  captured_at: string;
  followers_count: number | null;
  follows_count: number | null;
  posts_count: number | null;
  biography: string | null;
  external_url: string | null;
  is_verified: boolean | null;
  is_business_account: boolean | null;
  business_category_name: string | null;
  is_private: boolean;
  account_type: number | null;
  raw: Json;
};

export type InstagramPost = {
  id: string;
  competitor_id: string;
  source_id: string;
  ig_id: string;
  short_code: string | null;
  url: string | null;
  posted_at: string | null;
  media_type: string | null;
  product_type: string | null;
  caption: string | null;
  hashtags: string[];
  mentions: string[];
  tagged_users: string[];
  display_url: string | null;
  is_pinned: boolean;
  first_seen_at: string;
  last_seen_at: string;
};

export type InstagramPostMetric = {
  id: string;
  post_id: string;
  run_id: string | null;
  captured_at: string;
  /** null = desconhecido (conta esconde curtidas). Nunca -1, nunca 0 por default. */
  likes_count: number | null;
  comments_count: number | null;
  /** null em post de imagem = ausencia. A UI mostra celula vazia, nao "0". */
  video_play_count: number | null;
  video_view_count: number | null;
  latest_comments: Json;
};

export type ChangeEvent = {
  id: string;
  competitor_id: string;
  source_id: string | null;
  run_id: string | null;
  kind: ChangeKind;
  severity: Severity;
  title: string;
  summary: string | null;
  url: string | null;
  diff: string | null;
  payload: Json;
  occurred_at: string;
  created_at: string;
  dedupe_key: string;
};

/** Linha do placar (Nivel 2). Ver supabase/migrations/0002_scoreboard_view.sql. */
export type CompetitorWeeklyStats = {
  competitor_id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  followers_count: number | null;
  follows_count: number | null;
  is_private: boolean | null;
  profile_captured_at: string | null;
  followers_prior: number | null;
  followers_delta_7d: number | null;
  followers_delta_pct_7d: number | null;
  posts_7d: number;
  /** Posts da semana sem curtida visivel: a media e parcial. */
  posts_unknown_likes: number;
  avg_engagement_7d: number | null;
  engagement_rate_pct: number | null;
  blog_7d: number;
  jobs_open: number | null;
  headline_price: number | null;
  price_currency: string | null;
  tracking_since: string | null;
  /** false = ainda nao ha snapshot com 7+ dias. Mostrar "baseline", nao delta 0. */
  has_comparison: boolean;
};

type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      competitors: Table<Competitor>;
      sources: Table<Source>;
      runs: Table<Run>;
      web_snapshots: Table<WebSnapshot>;
      instagram_profile_snapshots: Table<InstagramProfileSnapshot>;
      instagram_posts: Table<InstagramPost>;
      instagram_post_metrics: Table<InstagramPostMetric>;
      change_events: Table<ChangeEvent>;
    };
    Views: {
      competitor_weekly_stats: View<CompetitorWeeklyStats>;
    };
    Functions: Record<string, never>;
    Enums: {
      source_kind: SourceKind;
      page_type: PageType;
      run_status: RunStatus;
      change_status: ChangeStatus;
      severity: Severity;
      change_kind: ChangeKind;
    };
    CompositeTypes: Record<string, never>;
  };
};

/** Severidade de cada tipo de evento — a cor do feed sai daqui. */
export const SEVERITY_BY_KIND: Record<ChangeKind, Severity> = {
  pricing_changed: "critical",
  value_prop_changed: "critical",
  page_removed: "critical",
  account_private: "critical",
  jobs_changed: "warning",
  page_added: "warning",
  page_hidden: "warning",
  page_changed: "warning",
  bio_changed: "warning",
  external_url_changed: "warning",
  followers_jump: "warning",
  blog_post: "info",
  new_post: "info",
};
