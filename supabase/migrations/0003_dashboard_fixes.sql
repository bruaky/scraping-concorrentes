-- ============================================================
-- Correções sobre 0001 + 0002
-- ============================================================
-- Migration separada de propósito: 0001 e 0002 estão verbatim como
-- foram aplicados no Supabase, para poderem ser diferenciados contra o
-- banco. Tudo que muda comportamento entra aqui, comentado com o porquê.
-- ============================================================


-- ------------------------------------------------------------
-- 1. logo_url
-- ------------------------------------------------------------
-- O overview de concorrentes no topo da dashboard mostra logo + nome.
-- Null é o caso normal: a UI cai num monograma com as iniciais.

alter table competitors add column if not exists logo_url text;


-- ------------------------------------------------------------
-- 2. Engajamento com curtida escondida
-- ------------------------------------------------------------
-- BUG: `engagement` fazia coalesce(nullif(likes,-1), 0), ou seja, tratava
-- curtida escondida como ZERO e incluía o post na média. Um post com
-- 1.000 likes + 50 coment. e outro com likes escondidos + 50 coment.
-- davam média 550 em vez de 1.050 — o concorrente que esconde curtidas
-- aparece com metade do engajamento real, e a gente lê como queda.
--
-- Agora: engagement é NULL quando as curtidas são desconhecidas, e o avg
-- do Postgres ignora NULL sozinho. Quem precisa do piso garantido usa
-- engagement_floor (só comentários).

drop view if exists v_dashboard_scoreboard;
drop view if exists v_competitor_timeline;
drop view if exists v_instagram_weekly_scoreboard;
drop view if exists v_instagram_post_engagement;

create view v_instagram_post_engagement as
select distinct on (p.id)
    c.name as competitor,
    p.owner_username,
    p.id as post_id,
    p.url,
    p.post_type,
    p.product_type,
    p.posted_at,
    p.is_pinned,
    nullif(m.likes_count, -1)                        as likes,
    m.comments_count                                 as comments,
    -- views só existe em vídeo; null em imagem é ausência, não zero
    coalesce(m.video_play_count, m.video_view_count) as views,
    -- NULL quando não sabemos as curtidas: fica fora de toda média
    case when nullif(m.likes_count, -1) is not null
         then nullif(m.likes_count, -1) + coalesce(m.comments_count, 0)
    end                                              as engagement,
    -- piso conhecido, para quando faz sentido somar mesmo sem curtidas
    coalesce(m.comments_count, 0)                    as engagement_floor,
    (m.likes_count = -1)                             as likes_hidden,
    m.captured_at
from instagram_posts p
join instagram_post_metrics m on m.post_id = p.id
join competitors c on c.id = p.competitor_id
order by p.id, m.captured_at desc;


create view v_instagram_weekly_scoreboard as
with latest_profile as (
    select distinct on (competitor_id)
        competitor_id, username, followers_count, captured_at
    from instagram_profile_snapshots
    order by competitor_id, captured_at desc
),
week as (
    select
        p.competitor_id,
        count(*)                                              as posts_7d,
        count(*) filter (where e.likes_hidden)                as posts_unknown_likes,
        round(avg(e.engagement), 1)                           as avg_engagement,
        -- soma ignora NULL; só fica NULL se NENHUM post tiver views
        sum(e.views)                                          as views_7d
    from instagram_posts p
    join v_instagram_post_engagement e on e.post_id = p.id
    where p.posted_at >= now() - interval '7 days'
      -- post fixado reaparece em toda coleta e não é post da semana
      and coalesce(p.is_pinned, false) = false
    group by p.competitor_id
)
select
    c.name as competitor,
    lp.username,
    lp.followers_count,
    coalesce(w.posts_7d, 0) as posts_7d,
    w.posts_unknown_likes,
    w.avg_engagement,
    w.views_7d,
    round(100.0 * w.avg_engagement / nullif(lp.followers_count, 0), 3) as engagement_rate_pct
from competitors c
join latest_profile lp on lp.competitor_id = c.id
left join week w on w.competitor_id = c.id
where c.is_active
order by lp.followers_count desc nulls last;


-- ------------------------------------------------------------
-- 3. Placar: delta de 7 dias que é mesmo de 7 dias
-- ------------------------------------------------------------
-- BUG: ig_prev usava rn = 2, o snapshot IMEDIATAMENTE anterior. Com cron
-- semanal os dois coincidem; no instante em que se dispara um ingest
-- manual, insere-se um snapshot e "followers_delta_7d" passa a significar
-- "delta desde alguns minutos atrás", sem nada na tela dizendo isso.
--
-- Agora são duas colunas com nomes honestos: delta_7d compara com o
-- snapshot mais recente com 7+ dias, delta_since_last com o anterior.
--
-- Também: open_roles virou inteiro (era text, e o placar é ordenável —
-- em text a ordem é 10 < 100 < 9), e posts_unknown_likes é exposto para
-- a UI poder dizer que a média é parcial.

create view v_dashboard_scoreboard as
with ig_now as (
    select distinct on (competitor_id)
        competitor_id, username, followers_count, posts_count, captured_at, is_private
    from instagram_profile_snapshots
    order by competitor_id, captured_at desc
),
ig_7d as (
    select distinct on (competitor_id)
        competitor_id, followers_count, captured_at
    from instagram_profile_snapshots
    where captured_at <= now() - interval '7 days'
    order by competitor_id, captured_at desc
),
ig_prev as (
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
        count(*)                                          as posts_7d,
        count(*) filter (where e.likes_hidden)            as posts_unknown_likes,
        round(avg(e.engagement), 1)                       as avg_engagement,
        sum(e.likes)                                      as likes_7d,
        sum(e.comments)                                   as comments_7d,
        sum(e.views)                                      as views_7d,
        count(*) filter (where p.product_type = 'clips')  as reels_7d
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
    select distinct on (f.competitor_id)
        f.competitor_id,
        -- cast seguro: valor não numérico vira NULL, não quebra a view
        case when trim(f.current_value) ~ '^[0-9]+$'
             then trim(f.current_value)::integer end as open_roles,
        f.observed_at
    from page_field_changes f
    join tracked_pages tp on tp.id = f.tracked_page_id
    where tp.page_type = 'careers'
      and f.field_name = 'open_roles_count'
    order by f.competitor_id, f.observed_at desc
),
price_last as (
    select distinct on (f.competitor_id)
        f.competitor_id, f.field_name, f.previous_value, f.current_value, f.observed_at
    from page_field_changes f
    join tracked_pages tp on tp.id = f.tracked_page_id
    where tp.page_type = 'pricing' and f.has_changed
    order by f.competitor_id, f.observed_at desc
),
web_week as (
    select competitor_id,
           count(*) filter (where change_status = 'changed') as pages_changed_7d
    from page_scrapes
    where scraped_at >= now() - interval '7 days'
    group by competitor_id
),
-- Desde quando existe qualquer captura: alimenta o estado de baseline.
tracking as (
    select competitor_id, min(t) as tracking_since from (
        select competitor_id, scraped_at  as t from page_scrapes
        union all
        select competitor_id, captured_at as t from instagram_profile_snapshots
    ) x group by competitor_id
)
select
    c.id    as competitor_id,
    c.name  as competitor,
    c.slug,
    c.website,
    c.category,
    c.logo_url,

    ig_now.username,
    ig_now.followers_count,
    ig_now.is_private,

    -- delta honesto de 7 dias
    ig_now.followers_count - ig_7d.followers_count              as followers_delta_7d,
    round(100.0 * (ig_now.followers_count - ig_7d.followers_count)
          / nullif(ig_7d.followers_count, 0), 2)                as followers_pct_7d,
    -- e o delta desde a captura anterior, seja ela quando for
    ig_now.followers_count - ig_prev.followers_count            as followers_delta_since_last,

    coalesce(ig_week.posts_7d, 0)                               as posts_7d,
    coalesce(ig_week.posts_unknown_likes, 0)                    as posts_unknown_likes,
    ig_week.reels_7d,
    ig_week.likes_7d,
    ig_week.comments_7d,
    ig_week.views_7d,
    ig_week.avg_engagement,
    round(100.0 * ig_week.avg_engagement
          / nullif(ig_now.followers_count, 0), 3)               as engagement_rate_pct,

    coalesce(blog_week.blog_posts_7d, 0)                        as blog_posts_7d,
    jobs_now.open_roles,
    coalesce(web_week.pages_changed_7d, 0)                      as pages_changed_7d,
    price_last.field_name                                       as last_price_field,
    price_last.previous_value                                   as last_price_from,
    price_last.current_value                                    as last_price_to,
    price_last.observed_at                                      as last_price_changed_at,

    ig_now.captured_at                                          as ig_last_seen,
    tracking.tracking_since,
    -- false = ainda não há snapshot com 7+ dias. A UI mostra "baseline
    -- coletado" em vez de um delta falso de zero.
    (ig_7d.competitor_id is not null)                           as has_comparison
from competitors c
left join ig_now     on ig_now.competitor_id     = c.id
left join ig_7d      on ig_7d.competitor_id      = c.id
left join ig_prev    on ig_prev.competitor_id    = c.id
left join ig_week    on ig_week.competitor_id    = c.id
left join blog_week  on blog_week.competitor_id  = c.id
left join jobs_now   on jobs_now.competitor_id   = c.id
left join price_last on price_last.competitor_id = c.id
left join web_week   on web_week.competitor_id   = c.id
left join tracking   on tracking.competitor_id   = c.id
where c.is_active;


-- ------------------------------------------------------------
-- 4. Timeline
-- ------------------------------------------------------------
-- Corrigido: nullif(x, null) é no-op (nada é igual a NULL), e likes = -1
-- imprimia "-1 likes". Agora usa as colunas já normalizadas da view de
-- engajamento e omite o que não se sabe.
-- Também inclui páginas que ficaram hidden, que antes só apareciam no feed.

create view v_competitor_timeline as

select
    c.id                as competitor_id,
    c.slug              as competitor_slug,
    p.posted_at         as occurred_at,
    'instagram'         as source,
    case when p.product_type = 'clips' then 'reel' else 'post' end as kind,
    left(coalesce(p.caption, '(sem legenda)'), 120)  as title,
    concat_ws(' · ',
        case when e.likes    is not null then e.likes    || ' likes'    end,
        case when e.comments is not null then e.comments || ' coment.'  end,
        case when e.views    is not null then e.views    || ' views'    end,
        case when e.likes_hidden then 'curtidas ocultas' end
    )                   as detail,
    p.url,
    null::text          as severity
from instagram_posts p
join v_instagram_post_engagement e on e.post_id = p.id
join competitors c on c.id = p.competitor_id

union all

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

select
    c.id, c.slug,
    ps.scraped_at,
    'web',
    case when ps.visibility = 'hidden' and ps.change_status <> 'removed'
         then 'page_hidden' else 'page_' || ps.change_status end,
    tp.page_type || case when ps.visibility = 'hidden' and ps.change_status <> 'removed'
                         then ' saiu dos links' else ' alterada' end,
    concat_ws(' ', d.lines_added, 'linhas +,', d.lines_removed, 'linhas −'),
    tp.url,
    'info'
from page_scrapes ps
join tracked_pages tp on tp.id = ps.tracked_page_id
join competitors   c  on c.id  = ps.competitor_id
left join page_diffs d on d.scrape_id = ps.id
where ps.change_status in ('changed', 'removed')
   or ps.visibility = 'hidden';


-- ------------------------------------------------------------
-- 5. Geração de eventos
-- ------------------------------------------------------------
-- Três correções:
--
-- a) v_count contava só o passo 1 (get diagnostics lê o statement
--    anterior). A função dizia "1" tendo inserido sete lotes.
--
-- b) page_hidden e page_removed re-disparavam TODA SEMANA. O ref do
--    dedupe é o id do scrape, e cada run cria um scrape novo — então o
--    mesmo fato gerava ref novo. Uma página aposentada virava um card
--    amarelo no feed para sempre, que é exatamente o ruído que o feed
--    existe para evitar. Agora só emite na TRANSIÇÃO.
--
-- c) O passo do blog ignorava o p_run_id e usava now() - 1 hora, o que
--    quebra a idempotência por run. Agora escopa pelo início do run.
--
-- Mais: search_path fixado (lint function_search_path_mutable do
-- Supabase) e o título de bio_link_changed deixou de dizer "mudou a bio"
-- quando só o link mudou.

create or replace function fn_generate_change_events(p_run_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_total integer := 0;
    v_n     integer := 0;
    v_run_started timestamptz;
begin
    select started_at into v_run_started from collection_runs where id = p_run_id;

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
    get diagnostics v_n = row_count; v_total := v_total + v_n;

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
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 3. Vagas → notable
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        f.competitor_id, 'firecrawl', 'page_changed', 'notable',
        c.name || ': vagas de ' || coalesce(f.previous_value, '—')
            || ' para ' || coalesce(f.current_value, '—'),
        tp.url,
        jsonb_build_object('ref', f.id::text, 'field', f.field_name, 'kind', 'careers'),
        f.observed_at
    from page_field_changes f
    join page_scrapes  ps on ps.id = f.scrape_id and ps.run_id = p_run_id
    join tracked_pages tp on tp.id = f.tracked_page_id
    join competitors   c  on c.id  = f.competitor_id
    where f.has_changed and tp.page_type = 'careers'
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 4. Post de blog novo → info (escopado pelo run, não por "última hora")
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
    where not b.is_gone
      and v_run_started is not null
      and b.first_seen_at >= v_run_started
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 5. Página saiu do ar ou dos links → notable, SÓ NA TRANSIÇÃO
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
    left join lateral (
        select p2.change_status, p2.visibility
        from page_scrapes p2
        where p2.tracked_page_id = ps.tracked_page_id
          and p2.scraped_at < ps.scraped_at
        order by p2.scraped_at desc
        limit 1
    ) prev on true
    where ps.run_id = p_run_id
      and (
        -- passou a estar fora do ar agora
        (ps.change_status = 'removed' and coalesce(prev.change_status, '') <> 'removed')
        -- ou passou a estar oculta agora
        or (ps.visibility = 'hidden'
            and coalesce(prev.visibility, 'visible') <> 'hidden'
            and ps.change_status is distinct from 'removed')
      )
      -- sem captura anterior é baseline: não há transição a relatar
      and prev.change_status is not null
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

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
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 7. Bio ou link da bio mudou → notable
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        s.competitor_id, 'apify_instagram',
        case when s.biography is distinct from prev.biography
             then 'bio_changed' else 'bio_link_changed' end,
        'notable',
        -- o título segue o que mudou de verdade
        case when s.biography is distinct from prev.biography
             then c.name || ' mudou a bio do Instagram'
             else c.name || ' mudou o link da bio' end,
        case when s.biography is distinct from prev.biography
             then coalesce(prev.biography, '—') || ' → ' || coalesce(s.biography, '—')
             else coalesce(prev.external_url, '—') || ' → ' || coalesce(s.external_url, '—') end,
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
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    return v_total;
end;
$$;


-- ------------------------------------------------------------
-- 6. security_invoker em todas as views
-- ------------------------------------------------------------
-- View no Postgres nasce SECURITY DEFINER: roda com os privilégios do
-- dono e IGNORA o RLS de quem consulta. Com RLS ligado e sem policies,
-- qualquer grant select nessas views abriria a base inteira para a anon
-- key — justamente o que o bloco de RLS da 0001 quer evitar.
-- É o lint `security_definer_view` do Supabase.

alter view v_page_current                set (security_invoker = true);
alter view v_instagram_growth            set (security_invoker = true);
alter view v_instagram_post_engagement   set (security_invoker = true);
alter view v_instagram_weekly_scoreboard set (security_invoker = true);
alter view v_pricing_history             set (security_invoker = true);
alter view v_dashboard_feed              set (security_invoker = true);
alter view v_dashboard_scoreboard        set (security_invoker = true);
alter view v_competitor_timeline         set (security_invoker = true);
alter view v_tracking_readiness          set (security_invoker = true);
