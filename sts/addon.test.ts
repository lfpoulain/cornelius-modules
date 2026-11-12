import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { arretDit, destinationFor, lieuDit, reseauDit } from './index.js';
// Relevés réels du 2026-11-12 vers 14 h 31 UTC (9 h 31 à Sherbrooke), lieux publics seulement :
// géocodage, itinéraire et passages de Transitous (horaires de la STS, sans temps réel).
import transitousCarrefour from './fixtures/transitous-carrefour.json' with { type: 'json' };
import transitousCentre from './fixtures/transitous-centre.json' with { type: 'json' };

const cle = (url: URL) => {
  url.searchParams.delete('time');
  return url.pathname.split('/').pop() + url.search;
};
const routes = (enregistrement: unknown) => (request: { url: string }) =>
  (enregistrement as Record<string, Record<string, unknown>>)[cle(new URL(request.url))] ?? {
    status: 404,
  };
const source = (adresseDepart: string) => ({ depart: 'le départ', adresseDepart, favoris: [] });

test('depuis le Carrefour de l’Estrie, apostrophe typographique comprise', async (t) => {
  const f = createTestModule(t, addon, {
    // Écrit avec l'apostrophe typographique, comme le fait souvent le modèle vocal.
    config: source('Carrefour de l’Estrie'),
    at: '2026-11-12T14:32:00Z',
    routes: routes(transitousCarrefour),
  });
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  // Québec est hors de la zone de la STS.
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...source('x'), latitude: 46.81, longitude: -71.21 }).ok,
    false,
  );
  const result = await f.invoke('trajet', { query: 'à l’Université de Sherbrooke' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    "Pour te rendre à l’Université de Sherbrooke, le prochain départ est l’autobus 11 dans 19 minutes selon l’horaire, à l’arrêt Carrefour de l'Estrie, à 2 minutes à pied. " +
      'La durée du trajet est de 16 minutes. Le suivant est prévu dans 48 minutes selon l’horaire.',
  );
  // Le géocodeur reçoit l'apostrophe droite : avec la typographique, il cherchait en France.
  const geocode = f.calls.find((call) => call.url.includes('/v1/geocode'))!;
  assert.equal(new URL(geocode.url).searchParams.get('text'), "Carrefour de l'Estrie");
});

test('depuis le centre-ville, King et Wellington', async (t) => {
  const f = createTestModule(t, addon, {
    config: source('King et Wellington, Sherbrooke'),
    at: '2026-11-12T14:31:00Z',
    routes: routes(transitousCentre),
  });
  const result = await f.invoke('trajet', { query: 'au Cégep de Sherbrooke' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(
    result.tool.summary,
    'Pour te rendre au Cégep de Sherbrooke, le prochain départ est l’autobus 3 dans 4 minutes selon l’horaire, à l’arrêt King et Wellington, à 1 minute à pied. ' +
      'La durée du trajet est de 15 minutes. Le suivant est prévu dans 24 minutes selon l’horaire.',
  );
});

test('sans adresse ni coordonnées de départ, réglage incomplet', async (t) => {
  const f = createTestModule(t, addon, {
    config: { depart: 'la maison', favoris: [] },
    at: '2026-11-12T14:31:00Z',
    routes: routes(transitousCentre),
  });
  const result = await f.invoke('trajet', { query: 'au Cégep de Sherbrooke' });
  assert.notEqual(result.tool.status, 'succeeded');
  assert.match(result.tool.error?.message ?? '', /adresse du départ/u);
});

test('réseau, arrêts et destinations dits à la voix', () => {
  assert.equal(reseauDit({ agencyName: 'Société de Transport de Sherbrooke' }), '');
  assert.equal(arretDit('King / Wellington'), 'King et Wellington');
  assert.equal(arretDit('CHUS Fleurimont'), 'CHUS Fleurimont');
  assert.equal(lieuDit('King et Wellington'), 'à l’arrêt King et Wellington');
  assert.deepEqual(destinationFor({ depart: 'x', favoris: [] }, 'à l’Université de Sherbrooke'), {
    vers: 'à l’Université de Sherbrooke',
    adresse: 'Université de Sherbrooke',
  });
});
