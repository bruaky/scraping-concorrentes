import "server-only";

/**
 * Checagem de configuracao.
 *
 * Sem isso, faltar uma variavel de ambiente derruba o server component e o
 * Next mostra so um digest — um hash da mensagem, que nao diz nada a quem
 * esta olhando o site. A mensagem real fica no log da plataforma, que nem
 * sempre esta a mao. Entao a tela passa a dizer o que falta, pelo NOME da
 * variavel, nunca pelo valor.
 */

/** Sem estas, nenhuma pagina renderiza: e o client do Supabase que quebra. */
const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Sem estas o site abre, mas a coleta nao roda. */
const REQUIRED_FOR_INGEST = ["FIRECRAWL_API_KEY", "APIFY_TOKEN", "CRON_SECRET"] as const;

function missingFrom(names: readonly string[]): string[] {
  return names.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
}

export function missingEnv(): string[] {
  return missingFrom(REQUIRED);
}

export function missingIngestEnv(): string[] {
  return missingFrom(REQUIRED_FOR_INGEST);
}
