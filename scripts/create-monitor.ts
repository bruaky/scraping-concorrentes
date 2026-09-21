/**
 * Cria (ou atualiza) o Firecrawl Monitor.
 *
 *   npm run monitor:setup
 *
 * O Monitor cumpre dois papeis:
 *   1. manda o e-mail semanal com os diffs, para voce ser avisado sem abrir
 *      a dashboard;
 *   2. ao terminar cada verificacao, chama o nosso webhook, que dispara a
 *      coleta que persiste no Supabase.
 *
 * A lista de concorrentes vem do banco, nao esta escrita aqui: adicionar um
 * concorrente em `competitors` e rodar isto de novo basta para ele entrar no
 * monitoramento.
 *
 * AUTENTICACAO: a doc do Monitor nao descreve assinatura de webhook; o que
 * existe e `notification.webhook.headers`. Por isso mandamos o bearer.
 * Rotacionar o segredo exige rodar este script de novo.
 */
import { createClient } from "@supabase/supabase-js";
import { Firecrawl } from "firecrawl";

const MONITOR_NAME = "Competitive intel — páginas dos concorrentes";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao definida (ver .env.example)`);
  return value;
}

/** Agrupa em lotes, para não estourar o tamanho de cada query de busca. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("name")
    .eq("is_active", true)
    .order("name");

  if (error) throw new Error(`Falha ao ler concorrentes: ${error.message}`);
  if (!competitors?.length) throw new Error("Nenhum concorrente ativo cadastrado.");

  const names = competitors.map((c) => c.name as string);
  console.log(`${names.length} concorrentes: ${names.join(", ")}`);

  // Nomes com espaço entram entre aspas para a busca não quebrá-los em dois.
  const queries = chunk(names, 3).map(
    (group) =>
      `${group.map((n) => (n.includes(" ") ? `'${n}'` : n)).join(" OR ")} pricing blog careers`,
  );

  const webhookUrl = `${env("APP_BASE_URL").replace(/\/+$/, "")}/api/webhooks/firecrawl-monitor`;
  const secret = process.env.FIRECRAWL_WEBHOOK_SECRET ?? env("CRON_SECRET");

  const config = {
    name: MONITOR_NAME,
    goal: [
      `- Alertar quando páginas de preço, blog ou vagas mudarem para: ${names.join(", ")}.`,
      "- Em preço, acompanhar nome do plano, valor e ciclo de cobrança.",
      "- Em blog e vagas, alertar sobre posts novos e vagas novas.",
    ].join("\n"),
    schedule: { cron: "0 9 * * 0", timezone: "UTC" },
    targets: [{ type: "search" as const, queries, sources: ["web"], maxResults: 10 }],
    notification: {
      email: {
        enabled: true,
        includeDiffs: true,
        recipients: [env("MONITOR_EMAIL")],
      },
      webhook: {
        url: webhookUrl,
        headers: { Authorization: `Bearer ${secret}` },
        // Só a reconciliação final dispara a coleta; monitor.page chega uma
        // vez por página e dispararia a coleta N vezes.
        events: ["monitor.check.completed"],
      },
    },
  };

  const app = new Firecrawl({ apiKey: env("FIRECRAWL_API_KEY") });

  // Idempotente: um monitor com este nome é atualizado, não duplicado.
  // O SDK pode devolver o array direto ou embrulhado; tratamos os dois.
  const existing: unknown = await app.listMonitors();
  const list = (
    Array.isArray(existing) ? existing : ((existing as { monitors?: unknown })?.monitors ?? [])
  ) as Array<{ id: string; name?: string }>;
  const match = list.find((m) => m.name === MONITOR_NAME);

  if (match) {
    await app.updateMonitor(match.id, config);
    console.log(`Monitor atualizado: ${match.id}`);
  } else {
    const monitor = await app.createMonitor(config);
    console.log(`Monitor criado: ${monitor.id}`);
  }

  console.log(`Webhook: ${webhookUrl}`);
  console.log(`Queries: ${queries.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
