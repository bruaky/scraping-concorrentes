import { Panel } from "./panel";
import type { Connection } from "@/lib/dashboard-data";

/**
 * Estados de ausencia.
 *
 * "Nao conectada" e diferente de "—". O travessao quer dizer "a fonte esta
 * ligada e este numero e desconhecido"; nao conectada quer dizer "nao existe
 * de onde ler". Confundir os dois faz um concorrente sem Instagram parecer um
 * concorrente com engajamento zero.
 *
 * Nenhum dos dois usa cor de status: vermelho e amarelo estao reservados para
 * preco e mudanca estrutural no feed. Ausencia e tinta neutra.
 */

/** Dentro de uma celula de tabela ou de um tile. */
export function NotConnected({ what }: { what?: string }) {
  return (
    <span
      className="text-xs text-muted"
      title={
        what
          ? `${what} não conectada para este concorrente`
          : "Fonte não conectada para este concorrente"
      }
    >
      não conectada
    </span>
  );
}

/** No lugar de uma secao inteira. */
export function SectionNotConnected({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-ink-2">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>
    </div>
  );
}

/**
 * Aviso no topo. Nao substitui a tela: o resto renderiza abaixo, em modo
 * desconectado, para dar para ver a estrutura antes de ligar as fontes.
 */
export function ConnectionBanner({ connection }: { connection: Connection }) {
  if (connection.status === "ok") return null;

  if (connection.status === "query_failed") {
    return (
      <Panel title="O banco recusou a consulta">
        <p className="text-sm text-ink-2">
          As credenciais estão configuradas, mas o Supabase respondeu com erro. Normalmente é a
          service role key errada, ou as migrations ainda não aplicadas neste projeto.
        </p>
        <ul className="mt-3 space-y-1">
          {connection.errors.map((message) => (
            <li key={message} className="font-mono text-sm text-critical">
              {message}
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  return (
    <Panel title="Nenhuma fonte conectada">
      <p className="text-sm text-ink">
        O site está no ar e a estrutura toda aparece abaixo. Não há de onde ler dado ainda.
      </p>

      <p className="mt-4 text-sm text-ink-2">Faltam estas variáveis de ambiente:</p>
      <ul className="mt-2 space-y-1">
        {connection.missing.map((name) => (
          <li key={name} className="font-mono text-sm text-ink">
            {name}
          </li>
        ))}
      </ul>

      {connection.missingIngest.length > 0 ? (
        <>
          <p className="mt-5 text-sm text-ink-2">E estas, para a coleta rodar:</p>
          <ul className="mt-2 space-y-1">
            {connection.missingIngest.map((name) => (
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
