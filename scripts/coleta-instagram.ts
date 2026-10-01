/**
 * Roda no terminal a mesma coleta do botao "Rodar coleta":
 *
 *   npm run coleta              # coleta real no Apify (padrao)
 *   npm run coleta -- simulated # plano B, sem credito
 *
 * Le SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e APIFY_TOKEN do ambiente ou do
 * .env.local. Busca Glean, Meuze, Bond e Strattum (lib/tracked.ts), grava
 * snapshot + posts + metricas, gera os alertas e imprime cada passo. Custa
 * ~US$ 0,12 e leva ~3 min para os 4 (medido em 01/10/2026). Respeita o mesmo
 * intervalo de 2 min entre runs que o botao.
 */
import { runLiveCollection, type CollectStep } from "../lib/live-collect";

async function main() {
  const mode = process.argv[2] === "simulated" ? "simulated" : "apify";
  let failed = false;

  const print = (step: CollectStep) => {
    switch (step.type) {
      case "start":
        console.log(`run ${step.runId} · ${(step.competitors as unknown[]).length} perfis · ${mode}`);
        break;
      case "fetching":
        console.log(`› ${step.name} (@${step.handle})…`);
        break;
      case "result": {
        const prev = step.previous as { followers: number | null };
        const curr = step.current as { followers: number; posts: number; newPosts: number };
        console.log(
          `✓ ${step.name}: ${prev.followers ?? "—"} → ${curr.followers} seguidores · ${curr.posts} posts` +
            (curr.newPosts ? ` (+${curr.newPosts})` : ""),
        );
        break;
      }
      case "failed":
        failed = true;
        console.error(`! ${step.name}: ${step.error}`);
        break;
      case "events:start":
        console.log("› gerando alertas…");
        break;
      case "done":
        console.log(
          `✓ ${step.ok} ok, ${step.failed} falha(s), ${step.events} alerta(s) · ${(Number(step.ms) / 1000).toFixed(1)} s`,
        );
        break;
      case "error":
        failed = true;
        console.error(`erro: ${step.error}`);
        break;
    }
  };

  await runLiveCollection(mode, print);
  process.exitCode = failed ? 1 : 0;
}

main();
