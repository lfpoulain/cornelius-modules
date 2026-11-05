import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { zonedTime } from '../_lib/temps.js';
import { CalendarError, readCalendar } from './ics.js';

/** Agenda fictif, au format d'un export Google Agenda, avec les cas difficiles. */
const ics = readFileSync(new URL('./fixtures/famille.ics', import.meta.url), 'utf8');
const iso = (ms: number) => new Date(ms).toISOString();
// Mardi 20 octobre 2026, 10 h à Paris ; passage à l'heure d'hiver le dimanche 25.
const now = Date.parse('2026-10-20T08:00:00Z');
const in14 = Date.parse('2026-11-02T23:00:00Z');

function titles(from = now, to = in14) {
  return readCalendar(ics, from, to).occurrences.map(
    (o) => `${iso(o.start).slice(0, 16)} ${o.title}`,
  );
}

test('heure murale vers UTC, de part et d’autre du changement d’heure', () => {
  const at = (day: number, hour: number) =>
    iso(zonedTime({ year: 2026, month: 10, day, hour, minute: 0, second: 0 }, 'Europe/Paris'));
  assert.equal(at(24, 9), '2026-10-24T07:00:00.000Z');
  assert.equal(at(26, 9), '2026-10-26T08:00:00.000Z');
  // 2 h existe deux fois le 25 : c'est la première, encore à l'heure d'été.
  assert.equal(at(25, 2), '2026-10-25T00:00:00.000Z');
});

test('les occurrences des quatorze prochains jours, dans l’ordre', () => {
  assert.deepEqual(titles(), [
    "2026-10-20T07:30 Réunion d'école",
    '2026-10-20T14:00 Dentiste de Léa',
    '2026-10-20T16:00 Séance photo',
    '2026-10-21T16:30 Foot de Tom',
    '2026-10-21T22:00 Anniversaire de Mamie',
    "2026-10-22T12:00 Visio avec les cousins d'Amérique pour préparer les fêtes de fin d'année et la grande réunion de famille",
    '2026-10-23T07:00 Rendez-vous banque',
    '2026-10-23T22:00 Stage de voile',
    '2026-10-24T09:00 Cours de piano (décalé)',
    '2026-10-26T08:00 Kiné',
    '2026-10-30T19:00 Réunion de copro',
    '2026-10-31T09:00 Cours de piano',
    '2026-11-02T08:00 Kiné',
  ]);
});

test('répétitions : COUNT, EXDATE, UNTIL, RECURRENCE-ID, annulation, dernier vendredi', () => {
  const all = titles();
  // COUNT=2 depuis le 19 : la séance photo du 21 n'existe pas.
  assert.equal(all.filter((t) => t.includes('Séance photo')).length, 1);
  // EXDATE du 28 : pas de foot ce mercredi-là.
  assert.equal(
    all.some((t) => t.startsWith('2026-10-28') && t.includes('Foot')),
    false,
  );
  // L'occurrence du 24 est remplacée par sa version décalée, pas doublée.
  assert.equal(all.filter((t) => t.startsWith('2026-10-24') && t.includes('piano')).length, 1);
  assert.equal(
    all.some((t) => t.includes('annulée')),
    false,
  );
  // Le kiné reste à 9 h, heure de Paris, après le changement d'heure.
  assert.ok(all.includes('2026-10-26T08:00 Kiné'));
  assert.ok(all.includes('2026-10-30T19:00 Réunion de copro'));
});

test('journée entière, plusieurs jours, lieu échappé, fuseau Outlook, nom de l’agenda', () => {
  const calendar = readCalendar(ics, now, in14);
  assert.equal(calendar.name, 'Famille');
  const voile = calendar.occurrences.find((o) => o.title === 'Stage de voile')!;
  assert.equal(voile.allDay, true);
  assert.equal((voile.end - voile.start) / 3_600_000, 73); // trois jours, et l'heure d'hiver
  const dentiste = calendar.occurrences.find((o) => o.title === 'Dentiste de Léa')!;
  assert.equal(dentiste.location, 'Cabinet du Dr Martin, Pacé');
  const banque = calendar.occurrences.find((o) => o.title === 'Rendez-vous banque')!;
  assert.equal(iso(banque.start), '2026-10-23T07:00:00.000Z');
});

test('descriptions : HTML et visio Google retirés, alarme ignorée, occurrence décalée', () => {
  const calendar = readCalendar(ics, now, in14);
  const of = (title: string) =>
    calendar.occurrences.find((o) => o.title.startsWith(title))?.description;
  assert.equal(
    of('Dentiste de Léa'),
    'Apporter la carte vitale et le carnet de santé. Code de la porte : 4B',
  );
  // Le bloc « Rejoindre avec Google Meet » disparaît, liens et numéros compris.
  assert.equal(of('Visio avec les cousins'), 'Ordre du jour : le menu de Noël.');
  assert.equal(of("Réunion d'école"), null);
  // L'occurrence décalée garde sa propre description, les autres celle de la répétition.
  assert.equal(of('Cours de piano (décalé)'), 'Salle 2, au lieu de la salle 1.');
  assert.equal(
    calendar.occurrences.find((o) => o.title === 'Cours de piano')?.description,
    'Apporter la partition.',
  );
  // La description d'une alarme (VALARM) n'est pas celle du rendez-vous.
  assert.equal(JSON.stringify(calendar).includes('event reminder'), false);
});

test('un événement en cours compte, un événement fini non', () => {
  const later = Date.parse('2026-10-20T09:30:00Z'); // 11 h 30 : la réunion d'école est finie
  assert.equal(titles(later)[0], '2026-10-20T14:00 Dentiste de Léa');
  assert.equal(titles(now)[0], "2026-10-20T07:30 Réunion d'école");
});

test('un document qui n’est pas un agenda est refusé ; un agenda coupé reste lisible', () => {
  assert.throws(() => readCalendar('<!DOCTYPE html><html></html>', now, in14), CalendarError);
  const cut = ics.slice(0, ics.indexOf('UID:annulee@fictif'));
  assert.equal(readCalendar(cut, now, in14).occurrences.at(-1)?.title, 'Foot de Tom');
});
