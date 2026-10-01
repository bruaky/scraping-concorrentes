import assert from "node:assert/strict";
import { test } from "node:test";

import { TRACKED_SLUGS, instagramHandle, isTracked, logoUrl } from "../tracked";

test("os 4 concorrentes acompanhados e seus Instagrams salvos", () => {
  assert.deepEqual(TRACKED_SLUGS, ["glean", "meuze", "bond", "strattum"]);
  assert.equal(instagramHandle("glean"), "gleanwork");
  assert.equal(instagramHandle("meuze"), "meuzeai");
  assert.equal(instagramHandle("bond"), "bondapp.io");
  assert.equal(instagramHandle("strattum"), "strattum.ai");
});

test("concorrente fora da lista nao tem handle nem aparece", () => {
  assert.equal(instagramHandle("delphi-ai"), null);
  assert.equal(isTracked("delphi-ai"), false);
});

test("logo: o do banco vale; sem ele, o salvo em public/logos", () => {
  assert.equal(logoUrl("bond", null), "/logos/bond.png");
  assert.equal(logoUrl("strattum", ""), "/logos/strattum.svg");
  assert.equal(logoUrl("glean", "https://exemplo.com/g.png"), "https://exemplo.com/g.png");
  assert.equal(logoUrl("delphi-ai", null), null);
});
