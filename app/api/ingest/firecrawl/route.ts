import { assertAuthorized, errorResponse } from "@/lib/auth";
import { flattenFields, scrapePage, type Scrape } from "@/lib/firecrawl";
import { closeRun, generateEvents, openRun } from "@/lib/runs";
import { supabaseAdmin } from "@/lib/supabase";
import type { Json, TrackedPage } from "@/lib/database.types";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  competitorSlug?: string;
  trackedPageIds?: string[];
  /** Run existente (o cron abre um e repassa). Sem isso, abrimos um aqui. */
  runId?: string;
  /** Deixa a geracao de eventos para quem chamou. */
  skipEvents?: boolean;
};

/** Coleta as paginas monitoradas e grava scrapes, diffs e campos extraidos. */
export async function POST(req: Request): Promise<Response> {
  let runId: string | null = null;
  let ownRun = false;

  try {
    assertAuthorized(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const pages = await selectPages(body);

    runId = body.runId ?? (await openRun("firecrawl", "weekly_pages"));
    ownRun = !body.runId;

    const results: Result[] = [];
    for (const page of pages) {
      results.push(await ingestPage(page, runId));
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;

    if (ownRun) await closeRun(runId, { ok, failed });

    const events = body.skipEvents ? null : await generateEvents(runId);

    return Response.json({ ok: true, runId, pages: results.length, ok_count: ok, failed, events, results });
  } catch (err) {
    if (runId && ownRun) {
      await closeRun(runId, {
        ok: 0,
        failed: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return errorResponse(err);
  }
}

type PageRow = Pick<
  TrackedPage,
  | "id"
  | "competitor_id"
  | "url"
  | "page_type"
  | "firecrawl_tag"
  | "diff_modes"
  | "extraction_schema"
  | "extraction_prompt"
  | "scrape_options"
>;

const PAGE_COLUMNS =
  "id, competitor_id, url, page_type, firecrawl_tag, diff_modes, extraction_schema, extraction_prompt, scrape_options";

async function selectPages(body: Body): Promise<PageRow[]> {
  const db = supabaseAdmin();

  let query = db.from("tracked_pages").select(PAGE_COLUMNS).eq("is_active", true);

  if (body.competitorSlug) {
    const { data: competitor } = await db
      .from("competitors")
      .select("id")
      .eq("slug", body.competitorSlug)
      .maybeSingle();

    if (!competitor) throw new Error(`concorrente "${body.competitorSlug}" nao existe`);
    query = query.eq("competitor_id", competitor.id);
  }

  if (body.trackedPageIds?.length) query = query.in("id", body.trackedPageIds);

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao listar tracked_pages: ${error.message}`);

  return data ?? [];
}

type Result =
  | { ok: true; pageId: string; url: string; status: string; fields: number; blogPosts: number }
  | { ok: false; pageId: string; url: string; error: string };

async function ingestPage(page: PageRow, runId: string): Promise<Result> {
  const db = supabaseAdmin();

  try {
    const scrape = await scrapePage(page);

    const { data: inserted, error } = await db
      .from("page_scrapes")
      .insert({
        run_id: runId,
        tracked_page_id: page.id,
        competitor_id: page.competitor_id,
        change_status: scrape.changeStatus,
        visibility: scrape.visibility,
        previous_scrape_at: scrape.previousScrapeAt,
        http_status: scrape.httpStatus,
        title: scrape.title,
        description: scrape.description,
        // 'same' nao guarda markdown, para nao inchar a tabela — o hash
        // continua permitindo detectar divergencia depois.
        markdown: scrape.changeStatus === "same" ? null : scrape.markdown,
        markdown_hash: createHash("sha256").update(scrape.markdown).digest("hex"),
        markdown_chars: scrape.markdown.length,
        warning: scrape.warning,
        raw: scrape.raw as Json,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      throw new Error(`Falha ao gravar scrape: ${error?.message ?? "sem retorno"}`);
    }

    const scrapeId = inserted.id;

    if (scrape.diffText || scrape.diffJson) {
      const { error: diffError } = await db.from("page_diffs").insert({
        scrape_id: scrapeId,
        competitor_id: page.competitor_id,
        diff_text: scrape.diffText,
        diff_json: (scrape.diffJson ?? null) as Json,
        lines_added: scrape.linesAdded,
        lines_removed: scrape.linesRemoved,
      });
      if (diffError) throw new Error(`Falha ao gravar diff: ${diffError.message}`);
    }

    const fields = await persistFields(page, scrapeId, scrape);
    const blogPosts = await persistBlogPosts(page, scrape);

    return {
      ok: true,
      pageId: page.id,
      url: page.url,
      // "unknown" quando o changeTracking nao veio: nao e "same".
      status: scrape.changeStatus ?? "unknown",
      fields,
      blogPosts,
    };
  } catch (err) {
    return {
      ok: false,
      pageId: page.id,
      url: page.url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Grava `page_field_changes`.
 *
 * Quando a pagina usa o modo json do changeTracking, o proprio Firecrawl
 * entrega previous/current por campo. Sem ele, buscamos o ultimo valor
 * conhecido do campo para montar o par — e por isso que has_changed pode ser
 * calculado como coluna gerada.
 */
async function persistFields(page: PageRow, scrapeId: string, scrape: Scrape): Promise<number> {
  const db = supabaseAdmin();

  type Row = { field_name: string; previous_value: string | null; current_value: string | null };
  let rows: Row[] = [];

  if (scrape.fields) {
    rows = Object.entries(scrape.fields).map(([field_name, diff]) => ({
      field_name,
      previous_value: diff.previous,
      current_value: diff.current,
    }));
  } else if (scrape.extracted) {
    const current = flattenFields(scrape.extracted);

    const { data: history } = await db
      .from("page_field_changes")
      .select("field_name, current_value, observed_at")
      .eq("tracked_page_id", page.id)
      .in("field_name", [...current.keys()])
      .order("observed_at", { ascending: false });

    // Primeiro valor de cada campo na lista ordenada = o mais recente.
    const previous = new Map<string, string | null>();
    for (const row of history ?? []) {
      if (!previous.has(row.field_name)) previous.set(row.field_name, row.current_value);
    }

    rows = [...current.entries()].map(([field_name, current_value]) => ({
      field_name,
      previous_value: previous.get(field_name) ?? null,
      current_value,
    }));
  }

  if (rows.length === 0) return 0;

  const { error } = await db.from("page_field_changes").insert(
    rows.map((row) => ({
      scrape_id: scrapeId,
      competitor_id: page.competitor_id,
      tracked_page_id: page.id,
      ...row,
    })),
  );

  if (error) throw new Error(`Falha ao gravar campos: ${error.message}`);
  return rows.length;
}

/**
 * Posts de blog: novidade = URL nunca vista. A URL e unica no schema, entao o
 * upsert cuida da deduplicacao e so atualiza o last_seen_at dos ja conhecidos.
 */
async function persistBlogPosts(page: PageRow, scrape: Scrape): Promise<number> {
  if (page.page_type !== "blog_index") return 0;

  const posts = (scrape.extracted?.posts ?? null) as unknown;
  if (!Array.isArray(posts)) return 0;

  const rows = posts
    .map((p) => {
      const o = p as { url?: unknown; title?: unknown; published_at?: unknown; summary?: unknown };
      if (typeof o.url !== "string" || o.url.length === 0) return null;
      return {
        competitor_id: page.competitor_id,
        url: absolute(o.url, page.url),
        title: typeof o.title === "string" ? o.title : null,
        published_at: typeof o.published_at === "string" ? o.published_at : null,
        summary: typeof o.summary === "string" ? o.summary : null,
        last_seen_at: new Date().toISOString(),
        raw: p as Json,
      };
    })
    .filter((r) => r !== null);

  if (rows.length === 0) return 0;

  const { error } = await supabaseAdmin()
    .from("blog_posts")
    // ignoreDuplicates: a URL ja conhecida mantem o first_seen_at original,
    // que e o que define "novidade".
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true });

  if (error) throw new Error(`Falha ao gravar blog_posts: ${error.message}`);
  return rows.length;
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
