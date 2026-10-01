/**
 * Atualiza "Competitor news" pelo terminal — o mesmo que a coleta semanal e
 * o botao Atualizar da home fazem:
 *
 *   npm run noticias
 *
 * Le SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e APIFY_TOKEN do ambiente ou do
 * .env.local. Um run do Google por concorrente, em paralelo (~1-2 min,
 * ~US$ 0,05).
 */
import { collectNews } from "../lib/news";

async function main() {
  const { runId, results } = await collectNews("news_cli");
  console.log(`run ${runId}`);
  for (const r of results) {
    console.log(r.ok ? `✓ ${r.name}: ${r.found} achada(s), ${r.fresh} nova(s)` : `! ${r.name}: ${r.error}`);
  }
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main().catch((err) => {
  console.error(`erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
