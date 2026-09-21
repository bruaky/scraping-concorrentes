import Link from "next/link";
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hakutaku",
  description: "Monitoramento semanal de concorrentes: site e Instagram no mesmo eixo de tempo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Hakutaku
            </Link>
            <span className="eyebrow">Inteligência competitiva</span>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
