import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hakutaku CI",
  description: "Monitoramento semanal de concorrentes: site + Instagram.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-5xl px-4 py-10">{children}</div>
      </body>
    </html>
  );
}
