import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';
import payload from './fixtures/route.json' with { type: 'json' };
import found from './fixtures/search.json' with { type: 'json' };

const key = 'cle-de-test-0123456789';
const summary = payload.routes[0]!.summary;
/** Une réponse TomTom dont seul le résumé change. */
const route = (changes: Record<string, unknown>) => ({
  ...payload,
  routes: [{ ...payload.routes[0], summary: { ...summary, ...changes } }],
});
/** 12 h dans le fuseau du foyer : le 22 septembre 2026 à Paris, UTC+2. */
const setup = (t: { after(fn: () => void): void }, reply: unknown = payload) =>
  createTestModule(t, addon, {
    at: '2026-09-22T10:00:00Z',
    routes: { '/calculateRoute/': reply as never, '/search/2/search/': found },
    secrets: { tomtomKey: key },
  });
const signal = () => new AbortController().signal;

test('définition, réglages, contrat et adresse interrogée', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const bad of [
    { origin: 'Bordeaux' },
    { origin: '44.841;-0.569' },
    { destination: '44,-0' },
    { destinationLabel: '' },
  ])
    assert.equal(
      f.runtime.validateConfig(addon.id, { ...addon.configDefaults, ...bad }).ok,
      false,
      JSON.stringify(bad),
    );
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok && result.card.primaryValue, 'Arrivée vers 12 h 34');
  assert.equal(result.ok && result.card.subtitle, '34 min en partant maintenant');
  assert.equal(result.ok && result.snapshot.validUntil, '2026-09-22T10:05:00.000Z');
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.origin, 'https://api.tomtom.com');
  assert.ok(url.pathname.startsWith('/routing/1/calculateRoute/'));
  assert.ok(url.pathname.endsWith('/44.84100,-0.56900:44.82600,-0.55600/json'));
  assert.equal(url.searchParams.get('key'), key);
  assert.equal(url.searchParams.get('traffic'), 'true');
  assert.equal(url.searchParams.get('routeType'), 'fastest');
  assert.equal(url.searchParams.get('computeTravelTimeFor'), 'all');
  assert.ok(f.calls[0]?.signal);
});

test('la carte donne le retard, la durée sans trafic et la distance', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.card.items, [
    { label: 'Trafic', value: '+9 min de trafic' },
    { label: 'Sans trafic', value: '25 min' },
    { label: 'Distance', value: '31,2 km' },
  ]);
  assert.match(
    result.presentation.summary,
    /arrivée vers 12 h 34 : 34 min de route, dont 9 min de trafic/u,
  );
});

test('sans retard annoncé, il se déduit de la durée sans trafic ; sinon il reste inconnu', async (t) => {
  const deduced = setup(t, route({ trafficDelayInSeconds: undefined }));
  const first = await deduced.read();
  assert.equal(first.ok && first.card.items[0]?.value, '+9 min de trafic');

  const unknown = setup(
    t,
    route({ trafficDelayInSeconds: undefined, noTrafficTravelTimeInSeconds: undefined }),
  );
  const second = await unknown.read();
  assert.equal(second.ok, true);
  if (!second.ok) return;
  // Pas de ligne « Trafic » ni « Sans trafic » inventée : seule la distance reste.
  assert.deepEqual(second.card.items, [{ label: 'Distance', value: '31,2 km' }]);
  assert.doesNotMatch(second.presentation.summary, /trafic/u);
});

test('un retard sous la minute se dit « Trafic fluide »', async (t) => {
  const f = setup(t, route({ trafficDelayInSeconds: 20, noTrafficTravelTimeInSeconds: 2020 }));
  const result = await f.read();
  assert.equal(result.ok && result.card.items[0]?.value, 'Trafic fluide');
  assert.match(result.ok ? result.presentation.summary : '', /sans retard dû au trafic/u);
});

test('un trajet de plus d’une heure se dit en heures et minutes', async (t) => {
  const f = setup(t, route({ travelTimeInSeconds: 3900, trafficDelayInSeconds: 600 }));
  const result = await f.read();
  assert.equal(result.ok && result.card.subtitle, '1 h 05 en partant maintenant');
  assert.equal(result.ok && result.card.primaryValue, 'Arrivée vers 13 h 05');
});

test('l’affichage permanent suit l’heure sans nouvelle requête', async (t) => {
  const f = setup(t);
  assert.equal((await f.read()).ok, true);
  const first = f.ambient();
  assert.equal(first.content?.value, 'Arrivée 12 h 34');
  assert.equal(first.content?.subtitle, '34 min en partant maintenant');
  // Trois minutes plus tard, la durée est inchangée mais l'arrivée a avancé.
  f.advance(3 * 60_000);
  assert.equal(f.ambient().content?.value, 'Arrivée 12 h 37');
  assert.equal(f.calls.length, 1);
});

test('les lectures simultanées et le cache frais ne doublent pas la collecte', async (t) => {
  const f = setup(t);
  const [first, second] = await Promise.all([f.read(), f.read()]);
  assert.equal(first.ok && second.ok, true);
  await f.read();
  assert.equal(f.calls.length, 1);
  f.advance(5 * 60_000 + 1);
  await f.read();
  assert.equal(f.calls.length, 2);
});

test('sans clé, la lecture échoue clairement et n’envoie aucune requête', async (t) => {
  const f = createTestModule(t, addon, {
    routes: { '/calculateRoute/': payload as never },
    secrets: {},
  });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'config_invalid');
  assert.equal(f.calls.length, 0);
});

test('chaque statut du fournisseur a son code, sans jamais citer la clé', async (t) => {
  const cases: [number, string][] = [
    [401, 'auth'],
    [403, 'auth'],
    [400, 'invalid_params'],
    [404, 'invalid_params'],
    [429, 'quota'],
    [503, 'unavailable'],
    [418, 'upstream'],
  ];
  for (const [status, code] of cases) {
    const f = setup(t, { status });
    const result = await f.read();
    assert.equal(result.ok, false, `statut ${status}`);
    if (result.ok) continue;
    assert.equal(result.error.code, code, `statut ${status}`);
    assert.doesNotMatch(result.error.message, new RegExp(key, 'u'));
    assert.doesNotMatch(result.error.message, /api\.tomtom\.com/u);
  }
});

test('une réponse invalide est signalée, jamais convertie en trajet nul', async (t) => {
  const bad = [
    route({ travelTimeInSeconds: 'rapide' }),
    route({ travelTimeInSeconds: 0 }),
    route({ lengthInMeters: -5 }),
    { ...payload, routes: [] },
    { formatVersion: '0.0.12' },
    'pas du json',
  ];
  for (const reply of bad) {
    const f = setup(t, reply);
    const result = await f.read();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'malformed');
  }
});

test('une panne après expiration garde le dernier relevé et l’annonce comme tel', async (t) => {
  const f = setup(t);
  const first = await f.read();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  f.advance(5 * 60_000 + 1);
  f.route({ '/calculateRoute/': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.equal(result.snapshot.revision, first.snapshot.revision);
  assert.equal(result.snapshot.fetchedAt, first.snapshot.fetchedAt);
  assert.match(result.presentation.summary, /Dernier relevé connu/u);
  assert.equal(f.runtime.toolResult(result).status, 'stale');
});

test('une première panne ne crée ni données ni date de succès', async (t) => {
  const f = setup(t, { status: 503 });
  const result = await f.read();
  assert.equal(result.ok, false);
  const snapshot = f.instances.getSnapshot(f.instance);
  assert.equal(snapshot?.status, 'error');
  assert.equal(snapshot?.data, null);
  assert.equal(snapshot?.fetchedAt, null);
});

test('l’outil vocal lit la source configurée', async (t) => {
  const f = setup(t);
  const { outcome, tool } = await f.invoke('read');
  assert.equal(outcome.ok, true);
  assert.equal(tool.status, 'succeeded');
  assert.deepEqual(f.contract(outcome), []);
});

test('un point hors du globe, même bien formé, est refusé sans requête', async (t) => {
  for (const origin of ['95.000,0.500', '44.841,-190.000']) {
    const f = setup(t);
    f.configure({ origin });
    const result = await f.read();
    assert.equal(result.ok, false, origin);
    if (!result.ok) assert.equal(result.error.code, 'config_invalid');
    assert.equal(f.calls.length, 0);
  }
});

test('les réglages de la version 1 sont repris, arrondis à environ 100 m', async (t) => {
  const f = setup(t);
  const migrated = addon.configMigrate!(1, {
    originLatitude: 44.8413,
    originLongitude: -0.5693,
    destinationLatitude: 44.8257,
    destinationLongitude: -0.556,
  });
  assert.deepEqual(migrated, {
    origin: '44.841,-0.569',
    originLabel: 'Départ',
    destination: '44.826,-0.556',
    destinationLabel: 'Arrivée',
  });
  assert.equal(f.runtime.validateConfig(addon.id, migrated).ok, true);
  // Une configuration déjà à jour n'est pas touchée.
  assert.deepEqual(addon.configMigrate!(2, addon.configDefaults), addon.configDefaults);
});

test('des réglages de la version 1 abîmés ne font pas échouer la migration', async (t) => {
  const f = setup(t);
  for (const broken of [
    {},
    { originLatitude: 'x', originLongitude: 1, destinationLatitude: 2, destinationLongitude: 3 },
    {
      originLatitude: Number.NaN,
      originLongitude: 1,
      destinationLatitude: 2,
      destinationLongitude: 3,
    },
  ]) {
    const migrated = addon.configMigrate!(1, broken);
    assert.deepEqual(migrated, addon.configDefaults);
    assert.equal(f.runtime.validateConfig(addon.id, migrated).ok, true);
  }
});

test('une recherche trop longue est coupée avant d’être envoyée', async (t) => {
  const f = setup(t);
  await f.runtime.search(addon.id, { kind: 'origin', query: 'a'.repeat(300) }, signal());
  const { pathname } = new URL(f.calls[0]!.url);
  assert.ok(pathname.endsWith(`/${'a'.repeat(120)}.json`));
  assert.ok(!pathname.includes('a'.repeat(121)));
});

test('les libellés du fournisseur sont nettoyés des caractères de contrôle', async (t) => {
  const f = setup(t);
  f.route({
    '/search/2/search/': {
      results: [
        {
          position: { lat: 44.8, lon: -0.5 },
          address: { freeformAddress: 'Rue\nde \t test', municipality: 'Bor\u0000deaux' },
        },
      ],
    },
  });
  const results = await f.runtime.search(
    addon.id,
    { kind: 'origin', query: 'rue de test' },
    signal(),
  );
  assert.deepEqual(results, [{ id: '44.800,-0.500', label: 'Rue de test', detail: 'Bor deaux' }]);
});

test('l’outil vocal borne la référence de la source', () => {
  const parameters = addon.tools![0]!.parameters as {
    properties: { instanceRef: { maxLength: number } };
  };
  assert.equal(parameters.properties.instanceRef.maxLength, 80);
});

test('la recherche d’adresse propose des points arrondis, sans doublon ni résultat inexploitable', async (t) => {
  const f = setup(t);
  const results = await f.runtime.search(
    addon.id,
    { kind: 'destination', query: ' cours de verdun bordeaux ' },
    signal(),
  );
  assert.deepEqual(results, [
    { id: '44.847,-0.572', label: 'Cours de Verdun, 33000 Bordeaux', detail: 'Bordeaux' },
    {
      id: '44.847,-0.573',
      label: "Lieu d'exemple, 12 Cours de Verdun, 33000 Bordeaux",
      detail: 'Bordeaux',
    },
  ]);
  const url = new URL(f.calls[0]!.url);
  assert.ok(url.pathname.endsWith('/cours%20de%20verdun%20bordeaux.json'));
  assert.equal(url.searchParams.get('countrySet'), 'FR');
  assert.equal(url.searchParams.get('language'), 'fr-FR');
  assert.equal(url.searchParams.get('key'), key);
  // Le départ se cherche de la même façon.
  assert.equal(
    (await f.runtime.search(addon.id, { kind: 'origin', query: 'cours de verdun' }, signal()))
      .length,
    2,
  );
});

test('un choix de la recherche donne un réglage valide, puis une lecture', async (t) => {
  const f = setup(t);
  const [first] = await f.runtime.search(
    addon.id,
    { kind: 'destination', query: 'cours de verdun' },
    signal(),
  );
  assert.ok(first);
  f.configure({ destination: first.id, destinationLabel: first.label });
  const result = await f.read();
  assert.equal(result.ok, true);
  assert.ok(f.calls.at(-1)!.url.includes(':44.84700,-0.57200/json'));
});

test('une recherche trop courte ne part pas ; sans clé ou sans résultat exploitable, rien d’inventé', async (t) => {
  const f = setup(t);
  assert.deepEqual(await f.runtime.search(addon.id, { kind: 'origin', query: 'ab' }, signal()), []);
  assert.deepEqual(await f.runtime.search(addon.id, { kind: 'origin' }, signal()), []);
  assert.equal(f.calls.length, 0);
  f.route({ '/search/2/search/': { results: [{ id: 'x' }, { position: { lat: 'a', lon: 0 } }] } });
  assert.deepEqual(
    await f.runtime.search(addon.id, { kind: 'origin', query: 'rien du tout' }, signal()),
    [],
  );
  const keyless = createTestModule(t, addon, {
    routes: { '/search/2/search/': found },
    secrets: {},
  });
  await assert.rejects(
    keyless.runtime.search(addon.id, { kind: 'origin', query: 'cours de verdun' }, signal()),
    (error: { code?: string }) => error.code === 'config_invalid',
  );
  assert.equal(keyless.calls.length, 0);
});

test('les échecs de la recherche ont leur code et ne citent jamais la clé', async (t) => {
  for (const [status, code] of [
    [403, 'auth'],
    [429, 'quota'],
    [503, 'unavailable'],
  ] as const) {
    const f = setup(t);
    f.route({ '/search/2/search/': { status } });
    await assert.rejects(
      f.runtime.search(addon.id, { kind: 'origin', query: 'cours de verdun' }, signal()),
      (error: { code?: string; message: string }) =>
        error.code === code && !error.message.includes(key) && !/tomtom\.com/u.test(error.message),
    );
  }
  const f = setup(t);
  f.route({ '/search/2/search/': 'pas du json' });
  await assert.rejects(
    f.runtime.search(addon.id, { kind: 'origin', query: 'cours de verdun' }, signal()),
    (error: { code?: string }) => error.code === 'malformed',
  );
  await assert.rejects(f.runtime.search(addon.id, { kind: 'inconnu', query: 'abc' }, signal()));
});
