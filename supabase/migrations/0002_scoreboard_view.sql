-- ===========================================================================
-- 0002_scoreboard_view
--
-- A view que alimenta o Nivel 2 (placar comparativo). Uma linha por
-- concorrente, toda a matematica num lugar so.
--
-- Regras que a view existe pra nao deixar ninguem errar:
--
--  * Engajamento precisa de denominador. Curtida absoluta compara mal — quem
--    tem mais seguidores sempre vence. ER = (likes + comments) / seguidores.
--
--  * likes_count NULL e DESCONHECIDO, nao zero. Posts sem curtida visivel
--    ficam fora da media (e sao contados em posts_unknown_likes, pra UI poder
--    dizer que a amostra e parcial) em vez de puxar a media pra baixo.
--
--  * video_* so existe em video; nao entra em nenhuma media aqui.
--
--  * Post fixado aparece em toda coleta e nao e post da semana: excluido.
--
--  * has_comparison = false significa que ainda nao existe snapshot com 7+
--    dias. A UI mostra "baseline coletado" em vez de um delta falso de zero.
-- ===========================================================================

create or replace view public.competitor_weekly_stats as

with latest_profile as (
  select distinct on (competitor_id)
    competitor_id, captured_at, followers_count, follows_count, posts_count, is_private
  from public.instagram_profile_snapshots
  order by competitor_id, captured_at desc
),

-- Snapshot mais recente com pelo menos 7 dias, pro delta semanal.
prior_profile as (
  select distinct on (competitor_id)
    competitor_id, captured_at, followers_count
  from public.instagram_profile_snapshots
  where captured_at <= now() - interval '7 days'
  order by competitor_id, captured_at desc
),

-- Ultima metrica conhecida de cada post.
latest_metrics as (
  select distinct on (post_id)
    post_id, likes_count, comments_count
  from public.instagram_post_metrics
  order by post_id, captured_at desc
),

week_posts as (
  select
    p.competitor_id,
    m.likes_count,
    m.comments_count
  from public.instagram_posts p
  left join latest_metrics m on m.post_id = p.id
  where p.posted_at >= now() - interval '7 days'
    and not p.is_pinned
),

post_stats as (
  select
    competitor_id,
    count(*) as posts_7d,
    count(*) filter (where likes_count is null) as posts_unknown_likes,
    avg(likes_count + coalesce(comments_count, 0))
      filter (where likes_count is not null) as avg_engagement
  from week_posts
  group by competitor_id
),

blog_stats as (
  select competitor_id, count(*) as blog_7d
  from public.change_events
  where kind = 'blog_post'
    and occurred_at >= now() - interval '7 days'
  group by competitor_id
),

careers as (
  select distinct on (s.competitor_id)
    s.competitor_id, w.jobs_count, w.captured_at
  from public.web_snapshots w
  join public.sources s on s.id = w.source_id
  where s.page_type = 'careers' and w.jobs_count is not null
  order by s.competitor_id, w.captured_at desc
),

pricing as (
  select distinct on (s.competitor_id)
    s.competitor_id, w.headline_price, w.price_currency, w.captured_at
  from public.web_snapshots w
  join public.sources s on s.id = w.source_id
  where s.page_type = 'pricing' and w.headline_price is not null
  order by s.competitor_id, w.captured_at desc
),

-- Desde quando existe qualquer captura deste concorrente.
tracking as (
  select competitor_id, min(captured_at) as tracking_since from (
    select competitor_id, captured_at from public.web_snapshots
    union all
    select competitor_id, captured_at from public.instagram_profile_snapshots
  ) all_captures
  group by competitor_id
)

select
  c.id            as competitor_id,
  c.slug,
  c.name,
  c.logo_url,

  lp.followers_count,
  lp.follows_count,
  lp.is_private,
  lp.captured_at  as profile_captured_at,

  pp.followers_count as followers_prior,
  case when pp.followers_count is not null
       then lp.followers_count - pp.followers_count end as followers_delta_7d,
  case when pp.followers_count is not null and pp.followers_count > 0
       then round(
              (lp.followers_count - pp.followers_count)::numeric
              / pp.followers_count * 100, 2) end as followers_delta_pct_7d,

  coalesce(ps.posts_7d, 0)             as posts_7d,
  coalesce(ps.posts_unknown_likes, 0)  as posts_unknown_likes,
  round(ps.avg_engagement, 1)          as avg_engagement_7d,
  -- ER so faz sentido com seguidores conhecidos e > 0.
  case when lp.followers_count > 0 and ps.avg_engagement is not null
       then round(ps.avg_engagement / lp.followers_count * 100, 3) end as engagement_rate_pct,

  coalesce(bs.blog_7d, 0)  as blog_7d,
  ca.jobs_count            as jobs_open,
  pr.headline_price,
  pr.price_currency,

  t.tracking_since,
  (pp.competitor_id is not null) as has_comparison

from public.competitors c
left join latest_profile lp on lp.competitor_id = c.id
left join prior_profile  pp on pp.competitor_id = c.id
left join post_stats     ps on ps.competitor_id = c.id
left join blog_stats     bs on bs.competitor_id = c.id
left join careers        ca on ca.competitor_id = c.id
left join pricing        pr on pr.competitor_id = c.id
left join tracking       t  on t.competitor_id  = c.id
where c.is_active;

-- A view herda o RLS das tabelas base (security invoker), entao continua
-- visivel so pra service role.
alter view public.competitor_weekly_stats set (security_invoker = true);
