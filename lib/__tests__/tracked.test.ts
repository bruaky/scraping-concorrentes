import assert from "node:assert/strict";
import { test } from "node:test";

import { TRACKED_SLUGS, instagramHandle, isSelf, isTracked, logoUrl } from "../tracked";

test("os 4 concorrentes + a Hakutaku, e seus Instagrams salvos", () => {
  assert.deepEqual(TRACKED_SLUGS, ["glean", "meuze", "bond", "strattum", "hakutaku"]);
  assert.equal(instagramHandle("hakutaku"), "hakutakuai");
  assert.equal(instagramHandle("glean"), "gleanwork");
  assert.equal(instagramHandle("meuze"), "meuzeai");
  assert.equal(instagramHandle("bond"), "bondapp.io");
  assert.equal(instagramHandle("strattum"), "strattum.ai");
});

test("concorrente fora da lista nao tem handle nem aparece", () => {
  assert.equal(instagramHandle("delphi-ai"), null);
  assert.equal(isTracked("delphi-ai"), false);
});

test("logo: o do banco vale; sem ele, a rota /api/logos", () => {
  assert.equal(logoUrl("bond", null), "/api/logos/bond");
  assert.equal(logoUrl("strattum", ""), "/api/logos/strattum");
  assert.equal(logoUrl("glean", "https://exemplo.com/g.png"), "https://exemplo.com/g.png");
  assert.equal(logoUrl("delphi-ai", null), null);
});

test("todo logo salvo existe em public/", async () => {
  const { existsSync } = await import("node:fs");
  const { TRACKED } = await import("../tracked");
  for (const t of TRACKED) assert.ok(existsSync(`public${t.logo}`), t.logo);
});

test("so a Hakutaku e marcada como nos", () => {
  assert.deepEqual(TRACKED_SLUGS.filter(isSelf), ["hakutaku"]);
});
