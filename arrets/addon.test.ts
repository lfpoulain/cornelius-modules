import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule, validateAddonDefinition } from '#cornelius/testing';
import addon from './index.js';
import belAirSuisse from './fixtures/locations/bel-air.json' with { type: 'json' };
import bern from './fixtures/locations/bern.json' with { type: 'json' };
import lausanneBelAir from './fixtures/locations/lausanne-bel-air.json' with { type: 'json' };
import lausanneChailly from './fixtures/locations/lausanne-chailly.json' with { type: 'json' };
import lausanneLausanneBelAir from './fixtures/locations/lausanne-lausanne-bel-air.json' with { type: 'json' };
import lausanneOuchy from './fixtures/locations/lausanne-ouchy.json' with { type: 'json' };
import lausanneInconnu from './fixtures/locations/lausanne-zzz-inconnu.json' with { type: 'json' };
import stationboard from './fixtures/stationboard.json' with { type: 'json' };
import connections from './fixtures/connections.json' with { type: 'json' };

/**
 * Vraies réponses de /v1/locations (type=all, limit=20), relevées le 9 novembre 2026, rangées
 * par texte cherché. Une recherche absente de la table rend une liste vide, comme l'API pour un
 * nom inconnu (« Zzz-Inconnu » sans ville).
 */
const recherches: Record<string, Record<string, unknown>> = {
  'Lausanne Bel-Air': lausanneBelAir,
  'Lausanne Chailly': lausanneChailly,
  'Lausanne Ouchy': lausanneOuchy,
  'Lausanne Lausanne, Bel-Air': lausanneLausanneBelAir,
  'Lausanne Zzz-Inconnu': lausanneInconnu,
  Bern: bern,
  'Bel-Air': belAirSuisse,
};

const locations = (request: { url: string }) =>
  recherches[new URL(request.url).searchParams.get('query') ?? ''] ?? { stations: [] };

/** Identifiants réels de ces réponses. */
const ids = {
  belAir: '8591988',
  chailly: '8588432',
  ouchyOlympique: '8592086',
  ouchyLac: '8501075',
  geneveBelAir: '8587387',
  bern: '8507000',
};

/** Table des arrêts de Bel-Air, pour vérifier que la question choisit le bon. */
const belAir = {
  station: { id: ids.belAir, name: 'Lausanne, Bel-Air' },
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
      '/stationboard': (request) =>
        request.url.includes(`id=${ids.belAir}`) ? belAir : stationboard,
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
  assert.ok(f.calls[1]?.url.includes(`id=${ids.belAir}`));
  assert.equal(invoked.outcome.card.subtitle, 'Lausanne, Bel-Air');
  assert.equal(invoked.outcome.card.primaryValue, '2 lignes');
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('la question ne garde que les arrêts de la ville configurée', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('ask', { query: 'Bel-Air' });
  assert.equal(invoked.outcome.ok, true);
  // La réponse réelle contient aussi « Bel-Air LEB, Lausanne », une adresse sans virgule après
  // la ville : elle est écartée, seul l'arrêt lausannois est demandé au flux.
  assert.ok(f.calls[1]?.url.includes(`id=${ids.belAir}`));
});

test('le nom qui commence par la demande passe avant celui qui la contient', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('ask', { query: 'Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  // « Ouchy-Olympique » l'emporte sur « Croix d'Ouchy » et sur le débarcadère des bateaux.
  assert.ok(f.calls[1]?.url.includes(`id=${ids.ouchyOlympique}`));
  assert.equal(f.calls[1]?.url.includes(ids.ouchyLac), false);
});

test('un nom français de gare germanophone est traduit', async (t) => {
  const f = setup(t, { ville: null });
  const invoked = await f.invoke('ask', { query: 'Berne' });
  assert.equal(invoked.outcome.ok, true);
  // « Bern » est cherché avant « Berne », qui attirerait « Berneuse ».
  assert.ok(f.calls[0]?.url.includes('query=Bern'));
  // Le tableau de départs est simulé : on vérifie l'identifiant demandé, pas le nom affiché.
  assert.ok(f.calls[1]?.url.includes(`id=${ids.bern}`));
});

test('sans ville, la recherche porte sur toute la Suisse', async (t) => {
  const f = setup(t, { ville: null });
  const invoked = await f.invoke('ask', { query: 'Bel-Air' });
  assert.equal(invoked.outcome.ok, true);
  // Aucun préfixe de ville dans la recherche.
  assert.ok(f.calls[0]?.url.includes('query=Bel-Air'));
  assert.equal(f.calls[0]?.url.includes('Lausanne'), false);
  // À pertinence égale, l'ordre de l'API tranche : elle classe Genève avant Lausanne.
  assert.ok(f.calls[1]?.url.includes(`id=${ids.geneveBelAir}`));
});

test('un trajet donne la durée, les heures et le nombre de correspondances', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'Chailly > Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.ok(f.calls[2]?.url.includes('/connections'));
  assert.ok(f.calls[2]?.url.includes(`from=${ids.chailly}`));
  assert.ok(f.calls[2]?.url.includes(`to=${ids.ouchyOlympique}`));
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

/** Un trajet direct de Chailly à Ouchy, aux heures données, retard annoncé éventuel compris. */
function direct(depart: string, arrive: string, delay = 0) {
  return {
    from: {
      departure: depart,
      delay,
      // Sans retard, l'API annonce la même heure en prévision ; avec, on laisse le retard seul.
      prognosis: delay ? null : { departure: depart },
    },
    to: { arrival: arrive },
    duration: '00d00:30:00',
    transfers: 0,
    products: ['B 6'],
    sections: [
      {
        departure: {
          station: { name: 'Lausanne, Chailly-Village' },
          departure: depart,
          platform: null,
        },
        arrival: { station: { name: 'Lausanne, Ouchy-Olympique' }, arrival: arrive },
        journey: { category: 'B', number: '6', name: 'B 6' },
      },
    ],
  };
}

test('le soir, « 9 h » vise le lendemain matin', async (t) => {
  // 22 h locales : l'échéance de 9 h est le lendemain, pas le matin déjà passé.
  const f = setup(t, {}, '2026-10-29T21:00:00Z');
  f.route({
    '/connections': {
      connections: [direct('2026-10-30T08:20:00+0100', '2026-10-30T08:50:00+0100')],
    },
  });
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 9, minute: 0 });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  const url = f.calls.find((call) => call.url.includes('/connections'))?.url ?? '';
  assert.ok(url.includes('date=2026-10-30'));
  assert.ok(url.includes('time=09%3A00'));
  assert.equal(invoked.outcome.card.primaryValue, '08:20');
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('le soir, un trajet de la veille n’est pas proposé pour le lendemain', async (t) => {
  // Les itinéraires du fixture partent le 29 à 0 h 18 et 0 h 41 : à 22 h le 29, ils sont passés.
  const f = setup(t, {}, '2026-10-29T21:00:00Z');
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 9, minute: 0 });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.match(invoked.outcome.error.message, /Trop tard/u);
});

test('un départ déjà passé n’est pas proposé : le module dit qu’il est trop tard', async (t) => {
  // 8 h 50 à Lausanne, pour être à Ouchy à 9 h avec 30 minutes de trajet.
  const f = setup(t, {}, '2026-10-29T07:50:00Z');
  f.route({
    '/connections': {
      connections: [
        direct('2026-10-29T08:00:00+0100', '2026-10-29T08:30:00+0100'),
        direct('2026-10-29T08:20:00+0100', '2026-10-29T08:50:00+0100'),
      ],
    },
  });
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 9, minute: 0 });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'not_found');
  assert.match(
    invoked.outcome.error.message,
    /Trop tard pour arriver à Lausanne, Ouchy-Olympique à 09:00/u,
  );
});

test('seuls les départs à venir sont proposés, le plus tardif d’abord', async (t) => {
  // 8 h 10 : le départ de 8 h est passé, celui de 8 h 20 reste.
  const f = setup(t, {}, '2026-10-29T07:10:00Z');
  f.route({
    '/connections': {
      connections: [
        direct('2026-10-29T08:00:00+0100', '2026-10-29T08:30:00+0100'),
        direct('2026-10-29T08:20:00+0100', '2026-10-29T08:50:00+0100'),
      ],
    },
  });
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 9, minute: 0 });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.equal(invoked.outcome.card.primaryValue, '08:20');
  assert.equal(invoked.outcome.card.items.length, 1);
  // Le résumé vouvoie, comme le reste du module.
  assert.match(invoked.outcome.presentation.summary, /^Partez à 08:20/u);
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('un départ en retard reste proposé tant qu’il n’est pas parti', async (t) => {
  // 8 h 25 : le bus de 8 h 20 annonce 10 minutes de retard, il part donc à 8 h 30.
  const f = setup(t, {}, '2026-10-29T07:25:00Z');
  f.route({
    '/connections': {
      connections: [direct('2026-10-29T08:20:00+0100', '2026-10-29T08:50:00+0100', 10)],
    },
  });
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 9, minute: 0 });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.equal(invoked.outcome.card.primaryValue, '08:20');
});

test('l’heure transmise à l’API est l’heure suisse, quel que soit le fuseau du foyer', async (t) => {
  // Un foyer réglé sur Londres demande 9 h : c'est 10 h à Zurich, et c'est ce que lit l'API.
  const f = createTestModule(t, addon, {
    at: '2026-10-29T06:00:00Z',
    timeZone: 'Europe/London',
    routes: {
      '/locations': locations,
      '/connections': {
        connections: [direct('2026-10-29T09:20:00+0100', '2026-10-29T09:50:00+0100')],
      },
    },
  });
  const invoked = await f.invoke('partir', { query: 'Ouchy', heure: 9, minute: 0 });
  const url = f.calls.find((call) => call.url.includes('/connections'))?.url ?? '';
  assert.ok(url.includes('date=2026-10-29'));
  assert.ok(url.includes('time=10%3A00'));
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  // La carte reste à l'heure du foyer : départ à 8 h 20 à Londres, échéance de 9 h.
  assert.equal(invoked.outcome.card.primaryValue, '08:20');
  assert.match(invoked.outcome.presentation.summary, /échéance de 09:00/u);
});

test('un bus en retard reste au tableau tant qu’il n’est pas passé', async (t) => {
  const f = setup(t);
  // 0 h 10 : le bus de 0 h 05 annonce 8 minutes de retard, il n'est pas encore passé ; celui
  // de 0 h 05 à l'heure, si.
  f.route({
    '/stationboard': {
      station: { name: 'Lausanne, Chailly-Village' },
      stationboard: [
        {
          category: 'B',
          number: '7',
          name: 'B 7',
          to: 'Prilly-M., gare',
          stop: {
            departure: '2026-10-29T00:05:00+0100',
            delay: 8,
            platform: null,
            prognosis: { departure: '2026-10-29T00:13:00+0100' },
          },
        },
        {
          category: 'B',
          number: '8',
          name: 'B 8',
          to: 'Lausanne, Bel-Air',
          stop: { departure: '2026-10-29T00:05:00+0100', delay: 0, platform: null },
        },
      ],
    },
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.card.items, [{ label: 'B 7', value: '→ Prilly-M., gare · 00:05 (+8)' }]);
});

test('seuls les champs utiles sont demandés, et une réponse coupée est dite', async (t) => {
  const f = setup(t);
  f.route({ '/stationboard': { status: 200, body: '{"stationboard":[', truncated: true } });
  const result = await f.read();
  assert.ok(f.calls[0]?.url.includes('fields%5B%5D=stationboard%2Fto'));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'malformed');
  assert.match(result.error.message, /coupée/u);
});

test('une réponse hors normes reste dans le schéma : trois trajets, durée bornée, ligne nommée', async (t) => {
  const f = setup(t);
  const aberrant = direct('2026-10-29T00:30:00+0100', '2026-10-29T01:00:00+0100');
  aberrant.duration = '03d00:00:00';
  aberrant.sections[0]!.journey = { category: '', number: '', name: '' };
  f.route({
    '/connections': {
      connections: [
        aberrant,
        direct('2026-10-29T00:40:00+0100', '2026-10-29T01:10:00+0100'),
        direct('2026-10-29T00:50:00+0100', '2026-10-29T01:20:00+0100'),
        direct('2026-10-29T01:00:00+0100', '2026-10-29T01:30:00+0100'),
      ],
    },
  });
  const invoked = await f.invoke('trajet', { query: 'Chailly > Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.equal(invoked.outcome.card.primaryValue, '1440 min');
  assert.equal(invoked.outcome.card.items[0]?.label, 'Ligne · 00:30');
  // Le schéma (trois trajets au plus, durée bornée, libellé non vide) est respecté.
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('les recherches d’arrêts sont gardées en cache', async (t) => {
  const f = setup(t);
  await f.invoke('trajet', { query: 'Chailly > Ouchy' });
  const recherchesFaites = f.calls.filter((call) => call.url.includes('/locations'));
  assert.ok(recherchesFaites.length > 0);
  // Dix minutes, le maximum du cœur : il borne lui-même toute valeur plus haute.
  for (const call of recherchesFaites) assert.equal(call.cacheMs, 600_000);
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

test('« à » et « vers » ne coupent pas une question d’arrêt en deux bouts', async (t) => {
  for (const query of ['Gare à Ouchy', 'Pully vers Ouchy']) {
    const f = setup(t);
    await f.invoke('ask', { query });
    // Un seul lieu est cherché, avec tout le texte dit ; aucun itinéraire n'est calculé.
    assert.ok(
      f.calls.every(
        (call) =>
          !call.url.includes('/locations') ||
          new URL(call.url).searchParams.get('query')?.includes(query),
      ),
    );
    assert.equal(
      f.calls.some((call) => call.url.includes('/connections')),
      false,
    );
  }
});

test('sans « > », trajet lit un seul arrêt : l’itinéraire demande deux bouts', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'Ouchy' });
  assert.equal(invoked.outcome.ok, true);
  assert.equal(
    f.calls.some((call) => call.url.includes('/connections')),
    false,
  );
  // La description de l'outil fait écrire « ici > Ouchy » pour un itinéraire depuis l'arrêt
  // habituel.
  const trajet = addon.tools.find((tool) => tool.name === 'trajet');
  assert.match(trajet?.description ?? '', /« ici > Ouchy »/u);
});

test('les cartes citent opentransportdata.swiss, comme le demandent ses conditions', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.card.sources, ['arrets', 'opentransportdata.swiss']);
});
