"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Botao "Atualizar" da secao Competitor news: chama /api/live/news (Google
 * via Apify, ~1-2 min) e recarrega a pagina com o que chegou.
 */
export function NewsRefresh() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/live/news", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; fresh?: number; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setNote({ tone: "ok", text: body.fresh ? `${body.fresh} nova(s)` : "nada novo" });
      router.refresh();
    } catch (err) {
      setNote({ tone: "warn", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-3">
      {note ? (
        <span className={`text-xs ${note.tone === "warn" ? "text-critical" : "text-muted"}`}>{note.text}</span>
      ) : null}
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-rule disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <span aria-hidden className="size-2.5 animate-spin rounded-full border-2 border-ink border-t-transparent" />
        ) : (
          <span aria-hidden>↻</span>
        )}
        {busy ? "Buscando…" : "Atualizar"}
      </button>
    </span>
  );
}
