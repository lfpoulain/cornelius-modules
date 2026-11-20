import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { findFeeds, type CatalogueFeed } from './index.js';
import catalogue from './catalogue.json' with { type: 'json' };

// Flux fictifs, aux formats exacts de franceinfo (entités hexadécimales) et du Monde (CDATA).
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function setup(
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  reply: { status: number; body: string } = { status: 200, body: fixture('franceinfo.xml') },
) {
  return createTestModule(t, addon, {
    config,
    at: '2026-10-20T13:30:00Z',
    ref: 'titres',
    routes: () => reply,
  });
}

test('définition, réglages et contrat', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const url of ['ftp://exemple.fr/flux', 'franceinfo.fr/titres.rss', 'javascript:alert(1)'])
    assert.equal(f.runtime.validateConfig(addon.id, { url, count: 3 }).ok, false, url);
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(f.calls[0]?.url, 'https://www.franceinfo.fr/titres.rss');
});

test('franceinfo : entités décodées, ancienneté, nombre de titres réglé', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Actu · franceinfo');
  assert.equal(
    result.card.primaryValue,
    'Titre fictif : la météo se dégrade sur la façade atlantique',
  );
  assert.equal(result.card.subtitle, 'Il y a 34 minutes');
  assert.equal(result.card.description, 'Un texte fictif d’essai, au format du flux.');
  assert.deepEqual(result.card.items, [
    // 1 h 38 et 4 h 25 plus tôt, arrondis à l'heure.
    { label: 'Il y a 2 heures', value: 'Deuxième titre fictif, publié une heure plus tôt' },
    { label: 'Il y a 4 heures', value: 'Troisième titre fictif' },
  ]);
  assert.equal(
    result.presentation.summary,
    'Les titres de franceinfo : Titre fictif : la météo se dégrade sur la façade atlantique. ' +
      'Deuxième titre fictif, publié une heure plus tôt. Troisième titre fictif.',
  );
});

test('Le Monde : CDATA, nom court du journal, ordre de la rédaction gardé', async (t) => {
  const f = setup(
    t,
    { url: 'https://www.lemonde.fr/rss/une.xml', count: 5 },
    { status: 200, body: fixture('lemonde.xml') },
  );
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Actu · Le Monde.fr');
  assert.equal(
    result.card.primaryValue,
    'Titre fictif en direct : « une journée d’essai » pour le module',
  );
  assert.equal(
    result.card.items[0]?.value,
    'Un titre fictif plus récent, placé en second par la rédaction',
  );
  assert.match(result.presentation.summary, /pour le module. Un titre fictif plus récent/u);
});

test('panne après expiration : derniers titres connus, annoncés comme tels', async (t) => {
  const f = setup(t);
  assert.equal((await f.read()).ok, true);
  f.advance(15 * 60 * 1000 + 1);
  f.route(() => ({ status: 503 }));
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.match(result.presentation.summary, /^Derniers titres connus, le journal ne répond pas\./u);
  assert.equal(result.card.description, 'Derniers titres connus : le journal ne répond pas.');
});

test('adresse qui ne donne pas un flux, flux absent ou vide', async (t) => {
  const page = await setup(t, {}, { status: 200, body: '<!DOCTYPE html><html></html>' }).read();
  assert.equal(page.ok, false);
  if (!page.ok) {
    assert.equal(page.error.code, 'malformed');
    assert.equal(page.error.message, 'Cette adresse ne donne pas un flux RSS ou Atom.');
  }
  const missing = await setup(t, {}, { status: 404, body: '' }).read();
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'not_found');
  const empty = await setup(
    t,
    {},
    { status: 200, body: '<rss><channel><title>Vide</title></channel></rss>' },
  ).read();
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, 'empty');
});

test('recherche par zone : région exacte, pays du foyer, national ; adresse collée', async () => {
  const labels = (query: string, timeZone?: string) =>
    findFeeds(query, timeZone).map((r) => r.label);
  assert.deepEqual(labels('Québec', 'America/Toronto').slice(0, 3), [
    'Radio-Canada · Région de Québec',
    'Noovo Info · Région de Québec',
    'TVA Nouvelles · national',
  ]);
  assert.deepEqual(labels('Montréal', 'America/Toronto').slice(0, 2), [
    'Radio-Canada · Montréal et environs',
    'Noovo Info · Montréal et environs',
  ]);
  assert.deepEqual(labels('bretagne'), ['France 3 · Bretagne']);
  // Le pays du foyer passe en tête, d'après son fuseau.
  assert.equal(labels('national', 'Europe/Paris')[0], 'franceinfo · national');
  assert.equal(labels('national', 'America/Toronto')[0], 'Radio-Canada · national');
  assert.equal(findFeeds('Bretagne')[0]!.detail, 'France › Bretagne · régional');
  assert.deepEqual(findFeeds('https://www.exemple.fr/flux.xml'), [
    { id: 'https://www.exemple.fr/flux.xml', label: 'exemple.fr', detail: 'Adresse saisie' },
  ]);
  assert.deepEqual(findFeeds('q'), []);
  assert.deepEqual(findFeeds('Atlantide'), []);
  // La recherche du formulaire passe par le même chemin.
  const via = await addon.search!.find({ kind: 'flux', query: 'Estrie', values: {} }, {
    timeZone: 'America/Toronto',
  } as never);
  assert.deepEqual(
    via.map((r) => r.label),
    ['Radio-Canada · Estrie'],
  );
});

test('catalogue : flux uniques, en https, valides pour le module ; anciennes sources inchangées', (t) => {
  const f = setup(t);
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const feed of catalogue as CatalogueFeed[]) {
    assert.ok(!ids.has(feed.id) && !urls.has(feed.url), feed.id);
    ids.add(feed.id);
    urls.add(feed.url);
    assert.match(feed.url, /^https:\/\//u, feed.id);
    assert.ok(['national', 'régional'].includes(feed.niveau), feed.id);
    assert.equal(feed.region === null, feed.niveau === 'national', feed.id);
    const result = findFeeds(feed.media).find((r) => r.id === feed.url);
    if (result)
      assert.equal(
        f.runtime.validateConfig(addon.id, { url: result.id, feedLabel: result.label, count: 3 })
          .ok,
        true,
        feed.id,
      );
  }
  // Une source réglée avant la recherche (adresse seule, sans libellé) reste valide.
  assert.equal(
    f.runtime.validateConfig(addon.id, { url: 'https://www.franceinfo.fr/titres.rss', count: 3 })
      .ok,
    true,
  );
});
