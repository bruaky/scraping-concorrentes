-- ============================================================
-- Baseline real — 01/10/2026
-- ============================================================
-- Ponto de partida da série, com dado VERIFICADO. Rodar no SQL Editor do
-- Supabase depois das migrations 0001–0004. Pode rodar de novo: substitui
-- o próprio baseline e não toca em coletas posteriores.
--
-- De onde vem cada coisa:
--
--   Site e LinkedIn  lidos no site oficial de cada empresa em 01/10/2026.
--   Logo             ícone oficial publicado pelo próprio site, copiado
--                    para public/logos/ (o app não depende do site deles).
--   Instagram        handle SÓ quando o site oficial linka o perfil:
--                    Glean, Meuze, Bond e Strattum. Os outros 8 não linkam
--                    Instagram e não têm perfil no Social Blade com o nome
--                    da empresa — ficam NULL ("sem IG"), não chutados.
--   Seguidores etc.  Social Blade (versão pública, sem login), lidos em
--                    01/10/2026 por volta das 12h UTC. O histórico diário do
--                    Social Blade exige login; por isso a série começa aqui.
--
-- Fica de fora o @delphi.ai: existe, mas tem 81 seguidores, 0 posts e o
-- site da Delphi não o linka — tudo indica perfil reservado, não oficial.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0. Se o seed de demonstração antigo foi aplicado, remove
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
drop table if exists demo_competitor_backup;

-- ------------------------------------------------------------
-- 1. Cadastro verificado dos 12 concorrentes
-- ------------------------------------------------------------

update competitors c
   set website          = v.website,
       instagram_handle = v.handle,
       linkedin_url     = v.linkedin,
       logo_url         = v.logo,
       category         = v.category,
       notes            = v.notes,
       updated_at       = now()
  from (values
    ('glean',         'https://www.glean.com',    'gleanwork',
     'https://www.linkedin.com/company/gleanwork/', '/logos/glean.png',
     'enterprise AI · busca e agentes',
     'Plataforma de "Work AI": busca, assistente e agentes sobre os dados da empresa.'),
    ('get-zep',       'https://www.getzep.com',   null,
     'https://www.linkedin.com/company/zep-ai/',    '/logos/get-zep.png',
     'memory layer',
     'Camada de contexto e memória para agentes (grafo de conhecimento temporal).'),
    ('nama-ai',       'https://nama.ai',          null,
     null,                                          '/logos/nama-ai.svg',
     'company brain',
     'Company Brain para IA corporativa. São Paulo, desde 2014.'),
    ('ultra-context', 'https://ultracontext.com', null,
     'https://www.linkedin.com/company/ultracontext', '/logos/ultra-context.png',
     'context/RAG',
     'Hub de contexto para agentes de IA, open source, com versionamento estilo git.'),
    ('try-glen',      'https://tryglen.com',      null,
     'https://www.linkedin.com/company/tryglen',    '/logos/try-glen.png',
     'memória para agentes',
     'Camada de aprendizado compartilhado entre os agentes da empresa (YC).'),
    ('impossibl',     'https://impossibl.com',    null,
     null,                                          '/logos/impossibl.png',
     'AI gateway',
     'Gateway de IA compatível com a API da OpenAI, multi-provedor.'),
    ('meuze',         'https://www.meuze.ai',     'meuzeai',
     'https://www.linkedin.com/company/meuze/',     '/logos/meuze.png',
     'company brain · food service',
     'Company Brain para redes de food service (QSR). CEO: Jack Doohan.'),
    ('bond',          'https://www.bondapp.io',   'bondapp.io',
     'https://www.linkedin.com/company/thebondapp', '/logos/bond.png',
     'chief of staff com IA',
     'Agente que conhece a empresa e as prioridades — um "chief of staff" com IA (YC X25).'),
    ('cogniscape',    'https://cogniscape.app',   null,
     null,                                          '/logos/cogniscape.png',
     'engineering intelligence',
     'Observabilidade de AI coding: liga uso de agentes a entregas no GitHub e Linear.'),
    ('delphi-ai',     'https://www.delphi.ai',    null,
     null,                                          '/logos/delphi-ai.png',
     'clones digitais',
     'Clones digitais de especialistas treinados no conteúdo de cada um.'),
    ('strattum',      'https://www.strattum.ai',  'strattum.ai',
     'https://www.linkedin.com/company/strattum-ai/', '/logos/strattum.svg',
     'company brain',
     'Company Brain. Páginas: /carreiras, /conteudos, /solucoes.'),
    ('workera',       'https://www.workera.ai',   null,
     'https://www.linkedin.com/company/workera-ai/', '/logos/workera.png',
     'skills intelligence',
     'Agentes de IA para avaliar e desenvolver as competências da força de trabalho.')
  ) as v(slug, website, handle, linkedin, logo, category, notes)
 where c.slug = v.slug;

-- ------------------------------------------------------------
-- 2. Snapshot de Instagram de 01/10/2026 (Social Blade)
-- ------------------------------------------------------------

delete from instagram_profile_snapshots
 where run_id in (select id from collection_runs where job = 'baseline_socialblade');
delete from collection_runs where job = 'baseline_socialblade';

with run as (
    insert into collection_runs
        (source, job, started_at, finished_at, status, items_ok, items_failed, external_ref)
    values
        ('apify_instagram', 'baseline_socialblade',
         '2026-10-01 12:00:00+00', '2026-10-01 12:20:00+00', 'success', 4, 0,
         'socialblade.com (público, sem login) — 01/10/2026')
    returning id
)
insert into instagram_profile_snapshots
    (run_id, competitor_id, username, captured_at, followers_count, follows_count,
     posts_count, full_name, is_private, raw)
select run.id, c.id, v.handle, '2026-10-01 12:00:00+00',
       v.followers, v.following, v.media, v.display_name, false,
       jsonb_build_object(
           'source', 'socialblade',
           'url', 'https://socialblade.com/instagram/user/' || v.handle,
           'engagement_rate_pct', v.er,
           'avg_likes', v.avg_likes,
           'avg_comments', v.avg_comments)
from run
cross join (values
    ('glean',    'gleanwork',   'Glean',                       1165, 92, 274,  2.26,   25.94, 0.44),
    ('meuze',    'meuzeai',     'Meuze AI',                    3488,  5,   4, 43.49, 1499.00, 18.00),
    ('bond',     'bondapp.io',  'BOND (YC X25)',               1781,  7,  59,  3.18,   52.50, 4.13),
    ('strattum', 'strattum.ai', 'Strattum AI - Company Brain',  109,  0,  24,  4.36,    4.63, 0.13)
) as v(slug, handle, display_name, followers, following, media, er, avg_likes, avg_comments)
join competitors c on c.slug = v.slug;

commit;
