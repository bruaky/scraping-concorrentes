import "server-only";

import type { PageType } from "./database.types";

/**
 * Extracao estruturada por tipo de pagina.
 *
 * O `schema` vai no formato `json` do Firecrawl e tambem no modo `json` do
 * changeTracking — e de la que sai o `previous`/`current` por campo, ou seja,
 * "preco antes → depois" sem precisar ler diff.
 *
 * So pedimos extracao onde ela vira metrica ou evento; nas demais paginas o
 * git-diff sozinho ja basta e sai mais barato.
 */

export type PricingExtract = {
  plans?: Array<{
    name?: string;
    price?: number | null;
    currency?: string | null;
    period?: string | null;
  }>;
};

export type CareersExtract = {
  roles?: Array<{ title?: string; department?: string | null; location?: string | null }>;
};

export type HomeExtract = { headline?: string; subheadline?: string | null };

export type BlogExtract = {
  posts?: Array<{ title?: string; url?: string | null; published_at?: string | null }>;
};

export type ExtractionSpec = { prompt: string; schema: Record<string, unknown> };

const SPECS: Partial<Record<PageType, ExtractionSpec>> = {
  pricing: {
    prompt:
      "Extraia todos os planos de preco listados, com o valor numerico mensal quando houver. Use null no price de planos 'Fale conosco' ou gratuitos sem valor.",
    schema: {
      type: "object",
      properties: {
        plans: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              price: { type: ["number", "null"] },
              currency: { type: ["string", "null"] },
              period: { type: ["string", "null"], description: "month | year | seat" },
            },
            required: ["name"],
          },
        },
      },
      required: ["plans"],
    },
  },

  careers: {
    prompt: "Extraia todas as vagas abertas listadas na pagina.",
    schema: {
      type: "object",
      properties: {
        roles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              department: { type: ["string", "null"] },
              location: { type: ["string", "null"] },
            },
            required: ["title"],
          },
        },
      },
      required: ["roles"],
    },
  },

  home: {
    prompt: "Extraia a headline principal e a subheadline do hero da pagina.",
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        subheadline: { type: ["string", "null"] },
      },
      required: ["headline"],
    },
  },

  blog: {
    prompt: "Extraia os posts listados na pagina, do mais recente para o mais antigo.",
    schema: {
      type: "object",
      properties: {
        posts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: ["string", "null"] },
              published_at: { type: ["string", "null"] },
            },
            required: ["title"],
          },
        },
      },
      required: ["posts"],
    },
  },
};

export function specFor(pageType: PageType): ExtractionSpec | null {
  return SPECS[pageType] ?? null;
}

/** Numero de vagas abertas, pro placar. */
export function jobsCount(extracted: unknown): number | null {
  const roles = (extracted as CareersExtract | null)?.roles;
  return Array.isArray(roles) ? roles.length : null;
}

/**
 * Preco de referencia do placar: o plano pago mais barato. Planos sem valor
 * (gratuito, "fale conosco") ficam de fora — zero ali seria mentira.
 */
export function headlinePrice(
  extracted: unknown,
): { price: number; currency: string | null } | null {
  const plans = (extracted as PricingExtract | null)?.plans;
  if (!Array.isArray(plans)) return null;

  const paid = plans.filter(
    (p): p is { name?: string; price: number; currency?: string | null } =>
      typeof p?.price === "number" && p.price > 0,
  );
  if (paid.length === 0) return null;

  const cheapest = paid.reduce((min, p) => (p.price < min.price ? p : min));
  return { price: cheapest.price, currency: cheapest.currency ?? null };
}
