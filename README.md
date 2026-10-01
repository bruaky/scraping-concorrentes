# hakutaku

Inteligência competitiva: coleta o Instagram dos concorrentes (Apify), guarda
tudo no Supabase e transforma as diferenças numa timeline de eventos.

A coleta das páginas web (Firecrawl) foi removida. As tabelas de web
(`tracked_pages`, `page_scrapes`, `page_field_changes`…) continuam no schema,
mas nada as alimenta hoje — as colunas de site no placar e na timeline ficam
vazias até entrar outra fonte.

## As três telas

**Nível 1 — o que mudou essa semana.** A tela que abre. Feed cronológico lendo
só `v_dashboard_feed`, com severidade por cor: `high` vermelho (preço,
proposta de valor), `notable` amarelo (vagas, mudança estrutural), `info`
cinza (post, blog). A cor nunca aparece sozinha — vem sempre colada ao rótulo
do tipo, porque no fundo claro o amarelo fica abaixo de 3:1 de contraste.

**Nível 2 — placar comparativo.** `v_dashboard_scoreboard`, uma linha por
concorrente, ordenável por qualquer coluna. Desconhecido vai sempre para o fim
da ordenação, em qualquer direção.

**Nível 3 — drill-down.** `v_competitor_timeline`, misturando web e Instagram
no mesmo eixo de tempo. É aqui que aparece a correlação que justifica o
sistema: pricing mexido na mesma semana de quatro vagas de vendas.

Overview de todos os concorrentes (logo + nome, clicável) fixo no topo. Sem
logo, monograma com as iniciais.

## Arquitetura

```
Vercel Cron ──►  /api/ingest/instagram  ──►  Supabase  ──►  views  ──►  dashboard
(semanal)        grava dados crus              │
                                               └──► fn_generate_change_events(run_id)
```

A decisão do que vira alerta mora em SQL (`fn_generate_change_events`), perto
dos dados. A aplicação grava o cru e dispara a função.

## Estrutura

```
app/
  page.tsx                              Níveis 1 e 2
  competitors/[slug]/page.tsx           Nível 3
  _components/                          rail, feed, placar, tiles
  api/
    cron/weekly/route.ts                Vercel Cron
    ingest/instagram/route.ts           perfil + posts + métricas
    live/run/route.ts                   botão "Rodar coleta" (NDJSON)
lib/
  supabase.ts       client service-role, SÓ server
  apify.ts          perfil + posts, valores CRUS
  runs.ts           collection_runs + fn_generate_change_events
  pipeline.ts       orquestra as rotas de ingest
  instagram.ts      Apify → snapshot + posts + métricas
  live-run.ts       modos do botão "Rodar coleta"
  format.ts         formatação (ausência nunca vira zero)
supabase/migrations/
  0001_competitive_intel.sql  schema (verbatim, como aplicado)
  0002_dashboard_views.sql    views + fn_generate_change_events (verbatim)
  0003_dashboard_fixes.sql    correções — ver abaixo
  0004_followers_title.sql    título do salto de seguidores sem espaços
supabase/baseline/
  2026-10-01_baseline.sql     ponto de partida verificado (Social Blade + sites)
supabase/demo/
  demo_cleanup.sql            remove o que o modo simulado gravou
public/logos/                 logos oficiais dos concorrentes
```

`0001` e `0002` estão verbatim de propósito, para poderem ser diferenciados
contra o que está no Supabase. Migration é append-only: tudo que muda
comportamento está em `0003`.

## O que a 0003 corrige

Cada item foi reproduzido contra um Postgres 16 antes e depois.

**Engajamento tratava curtida escondida como zero.** `engagement` fazia
`coalesce(nullif(likes,-1), 0)`, então o post entrava na média valendo só os
comentários. Com um post de 1.000 curtidas + 50 comentários e outro de
curtidas ocultas + 50 comentários, a view reportava média 550 e ER 5,5% —
o correto é 1.050 e 10,5%. Quem esconde curtidas aparecia com metade do
engajamento real. Agora `engagement` é NULL quando as curtidas são
desconhecidas (o `avg` ignora NULL sozinho), e `posts_unknown_likes` diz
quantos ficaram de fora.

**`followers_delta_7d` não era de 7 dias.** Usava o snapshot imediatamente
anterior. Com cron semanal coincide; no primeiro disparo manual vira "delta
desde alguns minutos atrás" sob um rótulo que promete uma semana. Agora são
duas colunas: `followers_delta_7d` (captura com 7+ dias) e
`followers_delta_since_last`.

**`page_hidden` e `page_removed` re-disparavam toda semana.** O `ref` do
dedupe é o id do scrape, e cada run cria um scrape novo. Uma página aposentada
virava um card amarelo no feed para sempre. Agora só emite na transição —
verificado: 1 evento quando fica oculta, 0 nas semanas seguintes.

**As views eram `SECURITY DEFINER`.** View no Postgres nasce assim: roda com
os privilégios do dono e ignora o RLS de quem consulta. Com RLS ligado e sem
policies, um `grant select` abriria a base inteira para a anon key. Todas as
nove views agora têm `security_invoker = true`.

**`open_roles` era `text` num placar ordenável** — a ordem era `10 < 100 < 9`.
Agora é inteiro, com cast seguro.

**A função retornava só a contagem do passo 1.** `get diagnostics` lê o
statement anterior; os passos 2–7 não somavam.

**O passo do blog ignorava o `p_run_id`** e usava `now() - 1 hora`, o que
quebra a idempotência por run. Agora escopa pelo início do run.

Menores: `search_path` fixado na função (lint do Supabase); `nullif(x, null)`
era no-op; o comentário sobre `sum()` retornar NULL estava invertido;
`bio_link_changed` dizia "mudou a bio" quando só o link mudou; a timeline não
mostrava páginas que ficaram ocultas.

## Regras que valem repetir

**`likes_count` é gravado CRU, com o `-1`.** A normalização mora nas views
(`nullif(likes_count, -1)`). Normalizar na ingestão perderia a distinção entre
"escondido" e "ausente" no dado bruto — e os testes em `lib/__tests__/`
travam essa direção.

**Views em post de imagem é ausência, não zero.** `video_*` fica NULL e a
célula aparece vazia.

**Semana 1 é toda `new`.** `v_tracking_readiness` distingue baseline de ativo,
e a tela mostra "baseline coletado, a comparação começa em X" em vez de um
delta falso de zero.

**Post fixado não é post da semana.** Fica fora dos eventos e das médias.

**Os números vêm da versão deslogada do Instagram** e podem ser menores do que
o que se vê logado. Conta privada não expõe engajamento.

## Setup

```bash
npm install
cp .env.example .env.local   # preencha as chaves
npm run dev
npm test
```

### Banco

```bash
supabase link --project-ref <ref>
supabase db push
```

Se a `0001` já está aplicada no seu Supabase, só a `0003` e a `0004` são
novas.

### Cadastrando concorrentes

A `0001` já semeia os 12 concorrentes com `website` e `instagram_handle`
nulos de propósito — preencher só depois de confirmar cada um. O ingest do
Instagram pula quem não tem handle.

```sql
update competitors
   set website = 'https://glean.com', instagram_handle = 'glean'
 where slug = 'glean';
```

### Disparo manual

```bash
curl -X POST http://localhost:3000/api/cron/weekly \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X POST http://localhost:3000/api/ingest/instagram \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"competitorSlug":"glean"}'
```

## Baseline e coleta ao vivo

**Baseline real.** `supabase/baseline/2026-10-01_baseline.sql` (rodar depois
das migrations) grava o ponto de partida verificado:

- site, LinkedIn e logo oficiais dos 12 concorrentes (logos em `public/logos/`);
- Instagram **só** de quem o site oficial linka: Glean (@gleanwork), Meuze
  (@meuzeai), Bond (@bondapp.io) e Strattum (@strattum.ai). Os outros 8 ficam
  "sem IG" — nenhum handle chutado;
- seguidores, seguidos, posts e engajamento médio desses 4, lidos no Social
  Blade em 01/10/2026. O histórico diário do Social Blade exige login, por
  isso a série começa nesse dia.

**O botão.** Com `LIVE_RUN` definido, o topo do dashboard ganha **Rodar
coleta**. Ele chama `POST /api/live/run`, que responde em NDJSON: a tabela
"baseline × hoje", as barras de variação e a série do concorrente em foco se
preenchem ao vivo, e no fim o feed e o placar recarregam.

- `LIVE_RUN=apify`: coleta real, pelo mesmo código do ingest semanal
  (`lib/instagram.ts`). Gasta crédito do Apify a cada clique (~US$ 0,12),
  sem intervalo mínimo entre runs.
- `LIVE_RUN=simulated`: plano B sem rede. Parte do baseline real e simula a
  captura de hoje, proporcional ao tempo decorrido. A tela mostra "simulado",
  e cada clique apaga a rodada anterior. Para limpar de vez:
  `supabase/demo/demo_cleanup.sql`.

A rota não pede `CRON_SECRET`, porque roda no browser: ligue `LIVE_RUN` só
para apresentar.

**Só os 4 com Instagram, mais a Hakutaku.** O dashboard, o placar, o feed, o
botão e o ingest mostram e coletam apenas Glean, Meuze, Bond e Strattum — e a
própria Hakutaku (@hakutakuai), marcada como "nós" no ranking para comparar
(`lib/tracked.ts`, migration `0007`). Os outros 8 continuam no banco; a
migration `0005` os marca como inativos.

**Competitor news.** A home mostra o que o Google acha de cada concorrente:
posts de blog, páginas novas do site, vagas e menções em outros sites
(`lib/news.ts`, actor `apify/google-search-scraper`). As buscas de cada
concorrente ficam em `lib/tracked.ts` (`NEWS_QUERIES`), calibradas para fugir
de homônimos. Roda na coleta semanal (`/api/ingest/news`), no botão
**Atualizar** da seção (com `LIVE_RUN=apify`, ~US$ 0,05 por clique) e em `npm run noticias`. Um run
por concorrente, em paralelo: ~3,5 min e ~US$ 0,05 na medição de 01/10/2026.
Precisa da migration `0006_competitor_news`.

**Pelo terminal.** A coleta do botão mora em `lib/live-collect.ts`, e
`npm run coleta` roda exatamente a mesma coisa (lê `.env.local`), imprimindo
cada passo. `npm run coleta -- simulated` usa o plano B. Na medição de
01/10/2026 os 4 perfis levaram ~3 min e custaram ~US$ 0,12 no Apify.
