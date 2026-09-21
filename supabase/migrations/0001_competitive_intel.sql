-- ============================================================
-- Competitive Intelligence — schema Supabase
-- Fontes: Firecrawl (changeTracking) + Apify (instagram-scraper)
-- ============================================================
-- Princípio do modelo:
--   * o que é CONFIG fica em tabelas de dimensão (competitors, tracked_pages)
--   * o que é MEDIÇÃO vira série temporal append-only (snapshots, metrics)
--   * o que é FATO IMUTÁVEL fica separado do que MUDA
--     (instagram_posts vs instagram_post_metrics)
--   * tudo que merece alerta é desnormalizado em change_events,
--     para a dashboard não precisar de UNION em 6 tabelas
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. DIMENSÕES
-- ------------------------------------------------------------

create table if not exists competitors (
    id                uuid primary key default gen_random_uuid(),
    name              text not null unique,
    slug              text not null unique,
    website           text,
    instagram_handle  text,            -- sem @; null = não tem/não confirmado
    linkedin_url      text,
    category          text,            -- ex: 'enterprise search', 'memory layer'
    is_active         boolean not null default true,
    notes             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

comment on column competitors.instagram_handle is
    'Confirmar manualmente antes de preencher. Muito B2B early-stage só tem LinkedIn.';

-- Páginas monitoradas. Um concorrente tem N páginas com cadências e
-- configs diferentes. A config de scrape mora AQUI porque o Firecrawl
-- exige consistência de parâmetros entre scrapes da mesma URL.
create table if not exists tracked_pages (
    id                uuid primary key default gen_random_uuid(),
    competitor_id     uuid not null references competitors(id) on delete cascade,
    url               text not null,
    page_type         text not null
        check (page_type in ('home','pricing','product','blog_index','blog_post',
                             'about','careers','changelog','docs','customers','other')),
    -- tag do changeTracking: isola históricos de comparação por cadência
    firecrawl_tag     text not null default 'weekly',
    -- modos de diff a pedir: {git-diff}, {json} ou ambos
    diff_modes        text[] not null default '{git-diff}',
    -- schema de extração do modo json (null = não usa json mode, não gasta 5 créditos)
    extraction_schema jsonb,
    extraction_prompt text,
    -- opções de scrape congeladas; mudar isso invalida a série de comparação
    scrape_options    jsonb not null default '{"onlyMainContent": true}'::jsonb,
    is_active         boolean not null default true,
    created_at        timestamptz not null default now(),
    unique (url, firecrawl_tag)
);

create index if not exists idx_tracked_pages_competitor
    on tracked_pages(competitor_id) where is_active;

-- ------------------------------------------------------------
-- 2. EXECUÇÕES (observabilidade e custo)
-- ------------------------------------------------------------

create table if not exists collection_runs (
    id              uuid primary key default gen_random_uuid(),
    source          text not null check (source in ('firecrawl','apify_instagram')),
    job             text not null,   -- 'weekly_pages', 'ig_details', 'ig_posts'
    started_at      timestamptz not null default now(),
    finished_at     timestamptz,
    status          text not null default 'running'
        check (status in ('running','success','partial','failed')),
    items_ok        integer not null default 0,
    items_failed    integer not null default 0,
    credits_used    numeric(10,2),   -- créditos Firecrawl ou resultados Apify
    cost_usd        numeric(10,4),
    external_ref    text,            -- Apify runId / Firecrawl jobId
    error           text
);

create index if not exists idx_runs_started on collection_runs(started_at desc);

-- ------------------------------------------------------------
-- 3. WEB — FIRECRAWL
-- ------------------------------------------------------------

-- Uma linha por execução de scrape por página. Append-only.
create table if not exists page_scrapes (
    id                 uuid primary key default gen_random_uuid(),
    run_id             uuid references collection_runs(id) on delete set null,
    tracked_page_id    uuid not null references tracked_pages(id) on delete cascade,
    competitor_id      uuid not null references competitors(id) on delete cascade,
    scraped_at         timestamptz not null default now(),

    -- changeTracking
    change_status      text check (change_status in ('new','same','changed','removed')),
    visibility         text check (visibility in ('visible','hidden')),
    previous_scrape_at timestamptz,

    -- metadata
    http_status        integer,
    title              text,
    description        text,

    -- conteúdo
    markdown           text,          -- null quando 'same', para não inchar
    markdown_hash      text,          -- checksum próprio, independente do Firecrawl
    markdown_chars     integer,

    warning            text,          -- campo warning da resposta
    raw                jsonb          -- resposta crua, para reprocessar sem re-scrapear
);

create index if not exists idx_scrapes_page_time
    on page_scrapes(tracked_page_id, scraped_at desc);
create index if not exists idx_scrapes_changed
    on page_scrapes(competitor_id, scraped_at desc)
    where change_status = 'changed';

comment on column page_scrapes.change_status is
    'Vem do Firecrawl. A comparação é escopada por team + URL exata + tag. '
    'Primeiro scrape de qualquer URL sempre volta "new".';

-- Diff só existe quando changed. Tabela separada porque o texto é grande
-- e a maioria dos scrapes é "same".
create table if not exists page_diffs (
    id              uuid primary key default gen_random_uuid(),
    scrape_id       uuid not null unique references page_scrapes(id) on delete cascade,
    competitor_id   uuid not null references competitors(id) on delete cascade,
    diff_text       text,             -- changeTracking.diff.text
    diff_json       jsonb,            -- changeTracking.diff.json
    lines_added     integer,          -- derivado de changes[].type = 'add'
    lines_removed   integer,          -- derivado de changes[].type = 'del'
    created_at      timestamptz not null default now()
);

-- Modo json: campos estruturados com previous/current.
-- Formato longo: adicionar um campo novo ao schema não exige migration.
create table if not exists page_field_changes (
    id              uuid primary key default gen_random_uuid(),
    scrape_id       uuid not null references page_scrapes(id) on delete cascade,
    competitor_id   uuid not null references competitors(id) on delete cascade,
    tracked_page_id uuid not null references tracked_pages(id) on delete cascade,
    field_name      text not null,    -- 'starter_price', 'headline', 'value_prop'
    previous_value  text,
    current_value   text,
    has_changed     boolean generated always as
                        (previous_value is distinct from current_value) stored,
    observed_at     timestamptz not null default now(),
    unique (scrape_id, field_name)
);

create index if not exists idx_field_changes_lookup
    on page_field_changes(competitor_id, field_name, observed_at desc);
create index if not exists idx_field_changes_only_changed
    on page_field_changes(field_name, observed_at desc) where has_changed;

-- Posts de blog descobertos via crawl/map do índice do blog.
-- Novidade = URL nunca vista antes. Por isso a URL é única.
create table if not exists blog_posts (
    id              uuid primary key default gen_random_uuid(),
    competitor_id   uuid not null references competitors(id) on delete cascade,
    url             text not null unique,
    title           text,
    published_at    timestamptz,      -- quando o site declara; costuma faltar
    first_seen_at   timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),
    author          text,
    summary         text,
    word_count      integer,
    is_gone         boolean not null default false,  -- sumiu do índice
    raw             jsonb
);

create index if not exists idx_blog_posts_competitor
    on blog_posts(competitor_id, coalesce(published_at, first_seen_at) desc);

-- ------------------------------------------------------------
-- 4. INSTAGRAM — APIFY
-- ------------------------------------------------------------

-- Série temporal do estado do perfil. Um registro por run.
create table if not exists instagram_profile_snapshots (
    id                    uuid primary key default gen_random_uuid(),
    run_id                uuid references collection_runs(id) on delete set null,
    competitor_id         uuid not null references competitors(id) on delete cascade,
    username              text not null,
    ig_user_id            text,
    captured_at           timestamptz not null default now(),

    followers_count       integer,
    follows_count         integer,
    posts_count           integer,
    highlight_reel_count  integer,

    full_name             text,
    biography             text,
    external_url          text,
    external_urls         jsonb,

    is_verified           boolean,
    is_business_account   boolean,
    business_category     text,
    is_private            boolean,
    account_type          smallint,   -- statistics: 1 pessoal, 2 business, 3 creator

    raw                   jsonb,
    unique (competitor_id, captured_at)
);

create index if not exists idx_ig_profile_series
    on instagram_profile_snapshots(competitor_id, captured_at desc);

-- Atributos imutáveis do post. Chave natural = id do Instagram.
create table if not exists instagram_posts (
    id                 text primary key,          -- post.id do Instagram
    competitor_id      uuid not null references competitors(id) on delete cascade,
    owner_username     text not null,
    short_code         text,
    url                text,
    post_type          text,                      -- Image | Video | Sidecar
    product_type       text,                      -- clips = reel
    caption            text,
    hashtags           text[],
    mentions           text[],
    tagged_users       text[],
    posted_at          timestamptz not null,      -- post.timestamp
    video_duration     numeric(8,2),
    music_info         jsonb,
    is_pinned          boolean,
    first_seen_at      timestamptz not null default now(),
    raw                jsonb
);

create index if not exists idx_ig_posts_competitor_time
    on instagram_posts(competitor_id, posted_at desc);

-- Métricas variam a cada coleta — o próprio Actor avisa que os números
-- são um snapshot do momento do run. Por isso ficam separadas do post.
create table if not exists instagram_post_metrics (
    id                uuid primary key default gen_random_uuid(),
    run_id            uuid references collection_runs(id) on delete set null,
    post_id           text not null references instagram_posts(id) on delete cascade,
    competitor_id     uuid not null references competitors(id) on delete cascade,
    captured_at       timestamptz not null default now(),

    likes_count       integer,   -- -1 = autor escondeu; normalizado nas views
    comments_count    integer,
    video_view_count  integer,   -- null em post de imagem
    video_play_count  integer,

    unique (post_id, captured_at)
);

create index if not exists idx_ig_metrics_post on instagram_post_metrics(post_id, captured_at desc);

-- ------------------------------------------------------------
-- 5. FEED UNIFICADO DE ALERTAS
-- ------------------------------------------------------------
-- Tudo que merece virar notificação entra aqui, venha de onde vier.
-- A dashboard e o Slack leem só desta tabela.

create table if not exists change_events (
    id              uuid primary key default gen_random_uuid(),
    competitor_id   uuid not null references competitors(id) on delete cascade,
    source          text not null check (source in ('firecrawl','apify_instagram')),
    event_type      text not null check (event_type in (
                        'pricing_changed','value_prop_changed','page_changed',
                        'page_removed','page_hidden','new_blog_post',
                        'followers_jump','bio_changed','bio_link_changed',
                        'posting_resumed','posting_stopped','new_profile'
                    )),
    severity        text not null default 'info'
                        check (severity in ('info','notable','high')),
    title           text not null,     -- linha pronta para o Slack
    detail          text,
    payload         jsonb,             -- previous/current, ids de origem
    occurred_at     timestamptz not null default now(),
    notified_at     timestamptz,       -- null = ainda não avisado
    acknowledged_at timestamptz
);

create index if not exists idx_events_feed on change_events(occurred_at desc);
create index if not exists idx_events_pending on change_events(occurred_at) where notified_at is null;
create index if not exists idx_events_competitor on change_events(competitor_id, occurred_at desc);

-- ------------------------------------------------------------
-- 6. VIEWS DE LEITURA
-- ------------------------------------------------------------

-- Estado atual de cada página monitorada
create or replace view v_page_current as
select distinct on (ps.tracked_page_id)
    ps.tracked_page_id,
    c.name          as competitor,
    tp.url,
    tp.page_type,
    ps.scraped_at,
    ps.change_status,
    ps.visibility,
    ps.http_status,
    ps.title
from page_scrapes ps
join tracked_pages tp on tp.id = ps.tracked_page_id
join competitors   c  on c.id  = ps.competitor_id
order by ps.tracked_page_id, ps.scraped_at desc;

-- Crescimento de seguidores semana a semana
create or replace view v_instagram_growth as
select
    c.name as competitor,
    s.username,
    s.captured_at,
    s.followers_count,
    s.followers_count - lag(s.followers_count)
        over (partition by s.competitor_id order by s.captured_at) as followers_delta,
    round(
        100.0 * (s.followers_count - lag(s.followers_count)
            over (partition by s.competitor_id order by s.captured_at))
        / nullif(lag(s.followers_count)
            over (partition by s.competitor_id order by s.captured_at), 0)
    , 2) as followers_pct,
    s.posts_count - lag(s.posts_count)
        over (partition by s.competitor_id order by s.captured_at) as posts_delta
from instagram_profile_snapshots s
join competitors c on c.id = s.competitor_id;

-- Engajamento por post, com likes escondidos tratados como desconhecido
create or replace view v_instagram_post_engagement as
select distinct on (p.id)
    c.name as competitor,
    p.owner_username,
    p.id as post_id,
    p.url,
    p.post_type,
    p.product_type,
    p.posted_at,
    nullif(m.likes_count, -1)                       as likes,
    m.comments_count                                as comments,
    coalesce(m.video_play_count, m.video_view_count) as views,
    coalesce(nullif(m.likes_count, -1), 0) + coalesce(m.comments_count, 0) as engagement,
    m.captured_at
from instagram_posts p
join instagram_post_metrics m on m.post_id = p.id
join competitors c on c.id = p.competitor_id
order by p.id, m.captured_at desc;

-- Placar semanal: cadência + engajamento médio + engagement rate
create or replace view v_instagram_weekly_scoreboard as
with latest_profile as (
    select distinct on (competitor_id)
        competitor_id, username, followers_count, captured_at
    from instagram_profile_snapshots
    order by competitor_id, captured_at desc
),
week as (
    select
        p.competitor_id,
        count(*)                          as posts_7d,
        round(avg(e.engagement), 1)       as avg_engagement,
        sum(coalesce(e.views, 0))         as views_7d
    from instagram_posts p
    join v_instagram_post_engagement e on e.post_id = p.id
    where p.posted_at >= now() - interval '7 days'
    group by p.competitor_id
)
select
    c.name as competitor,
    lp.username,
    lp.followers_count,
    coalesce(w.posts_7d, 0) as posts_7d,
    w.avg_engagement,
    w.views_7d,
    round(100.0 * w.avg_engagement / nullif(lp.followers_count, 0), 3) as engagement_rate_pct
from competitors c
join latest_profile lp on lp.competitor_id = c.id
left join week w on w.competitor_id = c.id
where c.is_active
order by lp.followers_count desc nulls last;

-- Histórico de preço por concorrente (só o que mudou de fato)
create or replace view v_pricing_history as
select
    c.name as competitor,
    tp.url,
    f.field_name,
    f.previous_value,
    f.current_value,
    f.observed_at
from page_field_changes f
join competitors   c  on c.id  = f.competitor_id
join tracked_pages tp on tp.id = f.tracked_page_id
where f.has_changed
  and tp.page_type = 'pricing'
order by f.observed_at desc;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------
-- Ferramenta interna: escrita e leitura pelo service_role (que ignora RLS).
-- Ligamos RLS sem policy para que a anon key não leia nada por acidente.
-- Se a dashboard for autenticada, adicione policies por auth.uid() depois.

alter table competitors                 enable row level security;
alter table tracked_pages               enable row level security;
alter table collection_runs             enable row level security;
alter table page_scrapes                enable row level security;
alter table page_diffs                  enable row level security;
alter table page_field_changes          enable row level security;
alter table blog_posts                  enable row level security;
alter table instagram_profile_snapshots enable row level security;
alter table instagram_posts             enable row level security;
alter table instagram_post_metrics      enable row level security;
alter table change_events               enable row level security;

-- ------------------------------------------------------------
-- 8. SEED
-- ------------------------------------------------------------

insert into competitors (name, slug, category) values
    ('Glean',         'glean',         'enterprise search'),
    ('Get Zep',       'get-zep',       'memory layer'),
    ('Nama AI',       'nama-ai',       null),
    ('Ultra Context', 'ultra-context', 'context/RAG'),
    ('Try Glen',      'try-glen',      null),
    ('Impossibl',     'impossibl',     null),
    ('Meuze',         'meuze',         null),
    ('Bond',          'bond',          null),
    ('Cogniscape',    'cogniscape',    null),
    ('Delphi AI',     'delphi-ai',     null),
    ('Strattum',      'strattum',      null),
    ('Workera',       'workera',       'skills/assessment')
on conflict (name) do nothing;

-- website e instagram_handle ficam NULL de propósito: preencher só após
-- confirmar a URL e o perfil de cada um manualmente.
