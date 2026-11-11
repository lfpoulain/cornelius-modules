import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { destinationFor, surLaRue } from './index.js';
// Réponses réelles lues par le module le 2026-11-11 à 21 h 19 UTC (16 h 19 à Québec), d'un lieu
// public (Place D'Youville) vers l'Université Laval : Transitous (géocodage, itinéraire) et les
// données de l'appli Nomade du RTC (lignes, autobus en route, passages), rangées par adresse
// sans le paramètre `time`.
import nomade from './fixtures/nomade.json' with { type: 'json' };
import transitous from './fixtures/transitous.json' with { type: 'json' };

const at = '2026-11-11T21:19:00Z';
const youville = { depart: 'Place D’Youville', latitude: 46.812, longitude: -71.213, favoris: [] };
const cle = (raw: string) => {
  const url = new URL(raw);
  url.searchParams.delete('time');
  return url.pathname.split('/').pop() + url.search;
};
const routes =
  (rtc: 'ok' | 'panne' = 'ok') =>
  (request: { url: string }) => {
    const url = new URL(request.url);
    const enregistrees = (url.hostname.includes('rtcquebec') ? nomade : transitous) as Record<
      string,
      Record<string, unknown> | unknown[]
    >;
    if (url.hostname.includes('rtcquebec') && rtc === 'panne') return { status: 503 };
    return enregistrees[cle(request.url)] ?? { status: 404 };
  };
const setup = (
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = youville,
  rtc: 'ok' | 'panne' = 'ok',
) => createTestModule(t, addon, { config, at, routes: routes(rtc) });

test('trajet : passage réel du RTC, durée, correspondance et bus suivant', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, youville).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { ...youville, latitude: 45.5 }).ok, false);
  const result = await f.invoke('trajet', { query: 'à l’Université Laval' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  // Le 805 en route : heure réelle (sans « selon l'horaire ») ; le suivant n'a pas encore quitté
  // son terminus : horaire prévu.
  assert.equal(
    result.tool.summary,
    'Pour te rendre à l’Université Laval, le prochain autobus est le 805 dans 6 minutes, à l’arrêt H.-Mercier et Saint-Joachim, à 4 minutes à pied. ' +
      'La durée du trajet est de 42 minutes. Correspondance avec le 804. Le bus suivant est prévu dans 20 minutes selon l’horaire.',
  );
  // Le départ part arrondi à environ 100 m ; identification honnête, sans imiter l'appli Nomade.
  const plan = f.calls.find((call) => call.url.includes('/v5/plan'))!;
  assert.equal(new URL(plan.url).searchParams.get('fromPlace'), '46.812,-71.213');
  for (const call of f.calls)
    assert.match(call.headers?.['User-Agent'] ?? '', /^Cornelius-module-rtc/u);
});

test('Nomade en panne : l’horaire prévu est dit comme tel', async (t) => {
  const f = setup(t, youville, 'panne');
  const result = await f.invoke('trajet', { query: 'à l’Université Laval' });
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    "Pour te rendre à l’Université Laval, le prochain autobus est le 805 dans 6 minutes selon l’horaire, à l’arrêt D'Youville, à 4 minutes à pied. " +
      'La durée du trajet est de 42 minutes. Correspondance avec le 804. Le bus suivant est prévu dans 20 minutes selon l’horaire.',
  );
});

test('sans adresse ni coordonnées de départ, réglage incomplet', async (t) => {
  const f = setup(t, { depart: 'la maison', favoris: [] });
  const result = await f.invoke('trajet', { query: 'à l’Université Laval' });
  assert.notEqual(result.tool.status, 'succeeded');
  assert.match(result.tool.error?.message ?? '', /adresse du départ/u);
});

test('destinations et adresses refusées', () => {
  const favoris = [
    { nom: 'université', dit: 'à l’Université Laval', adresse: '2325 rue de l’Université, Québec' },
  ];
  const config = { ...youville, favoris };
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
  assert.throws(() => destinationFor(youville, undefined), /destination favorite/u);
  assert.equal(
    surLaRue('2325 rue de l’Université, Québec', { street: 'Rue de l’Université' }),
    true,
  );
  assert.equal(surLaRue('2325 rue de l’Université', { street: 'Rue de la Faune' }), false);
  assert.equal(surLaRue('1re Avenue et 41e Rue', { name: '41e Rue Est et 1re Avenue' }), true);
});
