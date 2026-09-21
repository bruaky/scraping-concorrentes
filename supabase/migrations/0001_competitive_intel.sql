-- ===========================================================================
-- 0001_competitive_intel
--
-- Inteligencia competitiva: concorrentes, fontes monitoradas, captura bruta
-- (site via Firecrawl, Instagram via Apify) e a timeline de mudancas.
--
-- Tudo e escrito pelo backend com a service role key. RLS fica ligado e sem
-- policies para anon/authenticated: nenhum client le direto.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type source_kind as enum ('website', 'instagram');
exception when duplicate_object then null; end $$;

-- O que a pagina e, nao um rotulo livre: decide a extracao estruturada que
-- pedimos ao Firecrawl e a severidade do evento gerado.
do $$ begin
  create type page_type as enum ('home', 'pricing', 'blog', 'careers', 'changelog', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type run_status as enum ('running', 'success', 'error');
exception when duplicate_object then null; end $$;

-- Espelha o changeStatus do Firecrawl. Nullable na tabela: quando o lookup do
-- changeTracking da timeout, o status e DESCONHECIDO, nunca 'same'.
do $$ begin
  create type change_status as enum ('new', 'same', 'changed', 'removed');
exception when duplicate_object then null; end $$;

-- Cor do feed: critical vermelho, warning amarelo, info cinza.
do $$ begin
  create type severity as enum ('critical', 'warning', 'info');
exception when duplicate_object then null; end $$;

do $$ begin
  create type change_kind as enum (
    'pricing_changed',      -- preco de um plano mudou            (critical)
    'value_prop_changed',   -- headline/proposta da home mudou    (critical)
    'page_removed',         -- 404                                (critical)
    'account_private',      -- perfil fechou, a coleta para       (critical)
    'jobs_changed',         -- vagas abertas/fechadas             (warning)
    'page_added',           -- pagina nova                        (warning)
    'page_hidden',          -- saiu do sitemap, ainda abre        (warning)
    'page_changed',         -- conteudo mudou                     (warning)
    'bio_changed',          -- bio / nome do perfil               (warning)
    'external_url_changed', -- CTA da bio                         (warning)
    'followers_jump',       -- variacao relevante de seguidores   (warning)
    'blog_post',            -- post novo no blog                  (info)
    'new_post'              -- post novo no Instagram             (info)
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- competitors
-- ---------------------------------------------------------------------------
create table if not exists public.competitors (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  -- Logo do card no overview. Quando null a UI cai num monograma com as
  -- iniciais — nada de depender de servico externo de logo.
  logo_url    text,
  website     text,
  instagram   text,                 -- handle sem o "@"
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists competitors_active_idx
  on public.competitors (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------
create table if not exists public.sources (
  id             uuid primary key default gen_random_uuid(),
  competitor_id  uuid not null references public.competitors (id) on delete cascade,
  kind           source_kind not null,
  -- website: URL completa. instagram: o handle.
  target         text not null,
  page_type      page_type not null default 'other',
  is_active      boolean not null default true,
  last_run_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (competitor_id, kind, target)
);

create index if not exists sources_competitor_idx on public.sources (competitor_id);

-- ---------------------------------------------------------------------------
-- runs
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
-- web_snapshots — uma captura de uma URL
-- ---------------------------------------------------------------------------
create table if not exists public.web_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  competitor_id      uuid not null references public.competitors (id) on delete cascade,
  source_id          uuid not null references public.sources (id) on delete cascade,
  run_id             uuid references public.runs (id) on delete set null,
  captured_at        timestamptz not null default now(),

  -- changeTracking. status NULL = o Firecrawl nao conseguiu comparar (ver
  -- tracking_warning); a UI mostra "sem comparacao", nunca "nao mudou".
  change_status      change_status,
  tracking_warning   text,
  previous_scrape_at timestamptz,
  -- 'hidden' = a URL abre mas saiu dos links e do sitemap: pagina sendo
  -- aposentada.
  visibility         text check (visibility in ('visible', 'hidden')),

  status_code        integer,
  title              text,
  content_hash       text,
  markdown           text,
  diff_text          text,      -- git-diff, pro bloco expansivel do card
  diff_json          jsonb,     -- files[].chunks[].changes[] — de onde saem os posts novos

  -- Extracao estruturada (formato json do Firecrawl), por page_type.
  extracted          jsonb,
  -- Metricas achatadas pro placar nao precisar abrir o jsonb.
  jobs_count         integer,   -- page_type = careers
  headline_price     numeric,   -- page_type = pricing, plano pago mais barato
  price_currency     text
);

create index if not exists web_snapshots_source_time_idx
  on public.web_snapshots (source_id, captured_at desc);
create index if not exists web_snapshots_competitor_time_idx
  on public.web_snapshots (competitor_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- instagram_profile_snapshots — 1 linha por concorrente por semana
-- ---------------------------------------------------------------------------
create table if not exists public.instagram_profile_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  competitor_id          uuid not null references public.competitors (id) on delete cascade,
  source_id              uuid not null references public.sources (id) on delete cascade,
  run_id                 uuid references public.runs (id) on delete set null,
  captured_at            timestamptz not null default now(),

  followers_count        integer,
  follows_count          integer,
  posts_count            integer,

  biography              text,
  external_url           text,

  is_verified            boolean,
  is_business_account    boolean,
  business_category_name text,
  -- Se virar true a coleta para: perfil privado nao devolve mais nada.
  is_private             boolean not null default false,
  -- statistics.account_type: 1 pessoal, 2 business, 3 creator
  account_type           smallint,

  raw                    jsonb not null default '{}'::jsonb
);

create index if not exists ig_profile_competitor_time_idx
  on public.instagram_profile_snapshots (competitor_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- instagram_posts — identidade do post (o que nao muda)
-- ---------------------------------------------------------------------------
create table if not exists public.instagram_posts (
  id             uuid primary key default gen_random_uuid(),
  competitor_id  uuid not null references public.competitors (id) on delete cascade,
  source_id      uuid not null references public.sources (id) on delete cascade,
  ig_id          text not null,
  short_code     text,
  url            text,
  posted_at      timestamptz,          -- timestamp: cadencia real, dia e hora
  media_type     text,                 -- Image | Video | Sidecar
  product_type   text,                 -- 'clips' = reel
  caption        text,
  hashtags       text[] not null default '{}',
  mentions       text[] not null default '{}',
  tagged_users   text[] not null default '{}',
  display_url    text,
  -- Fixado no topo: aparece em toda coleta, nao e post da semana.
  is_pinned      boolean not null default false,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (competitor_id, ig_id)
);

create index if not exists ig_posts_competitor_time_idx
  on public.instagram_posts (competitor_id, posted_at desc);

-- ---------------------------------------------------------------------------
-- instagram_post_metrics — o que muda a cada coleta
--
-- likes_count NULL = desconhecido (a conta esconde curtidas; o Apify manda -1
-- e o ingest normaliza). Zero de verdade e 0. A constraint garante que -1 nunca
-- entra: se entrasse, a media de engajamento despencaria e leriamos isso como
-- queda real.
--
-- video_* so existem em video. NULL em post de imagem significa ausencia — o
-- card mostra celula vazia, nao "0 views".
-- ---------------------------------------------------------------------------
create table if not exists public.instagram_post_metrics (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.instagram_posts (id) on delete cascade,
  run_id           uuid references public.runs (id) on delete set null,
  captured_at      timestamptz not null default now(),
  likes_count      integer check (likes_count is null or likes_count >= 0),
  comments_count   integer check (comments_count is null or comments_count >= 0),
  video_play_count integer,
  video_view_count integer,
  -- Sentimento de graca, sem gastar run de comments.
  latest_comments  jsonb not null default '[]'::jsonb
);

create index if not exists ig_metrics_post_time_idx
  on public.instagram_post_metrics (post_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- change_events — o feed do Nivel 1
-- ---------------------------------------------------------------------------
create table if not exists public.change_events (
  id                 uuid primary key default gen_random_uuid(),
  competitor_id      uuid not null references public.competitors (id) on delete cascade,
  source_id          uuid references public.sources (id) on delete set null,
  run_id             uuid references public.runs (id) on delete set null,
  kind               change_kind not null,
  severity           severity not null,
  title              text not null,
  summary            text,
  url                text,
  diff               text,
  payload            jsonb not null default '{}'::jsonb,
  occurred_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  -- Torna o ingest idempotente: rodar duas vezes na mesma semana nao duplica.
  dedupe_key         text not null unique
);

create index if not exists change_events_competitor_time_idx
  on public.change_events (competitor_id, occurred_at desc);
create index if not exists change_events_time_idx
  on public.change_events (occurred_at desc);

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
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
-- RLS: ligado em tudo, sem policy nenhuma.
-- ---------------------------------------------------------------------------
alter table public.competitors                 enable row level security;
alter table public.sources                     enable row level security;
alter table public.runs                        enable row level security;
alter table public.web_snapshots               enable row level security;
alter table public.instagram_profile_snapshots enable row level security;
alter table public.instagram_posts             enable row level security;
alter table public.instagram_post_metrics      enable row level security;
alter table public.change_events               enable row level security;
