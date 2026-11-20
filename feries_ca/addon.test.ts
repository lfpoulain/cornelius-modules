import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { bref, dans, dit, nomCourt, nomDuFerie } from './index.js';
// Réponses réelles de canada-holidays.ca du 2026-11-12 : Québec, Ontario et liste fédérale,
// années 2026 et 2027.
import enregistrement from './fixtures/canada-holidays.json' with { type: 'json' };

const routes = (request: { url: string }) => {
  const url = new URL(request.url);
  const cle = url.pathname.replace('/api/v1/', '') + url.search;
  return (
    (enregistrement as Record<string, { status: number; body: unknown }>)[cle] ?? { status: 404 }
  );
};
const zone = 'America/Toronto';

test('Québec : le prochain jour férié, les suivants, sans réseau inutile', async (t) => {
  const f = createTestModule(t, addon, {
    config: { province: 'Québec' },
    // 12 novembre 2026, 9 h à Québec.
    at: '2026-11-12T14:00:00Z',
    timeZone: zone,
    routes,
  });
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { province: 'Québec ' }).ok, false);
  const result = await f.invoke('read', {});
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    'Le prochain jour férié au Québec : Noël, le vendredi 25 décembre, dans 43 jours. ' +
      'Ensuite : le Jour de l’An, le vendredi 1er janvier ; le Vendredi saint ou lundi de Pâques, au choix de l’employeur, le vendredi 26 mars.',
  );
  // L'année en cours et la suivante, une seule fois chacune.
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => call.url.includes('/provinces/QC?year=202')));
  const card = result.outcome.ok ? result.outcome.card : null;
  assert.equal(card?.title, 'Jours fériés · Québec');
  assert.equal(card?.primaryValue, 'Dans 43 jours');
  // Sur le miroir, des noms courts : un nom long écrasait la date (« 26 mar / s »).
  assert.deepEqual(f.ambient().content?.items, [
    { label: 'Jour de l’An', value: '1er janv.' },
    { label: 'Vendredi saint', value: '26 mars' },
  ]);
});

test('le jour même, puis le compte à rebours sur le miroir', async (t) => {
  const f = createTestModule(t, addon, {
    config: { province: 'Québec' },
    // 24 juin 2026, 10 h à Québec : Fête nationale.
    at: '2026-06-24T14:00:00Z',
    timeZone: zone,
    routes,
  });
  const result = await f.invoke('read', {});
  assert.match(
    result.tool.summary ?? '',
    /^Aujourd’hui, c’est la Fête nationale du Québec, jour férié au Québec\. Le suivant : /u,
  );
  const ambient = f.ambient().content;
  assert.equal(ambient?.value, 'Aujourd’hui');
  assert.equal(ambient?.subtitle, 'Fête nationale · 24 juin');
  assert.ok(ambient?.refreshAt, 'recalculé à minuit');
});

test('Ontario et employeurs fédéraux : leurs propres listes', async (t) => {
  const on = createTestModule(t, addon, {
    config: { province: 'Ontario' },
    at: '2026-12-20T15:00:00Z',
    timeZone: zone,
    routes,
  });
  const resultOn = await on.invoke('read', {});
  assert.match(resultOn.tool.summary ?? '', /^Le prochain jour férié en Ontario : /u);
  // Le lendemain de Noël est férié en Ontario, pas au Québec.
  assert.match(resultOn.tool.summary ?? '', /Lendemain de Noël/u);

  const fed = createTestModule(t, addon, {
    // Un employeur fédéral au Québec : la liste fédérale remplace celle du Québec.
    config: { province: 'Québec', employeurFederal: true },
    at: '2026-11-12T14:00:00Z',
    timeZone: zone,
    routes,
  });
  const resultFed = await fed.invoke('read', {});
  assert.equal(resultFed.tool.status, 'succeeded', resultFed.tool.error?.message);
  assert.match(
    resultFed.tool.summary ?? '',
    /^Le prochain jour férié pour les employeurs fédéraux : /u,
  );
  assert.ok(fed.calls.every((call) => call.url.includes('/holidays?federal=true&year=')));
  // Le choix Vendredi saint ou lundi de Pâques est propre à la loi québécoise : pas ici.
  assert.doesNotMatch(resultFed.tool.summary ?? '', /au choix de l’employeur/u);
  const card = resultFed.outcome.ok ? resultFed.outcome.card : null;
  assert.equal(card?.title, 'Jours fériés · fédéral');
  // « Fédéral » n'est plus une province.
  assert.equal(fed.runtime.validateConfig(addon.id, { province: 'Fédéral' }).ok, false);
});

test('service indisponible : erreur claire, à réessayer', async (t) => {
  const f = createTestModule(t, addon, {
    config: { province: 'Québec' },
    at: '2026-11-12T14:00:00Z',
    timeZone: zone,
    routes: () => ({ status: 503 }),
  });
  const result = await f.invoke('read', {});
  assert.equal(result.tool.status, 'failed');
  assert.equal(result.tool.error?.code, 'unavailable');
});

test('noms et dates', () => {
  assert.equal(
    nomDuFerie('Saint-Jean-Baptiste / Fête nationale du Québec', 'Québec'),
    'Fête nationale du Québec',
  );
  assert.equal(
    nomDuFerie('Vendredi saint', 'Québec'),
    'Vendredi saint ou lundi de Pâques, au choix de l’employeur',
  );
  assert.equal(nomDuFerie('Vendredi saint', 'Ontario'), 'Vendredi saint');
  assert.equal(dit('2027-01-01'), 'le vendredi 1er janvier');
  assert.equal(nomCourt('Fête nationale du Québec'), 'Fête nationale');
  assert.equal(nomCourt('Noël'), 'Noël');
  assert.equal(bref('2026-06-24'), '24 juin');
  assert.equal(dans('2026-12-24', '2026-12-25'), 'demain');
});
