import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // As rotas de ingest usam `export const maxDuration` para estender o limite
  // de execucao na Vercel; nada especial e necessario aqui.
};

export default nextConfig;
