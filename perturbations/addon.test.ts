import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestModule, validateAddonDefinition } from '#cornelius/testing';
import addon from './index.js';

const feed = readFileSync(new URL('./fixtures/siri-sx.xml', import.meta.url), 'utf8');

const setup = (
  t: { after(fn: () => void): void },
  options: { config?: Record<string, unknown>; secret?: boolean } = {},
) =>
  createTestModule(t, addon, {
    at: '2026-10-29T07:30:00Z',
    timeZone: 'Europe/Zurich',
    config: options.config,
    ...(options.secret === false ? {} : { secrets: { siriSxToken: 'jeton-de-test' } }),
    routes: { '/siri-sx-unplanned': feed },
  });

test('définition conforme, outil annoncé et réglages par défaut valides', (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.deepEqual(
    f.runtime.tools().map((tool) => tool.name),
    ['perturbations__read'],
  );
});

test('les annonces des lignes et des arrêts surveillés sont retenues, les autres écartées', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // La ligne 7 (annoncée « 7 ») et l'arrêt Chailly passent ; la ligne 121 reste dehors.
  assert.equal(result.card.primaryValue, '2 perturbations');
  assert.deepEqual(
    result.card.items.map((item) => item.label),
    ['7, 8', 'Lausanne, Chailly-Village'],
  );
  // La version courte (taille S) est préférée à l'en-tête : c'est celle qui se dit à l'oral.
  assert.match(result.card.items[0]!.value, /Service irrégulier ligne 7/u);
  assert.match(result.card.items[1]!.value, /Arrêt Chailly-Village déplacé/u);
});

test('le jeton part dans l’en-tête Authorization, jamais dans l’adresse', async (t) => {
  const f = setup(t);
  await f.read();
  assert.equal(f.calls[0]?.headers?.Authorization, 'Bearer jeton-de-test');
  assert.equal(f.calls[0]?.url.includes('jeton'), false);
});

test('aucune annonce pour les lignes du foyer : le module le dit', async (t) => {
  const f = setup(t, { config: { lignes: 'B 99', arrets: '' } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.status, 'empty');
  assert.equal(result.card.primaryValue, 'Aucune');
  assert.match(result.presentation.summary, /Aucune perturbation signalée pour B 99/u);
});

test('sans jeton, le module refuse de lire sans appeler le flux', async (t) => {
  const f = setup(t, { secret: false });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'config_invalid');
  assert.match(result.error.message, /CORNELIUS_SIRI_SX_TOKEN/u);
  assert.equal(f.calls.length, 0);
});

test('un jeton refusé et un quota dépassé sont dits clairement', async (t) => {
  const refusé = setup(t);
  refusé.route({ '/siri-sx-unplanned': { status: 401 } });
  const unauthorized = await refusé.read();
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.error.code, 'auth');

  const limité = setup(t);
  limité.route({ '/siri-sx-unplanned': { status: 429 } });
  const quota = await limité.read();
  assert.equal(quota.ok, false);
  if (!quota.ok) {
    assert.equal(quota.error.code, 'quota');
    assert.match(quota.error.message, /deux appels par minute/u);
  }
});

test('une réponse qui n’est pas du SIRI-SX est refusée', async (t) => {
  const f = setup(t);
  f.route({ '/siri-sx-unplanned': '<html>maintenance</html>' });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'malformed');
});
