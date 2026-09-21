import "server-only";

import type { ChangeStatus, Json, TrackedPage, Visibility } from "./database.types";

/**
 * Wrapper sobre a API v2 do Firecrawl.
 *
 * A config do scrape mora em `tracked_pages`, nao aqui: tag, modos de diff,
 * schema de extracao e scrape_options vem da linha. O Firecrawl exige
 * consistencia de parametros entre scrapes da mesma URL — mudar isso no
 * codigo invalidaria a serie de comparacao de todas as paginas de uma vez.
 *
 * Docs: https://docs.firecrawl.dev/features/change-tracking
 */

const DEFAULT_API_URL = "https://api.firecrawl.dev";

export type FieldDiff = { previous: string | null; current: string | null };

export type Scrape = {
  url: string;
  markdown: string;
  title: string | null;
  description: string | null;
  httpStatus: number | null;

  /**
   * null = o Firecrawl NAO conseguiu comparar (timeout no lookup, ver
   * `warning`). Desconhecido, nunca "same".
   */
  changeStatus: ChangeStatus | null;
  visibility: Visibility | null;
  previousScrapeAt: string | null;

  diffText: string | null;
  diffJson: unknown | null;
  linesAdded: number | null;
  linesRemoved: number | null;

  /** Extracao do formato json. */
  extracted: Record<string, unknown> | null;
  /** { campo: { previous, current } } do modo json do changeTracking. */
  fields: Record<string, FieldDiff> | null;

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

type PageConfig = Pick<
  TrackedPage,
  "url" | "firecrawl_tag" | "diff_modes" | "extraction_schema" | "extraction_prompt" | "scrape_options"
>;

export async function scrapePage(
  page: PageConfig,
  opts: { timeoutMs?: number } = {},
): Promise<Scrape> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const schema = page.extraction_schema as Record<string, unknown> | null;
  const usesJson = schema !== null && page.diff_modes.includes("json");

  const formats: unknown[] = ["markdown"];

  if (schema) {
    formats.push({
      type: "json",
      ...(page.extraction_prompt ? { prompt: page.extraction_prompt } : {}),
      schema,
    });
  }

  formats.push({
    type: "changeTracking",
    modes: page.diff_modes,
    tag: page.firecrawl_tag,
    ...(usesJson
      ? {
          schema,
          ...(page.extraction_prompt ? { prompt: page.extraction_prompt } : {}),
        }
      : {}),
  });

  const res = await fetch(apiUrl("/v2/scrape"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: page.url,
      formats,
      timeout: timeoutMs,
      // opcoes congeladas na linha de tracked_pages
      ...((page.scrape_options as Record<string, unknown> | null) ?? {}),
    }),
    signal: AbortSignal.timeout(timeoutMs + 15_000),
  });

  const body = (await res.json()) as {
    success?: boolean;
    error?: string;
    warning?: string;
    data?: {
      markdown?: string;
      json?: Record<string, unknown>;
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
      `Firecrawl falhou em ${page.url}: ${res.status} ${body.error ?? "sem detalhe"}`,
    );
  }

  const data = body.data;
  const ct = data.changeTracking;

  // Status que nao reconhecemos vira null (desconhecido), nunca 'same'.
  const changeStatus =
    ct?.changeStatus && VALID_STATUS.includes(ct.changeStatus)
      ? (ct.changeStatus as ChangeStatus)
      : null;

  const counts = countDiffLines(ct?.diff?.json ?? null);

  return {
    url: data.metadata?.sourceURL ?? page.url,
    markdown: data.markdown ?? "",
    title: data.metadata?.title ?? null,
    description: data.metadata?.description ?? null,
    httpStatus: data.metadata?.statusCode ?? null,
    changeStatus,
    visibility:
      ct?.visibility === "visible" || ct?.visibility === "hidden" ? ct.visibility : null,
    previousScrapeAt: ct?.previousScrapeAt ?? null,
    diffText: ct?.diff?.text ?? null,
    diffJson: ct?.diff?.json ?? null,
    linesAdded: counts?.added ?? null,
    linesRemoved: counts?.removed ?? null,
    extracted: data.json ?? null,
    fields: ct?.json ?? null,
    warning: data.warning ?? body.warning ?? null,
    raw: data,
  };
}

/** Percorre files[].chunks[].changes[] contando adicoes e remocoes. */
function countDiffLines(diffJson: unknown): { added: number; removed: number } | null {
  const files = (diffJson as { files?: unknown[] } | null)?.files;
  if (!Array.isArray(files)) return null;

  let added = 0;
  let removed = 0;

  for (const file of files) {
    for (const chunk of asArray((file as { chunks?: unknown }).chunks)) {
      for (const change of asArray((chunk as { changes?: unknown }).changes)) {
        const type = (change as { type?: string }).type;
        if (type === "add" || type === "added") added += 1;
        else if (type === "del" || type === "delete" || type === "removed") removed += 1;
      }
    }
  }

  return { added, removed };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Linhas adicionadas, com o numero da linha — de onde saem posts novos
 * quando a extracao estruturada nao esta ligada na pagina.
 */
export function addedLines(diffJson: unknown): Array<{ line: number; content: string }> {
  const files = (diffJson as { files?: unknown[] } | null)?.files;
  if (!Array.isArray(files)) return [];

  const out: Array<{ line: number; content: string }> = [];

  for (const file of files) {
    for (const chunk of asArray((file as { chunks?: unknown }).chunks)) {
      for (const change of asArray((chunk as { changes?: unknown }).changes)) {
        const c = change as {
          type?: string;
          content?: string;
          ln?: number;
          lineNumber?: number;
        };
        if (c.type !== "add" && c.type !== "added") continue;
        const content = (c.content ?? "").replace(/^\+/, "").trim();
        if (content.length === 0) continue;
        out.push({ line: c.ln ?? c.lineNumber ?? 0, content });
      }
    }
  }

  return out;
}

/**
 * Achata a extracao em pares campo → valor texto, que e o formato de
 * `page_field_changes`. Objetos e arrays viram JSON; null vira null (ausencia),
 * nunca string vazia.
 */
export function flattenFields(extracted: Record<string, unknown> | null): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!extracted) return out;

  for (const [key, value] of Object.entries(extracted)) {
    if (value === null || value === undefined) out.set(key, null);
    else if (typeof value === "object") out.set(key, JSON.stringify(value));
    else out.set(key, String(value));
  }

  return out;
}

export type { Json };
