import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { weatherLabel } from './index.js';
// Réponse réelle d'Open-Meteo pour Brest (48.39, -4.49), relevée le 2026-11-08, sur 7 jours :
// le module n'en garde que le nombre réglé, même si Open-Meteo en renvoie plus.
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
  // Les jours suivants, et seulement ceux demandés (3 jours, aujourd'hui compris), alors que
  // la réponse en compte 7.
  assert.deepEqual(
    result.card.items.map((item) => item.label),
    ['demain', 'mardi'],
  );
  assert.match(result.presentation.summary, /^Météo à Brest : 7 \/ 14 °C, couvert\./u);
  assert.match(result.presentation.summary, /Risque de pluie 60 %\./u);
  // Demain, avec « °C » intact à l'oral.
  assert.match(result.presentation.summary, /Demain 10 \/ 14 °C, pluie faible\./u);
  assert.doesNotMatch(result.presentation.summary, /°c/u);
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '48.39');
  assert.equal(url.searchParams.get('longitude'), '-4.49');
  // Affichage permanent : températures, temps et source (CC BY 4.0), jusqu'à minuit.
  const ambient = f.ambient().content;
  assert.equal(ambient?.value, '7 / 14 °C');
  assert.equal(ambient?.subtitle, 'Brest · Couvert · Open-Meteo');
  assert.equal(ambient?.refreshAt, '2026-11-08T23:00:00.000Z');
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
  // Le premier jour gardé est demain : il est dit comme tel, jamais « aujourd'hui ».
  assert.equal(result.card.primaryValue, '10 / 14 °C');
  assert.equal(result.card.subtitle, 'Brest · Demain · Pluie faible');
  assert.match(result.presentation.summary, /^Météo à Brest, demain : 10 \/ 14 °C/u);
  assert.match(result.presentation.summary, /Mardi 12 \/ 15 °C, pluie faible\./u);
  assert.doesNotMatch(result.presentation.summary, /Demain/u);
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

test('pannes : première panne sans données, lieu refusé, quota, réponse illisible ou incomplète', async (t) => {
  const { temperature_2m_max: _max, ...withoutMax } = payload.daily;
  for (const [route, code] of [
    [{ status: 503 }, 'unavailable'],
    [{ status: 400 }, 'config_invalid'],
    [{ status: 429 }, 'quota'],
    [{ status: 200, body: 'pas du json' }, 'malformed'],
    [{ latitude: 0 }, 'malformed'],
    // Colonne exigée absente, ou aucun jour exploitable : jamais un succès vide.
    [{ ...payload, daily: {} }, 'malformed'],
    [{ ...payload, daily: withoutMax }, 'malformed'],
    [
      {
        ...payload,
        daily: { ...payload.daily, temperature_2m_min: payload.daily.time.map(() => null) },
      },
      'malformed',
    ],
  ] as const) {
    const f = setup(t);
    f.route({ 'api.open-meteo.com': route });
    const result = await f.read();
    assert.equal(result.ok, false, JSON.stringify(route));
    if (!result.ok) assert.equal(result.error.code, code, JSON.stringify(route));
    assert.equal(f.instances.getSnapshot(f.instance)?.data, null);
  }
});

test('vent fort dit à l’oral, coordonnées arrondies à 2 décimales', async (t) => {
  const f = setup(t, { ...brest, latitude: 48.390_456, longitude: -4.486_789 });
  const wind = [52.4, ...payload.daily.wind_speed_10m_max.slice(1)];
  f.route({
    'api.open-meteo.com': { ...payload, daily: { ...payload.daily, wind_speed_10m_max: wind } },
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.presentation.summary, /Vent jusqu’à 52 km\/h\./u);
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.searchParams.get('latitude'), '48.39');
  assert.equal(url.searchParams.get('longitude'), '-4.49');
});

test('après minuit, la prévision de la veille n’est jamais donnée pour aujourd’hui', async (t) => {
  const f = setup(t, { ...brest, days: 1 });
  // 23 h 50 à Paris : la prévision du jour ne reste fraîche que jusqu'à minuit.
  f.at('2026-11-08T22:50:00Z');
  const evening = await f.read();
  assert.equal(evening.ok, true);
  f.at('2026-11-08T23:05:00Z');
  f.route({ 'api.open-meteo.com': { status: 503 } });
  const night = await f.read();
  assert.equal(f.calls.length, 2, 'relu après minuit, pas servi depuis le cache');
  assert.equal(night.ok, true);
  if (!night.ok) return;
  // Le seul jour connu est hier : pas de prévision plutôt qu'une fausse.
  assert.equal(night.card.primaryValue, null);
  assert.match(night.presentation.summary, /Pas de prévision à jour pour Brest/u);
});

test('une référence inconnue ne déclenche aucune requête', async (t) => {
  const f = setup(t);
  const result = await f.runtime.read(addon.id, null, 'autre', new AbortController().signal);
  assert.equal(result.ok, false);
  assert.equal(f.calls.length, 0);
});
