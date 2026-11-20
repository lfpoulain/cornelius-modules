import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { arretDit, destinationFor, lieuDit, reseauDit, surLaRue } from './index.js';
// Relevé réel du 2026-11-20 à 20 h 59 UTC (15 h 59 à Québec), lieux publics seulement, de la gare
// du Palais à l'Université Laval : géocodage, itinéraire et passages de Transitous (horaires du
// RTC), rangés par adresse sans le paramètre `time`, réduits aux champs lus par le module.
import transitous from './fixtures/transitous-gare-du-palais.json' with { type: 'json' };

const at = '2026-11-20T20:59:00Z';
const garePalais = { adresseDepart: 'Gare du Palais', favoris: [] };
const cle = (raw: string) => {
  const url = new URL(raw);
  url.searchParams.delete('time');
  return url.pathname.split('/').pop() + url.search;
};
const routes = (request: { url: string }) =>
  (transitous as unknown as Record<string, Record<string, unknown>>)[cle(request.url)] ?? {
    status: 404,
  };
const setup = (t: { after(fn: () => void): void }, config: Record<string, unknown> = garePalais) =>
  createTestModule(t, addon, { config, at, routes });

test('trajet : autobus du RTC à l’horaire, durée du trajet, depuis la gare du Palais', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, garePalais).ok, true);
  // Montréal est hors de la zone du RTC.
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...garePalais, latitude: 45.5, longitude: -73.56 }).ok,
    false,
  );
  const result = await f.invoke('trajet', { query: 'à l’Université Laval' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  // Le 807 part du terminus D'Youville, au-delà des 30 passages lus à cet arrêt très desservi :
  // son heure vient de l'itinéraire. Aucun suivant n'est connu, aucun n'est dit.
  assert.equal(
    result.tool.summary,
    'Pour te rendre à l’Université Laval, le prochain départ est l’autobus 807 dans 20 minutes selon l’horaire, au terminus D’Youville, à 13 minutes à pied. ' +
      'La durée du trajet est de 48 minutes. Correspondance avec l’autobus 79.',
  );
  // Seul Transitous est interrogé, avec le User-Agent du cœur.
  for (const call of f.calls) {
    assert.match(call.url, /^https:\/\/api\.transitous\.org\//u);
    assert.equal(call.headers?.['User-Agent'], undefined);
  }
  const plan = f.calls.find((call) => call.url.includes('/v5/plan'))!;
  assert.equal(new URL(plan.url).searchParams.get('fromPlace'), '46.818,-71.214');
});

test('sans adresse ni coordonnées de départ, réglage incomplet', async (t) => {
  const f = setup(t, { favoris: [] });
  const result = await f.invoke('trajet', { query: 'à l’Université Laval' });
  assert.notEqual(result.tool.status, 'succeeded');
  assert.match(result.tool.error?.message ?? '', /adresse du départ/u);
});

test('destinations, adresses refusées et arrêts dits à la voix', () => {
  const favoris = [
    { nom: 'université', dit: 'à l’Université Laval', adresse: '2325 rue de l’Université, Québec' },
  ];
  const config = { ...garePalais, favoris };
  assert.deepEqual(destinationFor(config, 'comment je vais à l’université'), {
    vers: 'à l’Université Laval',
    adresse: '2325 rue de l’Université, Québec',
  });
  assert.deepEqual(destinationFor(config, 'au Château Frontenac'), {
    vers: 'au Château Frontenac',
    adresse: 'Château Frontenac',
  });
  assert.deepEqual(destinationFor(config, 'chez Marie, 123 rue X'), {
    vers: 'chez Marie',
    adresse: 'chez Marie, 123 rue X',
  });
  assert.equal(destinationFor(config, undefined).vers, 'à l’Université Laval');
  assert.throws(() => destinationFor(garePalais, undefined), /destination favorite/u);
  assert.equal(
    surLaRue('2325 rue de l’Université, Québec', { street: 'Rue de l’Université' }),
    true,
  );
  assert.equal(surLaRue('2325 rue de l’Université', { street: 'Rue de la Faune' }), false);
  assert.equal(
    surLaRue('boulevard Laurier et route de l’Église', {
      name: 'Route de l’Église et boulevard Laurier',
    }),
    true,
  );
  assert.equal(arretDit("T. D'Youville"), 'terminus D’Youville');
  assert.equal(lieuDit(arretDit("T. D'Youville")), 'au terminus D’Youville');
  assert.equal(arretDit('H.-Mercier / Saint-Joachim'), 'H.-Mercier et Saint-Joachim');
  assert.equal(reseauDit({ agencyName: 'Réseau de transport de la Capitale' }), '');
});
