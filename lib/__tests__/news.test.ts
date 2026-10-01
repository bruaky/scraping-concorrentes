import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNews } from "../news";
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

test("mencao sem o termo do concorrente e descartada; blog e vaga nao passam pelo filtro", () => {
  const items = parseNews(
    [
      {
        searchQuery: { term: '"strattum.ai" -site:strattum.ai' },
        organicResults: [
          { url: "https://dictionary.cambridge.org/stratum", title: "STRATUM Definition" },
          { url: "https://linkedin.com/posts/x", title: "Strattum AI Acquires Tropicalia" },
        ],
      },
      { searchQuery: { term: "site:strattum.ai" }, organicResults: [{ url: "https://www.strattum.ai/x", title: "Capacity Calculator" }] },
    ],
    [
      { kind: "mention", query: '"strattum.ai" -site:strattum.ai' },
      { kind: "site", query: "site:strattum.ai" },
    ],
    ["strattum"],
  );
  assert.deepEqual(items.map((i) => [i.kind, i.title]), [
    ["mention", "Strattum AI Acquires Tropicalia"],
    ["site", "Capacity Calculator"],
  ]);
});

test("todo concorrente com noticia tem termo de filtro", async () => {
  const { NEWS_KEYWORDS } = await import("../tracked");
  for (const slug of Object.keys(NEWS_QUERIES)) assert.ok(NEWS_KEYWORDS[slug]?.length, slug);
});
