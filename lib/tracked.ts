/**
 * Concorrentes que o dashboard mostra e que a coleta busca: os 4 com
 * Instagram oficial confirmado (ver supabase/baseline/2026-10-01_baseline.sql).
 * Os outros 8 continuam cadastrados no banco, mas ficam fora da tela.
 *
 * O handle do Instagram e o logo moram AQUI, nao so no banco
 * (competitors.instagram_handle / logo_url):
 * a coleta (botao, script e ingest semanal) busca sempre estes perfis, mesmo
 * que o banco esteja sem o handle ou com um valor errado. Conferidos em
 * 01/10/2026 contra os perfis e numa coleta real no Apify.
 */
export const TRACKED = [
  // https://www.instagram.com/gleanwork/
  { slug: "glean", instagram: "gleanwork", logo: "/logos/glean.png" },
  // https://www.instagram.com/meuzeai/
  { slug: "meuze", instagram: "meuzeai", logo: "/logos/meuze.png" },
  // https://www.instagram.com/bondapp.io/
  { slug: "bond", instagram: "bondapp.io", logo: "/logos/bond.png" },
  // https://www.instagram.com/strattum.ai/
  { slug: "strattum", instagram: "strattum.ai", logo: "/logos/strattum.svg" },
] as const;

export const TRACKED_SLUGS: string[] = TRACKED.map((t) => t.slug);

export function isTracked(slug: string): boolean {
  return TRACKED_SLUGS.includes(slug);
}

/** Handle salvo para o concorrente; null se ele nao e acompanhado. */
export function instagramHandle(slug: string): string | null {
  return TRACKED.find((t) => t.slug === slug)?.instagram ?? null;
}

/**
 * Logo do concorrente: o do banco, ou o salvo aqui (public/logos/). Sem isso,
 * um banco sem o baseline aplicado mostra so as iniciais.
 */
export function logoUrl(slug: string, fromDb: string | null | undefined): string | null {
  return fromDb || TRACKED.find((t) => t.slug === slug)?.logo || null;
}
