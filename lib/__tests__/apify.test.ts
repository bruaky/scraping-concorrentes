import assert from "node:assert/strict";
import { test } from "node:test";

import { actorFrom, businessCategory, num } from "../apify";

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

test('categoria "None" do actor vira null', () => {
  assert.equal(businessCategory("None"), null);
  assert.equal(businessCategory(undefined), null);
  assert.equal(businessCategory("Software Company"), "Software Company");
});

test("actor vazio ou ausente cai no padrao", () => {
  assert.equal(actorFrom(undefined, "apify~x"), "apify~x");
  assert.equal(actorFrom("", "apify~x"), "apify~x");
  assert.equal(actorFrom("  ", "apify~x"), "apify~x");
  assert.equal(actorFrom("outro~actor", "apify~x"), "outro~actor");
});
