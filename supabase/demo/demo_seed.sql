-- ============================================================
-- Dados de demonstração — 9 semanas de histórico FICTÍCIO
-- ============================================================
-- Para apresentar o dashboard com todas as áreas preenchidas antes de ter
-- coleta real. NADA aqui é dado verdadeiro dos concorrentes: seguidores,
-- posts, preços, vagas e handles são inventados.
--
-- Rodar no SQL Editor do Supabase (ou psql) DEPOIS das migrations 0001–0003.
-- É idempotente: começa limpando a demo anterior, então pode rodar de novo
-- na manhã da apresentação para as datas ficarem frescas — tudo é relativo
-- a now(): a última coleta semanal cai 6 dias atrás e há uma coleta leve de
-- posts 2 horas atrás.
--
-- Para remover: supabase/demo/demo_cleanup.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0. Limpa a demo anterior (mesmo conteúdo de demo_cleanup.sql)
-- ------------------------------------------------------------

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
           set website = b.website, instagram_handle = b.instagram_handle,
               logo_url = b.logo_url, category = b.category, notes = b.notes
          from demo_competitor_backup b
         where b.competitor_id = c.id;
        drop table demo_competitor_backup;
    end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. Guarda o estado atual dos concorrentes e preenche o perfil de demo
-- ------------------------------------------------------------

create table demo_competitor_backup as
select id as competitor_id, website, instagram_handle, logo_url, category, notes
from competitors;

-- Parâmetros de cada concorrente na simulação.
--   f0       seguidores na semana 0
--   g        crescimento semanal (%)
--   ppw      posts por semana
--   er       taxa de engajamento típica (curtidas+coment. ÷ seguidores)
--   hide     fração dos posts com curtidas ocultas
--   reels    fração dos posts que são reels
--   jump_w   semana de um salto de seguidores (lançamento, viral...)
--   jump     tamanho do salto
--   stop_w   a partir desta semana para de postar (null = nunca)
create temp table demo_params (
    slug text primary key, website text, handle text, logo text, category text,
    f0 integer, g numeric, ppw integer, er numeric, hide numeric, reels numeric,
    jump_w integer, jump integer, stop_w integer, bio text, web boolean
) on commit drop;

insert into demo_params values
 ('glean',         'https://glean.com',    'gleanwork',      'https://www.google.com/s2/favicons?domain=glean.com&sz=128',
  'enterprise search',        46200, 0.55, 3, 0.012, 0.00, 0.40, 5, 1400, null,
  'The Work AI platform. Find, create and automate anything at work.', true),
 ('delphi-ai',     'https://delphi.ai',    'delphi.ai',      'https://www.google.com/s2/favicons?domain=delphi.ai&sz=128',
  'digital clones',           19800, 0.90, 4, 0.035, 0.30, 0.60, 7, 1100, null,
  'Clone your mind. Scale your expertise with an AI version of you.', true),
 ('meuze',         null,                   'meuze.app',      null,
  'creator tools',            11800, 1.10, 5, 0.045, 0.00, 0.70, 6,  900, null,
  'Sua voz, em escala. Conteúdo com IA para criadores.', false),
 ('workera',       'https://workera.ai',   'workera.ai',     'https://www.google.com/s2/favicons?domain=workera.ai&sz=128',
  'skills/assessment',         9400, 0.40, 2, 0.015, 0.00, 0.30, null, 0, null,
  'Measure and grow the skills that matter. AI-powered skills intelligence.', true),
 ('bond',          null,                   'bond.hq',        null,
  'relationship intelligence', 7600, 0.50, 2, 0.020, 0.00, 0.25, null, 0, null,
  'Every relationship, remembered.', false),
 ('get-zep',       'https://www.getzep.com','getzep',        'https://www.google.com/s2/favicons?domain=getzep.com&sz=128',
  'memory layer',              5900, 1.40, 2, 0.025, 0.00, 0.35, null, 0, null,
  'Memory for AI agents. Temporal knowledge graphs for agentic apps.', true),
 ('try-glen',      null,                   'tryglen',        null,
  'AI assistant',              4500, 0.80, 3, 0.030, 0.00, 0.50, null, 0, null,
  'Your AI chief of staff.', false),
 ('strattum',      'https://strattum.ai',  'strattum.ai',    'https://www.google.com/s2/favicons?domain=strattum.ai&sz=128',
  'estratégia com IA',         3100, 1.00, 3, 0.040, 0.00, 0.45, 8,  210, null,
  'Estratégia orientada por dados para o mid-market.', true),
 ('nama-ai',       null,                   'nama.ai',        null,
  'AI agents',                 2050, 0.70, 1, 0.030, 0.00, 0.30, null, 0, null,
  'Agents that get work done.', false),
 ('ultra-context', null,                   'ultracontext',   null,
  'context/RAG',               1550, 0.60, 1, 0.020, 0.00, 0.20, null, 0, null,
  'Context infrastructure for LLM apps.', false),
 ('impossibl',     null,                   'impossibl.ai',   null,
  'AI studio',                 1080, 0.30, 2, 0.025, 0.00, 0.30, null, 0, 6,
  'We build the impossible.', false),
 ('cogniscape',    null,                   'cogniscape',     null,
  'knowledge graphs',           820, 0.90, 1, 0.050, 0.00, 0.20, null, 0, null,
  'Map what your company knows.', false);

update competitors c
   set website          = coalesce(c.website, p.website),
       instagram_handle = p.handle,
       logo_url         = coalesce(c.logo_url, p.logo),
       category         = coalesce(c.category, p.category),
       notes            = 'Dados de demonstração (fictícios) — ver supabase/demo/.',
       updated_at       = now()
  from demo_params p
 where p.slug = c.slug;


-- Páginas do site e o valor de cada campo extraído, semana a semana
-- (posição 1 = semana 0). Só os 5 concorrentes com domínio conhecido.
create temp table demo_web (
    slug text, page_type text, path text, field text, vals text[]
) on commit drop;

insert into demo_web values
 ('glean',     'home',       '/',          'headline',
  array['Work AI for all.','Work AI for all.','Work AI for all.','Work AI for all.','Work AI for all.',
        'The Work AI platform for every team.','The Work AI platform for every team.',
        'The Work AI platform for every team.','The Work AI platform for every team.']),
 ('glean',     'pricing',    '/pricing',   'enterprise_price', array_fill('Sob consulta'::text, array[9])),
 ('glean',     'careers',    '/careers',   'open_roles_count',
  array['138','141','140','146','149','152','155','158','161']),
 ('glean',     'blog_index', '/blog',      null, null),

 ('get-zep',   'home',       '/',          'headline', array_fill('Memory for AI agents.'::text, array[9])),
 ('get-zep',   'pricing',    '/pricing',   'flex_price',
  array['US$ 25/mês','US$ 25/mês','US$ 25/mês','US$ 25/mês','US$ 25/mês',
        'US$ 29/mês','US$ 29/mês','US$ 29/mês','US$ 29/mês']),
 ('get-zep',   'careers',    '/careers',   'open_roles_count',
  array['6','6','7','7','8','8','9','9','11']),
 ('get-zep',   'blog_index', '/blog',      null, null),

 ('workera',   'home',       '/',          'headline', array_fill('Skills intelligence for the AI era.'::text, array[9])),
 ('workera',   'pricing',    '/pricing',   'team_price',
  array['US$ 39/usuário','US$ 39/usuário','US$ 39/usuário','US$ 49/usuário','US$ 49/usuário',
        'US$ 49/usuário','US$ 49/usuário','US$ 49/usuário','US$ 49/usuário']),
 ('workera',   'careers',    '/careers',   'open_roles_count',
  array['21','20','19','19','18','18','17','16','16']),
 ('workera',   'blog_index', '/blog',      null, null),

 ('delphi-ai', 'home',       '/',          'headline',
  array['Clone yourself.','Clone yourself.','Clone yourself.','Clone yourself.','Clone yourself.',
        'Clone yourself.','Your AI clone, live in minutes.','Your AI clone, live in minutes.',
        'Your AI clone, live in minutes.']),
 ('delphi-ai', 'pricing',    '/pricing',   'pro_price',
  array['US$ 29/mês','US$ 29/mês','US$ 29/mês','US$ 29/mês','US$ 29/mês','US$ 29/mês',
        'US$ 33/mês','US$ 33/mês','US$ 33/mês']),
 ('delphi-ai', 'careers',    '/careers',   'open_roles_count',
  array['9','10','10','12','12','14','15','15','17']),
 ('delphi-ai', 'blog_index', '/blog',      null, null),

 -- Strattum: a história da correlação. Na última semana mexeu no preço,
 -- na home, na bio do Instagram e abriu 4 vagas de uma vez.
 ('strattum',  'home',       '/',          'headline',
  array['Estratégia orientada por dados.','Estratégia orientada por dados.','Estratégia orientada por dados.',
        'Estratégia orientada por dados.','Estratégia orientada por dados.','Estratégia orientada por dados.',
        'Estratégia orientada por dados.','Estratégia orientada por dados.',
        'IA para decisões estratégicas — agora para times de vendas.']),
 ('strattum',  'pricing',    '/solucoes',  'starter_price',
  array['R$ 490/mês','R$ 490/mês','R$ 490/mês','R$ 490/mês','R$ 490/mês','R$ 490/mês',
        'R$ 490/mês','R$ 490/mês','R$ 590/mês']),
 ('strattum',  'pricing',    '/solucoes',  'pro_price',
  array['R$ 1.490/mês','R$ 1.490/mês','R$ 1.490/mês','R$ 1.490/mês','R$ 1.490/mês','R$ 1.490/mês',
        'R$ 1.490/mês','R$ 1.490/mês','R$ 1.890/mês']),
 ('strattum',  'careers',    '/carreiras', 'open_roles_count',
  array['3','3','3','4','4','4','4','5','9']),
 ('strattum',  'blog_index', '/conteudos', null, null);

insert into tracked_pages (competitor_id, url, page_type, firecrawl_tag, diff_modes,
                           extraction_prompt, extraction_schema, scrape_options)
select distinct on (c.id, dw.path)
       c.id,
       rtrim(dp.website, '/') || dw.path,
       dw.page_type,
       'demo',
       case when dw.field is null then '{git-diff}'::text[] else '{git-diff,json}'::text[] end,
       case when dw.field is null then null else 'Extraia os campos do schema.' end,
       case when dw.field is null then null
            else jsonb_build_object('type', 'object', 'demo', true) end,
       '{"onlyMainContent": true, "demo": true}'::jsonb
from demo_web dw
join demo_params dp on dp.slug = dw.slug
join competitors c  on c.slug  = dw.slug
order by c.id, dw.path;

-- ------------------------------------------------------------
-- 2. Gera 9 semanas de coleta
-- ------------------------------------------------------------

do $$
declare
    v_weeks  constant integer := 9;            -- semanas 0..8
    v_base   timestamptz := date_trunc('day', now()) - interval '6 days' + interval '9 hours';
    v_ts     timestamptz;
    v_ig_run uuid;
    v_web_run uuid;
    v_mid_run uuid;
    v_runs   uuid[] := '{}';
    v_web_runs uuid[] := '{}';
    v_scrape uuid;
    v_status text;
    v_added  integer;
    tp       record;
    fv       record;
    p        record;
    c_id     uuid;
    w        integer;
    i        integer;
    n        integer;
    f        integer;
    v_posts_total integer;
    v_bio    text;
    v_url    text;
    v_post_id text;
    v_posted timestamptz;
    v_metric_ts timestamptz;
    v_metric_run uuid;
    v_reel   boolean;
    v_likes  integer;
    v_plays  integer;
    v_captions text[] := array[
        'Lançamos hoje: busca unificada em todas as suas ferramentas. Link na bio.',
        '3 sinais de que sua empresa precisa de uma camada de contexto para IA.',
        'Bastidores do time de produto: como priorizamos o roadmap do trimestre.',
        'Case: como um cliente reduziu 40% do tempo de onboarding.',
        'Webinar na quinta — agentes de IA na prática. Inscrições abertas.',
        'O que aprendemos rodando 1 milhão de consultas por dia.',
        'Novo integração disponível. Conecte em dois cliques.',
        'Estamos contratando! Vagas para vendas, engenharia e CS.',
        'Thread: o mito do RAG que resolve tudo.',
        'Nosso time no evento desta semana. Passa no estande!',
        'Release notes de setembro: 12 melhorias que você pediu.',
        'Por que memória de longo prazo muda o jogo para assistentes.',
        'Cliente do mês: o que mudou depois de 90 dias.',
        'Guia rápido: 5 prompts para extrair mais da sua base interna.',
        'Pesquisa nova: como empresas médias estão adotando IA em 2026.',
        'Demo em 60 segundos. Assista até o fim.'
    ];
    v_blog_titles text[] := array[
        'Como construímos nossa camada de permissões',
        'O estado da IA no trabalho em 2026',
        'Agentes que lembram: arquitetura de memória',
        'Guia de ROI para IA generativa',
        'Novidades do produto — edição do mês',
        'Segurança e governança em LLMs corporativos',
        'Do piloto à produção em 30 dias',
        'Benchmarks: latência e qualidade de busca'
    ];
begin
    perform setseed(0.4242);

    -- Runs semanais: um do Instagram e um do site por semana.
    for w in 0..v_weeks-1 loop
        v_ts := v_base - make_interval(days => 7 * (v_weeks - 1 - w));

        insert into collection_runs (source, job, started_at, finished_at, status, items_ok, items_failed, credits_used)
        values ('apify_instagram', 'demo_seed', v_ts, v_ts + interval '4 minutes', 'success', 12, 0, 24)
        returning id into v_ig_run;

        insert into collection_runs (source, job, started_at, finished_at, status, items_ok, items_failed, credits_used)
        values ('firecrawl', 'demo_seed', v_ts - interval '10 minutes', v_ts - interval '3 minutes', 'success', 20, 0, 40)
        returning id into v_web_run;

        v_runs := v_runs || v_web_run || v_ig_run;
        v_web_runs := v_web_runs || v_web_run;

        -- --- Instagram: snapshot do perfil ---------------------------------
        for p in select dp.*, c.id as cid from demo_params dp join competitors c on c.slug = dp.slug loop
            f := round(p.f0 * power(1 + p.g / 100.0, w) * (1 + (random() - 0.5) * 0.003))::integer
                 + case when p.jump_w is not null and w >= p.jump_w then p.jump else 0 end;

            v_bio := p.bio;
            v_url := coalesce(p.website, 'https://linktr.ee/' || p.handle);
            -- Mudanças de perfil que viram alerta no feed
            if p.slug = 'strattum'  and w >= 8 then v_bio := 'IA para decisões estratégicas. Agora com planos para times de vendas.'; end if;
            if p.slug = 'delphi-ai' and w >= 7 then v_bio := 'Your AI clone, live in minutes. Trusted by 10,000+ experts.'; end if;
            if p.slug = 'glean'     and w >= 5 then v_url := 'https://glean.com/agents'; end if;

            select count(*) into v_posts_total from instagram_posts where competitor_id = p.cid;

            insert into instagram_profile_snapshots
                (run_id, competitor_id, username, captured_at, followers_count, follows_count,
                 posts_count, highlight_reel_count, full_name, biography, external_url,
                 is_verified, is_business_account, business_category, is_private, account_type, raw)
            values
                (v_ig_run, p.cid, p.handle, v_ts, f, 180 + (random() * 400)::integer,
                 140 + v_posts_total, 6, initcap(replace(p.slug, '-', ' ')), v_bio, v_url,
                 p.f0 > 20000, true, 'Software', false, 2, jsonb_build_object('demo', true));
        end loop;

        -- --- Instagram: posts publicados na semana que termina em v_ts ----
        for p in select dp.*, c.id as cid from demo_params dp join competitors c on c.slug = dp.slug loop
            continue when p.stop_w is not null and w >= p.stop_w;
            n := greatest(0, p.ppw + (floor(random() * 3) - 1)::integer);

            for i in 1..n loop
                v_post_id := 'demo_' || replace(p.slug, '-', '_') || '_' || w || '_' || i;
                v_posted  := v_ts - make_interval(secs => (random() * 6.5 * 86400)::integer);
                v_reel    := random() < p.reels;

                insert into instagram_posts
                    (id, competitor_id, owner_username, short_code, url, post_type, product_type,
                     caption, hashtags, posted_at, video_duration, is_pinned, raw)
                values
                    (v_post_id, p.cid, p.handle, 'D' || substr(md5(v_post_id), 1, 10), null,
                     case when v_reel then 'Video' when random() < 0.3 then 'Sidecar' else 'Image' end,
                     case when v_reel then 'clips' else 'feed' end,
                     v_captions[1 + floor(random() * array_length(v_captions, 1))::integer],
                     array['ia', 'produtividade'],
                     v_posted,
                     case when v_reel then round((15 + random() * 45)::numeric, 1) end,
                     (w = 0 and i = 1),
                     jsonb_build_object('demo', true));
            end loop;
        end loop;
    end loop;

    -- Coleta leve de posts 2 horas atrás: mede o que saiu depois da última
    -- semanal, para o placar "últimos 7 dias" ter números.
    insert into collection_runs (source, job, started_at, finished_at, status, items_ok, items_failed, credits_used)
    values ('apify_instagram', 'demo_seed_posts', now() - interval '2 hours',
            now() - interval '2 hours' + interval '2 minutes', 'success', 12, 0, 12)
    returning id into v_mid_run;

    for p in select dp.*, c.id as cid from demo_params dp join competitors c on c.slug = dp.slug loop
        continue when p.stop_w is not null;
        n := greatest(1, p.ppw - 1);
        for i in 1..n loop
            v_post_id := 'demo_' || replace(p.slug, '-', '_') || '_9_' || i;
            v_reel    := random() < p.reels;
            insert into instagram_posts
                (id, competitor_id, owner_username, short_code, url, post_type, product_type,
                 caption, hashtags, posted_at, video_duration, is_pinned, raw)
            values
                (v_post_id, p.cid, p.handle, 'D' || substr(md5(v_post_id), 1, 10), null,
                 case when v_reel then 'Video' else 'Image' end,
                 case when v_reel then 'clips' else 'feed' end,
                 v_captions[1 + floor(random() * array_length(v_captions, 1))::integer],
                 array['ia'],
                 v_base + make_interval(secs => (random() * 5.5 * 86400)::integer),
                 case when v_reel then round((15 + random() * 45)::numeric, 1) end,
                 false, jsonb_build_object('demo', true));
        end loop;
    end loop;

    -- Métricas: cada post é medido na primeira coleta depois de publicado.
    for p in
        select ip.id, ip.competitor_id, ip.posted_at, ip.product_type, dp.er, dp.hide
        from instagram_posts ip
        join competitors c on c.id = ip.competitor_id
        join demo_params dp on dp.slug = c.slug
        where ip.id like 'demo\_%'
    loop
        select r.started_at, r.id into v_metric_ts, v_metric_run
        from collection_runs r
        where r.job like 'demo_seed%' and r.source = 'apify_instagram' and r.started_at > p.posted_at
        order by r.started_at
        limit 1;

        select s.followers_count into f
        from instagram_profile_snapshots s
        where s.competitor_id = p.competitor_id and s.captured_at <= v_metric_ts
        order by s.captured_at desc limit 1;

        v_likes := round(f * p.er * (0.55 + random() * 0.9)
                         * case when p.product_type = 'clips' then 1.35 else 1 end)::integer;
        v_plays := case when p.product_type = 'clips'
                        then round(f * (0.35 + random() * 1.6))::integer end;

        insert into instagram_post_metrics
            (run_id, post_id, competitor_id, captured_at, likes_count, comments_count,
             video_view_count, video_play_count)
        values
            (v_metric_run, p.id, p.competitor_id, v_metric_ts,
             case when random() < p.hide then -1 else v_likes end,
             greatest(0, round(v_likes * (0.02 + random() * 0.06))::integer),
             v_plays, v_plays);
    end loop;

    -- --- Site (5 concorrentes com domínio conhecido) ------------------------
    for w in 0..v_weeks-1 loop
        v_ts := v_base - make_interval(days => 7 * (v_weeks - 1 - w)) - interval '10 minutes';

        for tp in
            select t.id, t.competitor_id, t.page_type, t.url, c.slug, c.website
            from tracked_pages t join competitors c on c.id = t.competitor_id
            where t.firecrawl_tag = 'demo'
        loop
            -- Post de blog novo nas semanas alternadas (e sempre na última da Strattum)
            v_added := 0;
            if tp.page_type = 'blog_index'
               and ((w + length(tp.slug)) % 2 = 0 or (tp.slug = 'strattum' and w = 8))
               and w > 0 then
                v_added := 1;
                insert into blog_posts (competitor_id, url, title, published_at, first_seen_at,
                                        last_seen_at, author, summary, word_count, raw)
                values (tp.competitor_id,
                        tp.url || '/' || w || '-' || substr(md5(tp.slug || w), 1, 6),
                        v_blog_titles[1 + ((w * 3 + length(tp.slug)) % array_length(v_blog_titles, 1))],
                        v_ts - make_interval(days => (random() * 5)::integer),
                        v_ts + interval '1 minute', v_ts + interval '1 minute',
                        'Time de conteúdo',
                        'Post novo detectado no índice do blog.',
                        800 + (random() * 1600)::integer,
                        jsonb_build_object('demo', true));
            end if;

            -- Mudou algum campo desta página nesta semana?
            select bool_or(dw.vals[w + 1] is distinct from dw.vals[w]) into strict v_reel
            from demo_web dw
            where dw.slug = tp.slug and rtrim(tp.website, '/') || dw.path = tp.url;

            v_status := case when w = 0 then 'new'
                             when coalesce(v_reel, false) or v_added > 0 then 'changed'
                             else 'same' end;

            insert into page_scrapes (run_id, tracked_page_id, competitor_id, scraped_at,
                                      change_status, visibility, previous_scrape_at,
                                      http_status, title, markdown_hash, markdown_chars, raw)
            values (v_web_runs[w + 1], tp.id, tp.competitor_id, v_ts + interval '1 minute',
                    v_status, 'visible',
                    case when w > 0 then v_ts + interval '1 minute' - interval '7 days' end,
                    200, initcap(tp.page_type) || ' — ' || initcap(replace(tp.slug, '-', ' ')),
                    md5(tp.url || w), 4000 + (random() * 9000)::integer,
                    jsonb_build_object('demo', true))
            returning id into v_scrape;

            if v_status = 'changed' then
                insert into page_diffs (scrape_id, competitor_id, diff_text, lines_added, lines_removed)
                values (v_scrape, tp.competitor_id, '(diff de demonstração)',
                        2 + (random() * 14)::integer, 1 + (random() * 8)::integer);
            end if;

            for fv in
                select dw.field, dw.vals from demo_web dw
                where dw.slug = tp.slug and dw.field is not null
                  and rtrim(tp.website, '/') || dw.path = tp.url
            loop
                insert into page_field_changes (scrape_id, competitor_id, tracked_page_id,
                                                field_name, previous_value, current_value, observed_at)
                values (v_scrape, tp.competitor_id, tp.id, fv.field,
                        -- semana 0 é baseline: anterior = atual, não é mudança
                        case when w = 0 then fv.vals[1] else fv.vals[w] end,
                        fv.vals[w + 1],
                        v_ts + interval '1 minute');
            end loop;
        end loop;
    end loop;

    -- Eventos: a mesma função que a coleta real usa, run por run, em ordem.
    for i in 1..array_length(v_runs, 1) loop
        perform fn_generate_change_events(v_runs[i]);
    end loop;
    perform fn_generate_change_events(v_mid_run);
end;
$$;

-- Marca os eventos gerados como demo (para a limpeza achar) e dá como
-- notificado o que tem mais de 7 dias — "novo" no feed fica só para a semana.
update change_events e
   set payload = e.payload || '{"demo": true}'::jsonb,
       notified_at = case when e.occurred_at < now() - interval '7 days'
                          then e.occurred_at + interval '1 hour' end
 where e.payload->>'ref' in (
        select id::text from instagram_profile_snapshots
         where run_id in (select id from collection_runs where job like 'demo%')
        union all select id::text from page_field_changes f
         where f.tracked_page_id in (select id from tracked_pages where firecrawl_tag = 'demo')
        union all select id::text from page_scrapes s
         where s.tracked_page_id in (select id from tracked_pages where firecrawl_tag = 'demo')
        union all select id::text from blog_posts where raw->>'demo' = 'true'
 );

commit;
