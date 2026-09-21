import { Panel } from "./panel";

/**
 * Estado de configuracao incompleta.
 *
 * Mostra o NOME das variaveis que faltam, nunca o valor de nenhuma — a pagina
 * e publica ate alguem colocar autenticacao na frente.
 */
export function SetupNeeded({
  missing,
  missingIngest,
}: {
  missing: string[];
  missingIngest: string[];
}) {
  return (
    <Panel title="Configuração incompleta">
      <p className="text-sm text-ink">
        O app subiu, mas não consegue falar com o Supabase.
      </p>

      <p className="mt-4 text-sm text-ink-2">
        Faltam estas variáveis de ambiente:
      </p>
      <ul className="mt-2 space-y-1">
        {missing.map((name) => (
          <li key={name} className="font-mono text-sm text-critical">
            {name}
          </li>
        ))}
      </ul>

      {missingIngest.length > 0 ? (
        <>
          <p className="mt-5 text-sm text-ink-2">
            E estas, para a coleta rodar (o site abre sem elas):
          </p>
          <ul className="mt-2 space-y-1">
            {missingIngest.map((name) => (
              <li key={name} className="font-mono text-sm text-muted">
                {name}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-5 text-sm text-muted">
        Na Vercel: <span className="text-ink-2">Project Settings → Environment Variables</span>,
        marcando Production, e depois um redeploy — variável nova não entra num deploy já feito.
        Localmente: <code>.env.local</code>, a partir do <code>.env.example</code>.
      </p>
    </Panel>
  );
}
