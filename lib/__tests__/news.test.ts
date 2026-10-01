import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNews, parsePress } from "../news";
import { NEWS_QUERIES, TRACKED_SLUGS } from "../tracked";

const queries = [
  { kind: "blog" as const, query: "site:glean.com/blog" },
  { kind: "job" as const, query: "site:job-boards.greenhouse.io/gleanwork" },
];

test("cada resultado leva o tipo da busca que o achou", () => {
  const items = parseNews(
    [
      {
        searchQuery: { term: "site:glean.com/blog" },
        organicResults: [
          { url: "https://www.glean.com/blog/a", title: " Post A ", description: "trecho", date: "2026-09-29T17:58:07.956Z" },
        ],
      },
      {
        searchQuery: { term: "site:job-boards.greenhouse.io/gleanwork" },
        organicResults: [{ url: "https://job-boards.greenhouse.io/gleanwork/jobs/1", title: "Vaga" }],
      },
    ],
    queries,
  );

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => [i.kind, i.title, i.source, i.publishedAt]),
    [
      ["blog", "Post A", "glean.com", "2026-09-29T17:58:07.956Z"],
      ["job", "Vaga", "job-boards.greenhouse.io", null],
    ],
  );
});

test("url repetida entra uma vez; busca desconhecida e resultado sem url sao ignorados", () => {
  const items = parseNews(
    [
      { searchQuery: { term: "site:glean.com/blog" }, organicResults: [{ url: "https://x.com/1" }, { title: "sem url" }] },
      { searchQuery: { term: "site:job-boards.greenhouse.io/gleanwork" }, organicResults: [{ url: "https://x.com/1" }] },
      { searchQuery: { term: "outra busca" }, organicResults: [{ url: "https://x.com/2" }] },
    ],
    queries,
  );
  assert.deepEqual(items.map((i) => [i.url, i.kind]), [["https://x.com/1", "blog"]]);
});

test("todo concorrente acompanhado tem buscas de noticia", () => {
  for (const slug of TRACKED_SLUGS) assert.ok(NEWS_QUERIES[slug]?.length, slug);
});

const press = {
  glean: { keyword: '"Glean" AI', title: ["Glean"] },
  strattum: { keyword: "Strattum", title: ["Strattum"] },
};

test("imprensa: cada noticia vai para o concorrente da palavra-chave, sem o ' - Fonte'", () => {
  const out = parsePress(
    [
      {
        title: "Glean Revenue 2026: $300M ARR - GetLatka",
        url: "https://news.google.com/a",
        source: "GetLatka",
        publishedAt: "2026-09-28T07:00:00+00:00",
        metadata: { keyword: '"Glean" AI' },
      },
      {
        title: "Strattum acqui-hires Tropicalia - Dealroom",
        url: "https://news.google.com/b",
        source: "Dealroom",
        publishedAt: "2026-09-10T14:29:07+00:00",
        metadata: { keyword: "Strattum" },
      },
    ],
    press,
  );
  assert.deepEqual(out.get("glean")?.map((i) => [i.kind, i.title, i.source, i.publishedAt]), [
    ["mention", "Glean Revenue 2026: $300M ARR", "GetLatka", "2026-09-28T07:00:00.000Z"],
  ]);
  assert.equal(out.get("strattum")?.[0].title, "Strattum acqui-hires Tropicalia");
});

test("imprensa: sem o nome no titulo (maiusculas importam) ou sem data, fica de fora", () => {
  const out = parsePress(
    [
      // ruido real de 01/10: "glean" como verbo e artigo generico de IA
      { title: "A surprising use for distorted data to glean hidden laws", url: "https://n/1", publishedAt: "2026-09-29T22:33:00Z", metadata: { keyword: '"Glean" AI' } },
      { title: "5 AI Delusions That Could Derail Your Business", url: "https://n/2", publishedAt: "2026-09-30T14:03:00Z", metadata: { keyword: '"Glean" AI' } },
      { title: "Glean sem data", url: "https://n/3", metadata: { keyword: '"Glean" AI' } },
      { title: "Glean de palavra-chave desconhecida", url: "https://n/4", publishedAt: "2026-09-30T14:03:00Z", metadata: { keyword: "outra" } },
    ],
    press,
  );
  assert.equal(out.size, 0);
});

test("todo concorrente acompanhado tem imprensa configurada", async () => {
  const { PRESS } = await import("../tracked");
  for (const slug of TRACKED_SLUGS) assert.ok(PRESS[slug]?.keyword && PRESS[slug].title.length, slug);
});
