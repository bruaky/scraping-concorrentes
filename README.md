# hakutaku-ci

Monitoramento semanal de concorrentes: varre o site (Firecrawl) e o Instagram
(Apify), guarda snapshots no Supabase e transforma as diferenças numa timeline
de eventos.

## Estrutura

```
app/
  page.tsx                     dashboard (server component, lê o Supabase)
  competitors/[slug]/page.tsx  timeline de um concorrente
  api/
    cron/weekly/route.ts       disparado pelo Vercel Cron
    ingest/firecrawl/route.ts  scrape dos sites + changeTracking
    ingest/instagram/route.ts  perfil + posts via Apify
lib/
  supabase.ts                  client service-role, SÓ server
  firecrawl.ts                 scrape + changeTracking
  apify.ts                     details + posts
  events.ts                    gera change_events
  auth.ts                      bearer guard das rotas de cron/ingest
  database.types.ts            tipos do schema
supabase/migrations/
  0001_competitive_intel.sql   schema
vercel.json                    schedule do cron
.env.example
```

## Como funciona

1. **Cron semanal** (`vercel.json`, segunda 09:00 UTC) chama `/api/cron/weekly`.
2. A rota abre uma `run` por tipo de fonte e chama as rotas de ingest.
3. Cada ingest captura um `snapshot` por `source` e compara com o anterior:
   - **site**: usa o `changeTracking` do Firecrawl (git-diff); se não vier,
     compara `content_hash`.
   - **instagram**: compara posts vistos, bio/link/nome e seguidores.
4. `lib/events.ts` grava `change_events` com `dedupe_key` — rodar duas vezes na
   mesma semana não duplica a timeline.
5. O dashboard lê `change_events` direto do Supabase no server.

## Setup

```bash
npm install
cp .env.example .env.local   # preencha as chaves
npm run dev
```

### Banco

Aplique a migration no seu projeto Supabase:

```bash
supabase link --project-ref <ref>
supabase db push
```

RLS fica ligado em todas as tabelas **sem policy nenhuma** — só a service role
key (server-side) enxerga os dados.

### Cadastrando um concorrente

```sql
insert into competitors (slug, name, website, instagram)
values ('acme', 'Acme', 'https://acme.com', 'acme');

insert into sources (competitor_id, kind, target, label)
select id, 'website', 'https://acme.com/pricing', 'pricing' from competitors where slug = 'acme'
union all
select id, 'website', 'https://acme.com', 'home' from competitors where slug = 'acme'
union all
select id, 'instagram', 'acme', null from competitors where slug = 'acme';
```

O `label` contendo `pricing` faz o evento virar `pricing_changed` com
severidade alta.

### Disparo manual

```bash
curl -X POST http://localhost:3000/api/cron/weekly \
  -H "Authorization: Bearer $CRON_SECRET"

# ou só uma parte
curl -X POST http://localhost:3000/api/ingest/firecrawl \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"competitorSlug":"acme"}'
```

## Deploy na Vercel

Configure as variáveis do `.env.example` no projeto. A Vercel injeta
`CRON_SECRET` no header `Authorization` das chamadas agendadas — use o mesmo
valor. `APP_BASE_URL` é opcional em produção (cai em `VERCEL_PROJECT_PRODUCTION_URL`).
