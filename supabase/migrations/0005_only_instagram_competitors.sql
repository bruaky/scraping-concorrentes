-- ============================================================
-- Só os 4 concorrentes com Instagram oficial confirmado ficam ativos
-- ============================================================
-- Glean, Meuze, Bond e Strattum. Os outros 8 continuam cadastrados (com
-- site, LinkedIn e logo do baseline), só saem do dashboard, do placar e do
-- ingest. Para voltar um deles: update competitors set is_active = true
-- where slug = '...'.
-- O app também filtra por lib/tracked.ts, então a tela já fica certa antes
-- desta migration rodar.

update competitors
   set is_active  = slug in ('glean', 'meuze', 'bond', 'strattum'),
       updated_at = now();
