export function Panel({
  title,
  action,
  children,
  bare = false,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Sem padding interno — para listas e tabelas que sangram ate a borda. */
  bare?: boolean;
}) {
  return (
    <section>
      {title || action ? (
        <header className="mb-3 flex items-baseline justify-between gap-4">
          {title ? <h2 className="eyebrow">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <div
        className={`overflow-hidden rounded-xl border border-line bg-surface ${bare ? "" : "p-5"}`}
      >
        {children}
      </div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{children}</p>;
}
