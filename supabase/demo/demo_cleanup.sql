-- ============================================================
-- Remove os dados de demonstração
-- ============================================================
-- Apaga só o que o botão "Rodar coleta" gravou no modo LIVE_RUN=simulated
-- (e, se ainda existir, o antigo seed de demonstração). Coletas reais —
-- baseline, ingest semanal e LIVE_RUN=apify — não são tocadas.
--
-- Como o dado de demo é reconhecido:
--   collection_runs        job começando com 'demo'
--   instagram_posts        id começando com 'demo_'
--   tracked_pages          firecrawl_tag = 'demo' (cascata: scrapes, diffs, campos)
--   blog_posts             raw->>'demo' = 'true'
--   change_events          payload->>'demo' = 'true'
--   competitors            restaurados de demo_competitor_backup (seed antigo)
--
-- Snapshots e métricas têm `on delete set null` no run_id, então são
-- apagados explicitamente ANTES dos runs.
-- ============================================================

begin;

delete from change_events where payload->>'demo' = 'true';

delete from instagram_post_metrics
 where post_id like 'demo\_%'
    or run_id in (select id from collection_runs where job like 'demo%');

delete from instagram_posts where id like 'demo\_%';

delete from instagram_profile_snapshots
 where run_id in (select id from collection_runs where job like 'demo%');

delete from tracked_pages where firecrawl_tag = 'demo';

delete from blog_posts where raw->>'demo' = 'true';

delete from collection_runs where job like 'demo%';

do $$
begin
    if to_regclass('public.demo_competitor_backup') is not null then
        update competitors c
           set website          = b.website,
               instagram_handle = b.instagram_handle,
               logo_url         = b.logo_url,
               category         = b.category,
               notes            = b.notes,
               updated_at       = now()
          from demo_competitor_backup b
         where b.competitor_id = c.id;

        drop table demo_competitor_backup;
    end if;
end;
$$;

commit;
