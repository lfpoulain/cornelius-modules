import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddonDefinition } from '#cornelius/addons';
import { createTestModule } from '#cornelius/testing';
import {
  arretDit,
  collecteur,
  dans,
  destinationFor,
  lieuDit,
  minutesDit,
  outilTrajet,
  presentation,
  surLaRue,
  trajetSchema,
  typo,
  vehiculeDit,
  type Reseau,
  type TrajetConfig,
  type TrajetData,
} from './transitous.js';

// Réseau et réponses fictifs, au format exact de Transitous, réduits aux champs lus. Les modules
// (sto, sts, rtc, stm) ont leurs tests sur des relevés réels.
const reseau: Reseau = {
  id: 'essai',
  sigle: 'ESSAI',
  ville: 'Québec',
  centre: '46.813,-71.208',
  reseauDit: (leg) => (leg.agencyId === 'AUTRE' ? ' (Autre réseau)' : ''),
};
const addon: AddonDefinition<TrajetConfig, TrajetData> = {
  id: 'essai',
  apiVersion: 1,
  version: '1.0.0',
  sourceLabel: 'Transitous',
  configVersion: 1,
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['favoris'],
    properties: {
      adresseDepart: { type: 'string' },
      latitude: { type: ['number', 'null'] },
      longitude: { type: ['number', 'null'] },
      favoris: { type: 'array' },
    },
  },
  configDefaults: { favoris: [] },
  dataVersion: 1,
  dataSchema: trajetSchema,
  freshMs: 60_000,
  tools: [outilTrajet('Trajet d’essai.')],
  collect: collecteur(reseau),
  present: presentation(reseau),
};

const at = '2026-11-20T15:00:00Z';
const minute = (n: number) => new Date(Date.parse(at) + n * 60_000).toISOString();
const geocode = [{ lat: 46.78, lon: -71.27, name: "Pavillon de l'Université" }];
const leg = (depart: number, extra: Record<string, unknown> = {}) => ({
  mode: 'BUS',
  routeShortName: '7',
  headsign: "Place d'Youville",
  agencyId: 'ESSAI',
  startTime: minute(depart),
  tripId: `voyage-${depart}`,
  from: { name: "Côte d'Abraham", stopId: 'essai_1' },
  ...extra,
});
const plan = (itineraire: Record<string, unknown>) => ({ itineraries: [itineraire] });
const passage = (depart: number) => ({
  routeShortName: '7',
  headsign: "Place d'Youville",
  tripId: `voyage-${depart}`,
  place: { departure: minute(depart) },
});
const essai = (
  t: { after(fn: () => void): void },
  reponses: { plan: unknown; stoptimes: unknown },
) =>
  createTestModule(t, addon, {
    config: { latitude: 46.8131, longitude: -71.2079, favoris: [] },
    at,
    routes: (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/v1/geocode')) return geocode;
      if (url.pathname.endsWith('/v5/plan')) return reponses.plan as Record<string, unknown>;
      if (url.pathname.endsWith('/v5/stoptimes'))
        return reponses.stoptimes as Record<string, unknown>;
      return { status: 404 };
    },
  });

test('minutes au singulier et au pluriel, jamais « 1 minutes »', () => {
  assert.equal(minutesDit(1), '1 minute');
  assert.equal(minutesDit(2), '2 minutes');
  assert.equal(dans(20_000), 'dans moins d’une minute');
  assert.equal(dans(60_000), 'dans 1 minute');
  assert.equal(dans(6 * 60_000), 'dans 6 minutes');
});

test('apostrophe typographique à l’oral et sur la carte', () => {
  assert.equal(typo("Carrefour de l'Estrie"), 'Carrefour de l’Estrie');
  assert.equal(arretDit("Carrefour de l'Estrie"), 'Carrefour de l’Estrie');
  assert.equal(arretDit("STATION L'ASSOMPTION"), 'station L’Assomption');
  assert.equal(arretDit('Station de la GAPPE #2'), 'station de la Gappe');
  assert.equal(arretDit('STATION ST-LAURENT'), 'station Saint-Laurent');
  assert.equal(lieuDit('terminus Longueuil'), 'au terminus Longueuil');
  assert.equal(lieuDit('King et Wellington'), 'à l’arrêt King et Wellington');
  assert.equal(
    vehiculeDit({ mode: 'BUS', routeShortName: '12', agencyId: 'AUTRE' }, reseau),
    'l’autobus 12 (Autre réseau)',
  );
});

test('destinations et adresses substituées refusées', () => {
  assert.deepEqual(destinationFor({ favoris: [] }, 'au Centre Bell'), {
    vers: 'au Centre Bell',
    adresse: 'Centre Bell',
  });
  assert.equal(destinationFor({ favoris: [] }, 'Centre Bell').vers, 'à Centre Bell');
  assert.equal(surLaRue('1500 rue Berri', { street: 'Rue Serre', houseNumber: '1500' }), false);
  assert.equal(surLaRue('Saint-Denis et Mont-Royal', { name: 'Mont-Royal et Saint-Denis' }), true);
});

test('durée absente : aucune durée dite ni inventée ; 1 minute au singulier', async (t) => {
  const f = essai(t, {
    plan: plan({ endTime: minute(30), legs: [{ mode: 'WALK', duration: 60 }, leg(5)] }),
    stoptimes: { stopTimes: [passage(5), passage(25)] },
  });
  const result = await f.invoke('trajet', { query: 'à l’Université' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    'Pour te rendre à l’Université, le prochain départ est l’autobus 7 dans 5 minutes selon l’horaire, à l’arrêt Côte d’Abraham, à 1 minute à pied. ' +
      'Le suivant est prévu dans 25 minutes selon l’horaire.',
  );
  assert.doesNotMatch(result.tool.summary, /durée|60 minutes/u);
  // Le géocodeur reçoit l'apostrophe droite ; la carte garde la typographique.
  const geocodes = f.calls.filter((call) => call.url.includes('/v1/geocode'));
  assert.equal(new URL(geocodes[0]!.url).searchParams.get('text'), 'Université');
  const carte = (result.outcome as { card?: { subtitle?: string; items?: unknown[] } }).card;
  assert.equal(carte?.subtitle, 'Côte d’Abraham → Pavillon de l’Université');
  assert.deepEqual(carte?.items?.at(-1), { label: 'Marche jusqu’à l’arrêt', value: '1 min' });
});

test('aucun passage à attraper : rien n’est promis, ni « dans l’heure »', async (t) => {
  const f = essai(t, {
    // Le seul départ connu est déjà passé quand on arrive à pied.
    plan: plan({
      duration: 60,
      endTime: minute(3),
      legs: [{ mode: 'WALK', duration: 600 }, leg(2)],
    }),
    stoptimes: { stopTimes: [passage(2)] },
  });
  const result = await f.invoke('trajet', { query: 'à l’Université' });
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    'Pour te rendre à l’Université, je ne trouve pas de prochain départ de l’autobus 7 à l’arrêt Côte d’Abraham, à 10 minutes à pied. ' +
      'La durée du trajet est de 1 minute.',
  );
  assert.doesNotMatch(result.tool.summary, /dans l’heure/u);
});

test('départ de l’itinéraire ajouté quand les passages lus s’arrêtent avant lui', async (t) => {
  const f = essai(t, {
    plan: plan({ duration: 1800, endTime: minute(50), legs: [leg(20)] }),
    // Arrêt très desservi : les passages lus ne vont pas jusqu'au départ de l'itinéraire.
    stoptimes: { stopTimes: [passage(4)] },
  });
  const result = await f.invoke('trajet', { query: 'à l’Université' });
  assert.equal(
    result.tool.summary,
    'Pour te rendre à l’Université, le prochain départ est l’autobus 7 dans 4 minutes selon l’horaire, à l’arrêt Côte d’Abraham. ' +
      'La durée du trajet est de 30 minutes. Le suivant est prévu dans 20 minutes selon l’horaire.',
  );
});

test('l’apostrophe typographique est changée en apostrophe droite avant le géocodage', async (t) => {
  const f = createTestModule(t, addon, {
    config: { adresseDepart: 'Gare de l’Est', favoris: [] },
    routes: () => ({ status: 404 }),
  });
  await f.invoke('trajet', { query: 'à l’Université' });
  const textes = f.calls
    .filter((call) => call.url.includes('/v1/geocode'))
    .map((call) => new URL(call.url).searchParams.get('text') ?? '');
  assert.ok(textes.length > 0);
  for (const texte of textes) assert.doesNotMatch(texte, /[’‘]/u, texte);
  assert.equal(textes[0], "Gare de l'Est");
});
