import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { arretDit, destinationFor, lieuDit, reseauDit, vehiculeDit } from './index.js';
// Relevés réels du 2026-11-12 à 14 h 23 UTC (9 h 23 à Gatineau), lieux publics seulement :
// géocodage, itinéraire et passages de Transitous, dont l'heure réelle de la STO.
import transitousGappe from './fixtures/transitous-gappe.json' with { type: 'json' };
import transitousPromenades from './fixtures/transitous-promenades.json' with { type: 'json' };

const at = '2026-11-12T14:23:00Z';
const cle = (url: URL) => {
  url.searchParams.delete('time');
  return url.pathname.split('/').pop() + url.search;
};
const routes = (enregistrement: unknown) => (request: { url: string }) =>
  (enregistrement as Record<string, Record<string, unknown>>)[cle(new URL(request.url))] ?? {
    status: 404,
  };
const source = (adresseDepart: string) => ({ depart: 'le départ', adresseDepart, favoris: [] });

test('Rapibus à l’heure réelle de la STO, depuis la station de la Gappe', async (t) => {
  const f = createTestModule(t, addon, {
    config: source('Station de la Gappe'),
    at,
    routes: routes(transitousGappe),
  });
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  // Montréal est hors de la zone de la STO.
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...source('x'), latitude: 45.5, longitude: -73.56 }).ok,
    false,
  );
  const result = await f.invoke('trajet', { query: 'à la Colline du Parlement' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    'Pour te rendre à la Colline du Parlement, le prochain départ est l’autobus 400 dans 6 minutes, à la station de la Gappe, à 2 minutes à pied. ' +
      'La durée du trajet est de 36 minutes. Le suivant est prévu dans 15 minutes.',
  );
  const plan = f.calls.find((call) => call.url.includes('/v5/plan'))!;
  assert.match(plan.headers?.['User-Agent'] ?? '', /^Cornelius-module-/u);
});

test('heure réelle puis horaire prévu, depuis les Promenades', async (t) => {
  const f = createTestModule(t, addon, {
    config: source('Promenades Gatineau'),
    at,
    routes: routes(transitousPromenades),
  });
  const result = await f.invoke('trajet', { query: 'au Musée canadien de l’histoire' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(
    result.tool.summary,
    'Pour te rendre au Musée canadien de l’histoire, le prochain départ est l’autobus 67 dans 9 minutes, à l’arrêt Les Promenades, à 2 minutes à pied. ' +
      'La durée du trajet est de 23 minutes. Le suivant est prévu dans 29 minutes selon l’horaire.',
  );
});

test('sans adresse ni coordonnées de départ, réglage incomplet', async (t) => {
  const f = createTestModule(t, addon, {
    config: { depart: 'la maison', favoris: [] },
    at,
    routes: routes(transitousGappe),
  });
  const result = await f.invoke('trajet', { query: 'à la Colline du Parlement' });
  assert.notEqual(result.tool.status, 'succeeded');
  assert.match(result.tool.error?.message ?? '', /adresse du départ/u);
});

test('réseaux, arrêts et destinations dits à la voix', () => {
  assert.equal(reseauDit({ agencyId: 'STO', agencyName: 'STO' }), '');
  assert.equal(reseauDit({ agencyId: '1', agencyName: 'OC Transpo' }), ' d’OC Transpo');
  assert.equal(
    vehiculeDit({ mode: 'BUS', routeShortName: '95', agencyName: 'OC Transpo' }),
    'l’autobus 95 d’OC Transpo',
  );
  assert.equal(
    vehiculeDit({ mode: 'TRAM', routeShortName: '1', agencyName: 'OC Transpo' }),
    'l’O-Train, ligne 1',
  );
  assert.equal(arretDit('Station de la GAPPE #2'), 'station de la Gappe');
  assert.equal(arretDit('Cégep - UQO'), 'Cégep - UQO');
  assert.equal(lieuDit(arretDit('Station de la GAPPE #2')), 'à la station de la Gappe');
  assert.deepEqual(
    destinationFor({ depart: 'x', favoris: [] }, 'au Musée canadien de l’histoire, Gatineau'),
    {
      vers: 'au Musée canadien de l’histoire',
      adresse: 'Musée canadien de l’histoire, Gatineau',
    },
  );
});
