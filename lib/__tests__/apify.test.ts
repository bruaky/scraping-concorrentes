import assert from "node:assert/strict";
import { test } from "node:test";

import { num } from "../apify";

/**
 * O schema guarda likes_count CRU e normaliza nas views. Estes testes
 * fixam essa direcao: se alguem "consertar" a coercao para zerar o -1 aqui,
 * o dado bruto perde a distincao entre escondido e ausente, e as views
 * passam a normalizar um valor que ja veio adulterado.
 */

test("-1 chega ao banco como -1, nao como zero nem null", () => {
  assert.equal(num(-1), -1);
});

test("zero de verdade continua zero", () => {
  assert.equal(num(0), 0);
});

test("ausente vira null", () => {
  assert.equal(num(undefined), null);
  assert.equal(num(null), null);
  assert.equal(num("1000"), null);
  assert.equal(num(Number.NaN), null);
});
