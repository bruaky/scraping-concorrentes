import "server-only";

import { supabaseAdmin } from "./supabase";
import { TRACKED_SLUGS, instagramHandle } from "./tracked";

/**
 * Botão "Rodar coleta" do dashboard (/api/live/run).
 *
 * LIVE_RUN escolhe o que o botão faz:
 *
 *   apify      coleta DE VERDADE: chama o Apify para cada concorrente com
 *              Instagram confirmado e grava exatamente como o ingest semanal
 *              (lib/instagram.ts). É o padrão para apresentar.
 *   simulated  plano B, sem crédito nem rede: parte da última captura real
 *              e simula a de hoje. Tudo que grava é marcado como demo (job
 *              'demo_run', posts 'demo_live_*', eventos com payload.demo) e
 *              cada clique apaga a rodada anterior. A tela avisa que é
 *              simulado.
 *   (vazio)    sem botão; a rota responde 404.
 */
export type LiveRunMode = "apify" | "simulated";

export function liveRunMode(): LiveRunMode | null {
  const v = process.env.LIVE_RUN;
  return v === "apify" || v === "simulated" ? v : null;
}

export const DEMO_JOB = "demo_run";
export const LIVE_JOB = "ig_live";

export type DemoTarget = {
  id: string;
  name: string;
  slug: string;
  handle: string;
};

export type Snapshot = {
  id: string;
  competitor_id: string;
  username: string;
  captured_at: string;
  followers_count: number | null;
  follows_count: number | null;
  posts_count: number | null;
  highlight_reel_count: number | null;
  full_name: string | null;
  biography: string | null;
  external_url: string | null;
  is_verified: boolean | null;
  is_business_account: boolean | null;
  business_category: string | null;
  is_private: boolean | null;
  account_type: number | null;
};

export type DemoResult = {
  competitorId: string;
  previous: { followers: number | null; posts: number | null; capturedAt: string | null };
  current: { followers: number; posts: number; capturedAt: string; newPosts: number };
};

/** Apaga a rodada de demo anterior, se houver. */
export async function clearPreviousDemoRun(): Promise<void> {
  const db = supabaseAdmin();

  const { data: runs } = await db.from("collection_runs").select("id").eq("job", DEMO_JOB);
  const runIds = (runs ?? []).map((r) => r.id);

  await db.from("change_events").delete().eq("payload->>demo_run", "true");
  await db.from("instagram_post_metrics").delete().like("post_id", "demo\\_live\\_%");
  await db.from("instagram_posts").delete().like("id", "demo\\_live\\_%");

  if (runIds.length > 0) {
    await db.from("instagram_post_metrics").delete().in("run_id", runIds);
    await db.from("instagram_profile_snapshots").delete().in("run_id", runIds);
    await db.from("collection_runs").delete().in("id", runIds);
  }
}

/** Última captura de cada concorrente — o "antes" da coleta de agora. */
export async function latestSnapshot(competitorId: string): Promise<Snapshot | null> {
  const { data } = await supabaseAdmin()
    .from("instagram_profile_snapshots")
    .select("*")
    .eq("competitor_id", competitorId)
    .order("captured_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as Snapshot[])[0] ?? null;
}

export async function listTargets(): Promise<DemoTarget[]> {
  const { data, error } = await supabaseAdmin()
    .from("competitors")
    .select("id, name, slug, instagram_handle")
    .eq("is_active", true)
    .in("slug", TRACKED_SLUGS)
    .order("name");

  if (error) throw new Error(`Falha ao listar concorrentes: ${error.message}`);

  // O handle salvo em lib/tracked.ts vale mais que o do banco.
  return (data ?? []).flatMap((c) => {
    const handle = instagramHandle(c.slug) ?? c.instagram_handle;
    return handle ? [{ id: c.id, name: c.name, slug: c.slug, handle }] : [];
  });
}

/**
 * Simula a coleta de um concorrente e grava como uma coleta de verdade.
 *
 * O crescimento parte do ritmo das últimas semanas (mesma tendência, com
 * ruído) e, de vez em quando, dá um salto — é o que faz o feed ganhar um
 * alerta de "seguidores" ao vivo.
 */
export async function simulateCompetitor(target: DemoTarget, runId: string): Promise<DemoResult> {
  const db = supabaseAdmin();

  const { data: snaps, error } = await db
    .from("instagram_profile_snapshots")
    .select("*")
    .eq("competitor_id", target.id)
    .order("captured_at", { ascending: false })
    .limit(6);

  if (error) throw new Error(`Falha ao ler histórico: ${error.message}`);

  const history = (snaps ?? []) as Snapshot[];
  const last = history[0] ?? null;
  const before = history[1] ?? null;

  const prevFollowers = last?.followers_count ?? null;
  const base = prevFollowers ?? 500 + Math.round(Math.random() * 4000);

  const trend =
    last?.followers_count && before?.followers_count
      ? (last.followers_count - before.followers_count) / before.followers_count
      : 0.008;
  const jump = Math.random() < 0.1 ? 0.03 + Math.random() * 0.03 : 0;
  // A tendencia e semanal; a coleta pode ser horas depois do baseline. Sem
  // essa escala, uma demo no mesmo dia mostraria uma semana de crescimento.
  const elapsedDays = last ? (Date.now() - Date.parse(last.captured_at)) / 86_400_000 : 7;
  const scale = Math.min(1.5, Math.max(0.15, elapsedDays / 7));
  const growth = (trend * (0.6 + Math.random() * 1.1) + (Math.random() - 0.35) * 0.004 + jump) * scale;
  const followers = Math.max(0, Math.round(base * (1 + growth)));

  const newPosts = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * 2);
  const posts = (last?.posts_count ?? 0) + newPosts;
  const capturedAt = new Date().toISOString();

  const { error: snapError } = await db.from("instagram_profile_snapshots").insert({
    run_id: runId,
    competitor_id: target.id,
    username: target.handle,
    captured_at: capturedAt,
    followers_count: followers,
    follows_count: last?.follows_count ?? null,
    posts_count: posts,
    highlight_reel_count: last?.highlight_reel_count ?? null,
    full_name: last?.full_name ?? target.name,
    biography: last?.biography ?? null,
    external_url: last?.external_url ?? null,
    is_verified: last?.is_verified ?? null,
    is_business_account: last?.is_business_account ?? null,
    business_category: last?.business_category ?? null,
    is_private: last?.is_private ?? false,
    account_type: last?.account_type ?? null,
    raw: { demo: true },
  });

  if (snapError) throw new Error(`Falha ao gravar snapshot: ${snapError.message}`);

  await insertNewPosts(target, runId, followers, newPosts, capturedAt);

  return {
    competitorId: target.id,
    previous: {
      followers: prevFollowers,
      posts: last?.posts_count ?? null,
      capturedAt: last?.captured_at ?? null,
    },
    current: { followers, posts, capturedAt, newPosts },
  };
}

const CAPTIONS = [
  "Novidade da semana: integração nova no ar. Link na bio.",
  "Bastidores: como o time decide o que entra no roadmap.",
  "Case novo publicado — resultados em 90 dias.",
  "Webinar ao vivo na quinta. Inscrições abertas.",
  "Estamos contratando para vendas e engenharia.",
  "Demo de 60 segundos do recurso que mais pediram.",
];

async function insertNewPosts(
  target: DemoTarget,
  runId: string,
  followers: number,
  count: number,
  capturedAt: string,
): Promise<void> {
  if (count === 0) return;
  const db = supabaseAdmin();

  const posts = Array.from({ length: count }, (_, i) => {
    const reel = Math.random() < 0.5;
    const id = `demo_live_${target.slug.replace(/-/g, "_")}_${i}`;
    return {
      reel,
      row: {
        id,
        competitor_id: target.id,
        owner_username: target.handle,
        short_code: `L${id.length}${i}`,
        url: null,
        post_type: reel ? "Video" : "Image",
        product_type: reel ? "clips" : "feed",
        caption: CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)],
        hashtags: ["ia"],
        posted_at: new Date(Date.now() - (1 + Math.random() * 40) * 3600_000).toISOString(),
        video_duration: reel ? 30 : null,
        is_pinned: false,
        raw: { demo: true },
      },
    };
  });

  const { error } = await db.from("instagram_posts").insert(posts.map((p) => p.row));
  if (error) throw new Error(`Falha ao gravar posts: ${error.message}`);

  const er = 0.015 + Math.random() * 0.03;
  const { error: metricsError } = await db.from("instagram_post_metrics").insert(
    posts.map(({ row, reel }) => {
      const likes = Math.round(followers * er * (0.6 + Math.random() * 0.8));
      const plays = reel ? Math.round(followers * (0.4 + Math.random() * 1.4)) : null;
      return {
        run_id: runId,
        post_id: row.id,
        competitor_id: target.id,
        captured_at: capturedAt,
        likes_count: likes,
        comments_count: Math.round(likes * (0.02 + Math.random() * 0.05)),
        video_view_count: plays,
        video_play_count: plays,
      };
    }),
  );
  if (metricsError) throw new Error(`Falha ao gravar métricas: ${metricsError.message}`);
}

/**
 * Marca os eventos que o run gerou como demo, para a próxima rodada (e o
 * demo_cleanup.sql) acharem. O ref dos eventos de Instagram é o id do
 * snapshot.
 */
export async function tagDemoEvents(runId: string): Promise<number> {
  const db = supabaseAdmin();

  const { data: snaps } = await db
    .from("instagram_profile_snapshots")
    .select("id")
    .eq("run_id", runId);
  const refs = (snaps ?? []).map((s) => s.id);
  if (refs.length === 0) return 0;

  const { data: events } = await db
    .from("change_events")
    .select("id, payload")
    .in("payload->>ref", refs);

  for (const e of events ?? []) {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    await db
      .from("change_events")
      .update({ payload: { ...payload, demo: true, demo_run: true } })
      .eq("id", e.id);
  }

  return events?.length ?? 0;
}
