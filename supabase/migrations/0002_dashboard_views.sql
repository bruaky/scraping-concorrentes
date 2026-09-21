-- ============================================================
-- Dashboard — views de leitura + geração de change_events
-- Aplicar DEPOIS de supabase_schema.sql
-- ============================================================
-- Nível 1: v_dashboard_feed          (o que mudou essa semana)
-- Nível 2: v_dashboard_scoreboard    (placar comparativo)
-- Nível 3: v_competitor_timeline     (drill-down por concorrente)
-- Escrita:  fn_generate_change_events(run_id)
-- ============================================================


-- ============================================================
-- NÍVEL 1 — FEED
-- ============================================================
-- O dashboard lê SÓ esta view na tela inicial.
-- Ordem de severidade é explícita: não confie em ordem alfabética.

create or replace view v_dashboard_feed as
select
    e.id,
    e.occurred_at,
    c.name                as competitor,
    c.slug                as competitor_slug,
    e.source,
    e.event_type,
    e.severity,
    case e.severity
        when 'high'    then 1
        when 'notable' then 2
        else 3
    end                   as severity_rank,
    e.title,
    e.detail,
    e.payload,
    e.notified_at is null as pending_notification,
    e.acknowledged_at
from change_events e
join competitors c on c.id = e.competitor_id
where c.is_active
order by e.occurred_at desc;


-- ============================================================
-- NÍVEL 2 — PLACAR
-- ============================================================
-- Uma linha por concorrente. LEFT JOIN em tudo: concorrente sem
-- Instagram, sem blog ou sem página de vagas aparece com NULL,
-- não some da tabela e não vira zero.

create or replace view v_dashboard_scoreboard as
with ig_now as (
    select distinct on (competitor_id)
        competitor_id, username, followers_count, posts_count, captured_at
    from instagram_profile_snapshots
    order by competitor_id, captured_at desc
),
ig_prev as (
    -- snapshot imediatamente anterior ao mais recente
    select competitor_id, followers_count, captured_at
    from (
        select competitor_id, followers_count, captured_at,
               row_number() over (partition by competitor_id
                                  order by captured_at desc) as rn
        from instagram_profile_snapshots
    ) t
    where rn = 2
),
ig_week as (
    select
        p.competitor_id,
        count(*)                                    as posts_7d,
        round(avg(e.engagement), 1)                 as avg_engagement,
        sum(coalesce(e.likes, 0))                   as likes_7d,
        sum(coalesce(e.comments, 0))                as comments_7d,
        -- views só existem em vídeo: soma sobre NULL continua NULL
        sum(e.views)                                as views_7d,
        count(*) filter (where p.product_type = 'clips') as reels_7d
    from instagram_posts p
    join v_instagram_post_engagement e on e.post_id = p.id
    where p.posted_at >= now() - interval '7 days'
      and coalesce(p.is_pinned, false) = false
    group by p.competitor_id
),
blog_week as (
    select competitor_id, count(*) as blog_posts_7d
    from blog_posts
    where first_seen_at >= now() - interval '7 days'
      and not is_gone
    group by competitor_id
),
jobs_now as (
    -- depende de careers em modo json com o campo open_roles_count
    select distinct on (f.competitor_id)
        f.competitor_id,
        nullif(f.current_value, '')::text as open_roles,
        f.observed_at
    from page_field_changes f
    join tracked_pages tp on tp.id = f.tracked_page_id
    where tp.page_type = 'careers'
      and f.field_name = 'open_roles_count'
    order by f.competitor_id, f.observed_at desc
),
price_last as (
    select distinct on (f.competitor_id)
        f.competitor_id,
        f.field_name,
        f.previous_value,
        f.current_value,
        f.observed_at
    from page_field_changes f
    join tracked_pages tp on tp.id = f.tracked_page_id
    where tp.page_type = 'pricing'
      and f.has_changed
    order by f.competitor_id, f.observed_at desc
),
web_week as (
    select competitor_id,
           count(*) filter (where change_status = 'changed') as pages_changed_7d
    from page_scrapes
    where scraped_at >= now() - interval '7 days'
    group by competitor_id
)
select
    c.id            as competitor_id,
    c.name          as competitor,
    c.slug,
    c.website,
    c.category,

    -- Instagram
    ig_now.username,
    ig_now.followers_count,
    ig_now.followers_count - ig_prev.followers_count            as followers_delta_7d,
    round(100.0 * (ig_now.followers_count - ig_prev.followers_count)
          / nullif(ig_prev.followers_count, 0), 2)              as followers_pct_7d,
    coalesce(ig_week.posts_7d, 0)                               as posts_7d,
    ig_week.reels_7d,
    ig_week.likes_7d,
    ig_week.comments_7d,
    ig_week.views_7d,
    ig_week.avg_engagement,
    round(100.0 * ig_week.avg_engagement
          / nullif(ig_now.followers_count, 0), 3)               as engagement_rate_pct,

    -- Web
    coalesce(blog_week.blog_posts_7d, 0)                        as blog_posts_7d,
    jobs_now.open_roles,
    coalesce(web_week.pages_changed_7d, 0)                      as pages_changed_7d,
    price_last.field_name                                       as last_price_field,
    price_last.previous_value                                   as last_price_from,
    price_last.current_value                                    as last_price_to,
    price_last.observed_at                                      as last_price_changed_at,

    ig_now.captured_at                                          as ig_last_seen
from competitors c
left join ig_now     on ig_now.competitor_id     = c.id
left join ig_prev    on ig_prev.competitor_id    = c.id
left join ig_week    on ig_week.competitor_id    = c.id
left join blog_week  on blog_week.competitor_id  = c.id
left join jobs_now   on jobs_now.competitor_id   = c.id
left join price_last on price_last.competitor_id = c.id
left join web_week   on web_week.competitor_id   = c.id
where c.is_active;


-- ============================================================
-- NÍVEL 3 — TIMELINE
-- ============================================================
-- Web e Instagram no mesmo eixo de tempo. É aqui que a correlação
-- aparece: pricing mexido na mesma semana de 4 vagas de vendas.
-- Filtrar por competitor_slug na aplicação.

create or replace view v_competitor_timeline as

-- posts do Instagram
select
    c.id                as competitor_id,
    c.slug              as competitor_slug,
    p.posted_at         as occurred_at,
    'instagram'         as source,
    case when p.product_type = 'clips' then 'reel' else 'post' end as kind,
    left(coalesce(p.caption, '(sem legenda)'), 120)  as title,
    concat_ws(' · ',
        nullif(e.likes, null)    || ' likes',
        nullif(e.comments, null) || ' coment.',
        case when e.views is not null then e.views || ' views' end
    )                   as detail,
    p.url,
    null::text          as severity
from instagram_posts p
join v_instagram_post_engagement e on e.post_id = p.id
join competitors c on c.id = p.competitor_id

union all

-- posts de blog descobertos
select
    c.id, c.slug,
    coalesce(b.published_at, b.first_seen_at),
    'web', 'blog_post',
    coalesce(b.title, b.url),
    b.summary,
    b.url,
    null
from blog_posts b
join competitors c on c.id = b.competitor_id
where not b.is_gone

union all

-- mudanças em campos extraídos (preço, proposta de valor, vagas)
select
    c.id, c.slug,
    f.observed_at,
    'web',
    tp.page_type || '_field',
    f.field_name || ': ' || coalesce(f.previous_value, '—')
                 || ' → ' || coalesce(f.current_value, '—'),
    tp.url,
    tp.url,
    case when tp.page_type = 'pricing' then 'high' else 'notable' end
from page_field_changes f
join tracked_pages tp on tp.id = f.tracked_page_id
join competitors c on c.id = f.competitor_id
where f.has_changed

union all

-- páginas que mudaram estruturalmente
select
    c.id, c.slug,
    ps.scraped_at,
    'web',
    'page_' || ps.change_status,
    tp.page_type || ' alterada',
    concat_ws(' ', d.lines_added, 'linhas +,', d.lines_removed, 'linhas −'),
    tp.url,
    'info'
from page_scrapes ps
join tracked_pages tp on tp.id = ps.tracked_page_id
join competitors   c  on c.id  = ps.competitor_id
left join page_diffs d on d.scrape_id = ps.id
where ps.change_status in ('changed', 'removed');


-- ============================================================
-- GERAÇÃO DE EVENTOS
-- ============================================================
-- A ingestão grava os dados crus e chama esta função uma vez,
-- passando o run_id. Ela decide o que vira alerta.
-- Idempotente: reexecutar o mesmo run não duplica eventos.

create unique index if not exists uq_change_events_dedupe
    on change_events (competitor_id, event_type, occurred_at,
                      coalesce(payload->>'ref', ''));

create or replace function fn_generate_change_events(p_run_id uuid)
returns integer
language plpgsql
as $$
declare
    v_count integer := 0;
begin

    -- 1. Preço mudou → high
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        f.competitor_id, 'firecrawl', 'pricing_changed', 'high',
        c.name || ': ' || f.field_name || ' passou de '
            || coalesce(f.previous_value, '—') || ' para '
            || coalesce(f.current_value, '—'),
        tp.url,
        jsonb_build_object('ref', f.id::text, 'field', f.field_name,
                           'previous', f.previous_value, 'current', f.current_value),
        f.observed_at
    from page_field_changes f
    join page_scrapes  ps on ps.id = f.scrape_id and ps.run_id = p_run_id
    join tracked_pages tp on tp.id = f.tracked_page_id
    join competitors   c  on c.id  = f.competitor_id
    where f.has_changed and tp.page_type = 'pricing'
    on conflict do nothing;
    get diagnostics v_count = row_count;

    -- 2. Proposta de valor (home) → high
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        f.competitor_id, 'firecrawl', 'value_prop_changed', 'high',
        c.name || ' mudou o posicionamento na home',
        coalesce(f.previous_value, '—') || ' → ' || coalesce(f.current_value, '—'),
        jsonb_build_object('ref', f.id::text, 'field', f.field_name),
        f.observed_at
    from page_field_changes f
    join page_scrapes  ps on ps.id = f.scrape_id and ps.run_id = p_run_id
    join tracked_pages tp on tp.id = f.tracked_page_id
    join competitors   c  on c.id  = f.competitor_id
    where f.has_changed and tp.page_type = 'home'
    on conflict do nothing;

    -- 3. Vagas → notable
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        f.competitor_id, 'firecrawl', 'page_changed', 'notable',
        c.name || ': vagas de ' || coalesce(f.previous_value, '—')
            || ' para ' || coalesce(f.current_value, '—'),
        tp.url,
        jsonb_build_object('ref', f.id::text, 'field', f.field_name),
        f.observed_at
    from page_field_changes f
    join page_scrapes  ps on ps.id = f.scrape_id and ps.run_id = p_run_id
    join tracked_pages tp on tp.id = f.tracked_page_id
    join competitors   c  on c.id  = f.competitor_id
    where f.has_changed and tp.page_type = 'careers'
    on conflict do nothing;

    -- 4. Post de blog novo → info
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        b.competitor_id, 'firecrawl', 'new_blog_post', 'info',
        c.name || ': ' || coalesce(b.title, b.url),
        b.url,
        jsonb_build_object('ref', b.id::text, 'url', b.url),
        b.first_seen_at
    from blog_posts b
    join competitors c on c.id = b.competitor_id
    where b.first_seen_at >= now() - interval '1 hour'
    on conflict do nothing;

    -- 5. Página sumiu do sitemap → notable
    --    visibility 'hidden' = URL ainda abre mas não é mais linkada
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        ps.competitor_id, 'firecrawl',
        case when ps.change_status = 'removed' then 'page_removed' else 'page_hidden' end,
        'notable',
        c.name || ': ' || tp.page_type
            || case when ps.change_status = 'removed'
                    then ' saiu do ar' else ' saiu dos links do site' end,
        tp.url,
        jsonb_build_object('ref', ps.id::text),
        ps.scraped_at
    from page_scrapes ps
    join tracked_pages tp on tp.id = ps.tracked_page_id
    join competitors   c  on c.id  = ps.competitor_id
    where ps.run_id = p_run_id
      and (ps.change_status = 'removed' or ps.visibility = 'hidden')
    on conflict do nothing;

    -- 6. Salto de seguidores → notable acima de 5% ou 500
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        s.competitor_id, 'apify_instagram', 'followers_jump', 'notable',
        c.name || ': ' || to_char(s.followers_count - prev.followers_count, 'SG999G999')
            || ' seguidores',
        '@' || s.username || ' agora com ' || s.followers_count,
        jsonb_build_object('ref', s.id::text,
                           'from', prev.followers_count, 'to', s.followers_count),
        s.captured_at
    from instagram_profile_snapshots s
    join competitors c on c.id = s.competitor_id
    join lateral (
        select followers_count
        from instagram_profile_snapshots p
        where p.competitor_id = s.competitor_id
          and p.captured_at < s.captured_at
        order by p.captured_at desc
        limit 1
    ) prev on true
    where s.run_id = p_run_id
      and prev.followers_count > 0
      and (
           abs(s.followers_count - prev.followers_count) >= 500
        or abs(100.0 * (s.followers_count - prev.followers_count)
               / prev.followers_count) >= 5
      )
    on conflict do nothing;

    -- 7. Bio ou link da bio mudou → notable
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        s.competitor_id, 'apify_instagram',
        case when s.biography is distinct from prev.biography
             then 'bio_changed' else 'bio_link_changed' end,
        'notable',
        c.name || ' mudou a bio do Instagram',
        coalesce(prev.biography, '—') || ' → ' || coalesce(s.biography, '—'),
        jsonb_build_object('ref', s.id::text,
                           'bio_from', prev.biography, 'bio_to', s.biography,
                           'url_from', prev.external_url, 'url_to', s.external_url),
        s.captured_at
    from instagram_profile_snapshots s
    join competitors c on c.id = s.competitor_id
    join lateral (
        select biography, external_url
        from instagram_profile_snapshots p
        where p.competitor_id = s.competitor_id
          and p.captured_at < s.captured_at
        order by p.captured_at desc
        limit 1
    ) prev on true
    where s.run_id = p_run_id
      and (s.biography   is distinct from prev.biography
        or s.external_url is distinct from prev.external_url)
    on conflict do nothing;

    return v_count;
end;
$$;


-- ============================================================
-- ESTADO DE BASELINE
-- ============================================================
-- Semana 1 é toda 'new'. O dashboard precisa saber disso para
-- mostrar "baseline coletado, comparação começa em X" em vez de
-- parecer quebrado.

create or replace view v_tracking_readiness as
select
    c.name as competitor,
    c.slug,
    count(*) filter (where ps.change_status is not null)      as scrapes_total,
    count(*) filter (where ps.change_status = 'new')          as scrapes_baseline,
    count(*) filter (where ps.change_status <> 'new')         as scrapes_comparaveis,
    min(ps.scraped_at)                                        as primeiro_scrape,
    (select count(*) from instagram_profile_snapshots s
      where s.competitor_id = c.id)                           as ig_snapshots,
    case
        when count(*) filter (where ps.change_status <> 'new') = 0
             then 'baseline'
        else 'ativo'
    end                                                       as status
from competitors c
left join page_scrapes ps on ps.competitor_id = c.id
where c.is_active
group by c.id, c.name, c.slug;
