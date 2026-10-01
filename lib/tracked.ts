/**
 * Concorrentes que o dashboard mostra e que a coleta busca: os 4 com
 * Instagram oficial confirmado (ver supabase/baseline/2026-10-01_baseline.sql).
 * Os outros 8 continuam cadastrados no banco, mas ficam fora da tela.
 *
 * Fica no codigo, e nao so em competitors.is_active, para a tela valer mesmo
 * antes de a migration 0005 rodar no banco.
 */
export const TRACKED_SLUGS = ["glean", "meuze", "bond", "strattum"];

export function isTracked(slug: string): boolean {
  return TRACKED_SLUGS.includes(slug);
}
