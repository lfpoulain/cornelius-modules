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
  assert.equal(result.ok && result.card.primaryValue, 'Arrivée vers 12 h 18');
  assert.equal(result.ok && result.card.subtitle, '18 min en partant maintenant');
  assert.equal(result.ok && result.snapshot.validUntil, '2026-09-22T10:05:00.000Z');
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.origin, 'https://api.tomtom.com');
  assert.ok(url.pathname.startsWith('/routing/1/calculateRoute/'));
  assert.ok(url.pathname.endsWith('/44.841,-0.569:44.826,-0.556/json'));
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
    { label: 'Trafic', value: '+7 min de trafic' },
    { label: 'Sans trafic', value: '11 min' },
    { label: 'Distance', value: '3,1 km' },
  ]);
  assert.match(
    result.presentation.summary,
    /arrivée vers 12 h 18 : 18 min de route, dont 7 min de trafic/u,
  );
});

test('le retard est l’écart avec la durée sans trafic ; à défaut, le retard annoncé ; sinon il reste inconnu', async (t) => {
  // Réponse enregistrée : 1 108 s au total, 685 s sans trafic, mais « trafficDelayInSeconds » 300 s
  // (les seuls incidents du moment). La carte garde « sans trafic + retard = durée » : 11 + 7 = 18.
  const gap = await setup(t).read();
  assert.equal(gap.ok && gap.card.items[0]?.value, '+7 min de trafic');

  const announced = setup(t, route({ noTrafficTravelTimeInSeconds: undefined }));
  const second = await announced.read();
  assert.equal(second.ok && second.card.items[0]?.value, '+5 min de trafic');

  const unknown = setup(
    t,
    route({ trafficDelayInSeconds: undefined, noTrafficTravelTimeInSeconds: undefined }),
  );
  const third = await unknown.read();
  assert.equal(third.ok, true);
  if (!third.ok) return;
  // Pas de ligne « Trafic » ni « Sans trafic » inventée : seule la distance reste.
  assert.deepEqual(third.card.items, [{ label: 'Distance', value: '3,1 km' }]);
  assert.doesNotMatch(third.presentation.summary, /trafic/u);
});

test('un retard sous la minute se dit « Trafic fluide »', async (t) => {
  const f = setup(t, route({ noTrafficTravelTimeInSeconds: 1070 }));
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
  assert.equal(first.content?.value, 'Arrivée 12 h 18');
  assert.equal(first.content?.subtitle, '18 min en partant maintenant');
  // Trois minutes plus tard, la durée est inchangée mais l'arrivée a avancé.
  f.advance(3 * 60_000);
  assert.equal(f.ambient().content?.value, 'Arrivée 12 h 21');
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

test('un point saisi plus précis est arrondi avant de partir chez TomTom', async (t) => {
  const f = setup(t);
  f.configure({ origin: '44.84130,-0.56930', destination: '44.82570,-0.55600' });
  const result = await f.read();
  assert.equal(result.ok, true);
  assert.ok(new URL(f.calls[0]!.url).pathname.endsWith('/44.841,-0.569:44.826,-0.556/json'));
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

test('la recherche d’adresse propose des points arrondis, un seul par repère', async (t) => {
  const f = setup(t);
  const results = await f.runtime.search(
    addon.id,
    { kind: 'destination', query: ' gare saint-jean bordeaux ' },
    signal(),
  );
  // Réponse enregistrée : six résultats ; « Pause Gourmande » tombe sur le même repère arrondi
  // que la rue « Gare Saint-Jean » (44.825,-0.557) : un seul réglage possible, le mieux classé reste.
  assert.deepEqual(results, [
    {
      id: '44.826,-0.556',
      label: 'Bordeaux Saint-Jean, Rue Charles Domercq, 33800 Bordeaux',
      detail: 'Bordeaux',
    },
    { id: '44.825,-0.557', label: 'Gare Saint-Jean, 33800 Bordeaux', detail: 'Bordeaux' },
    {
      id: '44.825,-0.561',
      label: 'Cargo Bordeaux GARE Saint-Jean, 40-42 Rue Furtado, 33800 Bordeaux',
      detail: 'Bordeaux',
    },
    {
      id: '44.828,-0.562',
      label: 'Ténéo Apparthotel Bordeaux-Gare Saint-Jean, 4 Cours Barbey, 33800 Bordeaux',
      detail: 'Bordeaux',
    },
    {
      id: '44.828,-0.559',
      label: 'Coiffeur Gare Saint-Jean, 202 Cours de la Marne, 33800 Bordeaux',
      detail: 'Bordeaux',
    },
  ]);
  const request = f.calls[0]!;
  const url = new URL(request.url);
  assert.ok(url.pathname.endsWith('/gare%20saint-jean%20bordeaux.json'));
  assert.equal(url.searchParams.get('countrySet'), 'FR');
  assert.equal(url.searchParams.get('language'), 'fr-FR');
  assert.equal(url.searchParams.get('key'), key);
  assert.equal(request.cacheMs, 10 * 60_000);
  // Le départ se cherche de la même façon.
  assert.equal(
    (await f.runtime.search(addon.id, { kind: 'origin', query: 'gare saint-jean' }, signal()))
      .length,
    5,
  );
});

test('un choix de la recherche donne un réglage valide, puis une lecture', async (t) => {
  const f = setup(t);
  const results = await f.runtime.search(
    addon.id,
    { kind: 'destination', query: 'gare saint-jean' },
    signal(),
  );
  const second = results[1];
  assert.ok(second);
  f.configure({ destination: second.id, destinationLabel: second.label });
  const result = await f.read();
  assert.equal(result.ok, true);
  assert.ok(f.calls.at(-1)!.url.includes(':44.825,-0.557/json'));
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
    keyless.runtime.search(addon.id, { kind: 'origin', query: 'gare saint-jean' }, signal()),
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
      f.runtime.search(addon.id, { kind: 'origin', query: 'gare saint-jean' }, signal()),
      (error: { code?: string; message: string }) =>
        error.code === code && !error.message.includes(key) && !/tomtom\.com/u.test(error.message),
    );
  }
  const f = setup(t);
  f.route({ '/search/2/search/': 'pas du json' });
  await assert.rejects(
    f.runtime.search(addon.id, { kind: 'origin', query: 'gare saint-jean' }, signal()),
    (error: { code?: string }) => error.code === 'malformed',
  );
  await assert.rejects(f.runtime.search(addon.id, { kind: 'inconnu', query: 'abc' }, signal()));
});
