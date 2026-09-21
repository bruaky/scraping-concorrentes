import assert from "node:assert/strict";
import { test } from "node:test";

import { instagramEvents, webEvents, type WebContext } from "../events";
import type { Scrape } from "../firecrawl";
import type { Post, Profile } from "../apify";
import type { ChangeStatus, PageType } from "../database.types";

// --- fixtures ---------------------------------------------------------------

function scrape(
  over: Partial<Omit<Scrape, "tracking">> & {
    status?: ChangeStatus | null;
    visibility?: "visible" | "hidden";
    diffJson?: unknown;
  } = {},
): Scrape {
  const { status, visibility, diffJson, ...rest } = over;
  return {
    url: "https://acme.com/pricing",
    markdown: "# Preços\nStarter $39",
    title: "Preços",
    description: null,
    statusCode: 200,
    extracted: null,
    warning: null,
    raw: {},
    ...rest,
    tracking: {
      changeStatus: status === undefined ? "changed" : status,
      visibility: visibility ?? "visible",
      previousScrapeAt: "2026-09-13T00:00:00Z",
      diffText: "- Starter $29\n+ Starter $39",
      diffJson: diffJson ?? null,
      fields: null,
    },
  };
}

function ctx(over: Partial<WebContext> = {}): WebContext {
  return {
    competitorId: "c1",
    sourceId: "s1",
    pageType: "pricing" as PageType,
    runId: null,
    scrape: scrape(),
    capturedAt: "2026-09-20T00:00:00Z",
    previous: {
      id: "prev",
      content_hash: "old",
      visibility: "visible",
      extracted: null,
      jobs_count: null,
      headline_price: null,
    },
    ...over,
  };
}

// --- baseline ---------------------------------------------------------------

test("primeira captura nao gera evento", () => {
  // Semana 1 e toda "new". Um feed com 40 cards de "pagina nova" e ruido.
  assert.deepEqual(webEvents(ctx({ previous: null })), []);
});

test("404 gera evento mesmo sem baseline", () => {
  // Pagina que ja nasce fora do ar ainda e informacao.
  const events = webEvents(
    ctx({ previous: null, scrape: scrape({ statusCode: 404, status: null }) }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "page_removed");
});

// --- desconhecido != igual --------------------------------------------------

test("changeTracking ausente nao vira 'nao mudou' nem inventa evento", () => {
  // O Firecrawl pode devolver sem changeTracking quando da timeout no lookup.
  // Isso e DESCONHECIDO: nao emitimos nada e a UI mostra "sem comparacao".
  const events = webEvents(
    ctx({ scrape: scrape({ status: null, warning: "changeTracking lookup timed out" }) }),
  );
  assert.deepEqual(events, []);
});

test("'same' nao gera evento", () => {
  assert.deepEqual(webEvents(ctx({ scrape: scrape({ status: "same" }) })), []);
});

// --- preco ------------------------------------------------------------------

test("mudanca de preco nomeia o plano e os dois valores", () => {
  const events = webEvents(
    ctx({
      previous: {
        id: "prev",
        content_hash: "old",
        visibility: "visible",
        extracted: { plans: [{ name: "Starter", price: 29, currency: "USD" }] },
        jobs_count: null,
        headline_price: 29,
      },
      scrape: scrape({ extracted: { plans: [{ name: "Starter", price: 39, currency: "USD" }] } }),
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "pricing_changed");
  assert.equal(events[0].title, "Starter passou de USD 29 para USD 39");
});

test("pagina de preco que mudou sem a extracao pegar ainda e critica", () => {
  const events = webEvents(ctx());
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "pricing_changed");
});

// --- visibilidade -----------------------------------------------------------

test("pagina que sai do sitemap mas ainda abre vira page_hidden", () => {
  const events = webEvents(
    ctx({
      pageType: "other",
      scrape: scrape({ status: "same", visibility: "hidden" }),
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "page_hidden");
});

test("pagina que ja estava hidden nao repete o evento", () => {
  const events = webEvents(
    ctx({
      pageType: "other",
      previous: {
        id: "prev",
        content_hash: "old",
        visibility: "hidden",
        extracted: null,
        jobs_count: null,
        headline_price: null,
      },
      scrape: scrape({ status: "same", visibility: "hidden" }),
    }),
  );
  assert.deepEqual(events, []);
});

// --- vagas e blog -----------------------------------------------------------

test("vaga nova aparece pelo titulo", () => {
  const events = webEvents(
    ctx({
      pageType: "careers",
      previous: {
        id: "prev",
        content_hash: "old",
        visibility: "visible",
        extracted: { roles: [{ title: "SWE" }] },
        jobs_count: 1,
        headline_price: null,
      },
      scrape: scrape({
        extracted: { roles: [{ title: "SWE" }, { title: "Head of Sales" }] },
      }),
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "jobs_changed");
  assert.match(events[0].title, /Head of Sales/);
});

test("post novo de blog vira um evento por post", () => {
  const events = webEvents(
    ctx({
      pageType: "blog",
      previous: {
        id: "prev",
        content_hash: "old",
        visibility: "visible",
        extracted: { posts: [{ title: "Antigo" }] },
        jobs_count: null,
        headline_price: null,
      },
      scrape: scrape({
        extracted: { posts: [{ title: "Novo A" }, { title: "Novo B" }, { title: "Antigo" }] },
      }),
    }),
  );

  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.kind === "blog_post"));
});

// --- Instagram --------------------------------------------------------------

function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "acme",
    fullName: "Acme",
    biography: "bio",
    externalUrl: "https://acme.com",
    followersCount: 10_000,
    followsCount: 100,
    postsCount: 50,
    profilePicUrl: null,
    isVerified: true,
    isBusinessAccount: true,
    businessCategoryName: null,
    isPrivate: false,
    accountType: 2,
    raw: {},
    ...over,
  };
}

function post(over: Partial<Post> = {}): Post {
  return {
    igId: "p1",
    shortCode: "abc",
    url: "https://instagram.com/p/abc",
    timestamp: "2026-09-19T00:00:00Z",
    mediaType: "Image",
    productType: null,
    caption: "oi",
    hashtags: [],
    mentions: [],
    taggedUsers: [],
    displayUrl: null,
    isPinned: false,
    likesCount: 10,
    commentsCount: 1,
    videoPlayCount: null,
    videoViewCount: null,
    latestComments: [],
    raw: {},
    ...over,
  };
}

const igBase = {
  competitorId: "c1",
  sourceId: "s1",
  handle: "acme",
  runId: null,
  capturedAt: "2026-09-20T00:00:00Z",
  previous: {
    id: "prev",
    followers_count: 10_000,
    biography: "bio",
    external_url: "https://acme.com",
    is_private: false,
  },
};

test("post fixado nao conta como post da semana", () => {
  // Fixado reaparece em toda coleta; viraria evento novo toda semana.
  const events = instagramEvents({
    ...igBase,
    profile: profile(),
    newPosts: [post({ isPinned: true })],
  });
  assert.deepEqual(events, []);
});

test("post novo vira evento e reel e nomeado como reel", () => {
  const events = instagramEvents({
    ...igBase,
    profile: profile(),
    newPosts: [post({ mediaType: "Video", productType: "clips" })],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "new_post");
  assert.match(events[0].title, /reel/);
});

test("variacao pequena de seguidores nao vira evento", () => {
  const events = instagramEvents({
    ...igBase,
    profile: profile({ followersCount: 10_050 }), // +0,5%
    newPosts: [],
  });
  assert.deepEqual(events, []);
});

test("salto relevante de seguidores vira evento", () => {
  const events = instagramEvents({
    ...igBase,
    profile: profile({ followersCount: 11_000 }), // +10%
    newPosts: [],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "followers_jump");
});

test("perfil que fecha e critico e interrompe os demais eventos", () => {
  const events = instagramEvents({
    ...igBase,
    profile: profile({ isPrivate: true }),
    newPosts: [post()],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "account_private");
});

test("sem baseline o Instagram tambem nao gera evento", () => {
  const events = instagramEvents({
    ...igBase,
    previous: null,
    profile: profile(),
    newPosts: [post(), post({ igId: "p2" })],
  });
  assert.deepEqual(events, []);
});
