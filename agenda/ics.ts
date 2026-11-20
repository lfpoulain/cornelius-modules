/**
 * Lecture d'un agenda iCalendar (RFC 5545), sans dépendance : les événements, leurs
 * répétitions et leurs exceptions, ramenés à des occurrences datées dans une fenêtre.
 *
 * Volontairement limité à ce qu'exportent Google Agenda, iCloud et Outlook pour un agenda
 * familial : répétitions DAILY, WEEKLY, MONTHLY et YEARLY avec INTERVAL, COUNT, UNTIL,
 * BYDAY (rangs compris) et BYMONTHDAY ; EXDATE ; RECURRENCE-ID ; STATUS:CANCELLED.
 */

import { plainText } from '../_lib/flux.js';
import { dayIn, dayMs, zonedTime, type Wall } from '../_lib/temps.js';

export interface Occurrence {
  uid: string;
  title: string;
  location: string | null;
  /** Description en texte simple (HTML retiré, bloc de visio Google retiré), entière. */
  description: string | null;
  /** Début et fin en millisecondes UTC ; pour une journée entière, minuit dans le fuseau du foyer. */
  start: number;
  end: number;
  allDay: boolean;
}

export interface Calendar {
  name: string | null;
  occurrences: Occurrence[];
}

export class CalendarError extends Error {}

type Property = { name: string; params: Record<string, string>; value: string };
type Moment = { wall: Wall; zone: string | null; allDay: boolean };

/**
 * Fuseau du foyer, pour les journées entières et les heures sans fuseau. Fixé à l'entrée de
 * readCalendar, qui est synchrone : aucune autre lecture ne peut s'intercaler.
 */
let homeZone = 'Europe/Paris';

/** Fuseaux Windows qu'écrit Outlook, ramenés à leur nom IANA. */
const windowsZones: Record<string, string> = {
  'romance standard time': 'Europe/Paris',
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  utc: 'UTC',
  'coordinated universal time': 'UTC',
  'eastern standard time': 'America/New_York',
  'pacific standard time': 'America/Los_Angeles',
  'reunion standard time': 'Indian/Reunion',
  'se asia standard time': 'Asia/Bangkok',
};

const zoneCache = new Map<string, string>();
/** Nom IANA utilisable, ou le fuseau du foyer si le nom est inconnu. */
function zoneOf(tzid: string | null | undefined): string {
  if (!tzid) return homeZone;
  const cleaned = tzid.replace(/^\/+/u, '').replace(/^"|"$/gu, '').trim();
  const cached = zoneCache.get(cleaned);
  if (cached) return cached === '?' ? homeZone : cached;
  let zone = windowsZones[cleaned.toLowerCase()] ?? cleaned;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zoneCache.set(cleaned, '?');
    return homeZone;
  }
  zoneCache.set(cleaned, zone);
  return zone;
}

// --- Lecture du texte ------------------------------------------------------------------------

function unescapeText(value: string): string {
  return value
    .replace(/\\([\\;,nN])/gu, (_, char: string) => (char === 'n' || char === 'N' ? ' ' : char))
    .trim();
}

/**
 * Bloc qu'ajoute Google Agenda pour une visio (« Rejoindre avec Google Meet », numéros,
 * code PIN), entre deux lignes « -::~:~::~:…::- » ; jusqu'à la fin si la seconde manque.
 */
const conferenceBlock = /-::~[:~]*::-[\s\S]*?(?:-::~[:~]*::-|$)/gu;

/**
 * Description lisible : déséchappée, sans le bloc de visio, puis sans HTML (Google Agenda
 * garde la mise en forme saisie : gras, listes, liens) ni entités, espaces resserrés.
 */
function descriptionOf(value: string | undefined): string | null {
  if (!value) return null;
  return plainText(unescapeText(value).replace(conferenceBlock, ' ')) || null;
}

/** Lignes dépliées (RFC 5545 § 3.1) puis propriétés « NOM;PARAM=…:valeur ». */
function properties(text: string): Property[] {
  const lines = text
    .replace(/\r\n|\r/gu, '\n')
    .replace(/\n[ \t]/gu, '')
    .split('\n');
  const result: Property[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // Les deux-points d'un paramètre entre guillemets ne séparent pas la valeur.
    let colon = -1;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') quoted = !quoted;
      else if (char === ':' && !quoted) {
        colon = index;
        break;
      }
    }
    if (colon < 0) continue;
    const [rawName, ...rawParams] = line.slice(0, colon).split(';');
    const params: Record<string, string> = {};
    for (const param of rawParams) {
      const equals = param.indexOf('=');
      if (equals > 0)
        params[param.slice(0, equals).toUpperCase()] = param
          .slice(equals + 1)
          .replace(/^"|"$/gu, '');
    }
    result.push({ name: (rawName ?? '').toUpperCase(), params, value: line.slice(colon + 1) });
  }
  return result;
}

function moment(property: Property | undefined): Moment | null {
  if (!property) return null;
  const value = property.value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/u.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const allDay = property.params.VALUE === 'DATE' || h === undefined;
  return {
    wall: {
      year: Number(y),
      month: Number(mo),
      day: Number(d),
      hour: allDay ? 0 : Number(h),
      minute: allDay ? 0 : Number(mi),
      second: allDay ? 0 : Number(s ?? 0),
    },
    zone: allDay ? null : z ? 'UTC' : zoneOf(property.params.TZID),
    allDay,
  };
}

/** Instant d'un moment ; une journée entière commence à minuit à Paris. */
function instant(m: Moment): number {
  return zonedTime(m.wall, m.allDay ? homeZone : (m.zone ?? homeZone));
}

function duration(value: string | undefined): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(
    value?.trim() ?? '',
  );
  if (!match) return null;
  const [, sign, w, d, h, m, s] = match;
  const ms =
    (Number(w ?? 0) * 7 + Number(d ?? 0)) * dayMs +
    (Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

// --- Répétitions -----------------------------------------------------------------------------

type Rule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: number | null;
  byDay: { weekday: number; ordinal: number | null }[];
  byMonthDay: number[];
  byMonth: number[];
};

const weekdayCodes: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

function rule(value: string | undefined): Rule | null {
  if (!value) return null;
  const parts = Object.fromEntries(
    value.split(';').map((part) => {
      const [key, val] = part.split('=');
      return [(key ?? '').toUpperCase(), val ?? ''];
    }),
  );
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const until = parts.UNTIL ? moment({ name: 'UNTIL', params: {}, value: parts.UNTIL }) : null;
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    count: parts.COUNT ? Math.max(1, Number(parts.COUNT) || 1) : null,
    // Une limite sans heure vaut pour toute la journée.
    until: until ? instant(until) + (until.allDay ? dayMs - 1 : 0) : null,
    byDay: (parts.BYDAY ?? '')
      .split(',')
      .map((code) => /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/u.exec(code.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ weekday: weekdayCodes[m[2]!]!, ordinal: m[1] ? Number(m[1]) : null })),
    byMonthDay: (parts.BYMONTHDAY ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n !== 0),
    byMonth: (parts.BYMONTH ?? '')
      .split(',')
      .map(Number)
      .filter((n) => n >= 1 && n <= 12),
  };
}

const civil = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / dayMs;
const weekdayOf = (day: number) => ((new Date(day * dayMs).getUTCDay() + 6) % 7) + 1;
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Jours (comptés depuis 1970) d'un mois qui répondent à BYDAY ou BYMONTHDAY. */
function monthDays(year: number, month: number, r: Rule, startDay: number): number[] {
  const length = daysInMonth(year, month);
  if (r.byDay.length) {
    const days: number[] = [];
    for (const { weekday, ordinal } of r.byDay) {
      const matching: number[] = [];
      for (let date = 1; date <= length; date += 1) {
        const day = civil(year, month, date);
        if (weekdayOf(day) === weekday) matching.push(day);
      }
      if (ordinal === null) days.push(...matching);
      else {
        const pick = ordinal > 0 ? matching[ordinal - 1] : matching[matching.length + ordinal];
        if (pick !== undefined) days.push(pick);
      }
    }
    return days;
  }
  const dates = r.byMonthDay.length ? r.byMonthDay : [new Date(startDay * dayMs).getUTCDate()];
  return dates
    .map((date) => (date > 0 ? date : length + date + 1))
    .filter((date) => date >= 1 && date <= length)
    .map((date) => civil(year, month, date));
}

/**
 * Jours de chaque occurrence, dans l'ordre, à partir du jour de début. `count` compte depuis
 * la première occurrence, même avant la fenêtre. Arrêt au-delà de `lastDay`.
 */
function recurringDays(
  r: Rule,
  startDay: number,
  lastDay: number,
  stamp: (day: number) => number,
): number[] {
  const days: number[] = [];
  let emitted = 0;
  const accept = (day: number): boolean => {
    if (day < startDay) return true;
    if (r.until !== null && stamp(day) > r.until) return false;
    if (r.count !== null && emitted >= r.count) return false;
    emitted += 1;
    days.push(day);
    return true;
  };
  const start = new Date(startDay * dayMs);
  for (let step = 0, guard = 0; guard < 20_000; step += 1, guard += 1) {
    let candidates: number[];
    if (r.freq === 'DAILY') candidates = [startDay + step * r.interval];
    else if (r.freq === 'WEEKLY') {
      const monday = startDay - (weekdayOf(startDay) - 1) + step * 7 * r.interval;
      const weekdays = r.byDay.length ? r.byDay.map((d) => d.weekday) : [weekdayOf(startDay)];
      candidates = [...new Set(weekdays)]
        .sort((a, b) => a - b)
        .map((weekday) => monday + weekday - 1);
    } else if (r.freq === 'MONTHLY') {
      const index = start.getUTCMonth() + step * r.interval;
      candidates = monthDays(
        start.getUTCFullYear() + Math.floor(index / 12),
        (index % 12) + 1,
        r,
        startDay,
      );
    } else {
      const year = start.getUTCFullYear() + step * r.interval;
      const months = r.byMonth.length ? r.byMonth : [start.getUTCMonth() + 1];
      candidates = months.flatMap((month) =>
        r.byDay.length || r.byMonthDay.length
          ? monthDays(year, month, r, startDay)
          : // Un 29 février n'existe que les années bissextiles.
            start.getUTCDate() <= daysInMonth(year, month)
            ? [civil(year, month, start.getUTCDate())]
            : [],
      );
    }
    candidates.sort((a, b) => a - b);
    if (candidates.length && candidates[0]! > lastDay) break;
    for (const day of candidates) {
      if (day > lastDay) return days;
      if (!accept(day)) return days;
    }
  }
  return days;
}

// --- Agenda ----------------------------------------------------------------------------------

type RawEvent = {
  uid: string;
  title: string;
  location: string | null;
  description: string | null;
  start: Moment;
  end: Moment | null;
  duration: number | null;
  rule: Rule | null;
  exdates: Set<number>;
  recurrenceId: number | null;
  cancelled: boolean;
};

function events(text: string): { name: string | null; events: RawEvent[] } {
  const props = properties(text);
  if (!props.some((p) => p.name === 'BEGIN' && p.value.trim().toUpperCase() === 'VCALENDAR'))
    throw new CalendarError('Ce document n’est pas un agenda iCalendar.');
  const name = props.find((p) => p.name === 'X-WR-CALNAME')?.value;
  const result: RawEvent[] = [];
  let current: Property[] | null = null;
  let depth = 0;
  for (const prop of props) {
    const value = prop.value.trim().toUpperCase();
    if (prop.name === 'BEGIN' && value === 'VEVENT') {
      current = [];
      depth = 0;
      continue;
    }
    if (!current) continue;
    // Les alarmes (VALARM) d'un événement ont leurs propres propriétés : on les saute.
    if (prop.name === 'BEGIN') depth += 1;
    else if (prop.name === 'END' && value !== 'VEVENT') depth -= 1;
    else if (prop.name === 'END' && value === 'VEVENT') {
      const get = (key: string) => current!.find((p) => p.name === key);
      const start = moment(get('DTSTART'));
      if (start) {
        const exdates = new Set<number>();
        for (const ex of current.filter((p) => p.name === 'EXDATE'))
          for (const item of ex.value.split(',')) {
            const m = moment({ ...ex, value: item });
            if (m) exdates.add(instant(m));
          }
        const recurrence = moment(get('RECURRENCE-ID'));
        result.push({
          uid: get('UID')?.value.trim() || `sans-uid-${result.length}`,
          title: unescapeText(get('SUMMARY')?.value ?? '') || 'Sans titre',
          location: unescapeText(get('LOCATION')?.value ?? '') || null,
          description: descriptionOf(get('DESCRIPTION')?.value),
          start,
          end: moment(get('DTEND')),
          duration: duration(get('DURATION')?.value),
          rule: rule(get('RRULE')?.value),
          exdates,
          recurrenceId: recurrence ? instant(recurrence) : null,
          cancelled: get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED',
        });
      }
      current = null;
    } else if (depth === 0) current.push(prop);
  }
  return { name: name ? unescapeText(name) : null, events: result };
}

function lengthOf(event: RawEvent): number {
  if (event.end) {
    const ms = instant(event.end) - instant(event.start);
    if (ms > 0) return ms;
  }
  if (event.duration !== null && event.duration > 0) return event.duration;
  return event.start.allDay ? dayMs : 0;
}

/**
 * Occurrences qui touchent la fenêtre [from, to[, par ordre de début. Un agenda coupé par
 * la limite de taille garde ses événements complets.
 */
export function readCalendar(
  text: string,
  from: number,
  to: number,
  zone = 'Europe/Paris',
): Calendar {
  homeZone = zone;
  const { name, events: all } = events(text);
  const overrides = new Map<string, RawEvent>();
  for (const event of all)
    if (event.recurrenceId !== null) overrides.set(`${event.uid}|${event.recurrenceId}`, event);
  const occurrences: Occurrence[] = [];
  const push = (event: RawEvent, start: number) => {
    const end = start + lengthOf(event);
    if (event.cancelled || end <= from || start >= to) return;
    occurrences.push({
      uid: event.uid,
      title: event.title,
      location: event.location,
      description: event.description,
      start,
      end,
      allDay: event.start.allDay,
    });
  };
  for (const event of all) {
    if (event.recurrenceId !== null) continue;
    if (!event.rule) {
      push(event, instant(event.start));
      continue;
    }
    const zone = event.start.allDay ? homeZone : (event.start.zone ?? homeZone);
    const { hour, minute, second } = event.start.wall;
    const startDay = civil(event.start.wall.year, event.start.wall.month, event.start.wall.day);
    // Chaque occurrence garde son heure murale : 10 h reste 10 h après le changement d'heure.
    const stamp = (day: number) => {
      const date = new Date(day * dayMs);
      return zonedTime(
        {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour,
          minute,
          second,
        },
        zone,
      );
    };
    const lastDay = dayIn(to, homeZone) + 1;
    // Les occurrences finies bien avant la fenêtre ne sont pas datées à l'heure près.
    const firstDay = dayIn(from, homeZone) - Math.ceil(lengthOf(event) / dayMs) - 1;
    for (const day of recurringDays(event.rule, startDay, lastDay, stamp)) {
      if (day < firstDay) continue;
      const start = stamp(day);
      if (event.exdates.has(start)) continue;
      const override = overrides.get(`${event.uid}|${start}`);
      if (override) {
        overrides.delete(`${event.uid}|${start}`);
        push(override, instant(override.start));
      } else push(event, start);
    }
  }
  // Une occurrence modifiée dont la répétition d'origine manque reste un événement.
  for (const override of overrides.values()) push(override, instant(override.start));
  occurrences.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
  return { name, occurrences };
}
