import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, {
  arretDit,
  coeurSansLectureBinaire,
  destinationFor,
  phraseAvis,
  surLaRue,
  vehiculeDit,
  voyageStm,
} from './index.js';
import { lirePassages } from './gtfs-rt.js';
// Réponses réelles relevées le 2026-11-11 à 21 h 16 UTC (16 h 16 à Montréal), lieux publics
// seulement : Transitous (géocodage, itinéraire, passages) et l'état du service de la STM.
import etatservice from './fixtures/etatservice.json' with { type: 'json' };
import geocodeCentreBell from './fixtures/geocode-centre-bell.json' with { type: 'json' };
import geocodeSaintMichel from './fixtures/geocode-saint-michel.json' with { type: 'json' };
import planCentreBell from './fixtures/plan-centre-bell.json' with { type: 'json' };
import planSaintMichel from './fixtures/plan-saint-michel.json' with { type: 'json' };
import stoptimesCentreBell from './fixtures/stoptimes-centre-bell.json' with { type: 'json' };
import stoptimesSaintMichel from './fixtures/stoptimes-saint-michel.json' with { type: 'json' };
import etatSnowdon from './fixtures/etatservice-snowdon.json' with { type: 'json' };
import transitousSnowdon from './fixtures/transitous-snowdon.json' with { type: 'json' };

const at = '2026-11-11T21:16:00Z';
const berri = { depart: 'Berri-UQAM', latitude: 45.515, longitude: -73.561, favoris: [] };
const jeanTalon = { depart: 'Jean-Talon', latitude: 45.539, longitude: -73.614, favoris: [] };

type Scenario = 'centre-bell' | 'saint-michel';
const fixtures = {
  'centre-bell': {
    geocode: geocodeCentreBell,
    plan: planCentreBell,
    stoptimes: stoptimesCentreBell,
  },
  'saint-michel': {
    geocode: geocodeSaintMichel,
    plan: planSaintMichel,
    stoptimes: stoptimesSaintMichel,
  },
};
const routes =
  (scenario: Scenario, stm: 'ok' | 'refus' = 'ok') =>
  (request: { url: string }) => {
    const url = new URL(request.url);
    if (url.hostname === 'api.stm.info') return stm === 'ok' ? etatservice : { status: 403 };
    if (url.pathname.endsWith('/v1/geocode'))
      return /michel/iu.test(url.searchParams.get('text') ?? '')
        ? fixtures['saint-michel'].geocode
        : fixtures['centre-bell'].geocode;
    if (url.pathname.endsWith('/v5/plan')) return fixtures[scenario].plan;
    if (url.pathname.endsWith('/v5/stoptimes')) return fixtures[scenario].stoptimes;
    return { status: 404 };
  };
const setup = (
  t: { after(fn: () => void): void },
  config: Record<string, unknown>,
  scenario: Scenario,
  stm: 'ok' | 'refus' = 'ok',
) => createTestModule(t, addon, { config, at, routes: routes(scenario, stm) });

test('trajet vers un lieu dit à la voix : métro, durée et départ suivant', async (t) => {
  const f = setup(t, berri, 'centre-bell');
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, berri).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { ...berri, latitude: 46.8 }).ok, false);
  const result = await f.invoke('trajet', { query: 'au Centre Bell' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    'Pour te rendre au Centre Bell, le prochain départ est le métro, ligne orange dans 1 minute selon l’horaire, à la station Berri-UQAM, à 1 minute à pied. ' +
      'La durée du trajet est de 11 minutes. Le suivant est prévu dans 4 minutes selon l’horaire.',
  );
  // « Service normal du métro » (ligne orange) n'est jamais dit.
  assert.doesNotMatch(result.tool.summary, /Avis|Service normal/u);
  // Le départ part arrondi à environ 100 m, avec un User-Agent honnête.
  const plan = f.calls.find((call) => call.url.includes('/v5/plan'))!;
  assert.equal(new URL(plan.url).searchParams.get('fromPlace'), '45.515,-73.561');
  assert.match(plan.headers?.['User-Agent'] ?? '', /^Cornelius-module-stm/u);
});

test('avis de la STM sur la ligne dit à la fin ; refus de la STM sans effet', async (t) => {
  const f = setup(t, jeanTalon, 'saint-michel');
  const result = await f.invoke('trajet', { query: 'à la station Saint-Michel' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.equal(
    result.tool.summary,
    'Pour te rendre à la station Saint-Michel, le prochain départ est le métro, ligne bleue dans 5 minutes selon l’horaire, à la station Jean-Talon, à 2 minutes à pied. ' +
      'La durée du trajet est de 9 minutes. Le suivant est prévu dans 10 minutes selon l’horaire. ' +
      'Avis de la STM : Ce samedi 14 novembre, le service métro débutera seulement vers 9h30 sur la ligne 5 - Bleue ' +
      "en raison de travaux d'entretien d'Hydro-Québec. Un service de navettes sera disponible.",
  );
  const stm = f.calls.find((call) => call.url.startsWith('https://api.stm.info/'))!;
  assert.ok((stm.headers?.apiKey ?? '').length > 20, 'clé de l’application envoyée');

  const g = setup(t, jeanTalon, 'saint-michel', 'refus');
  const sansAvis = await g.invoke('trajet', { query: 'à la station Saint-Michel' });
  assert.equal(sansAvis.tool.status, 'succeeded', sansAvis.tool.error?.message);
  assert.doesNotMatch(sansAvis.tool.summary, /Avis/u);
});

test('départ donné par une adresse ; sans adresse ni coordonnées, réglage incomplet', async (t) => {
  const parAdresse = {
    depart: 'la maison',
    adresseDepart: 'station Saint-Michel',
    latitude: null,
    longitude: null,
    favoris: [],
  };
  const f = setup(t, parAdresse, 'centre-bell');
  assert.equal(f.runtime.validateConfig(addon.id, parAdresse).ok, true);
  const result = await f.invoke('trajet', { query: 'au Centre Bell' });
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  const geocodes = f.calls.filter((call) => call.url.includes('/v1/geocode'));
  assert.equal(new URL(geocodes[0]!.url).searchParams.get('text'), 'station Saint-Michel');
  const plan = f.calls.find((call) => call.url.includes('/v5/plan'))!;
  assert.equal(new URL(plan.url).searchParams.get('fromPlace'), '45.56,-73.6');

  const g = setup(t, { depart: 'la maison', favoris: [] }, 'centre-bell');
  const incomplet = await g.invoke('trajet', { query: 'au Centre Bell' });
  assert.notEqual(incomplet.tool.status, 'succeeded');
  assert.match(incomplet.tool.error?.message ?? '', /adresse du départ/u);
});

test('destinations, adresses refusées et noms dits à la voix', () => {
  const favoris = [
    { nom: 'travail', dit: 'au travail', adresse: '1000 rue Sainte-Catherine Ouest, Montréal' },
  ];
  const config = { ...berri, favoris };
  assert.deepEqual(destinationFor(config, 'comment je vais au travail'), {
    vers: 'au travail',
    adresse: '1000 rue Sainte-Catherine Ouest, Montréal',
  });
  assert.deepEqual(destinationFor(config, 'au 4777 avenue Pierre-De Coubertin, Montréal'), {
    vers: 'au 4777 avenue Pierre-De Coubertin',
    adresse: '4777 avenue Pierre-De Coubertin, Montréal',
  });
  assert.equal(destinationFor(config, 'Centre Bell').vers, 'à Centre Bell');
  assert.equal(destinationFor(config, undefined).vers, 'au travail');
  assert.throws(() => destinationFor(berri, undefined), /destination favorite/u);
  // Le géocodeur substitue sans prévenir une voisine d'orthographe : refusée.
  assert.equal(
    surLaRue('1500 rue Berri, Montréal', { street: 'Rue Serre', houseNumber: '1500' }),
    false,
  );
  assert.equal(
    surLaRue('Berri et Sainte-Catherine', { name: 'Rue Guy et rue Sainte-Catherine' }),
    false,
  );
  assert.equal(
    surLaRue('Saint-Denis et Mont-Royal', { name: 'Avenue du Mont-Royal et rue Saint-Denis' }),
    true,
  );
  assert.equal(
    surLaRue('4777 avenue Pierre-De Coubertin', { street: 'Avenue Pierre de Coubertin' }),
    true,
  );
  assert.equal(
    vehiculeDit({ mode: 'SUBWAY', routeShortName: '2', routeLongName: 'Ligne 2 - Orange' }),
    'le métro, ligne orange',
  );
  assert.equal(vehiculeDit({ mode: 'BUS', routeShortName: '24' }), 'l’autobus 24');
  assert.equal(vehiculeDit({ mode: 'TRAM', routeShortName: 'A4-A1' }), 'le REM');
  assert.equal(arretDit('STATION ST-LAURENT'), 'station Saint-Laurent');
  assert.equal(arretDit('Sherbrooke / Saint-Denis'), 'Sherbrooke et Saint-Denis');
  assert.equal(
    phraseAvis('[Ouverture tardive] Ligne 5 fermée le matin. Navettes. <a class="external"'),
    'Ligne 5 fermée le matin. Navettes.',
  );
});

// Temps réel des autobus (GTFS-RT, binaire) : relevé réel du 2026-11-11 à 21 h 38 UTC, de la
// station Snowdon à l'Oratoire Saint-Joseph (autobus 51). Le flux de la STM (2 Mo) est réduit aux
// voyages de l'arrêt : les octets de leurs entités sont recopiés tels quels, sans réencodage.
test('décodeur GTFS-RT : passages réels des voyages demandés seulement', () => {
  const buf = new Uint8Array(
    readFileSync(new URL('./fixtures/tripupdates-snowdon.pb', import.meta.url)),
  );
  const tous = lirePassages(buf, { has: () => true } as unknown as Set<string>);
  assert.ok(tous.size > 5, 'plusieurs voyages');
  const [voyage] = [...tous.keys()];
  const un = lirePassages(buf, new Set([voyage!]));
  assert.deepEqual([...un.keys()], [voyage]);
  for (const ms of un.get(voyage!)!.values()) assert.ok(ms > Date.parse('2026-11-11T20:00:00Z'));
  assert.throws(
    () => lirePassages(buf.subarray(0, buf.length - 3), new Set([voyage!])),
    /tronqué/u,
  );
  assert.equal(voyageStm('20261111_16:47_ca-qc-STM_302247463'), '302247463');
});

test('temps réel des autobus avec un cœur qui lit le binaire ; sinon, l’horaire', async (t) => {
  const pb = new Uint8Array(
    readFileSync(new URL('./fixtures/tripupdates-snowdon.pb', import.meta.url)),
  );
  const routesSnowdon = (request: { url: string }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/tripUpdates')) return { status: 200, body: pb } as never;
    if (url.hostname === 'api.stm.info') return etatSnowdon;
    const cle =
      url.pathname.split('/').pop() + ((u) => (u.searchParams.delete('time'), u.search))(url);
    return (
      (transitousSnowdon as unknown as Record<string, Record<string, unknown>>)[cle] ?? {
        status: 404,
      }
    );
  };
  const snowdon = { depart: 'Snowdon', adresseDepart: 'Station Snowdon', favoris: [] };
  const f = createTestModule(t, addon, {
    config: snowdon,
    at: '2026-11-11T21:38:00Z',
    routes: routesSnowdon,
  });
  const result = await f.invoke('trajet', { query: 'à l’Oratoire Saint-Joseph' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.match(
    result.tool.summary,
    /^Pour te rendre à l’Oratoire Saint-Joseph, le prochain départ est l’autobus 51 /u,
  );
  const debut =
    'Pour te rendre à l’Oratoire Saint-Joseph, le prochain départ est l’autobus 51 dans 2 minutes selon l’horaire, ' +
    'à la station Snowdon (Queen-Mary et Circle), à 1 minute à pied. La durée du trajet est de 12 minutes. ';
  // Avec bytes() (Cornelius plus récent que 0.3.0), le suivant est à l'heure réelle de la STM ;
  // sans, il reste celui de l'horaire. Le premier n'est pas encore dans le flux temps réel.
  assert.equal(
    result.tool.summary,
    debut +
      (coeurSansLectureBinaire()
        ? 'Le suivant est prévu dans 9 minutes selon l’horaire.'
        : 'Le suivant est prévu dans 9 minutes.'),
  );
});
