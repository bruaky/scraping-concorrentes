# hakutaku

Monitoramento semanal de concorrentes: varre o site (Firecrawl) e o Instagram
(Apify), guarda os dados brutos no Supabase e transforma as diferenças numa
timeline de eventos.

## As três telas

**Nível 1 — o que mudou essa semana.** É a tela que abre. Feed cronológico lendo
só `change_events`, com severidade por cor: preço e proposta de valor em
vermelho, vagas e mudança estrutural em amarelo, post e blog em cinza. Sem isso
o feed vira ruído em três semanas. A cor nunca aparece sozinha — vem sempre
colada ao rótulo do tipo.

**Nível 2 — placar comparativo.** Uma linha por concorrente, ordenável por
qualquer coluna: seguidores, Δ7d, posts, engajamento médio, ER %, blog 7d,
vagas, preço. Δ e ER são o que respondem "quem está acelerando".

**Nível 3 — drill-down.** Ao clicar num concorrente: métricas principais e uma
timeline única misturando web e Instagram no mesmo eixo de tempo. É aqui que
aparece a correlação que justifica o sistema — "mudaram o pricing na semana que
abriram 4 vagas de vendas".

O overview de todos os concorrentes (logo + nome, clicável) fica fixo no topo.

## Estrutura

```
app/
  page.tsx                     Níveis 1 e 2
  competitors/[slug]/page.tsx  Nível 3
  _components/                 rail, feed, placar, tiles
  api/
    cron/weekly/route.ts       disparado pelo Vercel Cron
    ingest/firecrawl/route.ts  scrape + changeTracking
    ingest/instagram/route.ts  perfil + posts
lib/
  supabase.ts       client service-role, SÓ server
  firecrawl.ts      scrape + changeTracking (git-diff e json)
  apify.ts          perfil + posts, com as coerções que importam
  extract.ts        schema de extração por tipo de página
  events.ts         detecção de mudança → change_events
  sources.ts        seleção de fontes
  format.ts         formatação (ausência nunca vira zero)
  __tests__/        24 testes das regras acima
supabase/migrations/
  0001_competitive_intel.sql   schema
  0002_scoreboard_view.sql     view do placar
```

## As regras que quebram o dashboard se ignoradas

Estão codificadas, não só documentadas — cada uma tem teste ou constraint.

**Engajamento precisa de denominador.** Curtida absoluta compara mal: quem tem
mais seguidores sempre vence. ER = (curtidas + comentários) ÷ seguidores, na
view `competitor_weekly_stats`.

**`likesCount = -1` não é zero.** É a conta escondendo curtidas. `lib/apify.ts`
normaliza para `null` na entrada, uma constraint no banco garante que -1 nunca
é gravado, e a view tira esses posts da média em vez de contá-los como zero —
senão a média despenca e lemos como queda de engajamento. O placar marca com
`*` quantos posts ficaram de fora.

**Views em post de imagem é ausência, não zero.** `video_play_count` e
`video_view_count` ficam `null`; a célula aparece vazia, nunca "0 views".

**Semana 1 é toda `new`.** A primeira captura de cada fonte é baseline e não
gera evento — um feed com 40 cards de "página nova" é ruído. Enquanto não
existe snapshot com 7+ dias, `has_comparison` é `false` e a tela mostra
"baseline coletado, a comparação começa dia X" em vez de um delta falso de zero.

**`changeStatus` ausente não é "não mudou".** O Firecrawl pode devolver sem
`changeTracking` quando dá timeout no lookup. Nesse caso `change_status` fica
`null`, o aviso vai para `tracking_warning` e nenhum evento é emitido.

**Post fixado não é post da semana.** Reaparece em toda coleta; fica fora dos
eventos e das médias.

**Os números vêm da versão deslogada do Instagram** e podem ser menores do que
o que se vê logado. Conta privada não expõe engajamento — quando `is_private`
vira `true`, isso é um evento crítico e a coleta para.

## Setup

```bash
npm install
cp .env.example .env.local   # preencha as chaves
npm run dev
npm test                     # regras de detecção e normalização
```

### Banco

```bash
supabase link --project-ref <ref>
supabase db push
```

RLS fica ligado em todas as tabelas **sem policy nenhuma** — só a service role
key (server-side) enxerga os dados.

### Cadastrando um concorrente

O `page_type` não é rótulo livre: ele decide a extração estruturada que pedimos
ao Firecrawl e a severidade do evento gerado.

```sql
insert into competitors (slug, name, website, instagram, logo_url)
values ('acme', 'Acme', 'https://acme.com', 'acme', null);

insert into sources (competitor_id, kind, target, page_type)
select id, 'website', 'https://acme.com',          'home'    from competitors where slug = 'acme'
union all
select id, 'website', 'https://acme.com/pricing',  'pricing' from competitors where slug = 'acme'
union all
select id, 'website', 'https://acme.com/blog',     'blog'    from competitors where slug = 'acme'
union all
select id, 'website', 'https://acme.com/careers',  'careers' from competitors where slug = 'acme'
union all
select id, 'instagram', 'acme',                    'other'   from competitors where slug = 'acme';
```

`logo_url` é opcional — sem ele a UI usa um monograma com as iniciais.

### Disparo manual

```bash
curl -X POST http://localhost:3000/api/cron/weekly \
  -H "Authorization: Bearer $CRON_SECRET"

# ou só um concorrente
curl -X POST http://localhost:3000/api/ingest/firecrawl \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"competitorSlug":"acme"}'
```

## Deploy na Vercel

Configure as variáveis do `.env.example` no projeto. A Vercel injeta
`CRON_SECRET` no header `Authorization` das chamadas agendadas — use o mesmo
valor. `APP_BASE_URL` é opcional em produção.
