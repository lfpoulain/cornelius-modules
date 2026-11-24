import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { api, nomDemande, paysDuFoyer } from './index.js';

// Réponses simulées, au format exact de l'API de l'annuaire (un seul poste par demande).
const franceInter = {
  poste: {
    nom: 'France Inter',
    flux: 'https://flux.exemple.fr/franceinter-midfi.mp3',
    logo: 'https://radio.jokobee.com/logos/france-inter.png',
    pays: 'FR',
  },
};
const jazz = {
  poste: {
    nom: 'Jazz au hasard',
    flux: 'https://flux.exemple.fr/jazz.aac',
    logo: null,
    pays: 'FR',
  },
};

function setup(
  t: { after(fn: () => void): void },
  reply: { status: number; body?: unknown } = { status: 200, body: franceInter },
  { cle = 'cle-essai', timeZone = 'Europe/Paris' }: { cle?: string | null; timeZone?: string } = {},
) {
  return createTestModule(t, addon, {
    config: addon.configDefaults,
    at: '2026-11-24T15:00:00Z',
    timeZone,
    ...(cle ? { secrets: { radioKey: cle } } : {}),
    routes: (request: { url: string }) => {
      if (!request.url.startsWith(api)) return { status: 404 };
      return reply.body === undefined ? { status: reply.status } : reply;
    },
  } as never);
}

test('« mets France Inter » : le poste joue, avec son logo, et la clé part dans l’en-tête', async (t) => {
  const f = setup(t);
  const result = await f.invoke('ecouter', { query: 'France Inter' });
  assert.deepEqual(f.contract(result.outcome), []);
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  assert.deepEqual((result.outcome as { playback?: unknown }).playback, {
    url: 'https://flux.exemple.fr/franceinter-midfi.mp3',
    title: 'France Inter',
    subtitle: 'En direct',
    imageUrl: 'https://radio.jokobee.com/logos/france-inter.png',
    kind: 'live',
  });
  const call = f.calls[0]!;
  const url = new URL(call.url);
  assert.equal(url.searchParams.get('nom'), 'France Inter');
  assert.equal(url.searchParams.get('pays'), 'FR');
  assert.equal(url.searchParams.get('genre'), null);
  assert.equal((call.headers as Record<string, string>).Authorization, 'Bearer cle-essai');
  // Aucune publicité sur le miroir : le bandeau dit seulement « En direct ».
  const bandeau = (result.outcome as { playback?: { title: string; subtitle: string } }).playback;
  assert.doesNotMatch(`${bandeau?.title} ${bandeau?.subtitle}`, /jokobee/iu);
});

test('« trouve un poste de jazz » : un poste au hasard du genre', async (t) => {
  const f = setup(t, { status: 200, body: jazz }, { timeZone: 'America/Toronto' });
  const result = await f.invoke('ecouter', { query: 'jazz', genre: true });
  assert.equal(result.tool.status, 'succeeded', result.tool.error?.message);
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.searchParams.get('genre'), 'jazz');
  assert.equal(url.searchParams.get('nom'), null);
  assert.equal(url.searchParams.get('pays'), 'CA');
  assert.equal((result.outcome as { playback?: { imageUrl: unknown } }).playback?.imageUrl, null);
});

test('poste introuvable, clé refusée ou utilisée ailleurs, limite : des messages clairs', async (t) => {
  const cas = [
    [
      { status: 404, body: { erreur: 'introuvable' } },
      'not_found',
      /Aucun poste « Radio Inconnue »/u,
    ],
    [{ status: 401, body: { erreur: 'cle' } }, 'auth', /radio\.jokobee\.com\/cornelius/u],
    [{ status: 401, body: { erreur: 'ailleurs' } }, 'auth', /autre Cornelius/u],
    [{ status: 429, body: { erreur: 'limite' } }, 'quota', /Limite/u],
    [{ status: 503, body: { erreur: 'indisponible' } }, 'unavailable', /indisponible/u],
    [{ status: 503, body: { erreur: 'flux' } }, 'unavailable', /ne répond pas pour l’instant/u],
    [
      { status: 422, body: { erreur: 'format' } },
      'not_found',
      /format que Cornelius ne sait pas encore lire/u,
    ],
  ] as const;
  for (const [reply, code, message] of cas) {
    const f = setup(t, reply);
    const result = await f.invoke('ecouter', { query: 'Radio Inconnue' });
    assert.equal(result.tool.status, 'failed', code);
    assert.equal(result.tool.error?.code, code);
    assert.match(result.tool.error?.message ?? '', message);
  }
});

test('flux non https ou réponse incomplète : refusés, rien ne joue', async (t) => {
  for (const body of [
    { poste: { ...franceInter.poste, flux: 'http://flux.exemple.fr/a.mp3' } },
    { poste: { nom: '', flux: 'https://flux.exemple.fr/a.mp3' } },
    { autre: true },
  ]) {
    const f = setup(t, { status: 200, body });
    const result = await f.invoke('ecouter', { query: 'France Inter' });
    assert.equal(result.tool.status, 'failed');
    assert.equal(result.tool.error?.code, 'malformed');
  }
});

test('sans clé : la page pour l’obtenir, sans appel à l’annuaire', async (t) => {
  const f = setup(t, undefined, { cle: null });
  const result = await f.invoke('ecouter', { query: 'France Inter' });
  assert.equal(result.tool.error?.code, 'config_invalid');
  assert.match(result.tool.error?.message ?? '', /radio\.jokobee\.com\/cornelius/u);
  assert.equal(f.calls.length, 0);
});

test('Tester (lecture ordinaire) : aucune demande à l’annuaire, la limite est par jour', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.ok(result.ok);
  assert.equal(f.calls.length, 0);
  assert.equal(result.card?.subtitle, 'Prête : demandez un poste par son nom');
});

test('pays cherché d’abord : réglage, sinon fuseau du foyer', () => {
  assert.equal(paysDuFoyer({ pays: 'BE' }, 'Europe/Paris'), 'BE');
  assert.equal(paysDuFoyer({}, 'America/Toronto'), 'CA');
  assert.equal(paysDuFoyer({ pays: '' }, 'Europe/Paris'), 'FR');
  assert.equal(paysDuFoyer({}, 'Canada/Eastern'), 'CA');
  assert.equal(paysDuFoyer({}, 'Europe/Zurich'), 'CH');
  assert.equal(paysDuFoyer({}, 'Asia/Tokyo'), 'JP');
  assert.equal(paysDuFoyer({}, 'America/Montreal'), 'CA');
  assert.equal(paysDuFoyer({}, 'Africa/Abidjan'), 'CI');
  assert.equal(paysDuFoyer({}, 'Etc/UTC'), null);
});

test('réglages : « selon le fuseau » par défaut et chaque pays de la liste sont valides', (t) => {
  const f = setup(t);
  for (const pays of ['', 'CA', 'FR', 'BE', 'US', 'JP', 'SN'])
    assert.equal(f.runtime.validateConfig(addon.id, { pays }).ok, true, pays);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { pays: 'XX' }).ok, false);
});

test('le nom seul part à l’annuaire, même si la phrase entière arrive', () => {
  assert.equal(nomDemande('joue CHOI Radio X'), 'CHOI Radio X');
  assert.equal(nomDemande('Mets-moi la radio CKOI'), 'CKOI');
  assert.equal(nomDemande('fais jouer le poste de France Inter'), 'France Inter');
  assert.equal(nomDemande('écoute la station 98,5'), '98,5');
  assert.equal(nomDemande('  Radio  X '), 'Radio X');
  assert.equal(nomDemande('Rythme FM'), 'Rythme FM');
  assert.equal(nomDemande('joue'), 'joue');
});
