import { TRACKED } from "@/lib/tracked";

/**
 * GET /api/logos — os logos dos concorrentes acompanhados.
 *
 * Os arquivos ficam em public/logos/ e sobem com o deploy da Vercel; esta
 * rota so diz qual e de quem. A imagem de cada um sai em /api/logos/<slug>.
 */
export function GET(): Response {
  return Response.json(
    TRACKED.map((t) => ({
      slug: t.slug,
      instagram: t.instagram,
      logo: `/api/logos/${t.slug}`,
      file: t.logo,
    })),
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
