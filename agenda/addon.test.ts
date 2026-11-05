import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';

/** Agenda fictif au format d'un export Google ; mardi 20 octobre 2026, 10 h à Paris. */
const ics = readFileSync(new URL('./fixtures/famille.ics', import.meta.url), 'utf8');
const secretUrl =
  'https://calendar.google.com/calendar/ical/famille%40example.com/private-0123456789abcdef/basic.ics';

type Stored = { events: { title: string; description: string | null }[] };
const full = { days: 7, descriptions: true, descriptionLength: 300 };

const setup = (
  t: { after(fn: () => void): void },
  options: { config?: Record<string, unknown>; at?: string; body?: string; status?: number } = {},
) =>
  createTestModule(t, addon, {
    config: { url: secretUrl, days: 7, ...options.config },
    at: options.at,
    routes: { 'calendar.google.com': { status: options.status ?? 200, body: options.body ?? ics } },
  });

test('définition, réglages et contrat', async (t) => {
  const f = setup(t);
  for (const url of [secretUrl, 'webcal://p01-caldav.icloud.com/published/2/abc'])
    assert.equal(f.runtime.validateConfig(addon.id, { url, ...full }).ok, true, url);
  for (const config of [
    { url: 'ftp://exemple.fr/a.ics', ...full },
    { url: 'https://exemple.fr/a b.ics', ...full },
    { url: secretUrl, ...full, days: 30 },
    { url: secretUrl, ...full, descriptionLength: 10 },
    { url: secretUrl, ...full, descriptionLength: 5000 },
    { url: secretUrl, days: 7 },
  ])
    assert.equal(f.runtime.validateConfig(addon.id, config).ok, false, JSON.stringify(config));
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(f.calls[0]?.url, secretUrl);
});

test('le lien privé n’apparaît ni dans le relevé, ni sur la carte, ni à l’oral', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const stored = JSON.stringify(f.instances.getSnapshot(f.instance));
  const shown = JSON.stringify([result.card, result.presentation, f.runtime.toolResult(result)]);
  for (const text of [stored, shown]) {
    assert.equal(text.includes('private-0123456789abcdef'), false);
    assert.equal(text.includes('calendar.google.com'), false);
  }
});

test('la semaine : rendez-vous en cours d’abord, puis par jour, à l’oral comme sur la carte', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Agenda · Famille');
  assert.equal(result.card.primaryValue, "Réunion d'école");
  assert.equal(result.card.subtitle, 'Aujourd’hui, en cours, jusqu’à 11 h');
  assert.deepEqual(result.card.items.slice(0, 3), [
    { label: 'Aujourd’hui 16 h', value: 'Dentiste de Léa · Cabinet du Dr Martin, Pacé' },
    { label: 'Aujourd’hui 18 h', value: 'Séance photo' },
    { label: 'Demain 18 h 30', value: 'Foot de Tom' },
  ]);
  assert.equal(
    result.presentation.summary,
    "Aujourd’hui : Réunion d'école en cours, jusqu’à 11 h, Dentiste de Léa à 16 h et Séance photo à 18 h. " +
      'Demain : Foot de Tom à 18 h 30. ' +
      "Jeudi 22 octobre : Anniversaire de Mamie toute la journée et Visio avec les cousins d'Amérique " +
      "pour préparer les fêtes de fin d'année et la grande réunion de famille à 14 h. " +
      'Et 4 autres dans les 7 prochains jours.',
  );
});

test('descriptions : dans les données pour la voix, ni dites d’office ni sur la carte', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const data = f.runtime.toolResult(result).result?.data as Stored;
  const of = (title: string) => data.events.find((e) => e.title === title)?.description;
  assert.equal(
    of('Dentiste de Léa'),
    'Apporter la carte vitale et le carnet de santé. Code de la porte : 4B',
  );
  assert.equal(of("Réunion d'école"), null);
  const shown = JSON.stringify([result.card, result.presentation.summary, f.ambient()]);
  assert.equal(shown.includes('carte vitale'), false);
});

test('réglages de la source : longueur des descriptions, ou pas de description', async (t) => {
  const short = setup(t, { config: { descriptionLength: 50 } });
  await short.read();
  const dentist = (short.instances.getSnapshot(short.instance)?.data as Stored).events.find(
    (e) => e.title === 'Dentiste de Léa',
  )?.description;
  assert.ok(dentist && dentist.length <= 50 && dentist.endsWith('…'), dentist ?? 'absente');
  assert.match(dentist, /^Apporter la carte vitale/u);

  const off = setup(t, { config: { descriptions: false } });
  await off.read();
  const events = (off.instances.getSnapshot(off.instance)?.data as Stored).events;
  assert.equal(events.length > 0, true);
  assert.equal(
    events.every((e) => e.description === null),
    true,
  );
});

test('les réglages de la version 1 sont repris : descriptions lues, 300 caractères', async (t) => {
  assert.deepEqual(addon.configMigrate!(1, { url: secretUrl, days: 14 }), {
    url: secretUrl,
    days: 14,
    descriptions: true,
    descriptionLength: 300,
  });
  assert.throws(() => addon.configMigrate!(9, {}), /inconnus/u);
  // Une source enregistrée en version 1 se lit sans être réglée à nouveau.
  const f = setup(t);
  f.instances.updateInstance(f.instance.id, {
    config: { url: secretUrl, days: 7 },
    configVersion: 1,
  });
  const result = await f.runtime.read(addon.id, null, 'test', new AbortController().signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const data = f.runtime.toolResult(result).result?.data as Stored;
  assert.equal(
    data.events.find((e) => e.title === 'Cours de piano (décalé)')?.description,
    'Salle 2, au lieu de la salle 1.',
  );
});

test('arguments : « samedi » et « la semaine prochaine », à la demande, sans toucher au relevé', async (t) => {
  const f = setup(t);
  const saturday = await f.invoke('read', { debut: 4, jours: null });
  assert.equal(saturday.tool.status, 'succeeded');
  assert.equal(saturday.outcome.ok && saturday.outcome.card.primaryValue, 'Stage de voile');
  assert.match(
    saturday.tool.summary,
    /^Samedi 24 octobre : Stage de voile jusqu’au lundi 26 octobre et Cours de piano \(décalé\) à 11 h\./u,
  );
  // « La semaine prochaine » : du mardi 27 octobre au lundi 2 novembre.
  const next = await f.invoke('read', { debut: 7, jours: 7 });
  assert.match(next.tool.summary, /Réunion de copro/u);
  assert.doesNotMatch(next.tool.summary, /Dentiste/u);
  // Vendredi 18 décembre : aucun rendez-vous, et la phrase le dit pour ce jour-là.
  const empty = await f.invoke('read', { debut: 59, jours: 1 });
  assert.equal(empty.tool.summary, 'Rien de prévu vendredi 18 décembre.');
  const outside = await f.invoke('read', { debut: 61 });
  assert.equal(outside.tool.error?.code, 'invalid_params');
  // Aucune de ces lectures n'a remplacé le relevé ordinaire.
  assert.equal(f.instances.getSnapshot(f.instance), null);
});

test('plusieurs jours, rendez-vous fini, et l’affichage se recalcule à l’heure dite', async (t) => {
  const f = setup(t, { at: '2026-10-20T08:50:00Z' }); // 10 h 50 : réunion en cours
  const during = await f.read();
  assert.equal(during.ok && during.card.primaryValue, "Réunion d'école");
  // La carte permanente demande à être refaite à 11 h, fin de la réunion.
  assert.equal(f.ambient().content?.refreshAt, '2026-10-20T09:00:00.000Z');
  f.at('2026-10-20T09:04:00Z'); // 11 h 04 : finie, relevé encore frais
  const after = await f.read();
  assert.equal(after.ok && after.card.primaryValue, 'Dentiste de Léa');
  assert.equal(f.calls.length, 1);

  const g = setup(t, { at: '2026-10-24T06:00:00Z' }); // samedi, 8 h
  const saturday = await g.read();
  assert.equal(saturday.ok && saturday.card.subtitle, 'Aujourd’hui, jusqu’au lundi 26 octobre');
});

test('« webcal:// » lu en https ; une semaine vide est une réponse ; un agenda coupé le dit', async (t) => {
  const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
  const f = createTestModule(t, addon, {
    config: { url: 'webcal://p01-caldav.icloud.com/published/2/abc', days: 3 },
    routes: { 'icloud.com': empty },
  });
  const result = await f.read();
  assert.equal(f.calls[0]?.url, 'https://p01-caldav.icloud.com/published/2/abc');
  assert.equal(result.ok && result.card.primaryValue, 'Rien de prévu');
  assert.equal(
    result.ok && result.presentation.summary,
    'Rien de prévu dans les 3 prochains jours.',
  );
  assert.equal(f.ambient().content?.value, 'Rien de prévu');

  // Réponse coupée à 8 Mo par le client du cœur : la carte et l'oral le disent.
  const cut = setup(t);
  cut.route({ 'calendar.google.com': { status: 200, body: ics, truncated: true } });
  const truncated = await cut.read();
  assert.equal(
    truncated.ok && truncated.card.description,
    'Agenda incomplet : le fichier dépasse 8 Mo, des rendez-vous peuvent manquer.',
  );
  assert.match(truncated.ok ? truncated.presentation.summary : '', /^Agenda incomplet\./u);
});

test('les heures suivent le fuseau du foyer', async (t) => {
  const f = createTestModule(t, addon, {
    config: { url: secretUrl, days: 1 },
    timeZone: 'Indian/Reunion',
    at: '2026-10-20T08:00:00Z', // 12 h à La Réunion
    routes: { 'calendar.google.com': ics },
  });
  const result = await f.read();
  // Le dentiste de 16 h à Paris (14 h UTC) a lieu à 18 h à La Réunion.
  assert.match(result.ok ? result.presentation.summary : '', /Dentiste de Léa à 18 h/u);
});

test('lien réinitialisé, introuvable, page web : des messages sans le lien', async (t) => {
  for (const [status, body, code] of [
    [403, '', 'forbidden'],
    [404, '', 'not_found'],
    [200, '<!DOCTYPE html><html>Connexion</html>', 'malformed'],
  ] as const) {
    const result = await setup(t, { status, body }).read();
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.code, code);
    assert.equal(result.error.message.includes('google'), false);
  }
});

test('panne après expiration : dernier agenda connu, annoncé comme tel', async (t) => {
  const f = setup(t);
  assert.equal((await f.read()).ok, true);
  f.advance(16 * 60 * 1000);
  f.route({ 'calendar.google.com': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok && result.stale, true);
  assert.match(
    result.ok ? result.presentation.summary : '',
    /^D’après le dernier agenda connu, à vérifier\./u,
  );
});
