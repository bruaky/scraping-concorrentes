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
  // Nos mesmos, no ranking para comparar. https://www.instagram.com/hakutakuai/
  // (linkado por https://hakutaku.ai/, e o perfil linka de volta).
  { slug: "hakutaku", instagram: "hakutakuai", logo: "/logos/hakutaku.png" },
] as const;

/** A propria Hakutaku: aparece no ranking marcada como "nos". */
export const SELF_SLUG = "hakutaku";

export function isSelf(slug: string): boolean {
  return slug === SELF_SLUG;
}

export const TRACKED_SLUGS: string[] = TRACKED.map((t) => t.slug);

export function isTracked(slug: string): boolean {
  return TRACKED_SLUGS.includes(slug);
}

/** Handle salvo para o concorrente; null se ele nao e acompanhado. */
export function instagramHandle(slug: string): string | null {
  return TRACKED.find((t) => t.slug === slug)?.instagram ?? null;
}

/**
 * Logo do concorrente: o do banco ou, sem ele, a rota /api/logos/<slug>, que
 * aponta para o arquivo salvo em public/logos/. Sem isso, um banco sem o
 * baseline aplicado mostra so as iniciais.
 */
export function logoUrl(slug: string, fromDb: string | null | undefined): string | null {
  if (fromDb) return fromDb;
  return isTracked(slug) ? `/api/logos/${slug}` : null;
}

export type NewsQuery = { kind: "blog" | "site" | "job" | "mention"; query: string };

/**
 * Buscas no Google que alimentam "Competitor news" (lib/news.ts).
 *
 * Calibradas numa coleta real em 01/10/2026. O nome sozinho traz ruido —
 * "Strattum" devolve dicionario de "stratum", "Meuze" devolve a meuze.com
 * (outra empresa) — entao mencao e vaga vao pelo dominio ou pelo nome
 * composto, e quem nao tem pagina de vagas indexada fica sem busca de vaga.
 */
export const NEWS_QUERIES: Record<string, NewsQuery[]> = {
  glean: [
    { kind: "blog", query: "site:glean.com/blog" },
    { kind: "job", query: "site:job-boards.greenhouse.io/gleanwork" },
    { kind: "mention", query: '"Glean" "Work AI" -site:glean.com' },
  ],
  meuze: [
    { kind: "site", query: "site:meuze.ai" },
    { kind: "mention", query: '"meuze.ai" -site:meuze.ai' },
  ],
  bond: [
    { kind: "site", query: "site:bondapp.io" },
    { kind: "mention", query: '"Bond (YC X25)" OR "bondapp.io" -site:bondapp.io' },
  ],
  strattum: [
    { kind: "site", query: "site:strattum.ai" },
    { kind: "mention", query: '"strattum.ai" -site:strattum.ai' },
  ],
  hakutaku: [
    { kind: "site", query: "site:hakutaku.ai" },
    { kind: "mention", query: '"hakutaku.ai" OR "Hakutaku AI" -site:hakutaku.ai' },
  ],
};

/**
 * Mencao so entra se o titulo, o trecho ou a url citar um destes termos —
 * o Google as vezes ignora as aspas. "meuze" sozinho pega a meuze.com,
 * outra empresa; por isso a Meuze exige o dominio.
 */
export const NEWS_KEYWORDS: Record<string, string[]> = {
  glean: ["glean"],
  meuze: ["meuze.ai", "meuze ai"],
  bond: ["bond"],
  strattum: ["strattum"],
  hakutaku: ["hakutaku"],
};
