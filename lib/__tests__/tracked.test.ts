import assert from "node:assert/strict";
import { test } from "node:test";

import { TRACKED_SLUGS, instagramHandle, isTracked } from "../tracked";

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
