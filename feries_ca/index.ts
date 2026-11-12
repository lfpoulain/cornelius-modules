/**
 * Jours fériés au Canada, d'après canada-holidays.ca (gratuit, sans jeton) : ceux de la province
 * ou du territoire choisi, ou ceux des employeurs fédéraux. Le prochain jour férié, les suivants,
 * et la liste de l'année en cours et de la suivante pour répondre à « c'est quand l'Action de
 * grâce ? ». Les jours sont comptés dans le fuseau du foyer.
 */
import {
  AddonCollectError,
  type AddonCollectContext,
  type AddonDefinition,
  type AddonPresentation,
  type ModuleSnapshot,
} from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { dateIn, dayMs, iso, nextMidnight } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type Province =
  | 'Alberta'
  | 'Colombie-Britannique'
  | 'Île-du-Prince-Édouard'
  | 'Manitoba'
  | 'Nouveau-Brunswick'
  | 'Nouvelle-Écosse'
  | 'Nunavut'
  | 'Ontario'
  | 'Québec'
  | 'Saskatchewan'
  | 'Terre-Neuve-et-Labrador'
  | 'Territoires du Nord-Ouest'
  | 'Yukon';

type FeriesConfig = { province: Province; employeurFederal?: boolean };
type Ferie = { date: string; observe: string; nom: string; federal: boolean };
type FeriesData = {
  province: Province;
  /** L'employeur suit le calendrier fédéral : les jours fériés fédéraux, pas ceux de la province. */
  federal: boolean;
  feries: Ferie[];
  source: string | null;
};

/** Code de l'API et préposition qui précède le nom (« au Québec », « en Ontario »). */
const provinces: Record<Province, { code: string; dans: string }> = {
  Alberta: { code: 'AB', dans: 'en Alberta' },
  'Colombie-Britannique': { code: 'BC', dans: 'en Colombie-Britannique' },
  'Île-du-Prince-Édouard': { code: 'PE', dans: 'à l’Île-du-Prince-Édouard' },
  Manitoba: { code: 'MB', dans: 'au Manitoba' },
  'Nouveau-Brunswick': { code: 'NB', dans: 'au Nouveau-Brunswick' },
  'Nouvelle-Écosse': { code: 'NS', dans: 'en Nouvelle-Écosse' },
  Nunavut: { code: 'NU', dans: 'au Nunavut' },
  Ontario: { code: 'ON', dans: 'en Ontario' },
  Québec: { code: 'QC', dans: 'au Québec' },
  Saskatchewan: { code: 'SK', dans: 'en Saskatchewan' },
  'Terre-Neuve-et-Labrador': { code: 'NL', dans: 'à Terre-Neuve-et-Labrador' },
  'Territoires du Nord-Ouest': { code: 'NT', dans: 'dans les Territoires du Nord-Ouest' },
  Yukon: { code: 'YT', dans: 'au Yukon' },
};

const api = 'https://canada-holidays.ca/api/v1';
const headers = { 'User-Agent': 'Cornelius-module-feries_ca/1.0', Accept: 'application/json' };

type Holiday = {
  date: string;
  observedDate?: string;
  nameFr: string;
  federal?: number | boolean;
};
type Payload = { province?: { holidays: Holiday[]; sourceLink?: string }; holidays?: Holiday[] };

const holiday = {
  type: 'object',
  required: ['date', 'nameFr'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    observedDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    nameFr: { type: 'string', minLength: 1 },
  },
};
const validatePayload = compile<Payload>({
  type: 'object',
  properties: {
    province: {
      type: 'object',
      required: ['holidays'],
      properties: { holidays: { type: 'array', maxItems: 40, items: holiday } },
    },
    holidays: { type: 'array', maxItems: 40, items: holiday },
  },
});
const validateData = compile<FeriesData>(dataSchema);

/**
 * Nom dit et affiché : « Saint-Jean-Baptiste / Fête nationale du Québec » devient « Fête nationale
 * du Québec ». Au Québec, la loi laisse à l'employeur le choix entre le Vendredi saint et le lundi
 * de Pâques ; l'API ne donne que le premier.
 */
export function nomDuFerie(nom: string, province: Province | null): string {
  const net = nom.includes(' / ') ? nom.split(' / ').at(-1)!.trim() : nom.trim();
  if (province === 'Québec' && /^Vendredi saint$/iu.test(net))
    return 'Vendredi saint ou lundi de Pâques, au choix de l’employeur';
  return net;
}

/**
 * Nom affiché sur la carte et le miroir, dont la colonne de gauche est étroite : un nom trop long
 * écrase la date de droite (« 26 mar / s »). La voix garde le nom complet.
 */
export function nomCourt(nom: string): string {
  return nom
    .replace(/^Vendredi saint ou lundi de Pâques, au choix de l’employeur$/u, 'Vendredi saint')
    .replace(
      /^Journée nationale de la vérité et de la réconciliation$/u,
      'Vérité et réconciliation',
    )
    .replace(/^Journée nationale des peuples autochtones$/u, 'Peuples autochtones')
    .replace(/^Journée nationale des patriotes$/u, 'Journée des patriotes')
    .replace(/^Fête nationale du Québec$/u, 'Fête nationale')
    .slice(0, 40);
}

async function lire(context: AddonCollectContext<FeriesConfig>, path: string): Promise<Payload> {
  const response = await context.http.fetch({
    url: `${api}/${path}`,
    method: 'GET',
    headers,
    signal: context.signal,
    timeoutMs: 8000,
    maxBytes: 512 * 1024,
    // La liste ne change qu'avec une nouvelle loi : un jour en cache suffit.
    cacheMs: 24 * 3600_000,
  });
  if (response.status === 429)
    throw new AddonCollectError('quota', 'canada-holidays.ca limite les demandes.', true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', 'canada-holidays.ca est indisponible.', true);
  if (response.status !== 200)
    throw new AddonCollectError('upstream', `Réponse HTTP ${response.status} inattendue.`);
  let payload: unknown;
  try {
    payload = response.json();
  } catch {
    throw new AddonCollectError('malformed', 'Réponse illisible de canada-holidays.ca.');
  }
  if (!validatePayload(payload))
    throw new AddonCollectError('malformed', 'Jours fériés : réponse inattendue.');
  return payload;
}

async function collect(context: AddonCollectContext<FeriesConfig>) {
  const province = context.config.province;
  // Banques, transport, télécommunications, fonction publique fédérale : la liste fédérale.
  const federal = context.config.employeurFederal === true;
  const { code } = provinces[province] ?? {};
  if (!code)
    throw new AddonCollectError('config_invalid', 'Choisissez une province ou un territoire.');
  const annee = Number(dateIn(context.now(), context.timeZone).slice(0, 4));
  // L'année en cours et la suivante : le prochain jour férié de décembre est en janvier.
  const chemins = [annee, annee + 1].map((year) =>
    federal ? `holidays?federal=true&year=${year}` : `provinces/${code}?year=${year}`,
  );
  const reponses = await Promise.all(chemins.map((chemin) => lire(context, chemin)));
  const feries: Ferie[] = reponses
    .flatMap((r) => r.province?.holidays ?? r.holidays ?? [])
    .map((h) => ({
      date: h.date,
      observe: h.observedDate ?? h.date,
      nom: nomDuFerie(h.nameFr, federal ? null : province).slice(0, 120),
      federal: h.federal === 1 || h.federal === true,
    }))
    .sort((a, b) => a.observe.localeCompare(b.observe));
  const data: FeriesData = {
    province,
    federal,
    feries,
    source: reponses[0]?.province?.sourceLink?.slice(0, 300) ?? null,
  };
  if (!validateData(data)) throw new AddonCollectError('malformed', 'Jours fériés incohérents.');
  return {
    data,
    empty: feries.length === 0,
    freshMs: 12 * 3600_000,
    source: { provider: 'canada-holidays.ca', sourceId: federal ? 'federal' : code },
  };
}

// --- Dates ----------------------------------------------------------------------------------

const jourNumero = (jour: string) => {
  const [y, m, d] = jour.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / dayMs;
};
const longDay = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortDay = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
/** « le vendredi 1er janvier ». */
export const dit = (jour: string) =>
  `le ${longDay.format(new Date(jourNumero(jour) * dayMs)).replace(/ 1 /u, ' 1er ')}`;
/** « 1er janv. ». */
export const bref = (jour: string) =>
  shortDay.format(new Date(jourNumero(jour) * dayMs)).replace(/^1 /u, '1er ');
export function dans(aujourdhui: string, jour: string): string {
  const jours = jourNumero(jour) - jourNumero(aujourdhui);
  if (jours === 0) return 'aujourd’hui';
  if (jours === 1) return 'demain';
  return `dans ${jours} jours`;
}
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** « le Jour de l’An », « la Fête nationale du Québec », « l’Action de grâce ». */
const article = (nom: string) => {
  // « Noël » se dit sans article.
  if (/^noël$/iu.test(nom)) return nom;
  if (/^[aeiouyéèêàâîôûh]/iu.test(nom)) return `l’${nom}`;
  return /^(fête|journée|saint|veille)/iu.test(nom) ? `la ${nom}` : `le ${nom}`;
};

/** Le jour férié d'aujourd'hui, le prochain et les suivants, d'après la date observée. */
function situation(data: FeriesData, now: number, zone: string) {
  const today = dateIn(now, zone);
  const aujourdhui = data.feries.find((f) => f.observe === today) ?? null;
  const avenir = data.feries.filter((f) => f.observe > today);
  return { today, aujourdhui, prochain: avenir[0] ?? null, suivants: avenir.slice(1, 3) };
}

const observeDit = (f: Ferie) => (f.observe !== f.date ? `, congé observé ${dit(f.observe)}` : '');

function present(
  snapshot: ModuleSnapshot<FeriesData>,
  context: { now(): number; timeZone: string },
): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucun jour férié à présenter.');
  // « au Québec », ou « pour les employeurs fédéraux ».
  const ou = data.federal ? 'pour les employeurs fédéraux' : provinces[data.province].dans;
  const { today, aujourdhui, prochain, suivants } = situation(
    data,
    context.now(),
    context.timeZone,
  );
  const parts: string[] = [];
  if (aujourdhui) parts.push(`Aujourd’hui, c’est ${article(aujourdhui.nom)}, jour férié ${ou}.`);
  if (prochain)
    parts.push(
      `${aujourdhui ? 'Le suivant' : `Le prochain jour férié ${ou}`} : ${article(prochain.nom)}, ${dit(prochain.date)}, ${dans(today, prochain.observe)}${observeDit(prochain)}.`,
    );
  if (suivants.length)
    parts.push(
      `Ensuite : ${suivants.map((f) => `${article(f.nom)}, ${dit(f.date)}${observeDit(f)}`).join(' ; ')}.`,
    );
  return {
    title: `Jours fériés · ${data.federal ? 'fédéral' : data.province}`,
    primaryValue: prochain ? capitalize(dans(today, prochain.observe)) : null,
    subtitle: prochain
      ? `${nomCourt(prochain.nom)} · ${bref(prochain.observe)}`.slice(0, 120)
      : null,
    description: snapshot.status === 'stale' ? 'Dernière liste connue.' : null,
    items: [
      ...(aujourdhui ? [{ label: 'Aujourd’hui', value: aujourdhui.nom.slice(0, 160) }] : []),
      ...suivants.map((f) => ({ label: nomCourt(f.nom), value: bref(f.observe) })),
    ].slice(0, 5),
    summary: (parts.join(' ') || `Aucun jour férié publié ${ou}.`).slice(0, 500),
    sources: ['feries_ca'],
  };
}

const addon: AddonDefinition<FeriesConfig, FeriesData> = {
  id: 'feries_ca',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'canada-holidays.ca',
  display: {
    name: 'Jours fériés au Canada',
    // 160 caractères au plus (contrat des modules).
    description:
      'Le prochain jour férié et les suivants de votre province ou territoire, ou des employeurs fédéraux, d’après canada-holidays.ca.',
    icon: 'calendar-days',
    keywords: [
      'férié',
      'fériés',
      'congé',
      'canada',
      'québec',
      'province',
      'action de grâce',
      'fête',
    ],
    example: { label: 'Jours fériés au Québec', ref: 'feries' },
    spoken: { head: 'les jours fériés', repeats: ['feries', 'conges'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { province: 'Québec', employeurFederal: false },
  dataVersion: 1,
  dataSchema,
  freshMs: 12 * 3600_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les jours fériés de la province ou du territoire réglé (ou des employeurs fédéraux) et afficher leur carte : le prochain, les suivants, et la liste de l’année en cours et de la suivante dans les données. ' +
        'Utiliser pour « c’est quand le prochain congé férié ? », « est-ce férié lundi ? », « c’est quand l’Action de grâce ? », « la Fête nationale tombe quel jour ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  collect,
  present,
  ambient: {
    present(snapshot, context) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucun jour férié à afficher.');
      const { today, aujourdhui, prochain, suivants } = situation(
        data,
        context.now(),
        context.timeZone,
      );
      return {
        layout: 'metric',
        // Une liste de lois ne vieillit pas : la date du relevé n'aide pas.
        showCollectedAt: false,
        // À minuit, le compte à rebours perd un jour.
        refreshAt: iso(nextMidnight(context.now(), context.timeZone)),
        title: 'Jours fériés',
        value: aujourdhui
          ? 'Aujourd’hui'
          : prochain
            ? capitalize(dans(today, prochain.observe))
            : null,
        subtitle:
          (aujourdhui ?? prochain)
            ? `${nomCourt((aujourdhui ?? prochain)!.nom)} · ${bref((aujourdhui ?? prochain)!.observe)}`.slice(
                0,
                120,
              )
            : 'Aucun jour férié publié',
        items: (aujourdhui && prochain ? [prochain, ...suivants] : suivants)
          .slice(0, 2)
          .map((f) => ({ label: nomCourt(f.nom), value: bref(f.observe) })),
      };
    },
  },
};

export default addon;
