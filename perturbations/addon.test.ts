import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestModule, validateAddonDefinition } from '#cornelius/testing';
import addon from './index.js';

/**
 * Vraie réponse de siri-sx-unplanned, relevée le 29 octobre 2026 à 7 h 22 (UTC), raccourcie à
 * sept de ses vingt-deux annonces, sans autre retouche :
 * - m2 des TL (`LineRef` 85:151:72), ascenseur de Riponne-M. Béjart, en cours ;
 * - lignes 509 et 510 (85:841), le 15 novembre seulement : pas encore commencée ;
 * - gare de Neuhausen, ascenseur hors service, sans ligne ;
 * - ligne 3 (85:146:3), jusqu'à 8 h 30 ;
 * - lignes 1, 6 et 14 de l'exploitant 820, jusqu'à 10 h 36 ;
 * - ligne 121 de CarPostal (`LineRef` 85:801:2242), jusqu'à 7 h 35 ;
 * - lignes 101 et 107 (85:153), jusqu'à 8 h 15.
 */
const feed = readFileSync(new URL('./fixtures/siri-sx.xml', import.meta.url), 'utf8');

/** Le même flux, sans aucune annonce : l'en-tête réel et les balises fermantes. */
const emptyFeed = `${feed.slice(0, feed.indexOf('<PtSituationElement>'))}</Situations></SituationExchangeDelivery></ServiceDelivery></Siri>`;

const setup = (
  t: { after(fn: () => void): void },
  options: {
    config?: Record<string, unknown>;
    secret?: boolean;
    at?: string;
    body?: string;
  } = {},
) =>
  createTestModule(t, addon, {
    at: options.at ?? '2026-10-29T07:30:00Z',
    timeZone: 'Europe/Zurich',
    config: options.config,
    ...(options.secret === false ? {} : { secrets: { siriSxToken: 'jeton-de-test' } }),
    routes: { '/siri-sx-unplanned': options.body ?? feed },
  });

/** Données lues, telles que le module les a rangées. */
const dataOf = (result: { snapshot: { data: unknown } }) =>
  result.snapshot.data as { perturbations: { fin: string | null }[]; total: number } | null;

/** Libellés de la carte, ou null si la lecture a échoué. */
async function labels(f: ReturnType<typeof setup>): Promise<string[] | null> {
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  return result.ok ? result.card.items.map((item) => item.label) : null;
}

test('définition conforme, outil annoncé et réglages par défaut valides', (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.deepEqual(
    f.runtime.tools().map((tool) => tool.name),
    ['perturbations__read'],
  );
});

test('les annonces des lignes et des arrêts surveillés sont retenues, les autres écartées', async (t) => {
  const f = setup(t, { config: { lignes: '1, m2', arrets: 'Neuhausen' } });
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Le m2 et la ligne 1 par leur numéro public, Neuhausen par son lieu ; le reste du flux dehors.
  assert.equal(result.card.primaryValue, '3 perturbations');
  assert.deepEqual(
    result.card.items.map((item) => item.label),
    ['m2', 'Neuhausen', '1, 6, 14'],
  );
  // La version courte (taille S) est préférée à l'en-tête : c'est celle qui se dit à l'oral.
  assert.equal(result.card.items[1]!.value, "Pas d'accès PMR à Neuhausen");
  assert.equal(result.card.items[2]!.value, 'Circulation irrégulière lignes 1, 6, 14');
  // L'identifiant du module, puis la source des données, que ses conditions demandent de citer.
  assert.deepEqual(result.card.sources, ['perturbations', 'opentransportdata.swiss']);
});

test('« m2 », « S1 » ou « IC 1 » ne sont pas les lignes 2 ou 1', async (t) => {
  assert.deepEqual(await labels(setup(t, { config: { lignes: '2', arrets: '' } })), []);
  assert.deepEqual(await labels(setup(t, { config: { lignes: 'S1, IC 1', arrets: '' } })), []);
  // « M2 » en capitale et « Bus 3 » restent reconnus.
  assert.deepEqual(await labels(setup(t, { config: { lignes: 'M2, Bus 3', arrets: '' } })), [
    'm2',
    '3',
  ]);
});

test('« exploitant:ligne » compare le numéro public, pas la fin de LineRef', async (t) => {
  // La ligne 121 de CarPostal porte la référence 85:801:2242 : « 801:121 » la trouve…
  assert.deepEqual(await labels(setup(t, { config: { lignes: '801:121', arrets: '' } })), ['121']);
  // … « 801:2242 » ne désigne aucune ligne que le voyageur connaisse…
  assert.deepEqual(await labels(setup(t, { config: { lignes: '801:2242', arrets: '' } })), []);
  // … et l'exploitant compte : la ligne 1 de l'exploitant 820 n'est pas celle d'un autre.
  assert.deepEqual(await labels(setup(t, { config: { lignes: '820:1', arrets: '' } })), [
    '1, 6, 14',
  ]);
  assert.deepEqual(await labels(setup(t, { config: { lignes: '151:1', arrets: '' } })), []);
});

test('« Chailly » n’attrape ni Chailly-Montreux ni Chailly-sur-Montreux', async (t) => {
  // L'annonce de Neuhausen sert de gabarit : on lui donne un autre lieu, textes compris.
  const at = (lieu: string) => feed.replaceAll('Neuhausen', lieu);
  const chailly = { lignes: '', arrets: 'Chailly' };
  assert.deepEqual(
    await labels(setup(t, { config: chailly, body: at('Chailly-sur-Montreux') })),
    [],
  );
  assert.deepEqual(
    await labels(setup(t, { config: chailly, body: at('Chailly-Montreux, village') })),
    [],
  );
  assert.deepEqual(
    await labels(setup(t, { config: chailly, body: at('Lausanne, Chailly-Village') })),
    ['Lausanne, Chailly-Village'],
  );
});

test('un arrêt précis s’écrit avec sa ville : la virgule ne coupe plus le réglage', async (t) => {
  const body = feed.replaceAll('Neuhausen', 'Lausanne, Chailly-Village');
  const config = { lignes: '', arrets: 'Lausanne, Chailly-Village; Ouchy' };
  assert.deepEqual(await labels(setup(t, { config, body })), ['Lausanne, Chailly-Village']);
  // Le même nom dans une autre ville n'est pas cet arrêt.
  const ailleurs = feed.replaceAll('Neuhausen', 'Renens, Chailly-Village');
  assert.deepEqual(await labels(setup(t, { config, body: ailleurs })), []);
});

test('un flux sans annonce donne « Aucune », sans erreur', async (t) => {
  const f = setup(t, { body: emptyFeed });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.status, 'empty');
  assert.equal(result.card.primaryValue, 'Aucune');
});

test('un flux tronqué ou dont aucune annonce ne se lit est une erreur, pas « Aucune »', async (t) => {
  // Coupé par le client au plafond de lecture.
  const coupe = setup(t);
  coupe.route({ '/siri-sx-unplanned': { status: 200, body: feed, truncated: true } });
  const truncated = await coupe.read();
  assert.equal(truncated.ok, false);
  if (!truncated.ok) assert.equal(truncated.error.code, 'malformed');
  // Coupé en route, au milieu de la première annonce.
  const milieu = setup(t, { body: feed.slice(0, feed.indexOf('<PtSituationElement>') + 3000) });
  const cut = await milieu.read();
  assert.equal(cut.ok, false);
  if (!cut.ok) {
    assert.equal(cut.error.code, 'malformed');
    assert.match(cut.error.message, /aucune lue/u);
  }
});

test('préfixes d’espace de noms et attributs n’empêchent pas la lecture', async (t) => {
  const prefixed = feed
    .replace(/<(\/?)(?=[A-Za-z])/gu, '<$1siri:')
    .replaceAll('<siri:PtSituationElement>', '<siri:PtSituationElement version="2.0">');
  assert.notEqual(prefixed, feed);
  const config = { lignes: '1, m2', arrets: 'Neuhausen' };
  assert.deepEqual(await labels(setup(t, { config, body: prefixed })), [
    'm2',
    'Neuhausen',
    '1, 6, 14',
  ]);
});

test('une annonce terminée est écartée, une annonce en cours garde sa fin', async (t) => {
  const config = { lignes: '101', arrets: '' };
  const pendant = setup(t, { config });
  const result = await pendant.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(dataOf(result)?.perturbations[0]?.fin, '2026-10-29T08:15:00.000Z');
  // Cinq minutes après sa fin, la même annonce, toujours dans le flux, n'est plus retenue.
  assert.deepEqual(await labels(setup(t, { config, at: '2026-10-29T08:20:00Z' })), []);
});

test('une annonce pas encore commencée n’est pas affichée en cours', async (t) => {
  const config = { lignes: '509', arrets: '' };
  assert.deepEqual(await labels(setup(t, { config })), []);
  assert.deepEqual(await labels(setup(t, { config, at: '2026-11-15T12:00:00Z' })), ['509, 510']);
});

test('chaque période de validité est lue pour elle-même', async (t) => {
  // Une première période ouverte, puis une seconde, demain : la fin de la seconde ne doit pas
  // être prise pour celle de la première.
  const body = feed.replace(
    '<ValidityPeriod><StartTime>2026-10-29T07:08:42Z</StartTime><EndTime>2026-10-29T08:15:00Z</EndTime></ValidityPeriod>',
    '<ValidityPeriod><StartTime>2026-10-29T07:08:42Z</StartTime></ValidityPeriod>' +
      '<ValidityPeriod><StartTime>2026-10-30T07:00:00Z</StartTime><EndTime>2026-10-30T08:00:00Z</EndTime></ValidityPeriod>',
  );
  assert.notEqual(body, feed);
  const f = setup(t, { config: { lignes: '101', arrets: '' }, at: '2026-10-29T09:00:00Z', body });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(dataOf(result)?.perturbations[0]?.fin, null);
});

test('le total compte toutes les annonces trouvées, la carte en montre la limite', async (t) => {
  // Sans filtre, six annonces sont en cours à 7 h 30 (celle du 15 novembre ne l'est pas).
  const f = setup(t, { config: { lignes: '', arrets: '', limite: 2 } });
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(dataOf(result)?.total, 6);
  assert.equal(result.card.primaryValue, '6 perturbations');
  assert.equal(result.card.items.length, 2);
  assert.equal(result.card.description, 'Les 2 premières sur 6.');
  assert.match(result.presentation.summary, /^6 perturbations en cours/u);
});

test('une entité numérique hors limites ne fait pas planter la lecture', async (t) => {
  const body = feed.replace(
    'Circulation irrégulière lignes 1, 6, 14<',
    'Circulation irrégulière lignes 1, 6, 14 &#99999999;<',
  );
  assert.notEqual(body, feed);
  assert.deepEqual(await labels(setup(t, { config: { lignes: '820:1', arrets: '' }, body })), [
    '1, 6, 14',
  ]);
});

test('le jeton part dans l’en-tête Authorization, jamais dans l’adresse', async (t) => {
  const f = setup(t);
  await f.read();
  assert.equal(f.calls[0]?.headers?.Authorization, 'Bearer jeton-de-test');
  assert.equal(f.calls[0]?.url.includes('jeton'), false);
});

test('aucune annonce pour les lignes du foyer : le module le dit', async (t) => {
  const f = setup(t, { config: { lignes: 'B 99', arrets: '' } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.status, 'empty');
  assert.equal(result.card.primaryValue, 'Aucune');
  assert.match(result.presentation.summary, /Aucune perturbation signalée pour B 99/u);
});

test('sans jeton, le module refuse de lire sans appeler le flux', async (t) => {
  const f = setup(t, { secret: false });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'config_invalid');
  assert.match(result.error.message, /CORNELIUS_SIRI_SX_TOKEN/u);
  assert.equal(f.calls.length, 0);
});

test('un jeton refusé et un quota dépassé sont dits clairement', async (t) => {
  const refusé = setup(t);
  refusé.route({ '/siri-sx-unplanned': { status: 401 } });
  const unauthorized = await refusé.read();
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.error.code, 'auth');

  const limité = setup(t);
  limité.route({ '/siri-sx-unplanned': { status: 429 } });
  const quota = await limité.read();
  assert.equal(quota.ok, false);
  if (!quota.ok) {
    assert.equal(quota.error.code, 'quota');
    assert.match(quota.error.message, /deux appels par minute/u);
  }
});

test('une réponse qui n’est pas du SIRI-SX est refusée', async (t) => {
  const f = setup(t);
  f.route({ '/siri-sx-unplanned': '<html>maintenance</html>' });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'malformed');
});

test('un arrêt qui porte le nom d’une autre localité ne répond pas à « Chailly »', async (t) => {
  const at = (lieu: string) => feed.replaceAll('Neuhausen', lieu);
  const chailly = { lignes: '', arrets: 'Chailly' };
  assert.deepEqual(
    await labels(setup(t, { config: chailly, body: at('Montreux, Chailly-sur-Montreux') })),
    [],
  );
  // Un lieu sans ville est une localité : « Chailly-Village » seul se surveille par son nom.
  assert.deepEqual(await labels(setup(t, { config: chailly, body: at('Chailly-Village') })), []);
  assert.deepEqual(
    await labels(
      setup(t, { config: { lignes: '', arrets: 'Chailly-Village' }, body: at('Chailly-Village') }),
    ),
    ['Chailly-Village'],
  );
});
