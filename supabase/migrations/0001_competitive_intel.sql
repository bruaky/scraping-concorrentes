-- ===========================================================================
-- 0001_competitive_intel
--
-- Schema de inteligencia competitiva: concorrentes, fontes monitoradas,
-- snapshots brutos (site + instagram) e a timeline de mudancas detectadas.
--
-- Tudo e escrito pelo backend com a service role key. RLS fica ligado e sem
-- policies para anon/authenticated: nenhum client consegue ler direto.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type source_kind as enum ('website', 'instagram');
exception when duplicate_object then null; end $$;

do $$ begin
  create type run_status as enum ('running', 'success', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type change_kind as enum (
    'page_changed',      -- conteudo da pagina mudou (Firecrawl changeTracking)
    'page_added',        -- pagina nova apareceu
    'page_removed',      -- pagina sumiu / 404
    'pricing_changed',   -- mudanca detectada numa pagina marcada como pricing
    'new_post',          -- novo post no Instagram
    'bio_changed',       -- bio/link/nome do perfil mudou
    'followers_jump'     -- variacao relevante de seguidores
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- competitors
-- ---------------------------------------------------------------------------
create table if not exists public.competitors (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  website     text,
  instagram   text,               -- handle sem o "@"
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists competitors_active_idx
  on public.competitors (is_active)
  where is_active;

-- ---------------------------------------------------------------------------
-- sources — o que exatamente monitoramos de cada concorrente
-- ---------------------------------------------------------------------------
create table if not exists public.sources (
  id             uuid primary key default gen_random_uuid(),
  competitor_id  uuid not null references public.competitors (id) on delete cascade,
  kind           source_kind not null,
  -- website: URL completa. instagram: o handle.
  target         text not null,
  -- rotulo livre pra agrupar no dashboard: "pricing", "blog", "home"...
  label          text,
  is_active      boolean not null default true,
  last_run_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (competitor_id, kind, target)
);

create index if not exists sources_competitor_idx on public.sources (competitor_id);
create index if not exists sources_due_idx on public.sources (kind, last_run_at nulls first)
  where is_active;

-- ---------------------------------------------------------------------------
-- runs — uma execucao de ingest (cron semanal ou manual)
-- ---------------------------------------------------------------------------
create table if not exists public.runs (
  id            uuid primary key default gen_random_uuid(),
  kind          source_kind not null,
  status        run_status not null default 'running',
  trigger       text not null default 'cron',   -- 'cron' | 'manual'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  sources_total integer not null default 0,
  sources_ok    integer not null default 0,
  error         text
);

create index if not exists runs_started_idx on public.runs (started_at desc);

-- ---------------------------------------------------------------------------
-- snapshots — o estado bruto capturado numa execucao
--
-- content_hash permite deduplicar: se o hash nao mudou, nao geramos evento.
-- payload guarda o retorno cru do Firecrawl/Apify pra auditoria e re-analise.
-- ---------------------------------------------------------------------------
create table if not exists public.snapshots (
  id             uuid primary key default gen_random_uuid(),
  competitor_id  uuid not null references public.competitors (id) on delete cascade,
  source_id      uuid not null references public.sources (id) on delete cascade,
  run_id         uuid references public.runs (id) on delete set null,
  kind           source_kind not null,
  captured_at    timestamptz not null default now(),
  content_hash   text,
  title          text,
  markdown       text,     -- website: markdown do Firecrawl
  payload        jsonb not null default '{}'::jsonb,
  -- metricas achatadas pro dashboard nao precisar abrir o jsonb
  followers      integer,
  posts_count    integer
);

create index if not exists snapshots_source_time_idx
  on public.snapshots (source_id, captured_at desc);
create index if not exists snapshots_competitor_time_idx
  on public.snapshots (competitor_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- change_events — a timeline que o dashboard mostra
--
-- dedupe_key torna a ingest idempotente: rodar o cron duas vezes na mesma
-- semana nao duplica eventos.
-- ---------------------------------------------------------------------------
create table if not exists public.change_events (
  id                 uuid primary key default gen_random_uuid(),
  competitor_id      uuid not null references public.competitors (id) on delete cascade,
  source_id          uuid references public.sources (id) on delete set null,
  snapshot_id        uuid references public.snapshots (id) on delete set null,
  prev_snapshot_id   uuid references public.snapshots (id) on delete set null,
  run_id             uuid references public.runs (id) on delete set null,
  kind               change_kind not null,
  severity           smallint not null default 1 check (severity between 0 and 3),
  title              text not null,
  summary            text,
  url                text,
  diff               text,        -- git-diff do changeTracking, quando houver
  payload            jsonb not null default '{}'::jsonb,
  occurred_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  dedupe_key         text not null unique
);

create index if not exists change_events_competitor_time_idx
  on public.change_events (competitor_id, occurred_at desc);
create index if not exists change_events_time_idx
  on public.change_events (occurred_at desc);
create index if not exists change_events_kind_idx
  on public.change_events (kind, occurred_at desc);

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists competitors_touch_updated_at on public.competitors;
create trigger competitors_touch_updated_at
  before update on public.competitors
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: liga em tudo e nao cria policy nenhuma.
-- A service role key ignora RLS; anon/authenticated ficam sem acesso.
-- ---------------------------------------------------------------------------
alter table public.competitors   enable row level security;
alter table public.sources       enable row level security;
alter table public.runs          enable row level security;
alter table public.snapshots     enable row level security;
alter table public.change_events enable row level security;
