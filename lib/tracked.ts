/**
 * Concorrentes que o dashboard mostra e que a coleta busca: os 4 com
 * Instagram oficial confirmado (ver supabase/baseline/2026-10-01_baseline.sql).
 * Os outros 8 continuam cadastrados no banco, mas ficam fora da tela.
 *
 * O handle do Instagram mora AQUI, nao so em competitors.instagram_handle:
 * a coleta (botao, script e ingest semanal) busca sempre estes perfis, mesmo
 * que o banco esteja sem o handle ou com um valor errado. Conferidos em
 * 01/10/2026 contra os perfis e numa coleta real no Apify.
 */
export const TRACKED = [
  { slug: "glean", instagram: "gleanwork" }, // https://www.instagram.com/gleanwork/
  { slug: "meuze", instagram: "meuzeai" }, // https://www.instagram.com/meuzeai/
  { slug: "bond", instagram: "bondapp.io" }, // https://www.instagram.com/bondapp.io/
  { slug: "strattum", instagram: "strattum.ai" }, // https://www.instagram.com/strattum.ai/
] as const;

export const TRACKED_SLUGS: string[] = TRACKED.map((t) => t.slug);

export function isTracked(slug: string): boolean {
  return TRACKED_SLUGS.includes(slug);
}

/** Handle salvo para o concorrente; null se ele nao e acompanhado. */
export function instagramHandle(slug: string): string | null {
  return TRACKED.find((t) => t.slug === slug)?.instagram ?? null;
}
