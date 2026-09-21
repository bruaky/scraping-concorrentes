import Link from "next/link";
import { notFound } from "next/navigation";

import { EventCard, formatDate } from "../../_components/event-card";
import { supabaseAdmin } from "@/lib/supabase";
import type { ChangeEvent, Competitor, Snapshot, Source } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function CompetitorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = supabaseAdmin();

  const { data: competitor } = await db
    .from("competitors")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!competitor) notFound();

  const c = competitor as Competitor;

  const [sourcesRes, eventsRes, followersRes] = await Promise.all([
    db.from("sources").select("*").eq("competitor_id", c.id).order("kind"),
    db
      .from("change_events")
      .select("*")
      .eq("competitor_id", c.id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    db
      .from("snapshots")
      .select("id, captured_at, followers")
      .eq("competitor_id", c.id)
      .eq("kind", "instagram")
      .order("captured_at", { ascending: false })
      .limit(1),
  ]);

  const sources = (sourcesRes.data ?? []) as Source[];
  const events = (eventsRes.data ?? []) as ChangeEvent[];
  const latest = (followersRes.data ?? [])[0] as Pick<Snapshot, "followers"> | undefined;

  return (
    <main className="space-y-8">
      <div>
        <Link href="/" className="text-xs text-sky-400 hover:underline">
          ← voltar
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{c.name}</h1>
        <p className="mt-1 flex flex-wrap gap-3 text-sm text-[--color-muted]">
          {c.website ? (
            <a href={c.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {new URL(c.website).host}
            </a>
          ) : null}
          {c.instagram ? (
            <a
              href={`https://instagram.com/${c.instagram}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              @{c.instagram}
            </a>
          ) : null}
          {latest?.followers != null ? (
            <span>{latest.followers.toLocaleString("pt-BR")} seguidores</span>
          ) : null}
        </p>
        {c.notes ? <p className="mt-3 text-sm text-slate-300">{c.notes}</p> : null}
      </div>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[--color-muted]">
          Fontes monitoradas
        </h2>
        <ul className="mt-3 space-y-2">
          {sources.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[--color-edge] bg-[--color-panel] px-4 py-3 text-sm"
            >
              <span className="break-all">
                <span className="mr-2 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                  {s.kind}
                </span>
                {s.label ? <span className="mr-2 text-slate-400">{s.label}</span> : null}
                {s.target}
              </span>
              <span className="text-xs text-[--color-muted]">
                {s.is_active ? "" : "pausada · "}
                {s.last_run_at ? `última: ${formatDate(s.last_run_at)}` : "nunca rodou"}
              </span>
            </li>
          ))}
          {sources.length === 0 ? (
            <li className="rounded-lg border border-dashed border-[--color-edge] p-6 text-sm text-[--color-muted]">
              Nenhuma fonte cadastrada para este concorrente.
            </li>
          ) : null}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[--color-muted]">
          Timeline
        </h2>
        <div className="mt-3 space-y-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[--color-edge] p-6 text-sm text-[--color-muted]">
              Nada detectado ainda.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
