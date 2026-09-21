/* eslint-disable @next/next/no-img-element */
import { monogram } from "@/lib/format";

/**
 * Logo do concorrente, com monograma como fallback.
 *
 * Sem `next/image` de proposito: as logos sao URLs arbitrarias de dominios que
 * o concorrente controla, e liberar host remoto no next.config pra cada um e
 * pior do que abrir mao da otimizacao.
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
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-lg border border-line bg-surface object-contain"
        style={{ width: size, height: size }}
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
