import "server-only";

import { HttpError } from "./auth";
import { supabaseAdmin } from "./supabase";
import type { PageType, SourceKind } from "./database.types";

/**
 * Seleciona as fontes ativas de um tipo, opcionalmente filtradas.
 *
 * O slug e resolvido numa query propria em vez de `competitors!inner(slug)`:
 * o join embutido do postgrest-js so tipa com a tabela de Relationships
 * completa, e declarar relacionamentos a mao e mais fragil do que uma segunda
 * consulta barata.
 */
export type SourceRow = {
  id: string;
  competitor_id: string;
  target: string;
  page_type: PageType;
};

export async function activeSources(
  kind: SourceKind,
  filter: { competitorSlug?: string; sourceIds?: string[] } = {},
): Promise<SourceRow[]> {
  const db = supabaseAdmin();

  let query = db
    .from("sources")
    .select("id, competitor_id, target, page_type")
    .eq("kind", kind)
    .eq("is_active", true);

  if (filter.competitorSlug) {
    const { data: competitor, error } = await db
      .from("competitors")
      .select("id")
      .eq("slug", filter.competitorSlug)
      .maybeSingle();

    if (error) throw new Error(`Falha ao resolver o slug: ${error.message}`);
    if (!competitor) throw new HttpError(404, `concorrente "${filter.competitorSlug}" nao existe`);

    query = query.eq("competitor_id", competitor.id);
  }

  if (filter.sourceIds?.length) query = query.in("id", filter.sourceIds);

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao listar sources: ${error.message}`);

  return data ?? [];
}
