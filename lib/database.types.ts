/**
 * Tipos do schema em supabase/migrations/0001_competitive_intel.sql.
 *
 * Escritos a mao pra manter o repo sem passo de codegen. Se preferir gerar:
 *   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts
 */

export type SourceKind = "website" | "instagram";
export type RunStatus = "running" | "success" | "error";
export type ChangeKind =
  | "page_changed"
  | "page_added"
  | "page_removed"
  | "pricing_changed"
  | "new_post"
  | "bio_changed"
  | "followers_jump";

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
  website: string | null;
  instagram: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Source = {
  id: string;
  competitor_id: string;
  kind: SourceKind;
  target: string;
  label: string | null;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
}

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
}

export type Snapshot = {
  id: string;
  competitor_id: string;
  source_id: string;
  run_id: string | null;
  kind: SourceKind;
  captured_at: string;
  content_hash: string | null;
  title: string | null;
  markdown: string | null;
  payload: Json;
  followers: number | null;
  posts_count: number | null;
}

export type ChangeEvent = {
  id: string;
  competitor_id: string;
  source_id: string | null;
  snapshot_id: string | null;
  prev_snapshot_id: string | null;
  run_id: string | null;
  kind: ChangeKind;
  severity: number;
  title: string;
  summary: string | null;
  url: string | null;
  diff: string | null;
  payload: Json;
  occurred_at: string;
  created_at: string;
  dedupe_key: string;
}

type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      competitors: Table<Competitor>;
      sources: Table<Source>;
      runs: Table<Run>;
      snapshots: Table<Snapshot>;
      change_events: Table<ChangeEvent>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      source_kind: SourceKind;
      run_status: RunStatus;
      change_kind: ChangeKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
