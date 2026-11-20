import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';

const memoriesJson = readFileSync(new URL('./fixtures/memories.json', import.meta.url), 'utf8');
const searchJson = readFileSync(new URL('./fixtures/smart-search.json', import.meta.url), 'utf8');

function setup(
  t: { after(fn: () => void): void },
  options: {
    config?: Record<string, unknown>;
    secret?: string;
    timeZone?: string;
    memoriesReply?: { status: number; body: string; truncated?: boolean };
    searchReply?: { status: number; body: string; truncated?: boolean };
    randomReply?: { status: number; body: string; truncated?: boolean };
  } = {},
) {
  return createTestModule(t, addon, {
    config: { serverUrl: 'http://immich.local:2283', userName: 'Foyer', ...options.config },
    secrets: options.secret === '' ? {} : { IMMICH_API_KEY: options.secret ?? 'test-immich-key' },
    at: '2026-05-20T10:00:00Z',
    timeZone: options.timeZone ?? 'Europe/Paris',
    ref: 'immich-foyer',
    routes: (req) => {
      if (req.url.endsWith('/api/memories')) {
        return options.memoriesReply ?? { status: 200, body: memoriesJson };
      }
      if (req.url.endsWith('/api/search/smart')) {
        return options.searchReply ?? { status: 200, body: searchJson };
      }
      if (req.url.endsWith('/api/search/random')) {
        return options.randomReply ?? { status: 200, body: '[]' };
      }
      return { status: 404, body: '' };
    },
  });
}

test('définition, configuration et contrat', async (t) => {
  const f = setup(t);
  assert.equal(addon.minCoreVersion, '0.2.0');
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const serverUrl of ['', 'immich.local:2283', 'ftp://immich.local']) {
    assert.equal(
      f.runtime.validateConfig(addon.id, { ...addon.configDefaults, serverUrl }).ok,
      false,
      serverUrl,
    );
  }
  const { outcome } = await f.invoke('memories');
  assert.deepEqual(f.contract(outcome), []);
  assert.equal(f.calls[0]?.url, 'http://immich.local:2283/api/memories');
  assert.equal(f.calls[0]?.maxBytes, 2 * 1024 * 1024);
});

test('souvenirs du jour : carte, fuseau horaire du foyer et résumé vocal', async (t) => {
  const nearMidnight = JSON.stringify([
    {
      id: 'mem-tz',
      type: 'on_this_day',
      data: { year: 2024 },
      assets: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          originalFileName: 'IMG_20240520_0130.jpg',
          fileCreatedAt: '2024-05-19T23:30:00.000Z',
          exifInfo: { city: 'Annecy', country: 'France' },
        },
      ],
    },
  ]);
  const f = setup(t, { memoriesReply: { status: 200, body: nearMidnight } });
  const { outcome } = await f.invoke('memories');
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.card.title, 'Souvenirs Immich');
  assert.equal(outcome.card.primaryValue, 'Souvenirs · Foyer');
  assert.equal(outcome.card.items[0]?.label, '20 mai 2024');
  assert.equal(outcome.card.items[0]?.value, 'IMG_20240520_0130.jpg (Annecy, France)');
  assert.match(outcome.presentation.summary, /souvenirs du jour.*Foyer.*20 mai 2024/u);
});

test('repli aléatoire quand aucun souvenir du jour n’est présent', async (t) => {
  const randomAssets = JSON.stringify([
    {
      id: '55555555-5555-4555-8555-555555555555',
      originalFileName: 'randonnees.jpg',
      fileCreatedAt: '2023-07-10T12:00:00.000Z',
      exifInfo: { city: 'Chamonix', country: 'France' },
    },
  ]);
  const f = setup(t, {
    memoriesReply: { status: 200, body: '[]' },
    randomReply: { status: 200, body: randomAssets },
  });
  const { outcome } = await f.invoke('memories', { count: 3 });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(f.calls[1]?.url, 'http://immich.local:2283/api/search/random');
  assert.deepEqual(JSON.parse(String(f.calls[1]?.body ?? '{}')), {
    size: 3,
    type: 'IMAGE',
    withExif: true,
  });
  assert.equal(outcome.card.title, 'Sélection Immich');
  assert.equal(outcome.card.primaryValue, 'Sélection aléatoire · Foyer');
  assert.match(outcome.presentation.summary, /sélection aléatoire/u);
  assert.doesNotMatch(outcome.presentation.summary, /^Voici les souvenirs/u);
});

test('recherche intelligente CLIP par mot-clé', async (t) => {
  const f = setup(t);
  const { outcome } = await f.invoke('search', { query: 'vacances' });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.card.title, 'Photos : vacances');
  assert.equal(outcome.card.primaryValue, '2 photos trouvées');
  assert.equal(outcome.card.items[0]?.value, 'vacances_plage.jpg (Biarritz, France)');
  assert.match(outcome.presentation.summary, /vacances/u);
});

test('clé absente, clé refusée, réponse illisible, panne et photothèque vide', async (t) => {
  const { outcome: noKey } = await setup(t, { secret: '' }).invoke('memories');
  assert.equal(noKey.ok, false);
  if (!noKey.ok) assert.equal(noKey.error.code, 'config_invalid');

  const { outcome: refused } = await setup(t, {
    memoriesReply: { status: 401, body: '{"message":"Unauthorized"}' },
  }).invoke('memories');
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, 'auth');

  const { outcome: badJson } = await setup(t, {
    memoriesReply: { status: 200, body: 'not-json' },
  }).invoke('memories');
  assert.equal(badJson.ok, false);
  if (!badJson.ok) assert.equal(badJson.error.code, 'malformed');

  const { outcome: badShape } = await setup(t, {
    memoriesReply: { status: 200, body: '{"unexpected":true}' },
  }).invoke('memories');
  assert.equal(badShape.ok, false);
  if (!badShape.ok) assert.equal(badShape.error.code, 'malformed');

  const { outcome: truncated } = await setup(t, {
    memoriesReply: { status: 200, body: memoriesJson, truncated: true },
  }).invoke('memories');
  assert.equal(truncated.ok, false);
  if (!truncated.ok) assert.equal(truncated.error.code, 'malformed');

  const { outcome: downMem } = await setup(t, {
    memoriesReply: { status: 503, body: 'down' },
  }).invoke('memories');
  assert.equal(downMem.ok, false);
  if (!downMem.ok) assert.equal(downMem.error.code, 'unavailable');

  const { outcome: downRandom } = await setup(t, {
    memoriesReply: { status: 200, body: '[]' },
    randomReply: { status: 500, body: 'error' },
  }).invoke('memories');
  assert.equal(downRandom.ok, false);
  if (!downRandom.ok) assert.equal(downRandom.error.code, 'unavailable');

  const fEmpty = setup(t, {
    memoriesReply: { status: 200, body: '[]' },
    randomReply: { status: 200, body: '[]' },
  });
  const { outcome: empty } = await fEmpty.invoke('memories');
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.equal(empty.empty, true);
  assert.equal(empty.card.primaryValue, 'Aucun souvenir aujourd’hui');
  assert.deepEqual(fEmpty.contract(empty), []);
});
