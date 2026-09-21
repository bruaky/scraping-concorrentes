import assert from "node:assert/strict";
import { test } from "node:test";

import { headlinePrice, jobsCount } from "../extract";

test("headlinePrice pega o plano pago mais barato", () => {
  const price = headlinePrice({
    plans: [
      { name: "Business", price: 99, currency: "USD" },
      { name: "Starter", price: 29, currency: "USD" },
    ],
  });
  assert.deepEqual(price, { price: 29, currency: "USD" });
});

test("headlinePrice ignora gratuito e 'fale conosco'", () => {
  // Plano sem valor entrando como 0 faria o placar mostrar "USD 0" e ler isso
  // como preco — e a informacao real e que nao ha preco publicado.
  const price = headlinePrice({
    plans: [
      { name: "Free", price: 0, currency: "USD" },
      { name: "Enterprise", price: null, currency: null },
      { name: "Pro", price: 49, currency: "USD" },
    ],
  });
  assert.deepEqual(price, { price: 49, currency: "USD" });
});

test("headlinePrice devolve null quando nao ha nenhum plano pago", () => {
  assert.equal(headlinePrice({ plans: [{ name: "Enterprise", price: null }] }), null);
  assert.equal(headlinePrice({ plans: [] }), null);
  assert.equal(headlinePrice(null), null);
});

test("jobsCount distingue 'zero vagas' de 'nao sabemos'", () => {
  assert.equal(jobsCount({ roles: [] }), 0);
  assert.equal(jobsCount({ roles: [{ title: "SWE" }] }), 1);
  // Extracao que falhou nao e zero vaga.
  assert.equal(jobsCount(null), null);
  assert.equal(jobsCount({}), null);
});
