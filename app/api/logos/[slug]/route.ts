import { TRACKED } from "@/lib/tracked";

/**
 * GET /api/logos/<slug> — o logo do concorrente.
 *
 * Redireciona para o arquivo em public/logos/, que a Vercel serve direto da
 * CDN. Concorrente fora de lib/tracked.ts e 404 (a tela cai nas iniciais).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const logo = TRACKED.find((t) => t.slug === slug)?.logo;
  if (!logo) return new Response("Not found", { status: 404 });

  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(logo, req.url).toString(),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
