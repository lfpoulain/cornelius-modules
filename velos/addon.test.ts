import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestModule, type TestReply } from '#cornelius/testing';
import type { AddonHttpRequest } from '#cornelius/addons';
import addon from './index.js';

/**
 * Réponses réelles du 20/10/2026, réduites à quelques stations : Vélib’ (GBFS 2.x, vélos
 * électriques à part), Le Vélo TBM (3.0, types de vélos), LE vélo STAR (2.x, une station
 * fermée), et un extrait du catalogue des réseaux.
 */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const systems: Record<string, string> = {
  'smovengo.cloud': 'velib',
  'mecatran.com': 'tbm',
  'opendatasoft.com': 'star',
};

const velib = 'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json';
const tbm =
  'https://bdx.mecatran.com/utw/ws/gbfs/bordeaux/v3/gbfs.json?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt';
const star = 'https://eu.ftp.opendatasoft.com/star/gbfs/gbfs.json';

/** Réseau simulé : catalogue, puis chaque flux d'un réseau par son hôte et son nom. */
function network(override?: (url: string) => string | null) {
  return (request: AddonHttpRequest): TestReply => {
    const url = request.url;
    const body =
      override?.(url) ??
      (url.includes('raw.githubusercontent.com')
        ? fixture('systems.csv')
        : (() => {
            const prefix = Object.entries(systems).find(([host]) => url.includes(host))?.[1];
            const feed = /\/([a-z_]+)\.json/u.exec(new URL(url).pathname)?.[1];
            return prefix && feed ? fixture(`${prefix}-${feed}.json`) : null;
          })());
    return body === null ? { status: 404 } : body;
  };
}

function setup(
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  override?: (url: string) => string | null,
) {
  return createTestModule(t, addon, {
    config,
    at: '2026-10-20T13:15:00Z',
    routes: network(override),
  });
}

const find = (
  f: ReturnType<typeof setup>,
  kind: string,
  query: string,
  values: Record<string, unknown> = {},
) => f.runtime.search(addon.id, { kind, query, values }, new AbortController().signal);

test('définition, réglages et contrat ; chaque fichier passe par le cache partagé', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const patch of [{ systemUrl: 'http://exemple.fr/gbfs.json' }, { stationId: 'a b' }])
    assert.equal(
      f.runtime.validateConfig(addon.id, { ...addon.configDefaults, ...patch }).ok,
      false,
      JSON.stringify(patch),
    );
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  // Découverte et état du réseau sont partagés entre sources : 10 minutes et 30 secondes.
  assert.deepEqual(
    f.calls.map((call) => call.cacheMs),
    [600_000, 30_000],
  );
});

test('Vélib’ (GBFS 2.x) : vélos mécaniques et électriques, places libres', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Vélos · Vélib’ Métropole');
  assert.equal(result.card.primaryValue, '20 vélos');
  assert.equal(result.card.subtitle, 'Benjamin Godard - Victor Hugo');
  assert.deepEqual(result.card.items, [
    { label: 'Mécaniques', value: '16' },
    { label: 'Électriques', value: '4' },
    { label: 'Places libres', value: '14' },
  ]);
  assert.equal(
    result.presentation.summary,
    'Station Benjamin Godard - Victor Hugo : 20 vélos, dont 4 électriques et 14 places libres.',
  );
  // Seul l'état est lu à chaque collecte : pas les 276 Ko des informations de stations.
  assert.deepEqual(
    f.calls.map((call) => new URL(call.url).pathname.split('/').at(-1)),
    ['gbfs.json', 'station_status.json'],
  );
});

test('Le Vélo TBM (GBFS 3.0) : électriques comptés par le type de propulsion', async (t) => {
  const f = setup(t, {
    systemUrl: tbm,
    systemLabel: 'Le Vélo par TBM',
    stationId: '1',
    stationLabel: 'Meriadeck',
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, '9 vélos');
  assert.deepEqual(result.card.items, [
    { label: 'Mécaniques', value: '4' },
    { label: 'Électriques', value: '5' },
    { label: 'Places libres', value: '33' },
  ]);
  assert.equal(result.snapshot.data!.reported, '2026-10-20T13:10:43.000Z');
});

test('LE vélo STAR : station fermée, puis station sans type de vélo connu', async (t) => {
  const f = setup(t, {
    systemUrl: star,
    systemLabel: 'LE vélo STAR',
    stationId: '5501',
    stationLabel: 'République',
  });
  const closed = await f.read();
  assert.equal(closed.ok, true);
  if (!closed.ok) return;
  assert.equal(closed.card.primaryValue, 'Station fermée');
  assert.deepEqual(closed.card.items, []);
  assert.equal(closed.presentation.summary, 'La station République est fermée pour le moment.');
  assert.equal(f.ambient().content?.value, 'Fermée');

  const g = setup(t, {
    systemUrl: star,
    systemLabel: 'LE vélo STAR',
    stationId: '5502',
    stationLabel: 'Mairie - Opéra',
  });
  const open = await g.read();
  assert.equal(open.ok, true);
  if (!open.ok) return;
  assert.deepEqual(open.card.items, [{ label: 'Places libres', value: '21' }]);
  assert.equal(open.presentation.summary, 'Station Mairie - Opéra : 2 vélos et 21 places libres.');
});

test('station vide ou pleine : « aucun vélo », « aucune place libre »', async (t) => {
  const status = JSON.parse(fixture('velib-station_status.json'));
  status.data.stations[0] = {
    ...status.data.stations[0],
    num_bikes_available: 0,
    num_bikes_available_types: [{ mechanical: 0 }, { ebike: 0 }],
    num_docks_available: 0,
  };
  const f = setup(t, {}, (url) => (url.includes('station_status') ? JSON.stringify(status) : null));
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Aucun vélo');
  assert.equal(
    result.presentation.summary,
    'Station Benjamin Godard - Victor Hugo : aucun vélo et aucune place libre.',
  );
});

test('station disparue du réseau, réseau sans état des stations', async (t) => {
  const gone = await setup(t, { stationId: '999' }).read();
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.equal(gone.error.code, 'not_found');

  const discovery = JSON.stringify({
    version: '3.0',
    data: { feeds: [{ name: 'vehicle_status', url: 'https://x.fr/v.json' }] },
  });
  const free = await setup(t, {}, (url) => (url.endsWith('gbfs.json') ? discovery : null)).read();
  assert.equal(free.ok, false);
  if (!free.ok) assert.equal(free.error.message, 'Ce réseau ne publie pas l’état de ses stations.');
});

test('recherche du réseau : par ville, sans autopartage ni trottinettes, hors de France proche', async (t) => {
  const f = setup(t);
  assert.deepEqual(await find(f, 'system', 'rennes'), [
    {
      id: 'https://eu.ftp.opendatasoft.com/star/gbfs/gbfs.json',
      label: 'LE vélo STAR',
      detail: 'Rennes',
    },
  ]);
  assert.deepEqual(
    (await find(f, 'system', 'Bordeaux')).map((r) => r.label),
    ['Le Vélo par TBM'],
  );
  assert.deepEqual(
    (await find(f, 'system', 'velib')).map((r) => r.label),
    ["Vélib' Metropole", 'Vélibéo'],
  );
  assert.equal((await find(f, 'system', 'villo')).length, 1);
  // Canada : àVélo par sa ville, BIXI par son nom ; trottinettes Bird et Lime toujours écartées.
  assert.deepEqual(await find(f, 'system', 'quebec'), [
    {
      id: 'https://quebec.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json',
      label: 'àVélo',
      detail: 'Ville de Québec',
    },
  ]);
  assert.deepEqual(
    (await find(f, 'system', 'montreal')).map((r) => r.label),
    ['BIXI Montréal'],
  );
  assert.deepEqual(await find(f, 'system', 'ottawa'), []);
  // Le catalogue (180 Ko) est partagé dix minutes entre les recherches.
  assert.ok(f.calls.every((call) => call.cacheMs === 600_000));
});

test('recherche de la station : par son nom, sans accents, avec adresse et capacité', async (t) => {
  const f = setup(t);
  assert.deepEqual(await find(f, 'station', 'hotel de region', { systemUrl: tbm }), [
    {
      id: '2',
      label: 'Saint-Bruno - Hôtel de Région',
      detail: 'RUE FRANÇOIS DE SOURDIS (CIMETIÈRE DE LA CHARTREUSE) , BORDEAUX · 20 places',
    },
  ]);
  assert.deepEqual(await find(f, 'station', 'godard', { systemUrl: velib }), [
    { id: '213688169', label: 'Benjamin Godard - Victor Hugo', detail: '35 places' },
  ]);
  assert.deepEqual(await find(f, 'station', 'opéra'), []);
});
