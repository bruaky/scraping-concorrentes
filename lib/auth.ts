import "server-only";

/**
 * As rotas de cron/ingest sao publicas na internet, entao exigem um bearer
 * token. A Vercel manda `Authorization: Bearer $CRON_SECRET` nas chamadas
 * agendadas, e usamos o mesmo segredo pra disparos manuais.
 */
export function assertAuthorized(req: Request): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw new HttpError(500, "CRON_SECRET nao configurada");

  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${expected}`) throw new HttpError(401, "nao autorizado");
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Converte qualquer erro numa resposta JSON com o status certo. */
export function errorResponse(err: unknown): Response {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ ok: false, error: message }, { status });
}
