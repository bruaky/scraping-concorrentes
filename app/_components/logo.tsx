"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";

import { monogram } from "@/lib/format";

/**
 * Logo do concorrente, com monograma como fallback.
 *
 * Sem `next/image` de proposito: as logos sao URLs arbitrarias de dominios que
 * o concorrente controla, e liberar host remoto no next.config pra cada um e
 * pior do que abrir mao da otimizacao. Se a imagem nao carregar, cai no
 * monograma em vez de mostrar o icone de imagem quebrada.
 *
 * O fundo da imagem e sempre claro, independente do tema: logos pretos
 * (Bond, Meuze) sumiam sobre a superficie escura.
 */
export function Logo({
  name,
  src,
  size = 40,
}: {
  name: string;
  src: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  // A imagem pode falhar antes da hidratacao, quando o onError ainda nao
  // estava ligado. Na montagem, confere se ela ja chegou quebrada.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        ref={img}
        alt=""
        onError={() => setFailed(true)}
        width={size}
        height={size}
        className="shrink-0 rounded-lg border border-line bg-[#fcfcfb] object-contain"
        style={{ width: size, height: size, padding: Math.round(size * 0.1) }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-lg border border-line bg-surface font-medium text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {monogram(name)}
    </span>
  );
}
