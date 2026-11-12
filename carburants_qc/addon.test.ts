import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, {
  adresseDite,
  cents,
  centreDuCodePostal,
  codePostal,
  ditEnDollars,
  enDollars,
  exclue,
  initialesRue,
  banniere,
} from './index.js';
// Relevé réel de Régie essence Québec du 2026-11-12 à 14 h 45 UTC, réduit aux stations à 10 km
// de Sainte-Foy et à celles de la région de tri rurale G0A (166 stations sur 2 471).
import stations from './fixtures/stations.json' with { type: 'json' };

const at = '2026-11-12T14:50:00Z';
const routes = () => ({ status: 200, body: stations });
const source = (reglages: Record<string, unknown>) => ({ ...addon.configDefaults, ...reglages });
/** La station Shell du 2831 boulevard Laurier, code postal G1V 2L9. */
const shellLaurier = '46.76702,-71.28805';

test('le code postal, saisi à la va-vite, place la zone', async (t) => {
  const f = createTestModule(t, addon, { config: source({ codePostal: 'g1v2l9' }), at, routes });
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  // Un code postal hors du Québec est refusé dès le formulaire.
  assert.equal(f.runtime.validateConfig(addon.id, source({ codePostal: '75001' })).ok, false);
  assert.equal(f.runtime.validateConfig(addon.id, source({ codePostal: 'K1A 0B1' })).ok, false);
  const result = await f.invoke('read', {});
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  // Un carburant, une adresse.
  assert.equal(
    result.tool.summary,
    'Meilleur prix dans un rayon de 5 kilomètres : l’ordinaire à 1 dollar 67 chez Costco, 3233 avenue Watt, à 3 kilomètres.',
  );
  const card = result.outcome.ok ? result.outcome.card : null;
  assert.equal(card?.primaryValue, '1,669 $/L');
  assert.equal(card?.subtitle, 'Meilleur prix : Costco, 3233 Watt (3,4 km)');
  // Tuile « Meilleur prix » (par défaut) : la station, puis le type à gauche et le prix à droite.
  assert.deepEqual(f.ambient().content, {
    layout: 'metric',
    title: 'Carburants',
    value: null,
    subtitle: 'Costco, 3233 Watt (3,4 km)',
    items: [{ label: 'Ordinaire', value: '1,67 $/L' }],
  });
  // Toutes les stations du rayon comptent, pas seulement celles du code postal ; un seul appel.
  assert.equal(f.calls.length, 1);
});

test('Costco exclu : la moins chère suivante', async (t) => {
  const f = createTestModule(t, addon, {
    config: source({ codePostal: 'G1V 2L9', exclusions: ['costco'] }),
    at,
    routes,
  });
  const result = await f.invoke('read', {});
  assert.deepEqual(f.contract(result.outcome), []);
  // Les deux Costco du rayon (avenue Watt et Lévis) sont écartés.
  assert.equal(
    result.tool.summary,
    'Meilleur prix dans un rayon de 5 kilomètres : l’ordinaire à 1 dollar 72 chez Petro-Canada, 1350 chemin Sainte-Foy, à 4 kilomètres.',
  );
});

test('trois carburants : le meilleur prix de chacun, une station dite une fois', async (t) => {
  const f = createTestModule(t, addon, {
    config: source({ codePostal: 'G1V 2L9', carburants: ['Diesel', 'Super', 'Régulier'] }),
    at,
    routes,
  });
  const result = await f.invoke('read', {});
  assert.deepEqual(f.contract(result.outcome), []);
  // Costco est le moins cher pour l'ordinaire et le super, Shell pour le diesel : deux adresses.
  assert.equal(
    result.tool.summary,
    'Meilleurs prix dans un rayon de 5 kilomètres : l’ordinaire à 1 dollar 67 et le super à 1 dollar 87 chez Costco, 3233 avenue Watt, à 3 kilomètres ; ' +
      'le diesel à 2 dollars 77 chez Shell, 2831 boulevard Laurier, à 100 mètres.',
  );
  // Sur le miroir, plusieurs stations : lignes courtes (carburant, bannière et numéro civique, prix
  // arrondi au cent), adresses dans le sous-titre, chacune commençant par son numéro.
  assert.deepEqual(f.ambient().content, {
    layout: 'metric',
    title: 'Carburants',
    value: null,
    subtitle: 'Costco 3233 Watt · Shell 2831 Laurier',
    items: [
      { label: 'Ordinaire · Costco', value: '1,67 $/L' },
      { label: 'Super · Costco', value: '1,87 $/L' },
      { label: 'Diesel · Shell', value: '2,77 $/L' },
    ],
  });
});

test('super et diesel avec la station préférée : deux tuiles', async (t) => {
  const f = createTestModule(t, addon, {
    config: source({
      codePostal: 'G1V 2L9',
      carburants: ['Diesel', 'Super'],
      stationId: shellLaurier,
      stationLabel: 'Shell · 2831 boul. Laurier, Québec',
    }),
    at,
    routes,
  });
  const result = await f.invoke('read', {});
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  // La station préférée l'emporte pour le diesel (déjà la moins chère), pas pour le super.
  assert.equal(
    result.tool.summary,
    'Ta station Shell, 2831 boulevard Laurier : super 2 dollars 07, diesel 2 dollars 77. ' +
      'Meilleurs prix dans un rayon de 5 kilomètres : le super à 1 dollar 87 chez Costco, 3233 avenue Watt, à 3 kilomètres ; le diesel à 2 dollars 77 à ta station.',
  );
  assert.deepEqual(f.ambient().content?.items, [
    { label: 'Super · Costco', value: '1,87 $/L' },
    { label: 'Diesel · ta station', value: '2,77 $/L' },
  ]);
  const card = result.outcome.ok ? result.outcome.card : null;
  assert.deepEqual(card?.items, [
    { label: 'Super · Costco, 3233 Watt', value: '1,869 $/L' },
    { label: 'Diesel · ta station', value: '2,769 $/L' },
    { label: 'Ta station : Shell, 2831 Laurier', value: 'Super 2,069 $/L · Diesel 2,769 $/L' },
  ]);
  // Deuxième tuile, « Station préférée ».
  f.configure({ miroir: 'Station préférée' });
  await f.invoke('read', {});
  assert.deepEqual(f.ambient().content, {
    layout: 'metric',
    title: 'Carburants',
    value: null,
    subtitle: 'Shell, 2831 Laurier',
    items: [
      { label: 'Super', value: '2,07 $/L' },
      { label: 'Diesel', value: '2,77 $/L' },
    ],
  });
  // Les réglages exigent au moins un carburant, sans doublon.
  assert.equal(f.runtime.validateConfig(addon.id, source({ carburants: [] })).ok, false);
  assert.equal(
    f.runtime.validateConfig(addon.id, source({ carburants: ['Super', 'Super'] })).ok,
    false,
  );
});

test('miroir : deux Esso et un Mobil, l’adresse seulement pour départager les Esso', () => {
  const station = (nom: string, adresse: string) => ({
    nom,
    adresse,
    distanceKm: 3,
    prix: [],
  });
  const saintefoy = station('Esso', '3000 ch. Sainte-Foy, Québec');
  const levesque = station('Esso', '2500 boul. René-Lévesque, Québec');
  const mobil = station('Mobil', '2400 boul. René-Lévesque, Québec');
  const content = addon.ambient!.present(
    {
      status: 'ready',
      data: {
        rayonKm: 5,
        zone: true,
        meilleurs: [
          { carburant: 'Régulier', cents: 169.9, station: saintefoy, favorite: false },
          { carburant: 'Super', cents: 191.9, station: levesque, favorite: false },
          { carburant: 'Diesel', cents: 275.9, station: mobil, favorite: false },
        ],
        favorite: null,
        releve: '2026-11-12T15:50:00Z',
      },
    } as never,
    { instance: { config: {} }, now: () => 0, timeZone: 'America/Toronto' } as never,
  );
  // Trop long pour deux lignes : la rue déjà écrite passe en initiales.
  assert.equal(content.subtitle, 'Esso 3000 Sainte-Foy · Esso 2500 René-Lévesque · Mobil 2400 R-L');
  assert.deepEqual(content.items, [
    { label: 'Ordinaire · Esso 3000 S-F', value: '1,70 $/L' },
    { label: 'Super · Esso 2500 R-L', value: '1,92 $/L' },
    // Un seul Mobil : la bannière suffit.
    { label: 'Diesel · Mobil', value: '2,76 $/L' },
  ]);
});

test('station préférée déjà la moins chère : rien de mieux à annoncer', async (t) => {
  const f = createTestModule(t, addon, {
    config: source({ codePostal: 'G1V 2L9', carburants: ['Diesel'], stationId: shellLaurier }),
    at,
    routes,
  });
  const result = await f.invoke('read', {});
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(
    result.tool.summary,
    'Ta station Shell, 2831 boulevard Laurier : diesel 2 dollars 77. C’est le meilleur prix dans un rayon de 5 kilomètres.',
  );
  assert.equal(f.ambient().content?.subtitle, 'Ta station est déjà la moins chère');
  assert.deepEqual(f.ambient().content?.items, []);
  const card = result.outcome.ok ? result.outcome.card : null;
  assert.equal(card?.primaryValue, '2,769 $/L');
});

test('station préférée seule et diesel demandé à la voix', async (t) => {
  const f = createTestModule(t, addon, {
    config: source({
      carburants: ['Régulier', 'Super'],
      stationId: shellLaurier,
      stationLabel: 'Shell · 2831 boul. Laurier, Québec',
    }),
    at,
    routes,
  });
  const result = await f.invoke('read', { carburant: 'diesel' });
  assert.deepEqual(f.contract(result.outcome), []);
  // Sans zone, seule la station préférée est dite ; le carburant demandé remplace ceux des réglages.
  assert.equal(
    result.tool.summary,
    'Ta station Shell, 2831 boulevard Laurier : diesel 2 dollars 77.',
  );
});

test('les coordonnées passent avant le code postal', async (t) => {
  const f = createTestModule(t, addon, {
    // Code postal de Sainte-Foy, coordonnées du Vieux-Québec.
    config: source({ codePostal: 'G1V 2L9', latitude: 46.8123, longitude: -71.2145, rayonKm: 1 }),
    at,
    routes,
  });
  const result = await f.invoke('read', {});
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.doesNotMatch(result.tool.summary ?? '', /Watt|Laurier/u);
});

test('code postal rural trop étendu : refusé avec une piste', async (t) => {
  const f = createTestModule(t, addon, { config: source({ codePostal: 'G0A 9Z9' }), at, routes });
  const result = await f.invoke('read', {});
  assert.equal(result.tool.status, 'failed');
  assert.equal(result.tool.error?.code, 'not_found');
  assert.match(result.tool.error?.message ?? '', /G0A 9Z9.*latitude et la longitude/u);
});

test('sans code postal, coordonnées ni station : réglage incomplet, sans appel réseau', async (t) => {
  const f = createTestModule(t, addon, { config: source({}), at, routes });
  const result = await f.invoke('read', {});
  assert.equal(result.tool.error?.code, 'config_invalid');
  assert.equal(f.calls.length, 0);
});

test('recherche de la station préférée', async (t) => {
  const f = createTestModule(t, addon, { config: source({}), at, routes });
  const resultats = await f.runtime.search(
    addon.id,
    { kind: 'station', query: 'shell laurier' },
    new AbortController().signal,
  );
  assert.equal(resultats[0]?.id, shellLaurier);
  assert.equal(resultats[0]?.detail, 'Ordinaire 1,789 $/L · Super 2,069 $/L · Diesel 2,769 $/L');
});

test('recherche avec une adresse copiée de Google', async (t) => {
  const f = createTestModule(t, addon, { config: source({}), at, routes });
  const chercher = (query: string) =>
    f.runtime.search(addon.id, { kind: 'station', query }, new AbortController().signal);
  // « QC » et « Boulevard » en entier n'empêchent plus de trouver « 2831 boul. Laurier, Québec ».
  for (const query of [
    '2831 Boul. Laurier, Québec, QC G1V 2L9',
    '2831 Boulevard Laurier, Québec, QC G1V 2L9, Canada',
    'G1V2L9',
  ])
    assert.equal((await chercher(query))[0]?.id, shellLaurier, query);
  // Souple : ordre des mots, bannière seule ou en plus, faute de frappe, sans « boul. ».
  for (const query of [
    '2831 boul. Lorier, QC G1V 2L9',
    'Laurier 2831',
    'shell laurier',
    'Shel 2831 Laurier',
    '2831 Laurier Québec',
  ])
    assert.equal((await chercher(query))[0]?.id, shellLaurier, query);
  // Un seul mot : seulement les stations qui le portent.
  const costco = await chercher('costco');
  assert.ok(costco.length >= 2);
  assert.ok(costco.every((r) => r.label.startsWith('Costco')));
  // Le numéro civique est exact : 2830 ne donne pas le 2831.
  assert.notEqual((await chercher('2830 boul. Laurier'))[0]?.id, shellLaurier);
});

test('codes postaux, prix et adresses', () => {
  assert.equal(codePostal(' h2x 1y4 '), 'H2X1Y4');
  // Initiales de la rue, pour distinguer deux stations de la même bannière sur le miroir.
  assert.equal(initialesRue('2500 boul. René-Lévesque, Québec'), 'R-L');
  assert.equal(initialesRue('800 rue de l’Église, Québec'), 'É');
  assert.equal(initialesRue("800 rue de l'Église, Québec"), 'É');
  assert.equal(initialesRue('1350 ch. Sainte-Foy, Québec'), 'S-F');
  assert.equal(initialesRue('4105 av. 4 est, Québec'), '4E');
  assert.equal(initialesRue('8860 boul. Louis-XIV, Québec'), 'L-XIV');
  // Bannière longue en initiales sur le miroir, traits d'union gardés.
  assert.equal(banniere('Petro-Canada'), 'P-C');
  assert.equal(banniere('Couche-Tard'), 'C-T');
  assert.equal(banniere('Canadian Tire'), 'CT');
  assert.equal(banniere('Ultramar'), 'Ultramar');
  assert.equal(banniere('Esso'), 'Esso');
  assert.equal(codePostal('K1A 0B1'), null);
  assert.equal(cents('169.9¢'), 169.9);
  assert.equal(cents(''), null);
  assert.equal(ditEnDollars(169.9), '1 dollar 70');
  assert.equal(ditEnDollars(200), '2 dollars');
  assert.equal(ditEnDollars(205), '2 dollars 05');
  assert.equal(enDollars(169.9), '1,699 $/L');
  assert.equal(adresseDite('2831 boul. Laurier, Québec'), '2831 boulevard Laurier');
  // Code inconnu d'une région de tri urbaine : centre de la région de tri.
  assert.deepEqual(centreDuCodePostal(stations.features, 'G1V9Z9'), [46.7851085, -71.2878075]);
  assert.equal(exclue({ brand: 'Costco', Name: 'Costco Sainte-Foy' }, ['COSTCO']), true);
  assert.equal(
    exclue({ brand: 'Shell', Address: '2831 boul. Laurier, Québec' }, ['Shell Laurier']),
    true,
  );
  assert.equal(
    exclue({ brand: 'Shell', Address: '2125 ch. Sainte-Foy, Québec' }, ['Shell Laurier']),
    false,
  );
});
