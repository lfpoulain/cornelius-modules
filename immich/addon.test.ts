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
    memoriesReply?: { status: number; body: string };
    searchReply?: { status: number; body: string };
  } = {},
) {
  return createTestModule(t, addon, {
    config: { serverUrl: 'http://immich.local:2283', userName: 'Camille', ...options.config },
    secrets: options.secret === '' ? {} : { IMMICH_API_KEY: options.secret ?? 'test-immich-key' },
    at: '2026-05-20T10:00:00Z',
    ref: 'immich-camille',
    routes: (req) => {
      if (req.url.endsWith('/api/memories')) {
        return options.memoriesReply ?? { status: 200, body: memoriesJson };
      }
      if (req.url.endsWith('/api/search/smart')) {
        return options.searchReply ?? { status: 200, body: searchJson };
      }
      if (req.url.endsWith('/api/search/random')) {
        return { status: 200, body: '[]' };
      }
      return { status: 404, body: '' };
    },
  });
}

test('définition, configuration et contrat', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...addon.configDefaults, serverUrl: '' }).ok,
    false,
  );
  const { outcome } = await f.invoke('memories');
  assert.deepEqual(f.contract(outcome), []);
  assert.equal(f.calls[0]?.url, 'http://immich.local:2283/api/memories');
});

test('souvenirs du jour : carte et résumé vocal', async (t) => {
  const f = setup(t);
  const { outcome } = await f.invoke('memories');
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.card.title, 'Souvenirs Immich');
  assert.equal(outcome.card.primaryValue, 'Souvenirs · Camille');
  assert.equal(outcome.card.items.length, 2);
  assert.equal(outcome.card.items[0]?.value, 'IMG_20240520_1430.jpg (Annecy, France)');
  assert.match(outcome.presentation.summary, /Camille.*2 clichés/u);
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

test('clé absente ou photothèque vide', async (t) => {
  const { outcome: noKey } = await setup(t, { secret: '' }).invoke('memories');
  assert.equal(noKey.ok, false);
  if (!noKey.ok) assert.equal(noKey.error.code, 'auth');

  const { outcome: empty } = await setup(t, {
    memoriesReply: { status: 200, body: '[]' },
  }).invoke('memories');
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, 'empty');
});
