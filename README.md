# hakutaku

Inteligência competitiva: varre as páginas dos concorrentes (Firecrawl) e o
Instagram (Apify), guarda tudo no Supabase e transforma as diferenças numa
timeline de eventos.

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
Firecrawl Monitor  ──webhook──┐
(agenda + e-mail com diffs)   │
                              ▼
Vercel Cron ──────────►  /api/ingest/*  ──►  Supabase  ──►  views  ──►  dashboard
(rede de segurança)      grava dados crus      │
                                               └──► fn_generate_change_events(run_id)
```

O Monitor agenda e manda o e-mail; quando termina uma verificação, chama
`/api/webhooks/firecrawl-monitor`, que dispara a nossa coleta. Os targets do
Monitor são queries de busca, não as URLs de `tracked_pages` — por isso ele é
o gatilho, e quem coleta continua sendo o nosso ingest, que é o que sustenta
placar e timeline.

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
    ingest/firecrawl/route.ts           tracked_pages → page_scrapes/diffs/fields
    ingest/instagram/route.ts           perfil + posts + métricas
    webhooks/firecrawl-monitor/route.ts gatilho do Monitor
lib/
  supabase.ts       client service-role, SÓ server
  firecrawl.ts      scrape configurado por tracked_pages
  apify.ts          perfil + posts, valores CRUS
  runs.ts           collection_runs + fn_generate_change_events
  pipeline.ts       orquestra as rotas de ingest
  format.ts         formatação (ausência nunca vira zero)
scripts/
  create-monitor.ts npm run monitor:setup
supabase/migrations/
  0001_competitive_intel.sql  schema (verbatim, como aplicado)
  0002_dashboard_views.sql    views + fn_generate_change_events (verbatim)
  0003_dashboard_fixes.sql    correções — ver abaixo
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

## Três estados, nunca confundidos

A tela **sempre renderiza**. Falta de credencial, consulta recusada ou fonte
não cadastrada não derrubam a página — cada uma vira um estado que a UI
declara. Um painel que morre inteiro não diz onde está o buraco; um painel que
diz "fonte não conectada" naquela célula, diz.

| Estado | O que significa | Como aparece |
|---|---|---|
| **não conectada** | não existe de onde ler | `não conectada`, em tinta neutra |
| **baseline** | fonte ligada, coletou uma vez, sem com o que comparar | `baseline` |
| **desconhecido** | fonte ligada e coletada, este número não veio | `—` |

Confundir os dois primeiros com o terceiro é o que faz um concorrente sem
Instagram parecer um concorrente com engajamento zero.

"Não conectada" se aplica em dois níveis:

- **Infra**: sem `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, a estrutura toda
  aparece e o topo lista o que falta, pelo nome da variável, nunca pelo valor.
- **Por concorrente**: sem `instagram_handle`, as colunas sociais são
  não conectadas; sem linha ativa em `tracked_pages`, as colunas de web são.
  Os 12 concorrentes semeados nascem assim de propósito.

Nenhum desses estados usa cor de status: vermelho e amarelo estão reservados
para preço e mudança estrutural no feed. Ausência é tinta neutra.

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

**`change_status` nulo não é "não mudou".** Quando o Firecrawl não consegue
comparar, o aviso vai para `page_scrapes.warning` e nenhum evento é emitido.

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

Se a `0001` já está aplicada no seu Supabase, só a `0003` é nova.

### Cadastrando páginas

A `0001` já semeia os 12 concorrentes com `website` e `instagram_handle`
nulos de propósito — preencher só depois de confirmar cada um. O ingest do
Instagram pula quem não tem handle.

```sql
update competitors
   set website = 'https://glean.com', instagram_handle = 'glean'
 where slug = 'glean';

insert into tracked_pages (competitor_id, url, page_type, diff_modes,
                           extraction_prompt, extraction_schema)
select id, 'https://glean.com/pricing', 'pricing', '{git-diff,json}',
       'Extraia o valor mensal de cada plano.',
       '{"type":"object","properties":{
           "starter_price":{"type":["string","null"]},
           "pro_price":{"type":["string","null"]},
           "billing_cycle":{"type":["string","null"]}}}'::jsonb
from competitors where slug = 'glean';
```

O schema de extração deve ser **plano**: cada campo escalar vira uma linha em
`page_field_changes`, e o modo json do changeTracking entrega
`previous`/`current` por campo. Para `careers`, use o campo
`open_roles_count` — é o que o placar lê.

### Firecrawl Monitor

```bash
npm run monitor:setup
```

Lê a lista de concorrentes do banco, cria (ou atualiza) o monitor com e-mail
semanal e aponta o webhook para `/api/webhooks/firecrawl-monitor`. Rodar de
novo depois de adicionar um concorrente.

### Disparo manual

```bash
curl -X POST http://localhost:3000/api/cron/weekly \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X POST http://localhost:3000/api/ingest/firecrawl \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"competitorSlug":"glean"}'
```
