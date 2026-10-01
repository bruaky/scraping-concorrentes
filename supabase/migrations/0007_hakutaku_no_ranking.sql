-- ============================================================
-- A própria Hakutaku no ranking, para comparar com os concorrentes
-- ============================================================
-- Instagram @hakutakuai: linkado por https://hakutaku.ai/ e o perfil linka
-- de volta para o site. Baseline: coleta real no Apify em 01/10/2026 às
-- 20:34 UTC (os concorrentes partem do Social Blade das 12h do mesmo dia).
-- Pode rodar de novo: substitui o próprio baseline.

begin;

insert into competitors
    (name, slug, website, instagram_handle, linkedin_url, logo_url, category, notes, is_active)
values
    ('Hakutaku', 'hakutaku', 'https://hakutaku.ai', 'hakutakuai',
     'https://www.linkedin.com/company/hakutakuai/', '/logos/hakutaku.png',
     'nós · gestão de conhecimento com IA',
     'A própria Hakutaku, no ranking para comparar com os concorrentes.',
     true)
on conflict (slug) do update
   set website          = excluded.website,
       instagram_handle = excluded.instagram_handle,
       linkedin_url     = excluded.linkedin_url,
       logo_url         = excluded.logo_url,
       category         = excluded.category,
       notes            = excluded.notes,
       is_active        = true,
       updated_at       = now();

delete from instagram_profile_snapshots
 where run_id in (select id from collection_runs where job = 'baseline_hakutaku');
delete from collection_runs where job = 'baseline_hakutaku';

with run as (
    insert into collection_runs
        (source, job, started_at, finished_at, status, items_ok, items_failed)
    values
        ('apify_instagram', 'baseline_hakutaku',
         '2026-10-01 20:34:42+00', '2026-10-01 20:34:42+00', 'success', 1, 0)
    returning id
)
insert into instagram_profile_snapshots
    (run_id, competitor_id, username, ig_user_id, captured_at, followers_count,
     follows_count, posts_count, full_name, biography, external_url,
     is_verified, is_business_account, is_private, raw)
select run.id, c.id, 'hakutakuai', '68993757911', '2026-10-01 20:34:42+00', 294,
       4, 4, 'Hakutaku', 'Enabling companies to scale without increasing headcount.',
       'https://hakutaku.ai', false, true, false,
       '{"fonte": "apify~instagram-profile-scraper, 01/10/2026"}'::jsonb
  from run, competitors c
 where c.slug = 'hakutaku';

commit;

notify pgrst, 'reload schema';
