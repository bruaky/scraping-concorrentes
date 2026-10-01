import "server-only";

import { supabaseAdmin } from "./supabase";
import { TRACKED, isSelf } from "./tracked";

/**
 * Cadastra no banco quem esta em lib/tracked.ts e ainda nao existe em
 * `competitors` — hoje, a Hakutaku quando a migration 0007 nao rodou.
 *
 * Chamado no inicio de toda coleta (botao, script, ingest semanal), para a
 * lista do codigo valer sem depender de alguem rodar SQL. So INSERE quem
 * falta: quem ja existe nao e tocado (nem reativado, se alguem desligou).
 * Sem baseline: a primeira coleta vira o ponto de partida.
 */
export async function ensureTrackedCompetitors(): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("competitors")
    .select("slug")
    .in(
      "slug",
      TRACKED.map((t) => t.slug),
    );
  if (error) throw new Error(`Falha ao conferir concorrentes: ${error.message}`);

  const known = new Set((data ?? []).map((c) => c.slug));
  const missing = TRACKED.filter((t) => !known.has(t.slug));
  if (missing.length === 0) return [];

  const { error: insertError } = await db.from("competitors").insert(
    missing.map((t) => ({
      name: t.name,
      slug: t.slug,
      website: t.website,
      instagram_handle: t.instagram,
      logo_url: t.logo,
      category: isSelf(t.slug) ? "nós · gestão de conhecimento com IA" : null,
      is_active: true,
    })),
  );
  if (insertError) throw new Error(`Falha ao cadastrar ${missing.map((t) => t.name).join(", ")}: ${insertError.message}`);

  return missing.map((t) => t.slug);
}
