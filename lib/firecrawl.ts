import "server-only";

import type { ChangeStatus, PageType } from "./database.types";
import { specFor } from "./extract";

/**
 * Wrapper fino sobre a API v2 do Firecrawl.
 *
 * Pedimos tres coisas por scrape:
 *   markdown         — corpo da pagina, guardado pra auditoria
 *   json             — extracao estruturada por page_type (ver lib/extract.ts)
 *   changeTracking   — git-diff (o bloco do card, e de onde saem posts novos)
 *                      + json (previous/current por campo: preco antes → depois)
 *
 * Docs: https://docs.firecrawl.dev/features/change-tracking
 */

const DEFAULT_API_URL = "https://api.firecrawl.dev";

export type FieldDiff<T = unknown> = { previous: T | null; current: T | null };

export type ChangeTracking = {
  /**
   * null = o Firecrawl NAO conseguiu comparar (timeout no lookup, ver
   * `warning`). Isso e "desconhecido", nunca "same" — tratar como ausente.
   */
  changeStatus: ChangeStatus | null;
  visibility: "visible" | "hidden" | null;
  previousScrapeAt: string | null;
  diffText: string | null;
  diffJson: unknown | null;
  /** { campo: { previous, current } } do modo json. */
  fields: Record<string, FieldDiff> | null;
};

export type Scrape = {
  url: string;
  markdown: string;
  title: string | null;
  description: string | null;
  statusCode: number | null;
  extracted: unknown | null;
  tracking: ChangeTracking;
  /** Aviso do Firecrawl (ex.: changeTracking indisponivel nesta chamada). */
  warning: string | null;
  raw: unknown;
};

function apiUrl(path: string): string {
  const base = process.env.FIRECRAWL_API_URL?.replace(/\/+$/, "") ?? DEFAULT_API_URL;
  return `${base}${path}`;
}

function apiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY nao definida (ver .env.example)");
  return key;
}

const VALID_STATUS: readonly string[] = ["new", "same", "changed", "removed"];

/**
 * Faz o scrape de uma URL.
 *
 * `tag` isola o historico do changeTracking por source — duas fontes na mesma
 * URL nao se atrapalham.
 */
export async function scrape(
  url: string,
  opts: { pageType?: PageType; tag?: string; timeoutMs?: number } = {},
): Promise<Scrape> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const spec = opts.pageType ? specFor(opts.pageType) : null;

  const formats: unknown[] = ["markdown"];
  if (spec) {
    formats.push({ type: "json", prompt: spec.prompt, schema: spec.schema });
  }
  formats.push({
    type: "changeTracking",
    // O modo json so faz sentido com schema; sem ele, so git-diff.
    modes: spec ? ["git-diff", "json"] : ["git-diff"],
    ...(spec ? { prompt: spec.prompt, schema: spec.schema } : {}),
    ...(opts.tag ? { tag: opts.tag } : {}),
  });

  const res = await fetch(apiUrl("/v2/scrape"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats, onlyMainContent: true, timeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 15_000),
  });

  const body = (await res.json()) as {
    success?: boolean;
    error?: string;
    warning?: string;
    data?: {
      markdown?: string;
      json?: unknown;
      warning?: string;
      changeTracking?: {
        changeStatus?: string;
        visibility?: string;
        previousScrapeAt?: string | null;
        diff?: { text?: string; json?: unknown } | null;
        json?: Record<string, FieldDiff> | null;
      };
      metadata?: {
        title?: string;
        description?: string;
        statusCode?: number;
        sourceURL?: string;
      };
    };
  };

  if (!res.ok || !body.success || !body.data) {
    throw new Error(
      `Firecrawl falhou em ${url}: ${res.status} ${body.error ?? "sem detalhe"}`,
    );
  }

  const data = body.data;
  const ct = data.changeTracking;
  const warning = data.warning ?? body.warning ?? null;

  // Um changeStatus que nao reconhecemos vira null (desconhecido), nao 'same'.
  const status =
    ct?.changeStatus && VALID_STATUS.includes(ct.changeStatus)
      ? (ct.changeStatus as ChangeStatus)
      : null;

  return {
    url: data.metadata?.sourceURL ?? url,
    markdown: data.markdown ?? "",
    title: data.metadata?.title ?? null,
    description: data.metadata?.description ?? null,
    statusCode: data.metadata?.statusCode ?? null,
    extracted: data.json ?? null,
    warning,
    tracking: {
      changeStatus: status,
      visibility:
        ct?.visibility === "visible" || ct?.visibility === "hidden" ? ct.visibility : null,
      previousScrapeAt: ct?.previousScrapeAt ?? null,
      diffText: ct?.diff?.text ?? null,
      diffJson: ct?.diff?.json ?? null,
      fields: ct?.json ?? null,
    },
    raw: data,
  };
}

/**
 * Linhas adicionadas no git-diff, com o numero da linha.
 * E daqui que saem os posts novos de uma pagina de blog.
 */
export function addedLines(diffJson: unknown): Array<{ line: number; content: string }> {
  const files = (diffJson as { files?: unknown[] } | null)?.files;
  if (!Array.isArray(files)) return [];

  const out: Array<{ line: number; content: string }> = [];

  for (const file of files) {
    const chunks = (file as { chunks?: unknown[] }).chunks;
    if (!Array.isArray(chunks)) continue;

    for (const chunk of chunks) {
      const changes = (chunk as { changes?: unknown[] }).changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        const c = change as { type?: string; content?: string; ln?: number; lineNumber?: number };
        if (c.type !== "add" && c.type !== "added") continue;
        const content = (c.content ?? "").replace(/^\+/, "").trim();
        if (content.length === 0) continue;
        out.push({ line: c.ln ?? c.lineNumber ?? 0, content });
      }
    }
  }

  return out;
}
