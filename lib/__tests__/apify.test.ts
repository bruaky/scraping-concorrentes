import assert from "node:assert/strict";
import { test } from "node:test";

import { hideable } from "../apify";

test("-1 do Apify vira desconhecido, nao zero", () => {
  // Esse e o bug que mais silenciosamente estraga o painel: a conta esconde
  // curtidas, o Apify manda -1, e se isso virar 0 a media de engajamento
  // despenca e a gente le como queda real.
  assert.equal(hideable(-1), null);
});

test("zero de verdade continua zero", () => {
  assert.equal(hideable(0), 0);
});

test("valor normal passa direto", () => {
  assert.equal(hideable(1234), 1234);
});

test("ausente continua ausente", () => {
  assert.equal(hideable(undefined), null);
  assert.equal(hideable(null), null);
  assert.equal(hideable("100"), null);
});
