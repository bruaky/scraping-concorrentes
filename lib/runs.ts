import "server-only";

import { supabaseAdmin } from "./supabase";
import type { RunStatus, Source } from "./database.types";

/**
 * Abertura e fechamento de `collection_runs`.
 *
 * Todo ingest roda dentro de um run: e o run_id que amarra scrapes,
 * snapshots e metricas, e e ele que `fn_generate_change_events` recebe para
 * decidir o que vira alerta.
 */
export async function openRun(source: Source, job: string): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("collection_runs")
    .insert({ source, job, status: "running" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Falha ao abrir run: ${error?.message ?? "sem retorno"}`);
  }

  return data.id;
}

export async function closeRun(
  runId: string,
  result: { ok: number; failed: number; creditsUsed?: number | null; error?: string | null },
): Promise<void> {
  // 'partial' existe para o caso comum: algumas fontes passaram, outras nao.
  // Marcar isso como 'success' esconderia buraco no dado.
  const status: RunStatus = result.error
    ? "failed"
    : result.failed === 0
      ? "success"
      : result.ok === 0
        ? "failed"
        : "partial";

  await supabaseAdmin()
    .from("collection_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      items_ok: result.ok,
      items_failed: result.failed,
      credits_used: result.creditsUsed ?? null,
      error: result.error ?? null,
    })
    .eq("id", runId);
}

/**
 * Gera os change_events do run. A decisao do que vira alerta mora em SQL
 * (fn_generate_change_events), perto dos dados — a aplicacao so dispara.
 */
export async function generateEvents(runId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("fn_generate_change_events", {
    p_run_id: runId,
  });

  if (error) throw new Error(`Falha ao gerar eventos: ${error.message}`);
  return data ?? 0;
}
