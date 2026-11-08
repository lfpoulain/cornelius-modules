import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { weatherLabel } from './index.js';
// Réponse réelle d'Open-Meteo pour Brest (48.39, -4.49), relevée le 2026-11-08.
import payload from './fixtures/brest.json' with { type: 'json' };

const brest = { place: 'Brest', latitude: 48.39, longitude: -4.49, days: 3 };
const setup = (t: { after(fn: () => void): void }, config: Record<string, unknown> = brest) =>
  createTestModule(t, addon, {
    config,
    at: '2026-11-08T09:00:00Z',
    routes: { 'api.open-meteo.com': payload },
  });

test('définition, réglages, contrat et adresse interrogée', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { ...brest, latitude: 91 }).ok, false);
  assert.equal(f.runtime.validateConfig(addon.id, { ...brest, days: 8 }).ok, false);
  assert.equal(f.runtime.validateConfig(addon.id, { ...brest, place: '' }).ok, false);
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, '7 / 14 °C');
  assert.equal(result.card.subtitle, 'Brest · Couvert');
  // Les jours suivants, et seulement ceux demandés (3 jours, aujourd'hui compris).
  assert.deepEqual(
    result.card.items.map((item) => item.label),
    ['lundi', 'mardi'],
  );
  assert.match(result.presentation.summary, /^Météo à Brest : 7 \/ 14 °C, couvert\./u);
  assert.match(result.presentation.summary, /Risque de pluie 60 %\./u);
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '48.39');
  assert.equal(url.searchParams.get('longitude'), '-4.49');
  assert.equal(url.searchParams.get('forecast_days'), '3');
  // Les jours suivent le fuseau du foyer.
  assert.equal(url.searchParams.get('timezone'), 'Europe/Paris');
  assert.ok(f.calls[0]?.signal);
});

test('les lectures simultanées et le cache frais ne doublent pas la collecte', async (t) => {
  const f = setup(t);
  const [first, second] = await Promise.all([f.read(), f.read()]);
  assert.equal(first.ok && second.ok, true);
  await f.read();
  assert.equal(f.calls.length, 1);
});

test('codes météo de l’OMM traduits, code inconnu prudent', () => {
  assert.equal(weatherLabel(0), 'Ciel dégagé');
  assert.equal(weatherLabel(61), 'Pluie faible');
  assert.equal(weatherLabel(95), 'Orage');
  assert.equal(weatherLabel(42), 'Conditions variables');
  assert.equal(weatherLabel(null), 'Conditions variables');
});

test('le lendemain, le premier jour passé n’est plus annoncé', async (t) => {
  const f = setup(t, { ...brest, days: 7 });
  const first = await f.read();
  assert.equal(first.ok, true);
  f.advance(24 * 3_600_000);
  f.route({ 'api.open-meteo.com': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Relevé de la veille, gardé : il commence au 9 novembre (pluie faible).
  assert.equal(result.stale, true);
  assert.equal(result.card.subtitle, 'Brest · Pluie faible');
  assert.match(result.presentation.summary, /^Dernière prévision connue à Brest/u);
  assert.equal(f.runtime.toolResult(result).status, 'stale');
});

test('une température absente écarte le jour, sans valeur inventée', async (t) => {
  const f = setup(t);
  const daily = { ...payload.daily, temperature_2m_min: [null, 9.8, 12.4] };
  f.route({ 'api.open-meteo.com': { ...payload, daily } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, '10 / 14 °C');
  // Probabilité de pluie absente : pas de phrase sur la pluie.
  f.advance(31 * 60_000);
  f.route({
    'api.open-meteo.com': {
      ...payload,
      daily: { ...payload.daily, precipitation_probability_max: [null, null, null] },
    },
  });
  const later = await f.read();
  assert.equal(later.ok, true);
  if (later.ok) assert.doesNotMatch(later.presentation.summary, /Risque de pluie/u);
});

test('pannes : première panne sans données, lieu refusé, quota, réponse illisible', async (t) => {
  for (const [route, code] of [
    [{ status: 503 }, 'unavailable'],
    [{ status: 400 }, 'config_invalid'],
    [{ status: 429 }, 'quota'],
    [{ status: 200, body: 'pas du json' }, 'malformed'],
    [{ latitude: 0 }, 'malformed'],
  ] as const) {
    const f = setup(t);
    f.route({ 'api.open-meteo.com': route });
    const result = await f.read();
    assert.equal(result.ok, false, JSON.stringify(route));
    if (!result.ok) assert.equal(result.error.code, code, JSON.stringify(route));
    assert.equal(f.instances.getSnapshot(f.instance)?.data, null);
  }
});

test('une référence inconnue ne déclenche aucune requête', async (t) => {
  const f = setup(t);
  const result = await f.runtime.read(addon.id, null, 'autre', new AbortController().signal);
  assert.equal(result.ok, false);
  assert.equal(f.calls.length, 0);
});
