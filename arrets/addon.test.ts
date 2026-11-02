import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule, validateAddonDefinition } from '#cornelius/testing';
import addon from './index.js';
import locations from './fixtures/locations.json' with { type: 'json' };
import stationboard from './fixtures/stationboard.json' with { type: 'json' };
import connections from './fixtures/connections.json' with { type: 'json' };

/** Table des arrêts de Bel-Air, pour vérifier que la question choisit le bon. */
const belAir = {
  station: { id: '8588431', name: 'Lausanne, Bel-Air' },
  stationboard: [
    {
      category: 'B',
      number: '8',
      name: 'B 8',
      to: 'Lausanne, Ouchy',
      stop: { departure: '2026-10-29T00:18:00+0100', delay: 0, platform: null },
    },
    {
      category: 'M',
      number: 'm2',
      name: 'm2',
      to: 'Lausanne, gare',
      stop: { departure: '2026-10-29T00:22:00+0100', delay: 0, platform: '2' },
    },
  ],
};

const setup = (
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  at = '2026-10-28T23:10:00Z',
) =>
  createTestModule(t, addon, {
    at,
    timeZone: 'Europe/Zurich',
    config,
    routes: {
      '/locations': locations,
      '/connections': connections,
      '/stationboard': (request) => (request.url.includes('id=8588431') ? belAir : stationboard),
    },
  });

test('définition conforme et outils annoncés', (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.deepEqual(
    f.runtime.tools().map((tool) => tool.name),
    ['arrets__read', 'arrets__ask', 'arrets__trajet', 'arrets__partir'],
  );
});

test('l’arrêt habituel donne une ligne par direction, la plus proche, sans les départs passés', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(f.calls[0]?.url.includes('station=Lausanne%2C+Chailly-Village'));
  assert.equal(result.card.primaryValue, '3 lignes');
  assert.equal(result.card.subtitle, 'Lausanne, Chailly-Village');
  // Le doublon de la B 7 vers Prilly est fondu : la première heure gagne.
  assert.deepEqual(result.card.items, [
    { label: 'B 7', value: '→ Prilly-M., gare · 00:19' },
    { label: 'B 7', value: '→ Pully, Val-Vert · 00:21' },
    { label: 'B 8', value: '→ Lausanne, Bel-Air · 00:25 (+2)' },
  ]);
  assert.equal(result.presentation.summary.startsWith('À Lausanne, Chailly-Village : B 7'), true);
});

test('une question nomme un autre arrêt de la ville et trouve ses correspondances', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('ask', { query: 'Bel-Air' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.ok(f.calls[0]?.url.includes('/locations'));
  assert.ok(f.calls[0]?.url.includes('Lausanne+Bel-Air'));
  assert.ok(f.calls[1]?.url.includes('id=8588431'));
  assert.equal(invoked.outcome.card.subtitle, 'Lausanne, Bel-Air');
  assert.equal(invoked.outcome.card.primaryValue, '2 lignes');
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('la question ne garde que les arrêts de la ville configurée', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('ask', { query: 'Bel-Air' });
  assert.equal(invoked.outcome.ok, true);
  // Genève, Bel-Air est écarté : seul l'arrêt lausannois est demandé au flux.
  assert.ok(f.calls[1]?.url.includes('id=8588431'));
  assert.equal(f.calls[1]?.url.includes('8590000'), false);
});

test('le nom qui commence par la demande passe avant celui qui la contient', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('ask', { query: 'Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  // « Ouchy-Olympique » l'emporte sur « Croix d'Ouchy » et sur le débarcadère des bateaux.
  assert.ok(f.calls[1]?.url.includes('id=8588440'));
  assert.equal(f.calls[1]?.url.includes('8588441'), false);
});

test('un nom français de gare germanophone est traduit', async (t) => {
  const f = setup(t, { ville: null });
  const invoked = await f.invoke('ask', { query: 'Berne' });
  assert.equal(invoked.outcome.ok, true);
  // « Bern » est cherché avant « Berne », qui attirerait « Berneuse ».
  assert.ok(f.calls[0]?.url.includes('query=Bern'));
  // Le tableau de départs est simulé : on vérifie l'identifiant demandé, pas le nom affiché.
  assert.ok(f.calls[1]?.url.includes('id=8507000'));
});

test('sans ville, la recherche porte sur toute la Suisse', async (t) => {
  const f = setup(t, { ville: null });
  const invoked = await f.invoke('ask', { query: 'Bel-Air' });
  assert.equal(invoked.outcome.ok, true);
  // Aucun préfixe de ville dans la recherche.
  assert.ok(f.calls[0]?.url.includes('query=Bel-Air'));
  assert.equal(f.calls[0]?.url.includes('Lausanne'), false);
});

test('un trajet donne la durée, les heures et le nombre de correspondances', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'Chailly > Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.ok(f.calls[2]?.url.includes('/connections'));
  assert.ok(f.calls[2]?.url.includes('from=8588432'));
  assert.ok(f.calls[2]?.url.includes('to=8588440'));
  assert.equal(invoked.outcome.card.primaryValue, '49 min');
  assert.equal(
    invoked.outcome.card.subtitle,
    'Lausanne, Chailly-Village → Lausanne, Ouchy-Olympique',
  );
  // Le trajet direct s'affiche par tronçon : c'est ce que montre le miroir.
  assert.deepEqual(invoked.outcome.card.items[0], {
    label: 'B 6 · 00:18',
    value: 'Lausanne, Chailly-Village → Lausanne, Ouchy-Olympique',
  });
  assert.match(invoked.outcome.presentation.summary, /sans correspondance/u);
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('un trajet avec changement donne les tronçons et l’arrêt où l’on change', async (t) => {
  const f = setup(t);
  f.route({
    '/connections': {
      connections: [
        {
          from: { departure: '2026-10-29T00:41:00+0100' },
          to: { arrival: '2026-10-29T01:02:00+0100' },
          duration: '00d00:21:00',
          transfers: 1,
          products: ['B 7', 'm2'],
          sections: [
            {
              departure: {
                station: { name: 'Lausanne, Chailly-Village' },
                departure: '2026-10-29T00:41:00+0100',
                platform: null,
              },
              arrival: {
                station: { name: 'Lausanne, Ours' },
                arrival: '2026-10-29T00:47:00+0100',
              },
              journey: { category: 'B', number: '7' },
            },
            {
              departure: {
                station: { name: 'Lausanne, Ours' },
                departure: '2026-10-29T00:52:00+0100',
                platform: '2',
              },
              arrival: {
                station: { name: 'Lausanne, Ouchy-Olympique' },
                arrival: '2026-10-29T01:02:00+0100',
              },
              journey: { category: 'M', number: 'm2' },
            },
          ],
        },
      ],
    },
  });
  const invoked = await f.invoke('trajet', { query: 'Chailly > Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.deepEqual(invoked.outcome.card.items, [
    { label: 'B 7 · 00:41', value: 'Lausanne, Chailly-Village → Lausanne, Ours' },
    { label: 'm2 · 00:52', value: 'Lausanne, Ours → Lausanne, Ouchy-Olympique' },
  ]);
  assert.match(invoked.outcome.presentation.summary, /Changement à Lausanne, Ours \(5 min\)/u);
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('« ici » part de l’arrêt habituel, sans le nommer', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'ici > Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  // Une seule recherche d'arrêt : celle de la destination.
  assert.ok(f.calls[0]?.url.includes('/locations'));
  assert.ok(f.calls[1]?.url.includes('/connections'));
  assert.ok(f.calls[1]?.url.includes('from=Lausanne%2C+Chailly-Village'));
});

test('un bout inconnu du trajet est dit, sans calculer', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'Chailly > Zzz-Inconnu' });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'not_found');
  assert.equal(
    f.calls.some((call) => call.url.includes('/connections')),
    false,
  );
});

test('un arrêt inconnu est dit tel quel, sans interroger le flux', async (t) => {
  const f = setup(t);
  f.route({ '/locations': { stations: [] } });
  const invoked = await f.invoke('ask', { query: 'Nulle-Part' });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'not_found');
  assert.match(invoked.outcome.error.message, /Aucun arrêt « Nulle-Part » trouvé à Lausanne/u);
  assert.equal(f.calls.length, 1);
});

test('une question vide ne part pas', async (t) => {
  const f = setup(t);
  for (const query of ['', '   ']) {
    const invoked = await f.invoke('ask', { query });
    assert.equal(invoked.outcome.ok, false);
    if (invoked.outcome.ok === false) assert.equal(invoked.outcome.error.code, 'invalid_params');
  }
  assert.equal(f.calls.length, 0);
});

test('la limite de lignes est respectée', async (t) => {
  const f = setup(t, { limite: 3 });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.items.length, 3);
});

test('un flux en panne devient une erreur compréhensible', async (t) => {
  const f = setup(t);
  f.route({ '/stationboard': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'unavailable');
});

test('une heure d’arrivée donne le dernier départ utile et la marge', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 1, minute: 30 });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  const url = f.calls.find((call) => call.url.includes('/connections'))?.url ?? '';
  // La question est posée à l'envers : on demande les trajets qui arrivent avant 01:30.
  assert.ok(url.includes('isArrivalTime=1'));
  assert.ok(url.includes('time=01%3A30'));
  // Deux trajets arrivent avant 01:30 : c'est le plus tardif qui compte, pas le plus rapide.
  assert.equal(invoked.outcome.card.primaryValue, '00:41');
  assert.equal(
    invoked.outcome.card.subtitle,
    'Lausanne, Chailly-Village → Lausanne, Ouchy-Olympique',
  );
  assert.deepEqual(invoked.outcome.card.items[0], {
    label: '00:41 → 01:02',
    value: '21 min · 1 correspondance · B 7, m2',
  });
  // Arrivée à 01:02 pour une échéance de 01:30 : vingt-huit minutes d'avance.
  assert.match(invoked.outcome.presentation.summary, /28 minutes d’avance/u);
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('une échéance vaut pour un autre départ que l’arrêt habituel', async (t) => {
  const f = setup(t);
  // Rien ne limite la question au trajet maison-bureau : n'importe quel couple d'arrêts.
  const invoked = await f.invoke('partir', { query: 'Bel-Air > Ouchy', heure: 1, minute: 30 });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.equal(invoked.outcome.card.subtitle, 'Lausanne, Bel-Air → Lausanne, Ouchy-Olympique');
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('le mot « bureau » désigne la destination réglée', async (t) => {
  const f = setup(t, { bureau: 'Lausanne, Bel-Air' });
  // La personne dit « bureau » : la source le traduit en arrêt, sans le faire épeler.
  const invoked = await f.invoke('partir', { query: 'bureau', heure: 1, minute: 30 });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.equal(invoked.outcome.card.subtitle, 'Lausanne, Chailly-Village → Lausanne, Bel-Air');
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('sans heure d’arrivée, aucun calcul d’échéance n’est lancé', async (t) => {
  const f = setup(t);
  // L'outil est prévu pour être appelé après avoir demandé l'heure ; s'il arrive quand même
  // sans elle, le module répond comme à une question d'arrêt, sans interroger les trajets.
  const invoked = await f.invoke('partir', { query: 'Bel-Air' });
  assert.equal(invoked.outcome.ok, true);
  assert.equal(
    f.calls.some((call) => call.url.includes('/connections')),
    false,
  );
});

test('aucun trajet n’arrive avant l’heure demandée : le module le dit', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 0, minute: 30 });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'not_found');
  assert.match(invoked.outcome.error.message, /Aucun trajet n’arrive avant 00:30/u);
});

test('le soir, « 9 h » vise le lendemain matin', async (t) => {
  // 22 h locales : l'échéance de 9 h est le lendemain, pas le matin déjà passé.
  const f = setup(t, {}, '2026-10-29T21:00:00Z');
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 9, minute: 0 });
  assert.equal(invoked.outcome.ok, true);
  const url = f.calls.find((call) => call.url.includes('/connections'))?.url ?? '';
  assert.ok(url.includes('date=2026-10-30'));
  assert.ok(url.includes('time=09%3A00'));
});

test('un arrêt sans départ affiche une carte, sans lever d’exception', async (t) => {
  const f = setup(t);
  f.route({
    '/stationboard': { station: { name: 'Lausanne, Chailly-Village' }, stationboard: [] },
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Aucun départ');
  assert.match(result.presentation.summary, /Aucun départ prévu/u);
  assert.deepEqual(f.contract(result), []);
});
