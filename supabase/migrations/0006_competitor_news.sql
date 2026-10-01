-- ============================================================
-- Competitor news — o que o Google acha de cada concorrente
-- ============================================================
-- Alimentada pelo apify/google-search-scraper (lib/news.ts): posts de
-- blog, páginas novas do site, vagas e menções em outros sites. Uma linha
-- por (concorrente, url); a mesma notícia achada de novo só atualiza
-- last_seen_at, e first_seen_at diz quando ela apareceu pra nós.

alter table collection_runs drop constraint if exists collection_runs_source_check;
alter table collection_runs add constraint collection_runs_source_check
    check (source in ('firecrawl', 'apify_instagram', 'apify_google'));

create table if not exists competitor_news (
    id              uuid primary key default gen_random_uuid(),
    competitor_id   uuid not null references competitors(id) on delete cascade,
    run_id          uuid references collection_runs(id) on delete set null,
    kind            text not null check (kind in ('blog', 'site', 'job', 'mention')),
    url             text not null,
    title           text,
    snippet         text,
    source          text,             -- domínio de onde veio (linkedin.com, ...)
    published_at    timestamptz,      -- quando o Google mostra data; costuma faltar
    first_seen_at   timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),
    query           text,             -- a busca que achou
    raw             jsonb,
    unique (competitor_id, url)
);

create index if not exists idx_competitor_news_recent
    on competitor_news (coalesce(published_at, first_seen_at) desc);

-- Mesmo padrão da 0001: RLS ligado sem policy, só a service role lê.
alter table competitor_news enable row level security;
