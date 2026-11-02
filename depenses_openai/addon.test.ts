import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';
import payload from './fixtures/costs.json' with { type: 'json' };

// 5 novembre 2026, 12:00 UTC : le fixture couvre le 1er (2,00 $) et le 5 (0,18 $).
const AT = '2026-11-05T12:00:00Z';
const AMBIENT_VALUE = '2,18 $';
const KEY = 'sk-admin-test-0000000000000000';

const setup = (t: { after(fn: () => void): void }, extra: Record<string, unknown> = {}) =>
  createTestModule(t, addon, {
    at: AT,
    routes: { '/organization/costs': payload },
    secrets: { adminKey: KEY },
    ...extra,
  });

// Début des journées UTC utiles aux cas construits à la main.
const DAY = 86_400;
const NOV_1 = 1793491200;
const bucket = (start: number, ...results: [number, string, string?][]) => ({
  start_time: start,
  results: results.map(([value, line_item, currency = 'usd']) => ({
    amount: { value, currency },
    line_item,
  })),
});
const costs = (...data: ReturnType<typeof bucket>[]) => ({ object: 'page', data, has_more: false });

test('définition, contrat, adresse et clé envoyées', async (t) => {
  const f = setup(t, { config: { projet: 'proj_TestProject0001', budgetMensuel: 10 } });
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(
    f.runtime.validateConfig(addon.id, { projet: 'autre', budgetMensuel: 10 }).ok,
    false,
  );
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  const url = new URL(f.calls[0]?.url ?? 'http://x');
  assert.equal(url.origin + url.pathname, 'https://api.openai.com/v1/organization/costs');
  // Le 5 novembre, les 7 derniers jours commencent le 30 octobre.
  assert.equal(url.searchParams.get('start_time'), String(NOV_1 - 2 * DAY));
  assert.equal(url.searchParams.get('bucket_width'), '1d');
  assert.equal(url.searchParams.get('project_ids'), 'proj_TestProject0001');
  assert.equal(f.calls[0]?.headers?.Authorization, `Bearer ${KEY}`);
});

test('totaux du mois, du jour, de la semaine et par modèle', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const data = result.snapshot.data;
  assert.equal(data?.month, 2.18);
  assert.equal(data?.today, 0.18);
  // Le fixture ne contient rien avant le 1er : la semaine (30 octobre - 5 novembre) égale le mois.
  assert.equal(data?.week, 2.18);
  assert.deepEqual((data?.byLine as { label: string; amount: number }[] | undefined)?.[0], {
    label: 'gpt-live-1',
    amount: 2,
  });
  assert.equal(result.card.primaryValue, '2,18 $ ce mois-ci');
  assert.match(result.presentation.summary, /0,18 \$/u);
});

test('semaine à cheval sur deux mois', async (t) => {
  // 3 novembre : la semaine part du 28 octobre, le mois du 1er novembre.
  const f = setup(t, {
    at: '2026-11-03T12:00:00Z',
    routes: {
      '/organization/costs': costs(
        bucket(NOV_1 - 4 * DAY, [1, 'gpt-ancien']),
        bucket(NOV_1 - DAY, [0.5, 'gpt-ancien']),
        bucket(NOV_1, [2, 'gpt-live-1']),
        bucket(NOV_1 + 2 * DAY, [0.25, 'gpt-live-1, input']),
      ),
    },
  });
  const result = await f.read();
  assert.equal(
    new URL(f.calls[0]?.url ?? 'http://x').searchParams.get('start_time'),
    String(NOV_1 - 4 * DAY),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const data = result.snapshot.data;
  assert.equal(data?.monthStart, '2026-11-01');
  assert.equal(data?.month, 2.25);
  assert.equal(data?.week, 3.75);
  assert.equal(data?.today, 0.25);
  assert.deepEqual(data?.byLine, [{ label: 'gpt-live-1', amount: 2.25 }]);
});

test('les avoirs sont déduits', async (t) => {
  const f = setup(t, {
    routes: {
      '/organization/costs': costs(
        bucket(NOV_1, [2, 'gpt-live-1']),
        bucket(NOV_1 + 4 * DAY, [-0.5, 'credit']),
      ),
    },
  });
  const result = await f.read();
  assert.equal(result.ok && result.snapshot.data?.month, 1.5);
  assert.equal(result.ok && result.snapshot.data?.today, -0.5);
  assert.deepEqual(f.contract(result), []);
});

test('plusieurs devises : malformed', async (t) => {
  const f = setup(t, {
    routes: {
      '/organization/costs': costs(
        bucket(NOV_1, [2, 'gpt-live-1']),
        bucket(NOV_1 + DAY, [1, 'gpt-live-1', 'eur']),
      ),
    },
  });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'malformed');
});

test('budget : 80 % puis dépassé, carte et affichage permanent', async (t) => {
  const near = setup(t, { config: { projet: null, budgetMensuel: 2.5 } });
  const nearResult = await near.read();
  assert.equal(nearResult.ok, true);
  if (nearResult.ok) assert.match(nearResult.card.subtitle ?? '', /80 %/u);
  assert.match(near.ambient().content?.subtitle ?? '', /80 %/u);

  const over = setup(t, { config: { projet: null, budgetMensuel: 2 } });
  const overResult = await over.read();
  assert.equal(overResult.ok, true);
  if (overResult.ok) assert.match(overResult.card.subtitle ?? '', /dépassé/u);
  assert.match(over.ambient().content?.subtitle ?? '', /dépassé/u);

  const ok = setup(t, { config: { projet: null, budgetMensuel: 10 } });
  await ok.read();
  assert.equal(ok.ambient().content?.subtitle, 'sur 10,00 $ ce mois-ci');
});

test('pagination : pages suivantes lues, relevé incomplet au-delà de 3 pages', async (t) => {
  const pages = new Map<string | null, unknown>([
    [null, { ...costs(bucket(NOV_1, [1, 'gpt-live-1'])), has_more: true, next_page: 'p2' }],
    ['p2', { ...costs(bucket(NOV_1 + DAY, [2, 'gpt-live-1'])), has_more: false }],
  ]);
  const f = setup(t, {
    routes: (request: { url: string }) =>
      pages.get(new URL(request.url).searchParams.get('page')) as Record<string, unknown>,
  });
  const result = await f.read();
  assert.equal(f.calls.length, 2);
  assert.equal(new URL(f.calls[1]?.url ?? 'http://x').searchParams.get('page'), 'p2');
  assert.equal(result.ok && result.snapshot.data?.month, 3);
  assert.equal(result.ok && result.snapshot.data?.partial, false);

  const endless = setup(t, {
    routes: {
      '/organization/costs': {
        ...costs(bucket(NOV_1, [1, 'gpt-live-1'])),
        has_more: true,
        next_page: 'encore',
      },
    },
  });
  const partial = await endless.read();
  assert.equal(endless.calls.length, 3);
  assert.equal(partial.ok && partial.snapshot.data?.partial, true);
  assert.match((partial.ok && partial.card.description) || '', /incomplet/u);
});

test('le relevé expire à minuit chez le foyer, au plus tard après une heure', async (t) => {
  // 23:30 à Paris : « aujourd’hui » change à minuit, soit 23:00 UTC.
  const late = setup(t, { at: '2026-11-05T22:30:00Z' });
  const lateResult = await late.read();
  assert.equal(lateResult.ok && lateResult.snapshot.validUntil, '2026-11-05T23:00:00.000Z');
  const noon = setup(t);
  const noonResult = await noon.read();
  assert.equal(noonResult.ok && noonResult.snapshot.validUntil, '2026-11-05T13:00:00.000Z');
});

test('affichage permanent', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(f.ambient().content?.value, AMBIENT_VALUE);
});

test('clé absente : réglage incomplet, sans appel', async (t) => {
  const f = createTestModule(t, addon, { at: AT, routes: { '/organization/costs': payload } });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'config_invalid');
  assert.equal(f.calls.length, 0);
});

test('erreurs OpenAI', async (t) => {
  for (const [status, code] of [
    [401, 'auth'],
    [403, 'forbidden'],
    [429, 'quota'],
    [500, 'unavailable'],
    [404, 'upstream'],
  ] as const) {
    const f = setup(t, { routes: { '/organization/costs': { status, body: '{}' } } });
    const result = await f.read();
    assert.equal(result.ok, false, `statut ${status}`);
    if (!result.ok) assert.equal(result.error.code, code, `statut ${status}`);
  }
});

test('réponse inattendue : malformed', async (t) => {
  const f = setup(t, { routes: { '/organization/costs': { data: 'x', has_more: false } } });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'malformed');
});

test('les lectures simultanées et le cache frais ne doublent pas la collecte', async (t) => {
  const f = setup(t);
  const [first, second] = await Promise.all([f.read(), f.read()]);
  assert.equal(first.ok && second.ok, true);
  await f.read();
  assert.equal(f.calls.length, 1);
});

test('zéro dépense reste un succès utile', async (t) => {
  const f = setup(t, {
    routes: { '/organization/costs': { object: 'page', data: [], has_more: false } },
  });
  const result = await f.read();
  assert.equal(result.ok && result.snapshot.status, 'ready');
  assert.equal(result.ok && result.card.primaryValue, '0,00 $ ce mois-ci');
  assert.deepEqual(f.contract(result), []);
});

test('mois et jour du foyer : début du mois à Paris, avant le premier jour UTC', async (t) => {
  // 1er novembre à 00:30 à Paris, encore le 31 octobre en UTC : rien n'est publié pour novembre,
  // mais la semaine compte la fin d'octobre.
  const f = setup(t, {
    at: '2026-10-31T23:30:00Z',
    routes: { '/organization/costs': costs(bucket(NOV_1 - DAY, [0.4, 'gpt-live-1'])) },
  });
  const result = await f.read();
  assert.equal(
    new URL(f.calls[0]?.url ?? 'http://x').searchParams.get('start_time'),
    String(NOV_1 - 6 * DAY),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, '0,00 $ ce mois-ci');
  assert.equal(result.snapshot.data?.monthStart, '2026-11-01');
  assert.equal(result.snapshot.data?.week, 0.4);
  assert.equal(result.snapshot.data?.today, null);
  assert.equal(result.card.items[0]?.value, 'pas encore publié');
  assert.match(result.presentation.summary, /rien n’est encore publié pour aujourd’hui/u);
  assert.equal(f.ambient().content?.items[0]?.value, 'pas encore publié');
});

test('mois et jour du foyer : fuseau en retard sur UTC', async (t) => {
  // 1er novembre 05:00 UTC, encore le 31 octobre à Honolulu : mois d'octobre, jour du 31.
  const f = setup(t, {
    at: '2026-11-01T05:00:00Z',
    timeZone: 'Pacific/Honolulu',
    routes: {
      '/organization/costs': {
        object: 'page',
        data: [
          {
            start_time: 1793404800,
            results: [{ amount: { value: 0.5, currency: 'usd' }, line_item: 'gpt-live-1' }],
          },
          {
            start_time: 1793491200,
            results: [{ amount: { value: 9, currency: 'usd' }, line_item: 'gpt-live-1' }],
          },
        ],
        has_more: false,
      },
    },
  });
  const result = await f.read();
  assert.equal(new URL(f.calls[0]?.url ?? 'http://x').searchParams.get('start_time'), '1790812800');
  assert.equal(result.ok && result.snapshot.data?.monthStart, '2026-10-01');
  assert.equal(result.ok && result.snapshot.data?.today, 0.5);
  assert.equal(result.ok && result.snapshot.data?.month, 0.5);
});

test('une panne après expiration annonce le dernier relevé', async (t) => {
  const f = setup(t);
  const first = await f.read();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  f.advance(60 * 60_000 + 1);
  f.route({ '/organization/costs': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.equal(result.snapshot.fetchedAt, first.snapshot.fetchedAt);
  assert.match(result.presentation.summary, /^Dernier relev/u);
  assert.equal(f.runtime.toolResult(result).status, 'stale');
});

test('une première panne ne crée ni données ni date de succès', async (t) => {
  const f = setup(t, { routes: { '/organization/costs': { status: 503 } } });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'unavailable');
  const snapshot = f.instances.getSnapshot(f.instance);
  assert.equal(snapshot?.status, 'error');
  assert.equal(snapshot?.data, null);
  assert.equal(snapshot?.fetchedAt, null);
});

test('une référence inconnue ne déclenche aucune requête', async (t) => {
  const f = setup(t);
  const result = await f.runtime.read(addon.id, null, 'autre', new AbortController().signal);
  assert.equal(result.ok, false);
  assert.equal(f.calls.length, 0);
});
