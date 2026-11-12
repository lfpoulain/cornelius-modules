/**
 * Météo d'une ville canadienne d'après Environnement et Changement climatique Canada (API
 * GeoMet-OGC, page « citypageweather », JSON, sans jeton) : conditions actuelles, prévisions par
 * période, avertissements en vigueur. Les icônes suivent les codes officiels d'Environnement
 * Canada ; elles sont envoyées au miroir si le cœur les connaît (`cardIcons`), sinon dites par
 * des émojis dans le texte de la carte.
 */
import * as contrat from '#cornelius/addons';
import {
  AddonCollectError,
  type AddonCollectContext,
  type AddonDefinition,
  type AddonPresentation,
  type AddonPresentContext,
  type ModuleSnapshot,
} from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };
import villes from './villes.json' with { type: 'json' };

type MeteoCanadaConfig = {
  ville: string;
  latitude?: number | null;
  longitude?: number | null;
  periodes: number;
};
type Icone =
  | 'sun'
  | 'moon'
  | 'cloud-sun'
  | 'cloud-moon'
  | 'cloud'
  | 'cloud-drizzle'
  | 'cloud-rain'
  | 'cloud-sun-rain'
  | 'cloud-moon-rain'
  | 'cloud-snow'
  | 'snowflake'
  | 'cloud-hail'
  | 'cloud-lightning'
  | 'cloud-fog'
  | 'haze'
  | 'wind'
  | 'tornado'
  | 'thermometer'
  | 'triangle-alert';
type Periode = {
  nom: string;
  resume: string;
  icone: Icone;
  temperature: number | null;
  classe: 'max' | 'min' | null;
};
type MeteoCanadaData = {
  ville: string;
  actuel: {
    temperature: number;
    condition: string | null;
    icone: Icone;
    ressenti: number | null;
    ventKmh: number | null;
  } | null;
  periodes: Periode[];
  avertissements: string[];
  misAJour: string;
};

/** [identifiant, nom, latitude, longitude] des 844 pages de ville d'Environnement Canada. */
const listeVilles = villes as [string, string, number, number][];
const api = 'https://api.weather.gc.ca/collections/citypageweather-realtime/items';
const headers = { 'User-Agent': 'Cornelius-module-meteo-canada/1.0', Accept: 'application/json' };
const validateData = compile<MeteoCanadaData>(dataSchema);

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

/**
 * La page de ville : la plus proche des coordonnées si elles sont saisies (elles priment), sinon
 * celle dont le nom correspond (« Windsor, ON » départage les homonymes par la province).
 */
export function trouverVille(config: Pick<MeteoCanadaConfig, 'ville' | 'latitude' | 'longitude'>) {
  const { latitude, longitude } = config;
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    const distance = ([, , lat, lon]: [string, string, number, number]) =>
      Math.hypot(lat - latitude, (lon - longitude) * Math.cos((latitude * Math.PI) / 180));
    const proche = [...listeVilles].sort((a, b) => distance(a) - distance(b))[0]!;
    if (distance(proche) * 111 > 150)
      throw new AddonCollectError(
        'not_found',
        'Aucune ville d’Environnement Canada à moins de 150 km.',
      );
    return { id: proche[0], nom: proche[1] };
  }
  const [nom = '', province = ''] = config.ville.split(',').map((part) => plain(part));
  const candidats = listeVilles.filter(
    ([id, n]) => plain(n) === nom && (!province || id.startsWith(`${province}-`)),
  );
  // Sans province, le Québec d'abord, puis l'ordre de la liste.
  const ville = candidats.find(([id]) => id.startsWith('qc-')) ?? candidats[0];
  if (!ville)
    throw new AddonCollectError(
      'not_found',
      `Ville introuvable chez Environnement Canada : ${config.ville.slice(0, 80)}. Essayez la ville voisine la plus grande.`,
    );
  return { id: ville[0], nom: ville[1] };
}

/**
 * Codes d'icône d'Environnement Canada (0 à 48) → icône de la carte. Relevés le 2026-11-11 sur
 * les 844 villes : 14 « pluie verglaçante », 30 « dégagé » (nuit), 40 « blizzard »…
 */
const icones: Record<number, Icone> = {
  0: 'sun',
  1: 'sun',
  2: 'cloud-sun',
  3: 'cloud',
  4: 'cloud',
  5: 'cloud-sun',
  6: 'cloud-sun-rain',
  7: 'cloud-snow',
  8: 'cloud-snow',
  9: 'cloud-lightning',
  10: 'cloud',
  11: 'cloud-rain',
  12: 'cloud-rain',
  13: 'cloud-rain',
  14: 'cloud-hail',
  15: 'cloud-snow',
  16: 'snowflake',
  17: 'snowflake',
  18: 'snowflake',
  19: 'cloud-lightning',
  22: 'cloud-sun',
  23: 'haze',
  24: 'cloud-fog',
  25: 'wind',
  26: 'snowflake',
  27: 'cloud-hail',
  28: 'cloud-drizzle',
  30: 'moon',
  31: 'cloud-moon',
  32: 'cloud-moon',
  33: 'cloud',
  34: 'cloud',
  35: 'cloud-moon',
  36: 'cloud-moon-rain',
  37: 'cloud-snow',
  38: 'cloud-snow',
  39: 'cloud-lightning',
  40: 'wind',
  41: 'tornado',
  42: 'tornado',
  43: 'wind',
  44: 'haze',
  45: 'haze',
  46: 'cloud-hail',
  47: 'cloud-lightning',
  48: 'tornado',
};

/** Code absent ou inconnu : d'après le texte, sans rien inventer de plus. */
export function iconeDe(code: unknown, texte: string | null): Icone {
  if (typeof code === 'number' && icones[code]) return icones[code];
  const t = plain(texte ?? '');
  if (/orage/u.test(t)) return 'cloud-lightning';
  if (/vergla|gresil|grele/u.test(t)) return 'cloud-hail';
  if (/neige|poudrerie|blizzard/u.test(t)) return 'cloud-snow';
  if (/bruine/u.test(t)) return 'cloud-drizzle';
  if (/pluie|averse|precipitation/u.test(t)) return 'cloud-rain';
  if (/brouillard|brume/u.test(t)) return 'cloud-fog';
  if (/ensoleille|degage/u.test(t)) return 'sun';
  return 'cloud';
}

const emojis: Record<Icone, string> = {
  sun: '☀️',
  moon: '🌙',
  'cloud-sun': '⛅',
  'cloud-moon': '🌙',
  cloud: '☁️',
  'cloud-drizzle': '🌦️',
  'cloud-rain': '🌧️',
  'cloud-sun-rain': '🌦️',
  'cloud-moon-rain': '🌧️',
  'cloud-snow': '🌨️',
  snowflake: '❄️',
  'cloud-hail': '🧊',
  'cloud-lightning': '⛈️',
  'cloud-fog': '🌫️',
  haze: '🌫️',
  wind: '💨',
  tornado: '🌪️',
  thermometer: '🌡️',
  'triangle-alert': '⚠️',
};

/** Le cœur sait-il dessiner cette icône ? Sinon (Cornelius 0.3.0), un émoji dans le texte. */
const iconesDuCoeur = (contrat as { cardIcons?: readonly string[] }).cardIcons;
export const coeurAvecIcones = () => Array.isArray(iconesDuCoeur);
function icone(nom: Icone): { icon?: Icone } {
  return iconesDuCoeur?.includes(nom) ? { icon: nom } : {};
}
const avecEmoji = (nom: Icone, texte: string) =>
  iconesDuCoeur?.includes(nom) ? texte : `${emojis[nom]} ${texte}`;

type Json = Record<string, any>;
const fr = (champ: unknown): any =>
  champ && typeof champ === 'object' ? (champ as Json).fr : undefined;
const nombre = (valeur: unknown): number | null => {
  const n = typeof valeur === 'string' ? Number(valeur) : valeur;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** « AVERTISSEMENT JAUNE - PLUIE » → « Avertissement jaune : pluie ». */
export function avertissement(texte: string): string {
  const bas = texte
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/u, ' : ');
  return (bas.charAt(0).toUpperCase() + bas.slice(1)).slice(0, 120);
}

/**
 * « Ressenti » seulement s'il est plausible : la page peut publier un refroidissement éolien
 * absurde (−2 °C par 16,7 °C à West Vancouver le 2026-11-11). Refroidissement éolien à 10 °C ou
 * moins et plus bas que la température ; humidex à 20 °C ou plus et plus haut. Sinon, rien.
 */
export function ressentiPlausible(
  temperature: number,
  refroidissement: number | null,
  humidex: number | null,
): number | null {
  if (refroidissement !== null && temperature <= 10 && refroidissement < temperature)
    return refroidissement;
  if (humidex !== null && temperature >= 20 && humidex > temperature) return humidex;
  return null;
}

export function lirePage(page: unknown, maintenant: number): Omit<MeteoCanadaData, 'ville'> {
  const p = (page as Json)?.properties as Json | undefined;
  if (!p || typeof p !== 'object')
    throw new AddonCollectError('malformed', 'Page météo illisible.');
  const cc = (p.currentConditions ?? {}) as Json;
  const temperature = nombre(fr(cc.temperature?.value));
  const condition = typeof fr(cc.condition) === 'string' ? (fr(cc.condition) as string) : null;
  const actuel =
    temperature === null
      ? null
      : {
          temperature,
          condition,
          icone: iconeDe(cc.iconCode?.value, condition),
          ressenti: ressentiPlausible(
            temperature,
            nombre(fr(cc.windChill?.value)),
            nombre(fr(cc.humidex?.value)),
          ),
          ventKmh: nombre(fr(cc.wind?.speed?.value)),
        };
  const prevues = Array.isArray(p.forecastGroup?.forecasts)
    ? (p.forecastGroup.forecasts as Json[])
    : [];
  const periodes: Periode[] = prevues
    .map((f) => {
      const resume = String(fr(f.abbreviatedForecast?.textSummary) ?? '').trim();
      const t = Array.isArray(f.temperatures?.temperature)
        ? (f.temperatures.temperature[0] as Json)
        : null;
      const classe = fr(t?.class);
      return {
        nom: String(fr(f.period?.textForecastName) ?? '').trim(),
        resume,
        icone: iconeDe(f.abbreviatedForecast?.icon?.value, resume),
        temperature: nombre(fr(t?.value)),
        classe: classe === 'high' ? ('max' as const) : classe === 'low' ? ('min' as const) : null,
      };
    })
    .filter((f) => f.nom && f.resume)
    .slice(0, 6);
  const avertissements = (Array.isArray(p.warnings) ? (p.warnings as Json[]) : [])
    .filter((w) => {
      const fin = Date.parse(String(fr(w.expiryTime) ?? ''));
      return !Number.isFinite(fin) || fin > maintenant;
    })
    .map((w) => String(fr(w.description) ?? '').trim())
    .filter(Boolean)
    .map(avertissement)
    .slice(0, 3);
  if (!actuel && !periodes.length)
    throw new AddonCollectError('malformed', 'Page météo sans données.');
  return {
    actuel,
    periodes,
    avertissements,
    misAJour: String(p.lastUpdated ?? new Date(maintenant).toISOString()),
  };
}

async function collect(context: AddonCollectContext<MeteoCanadaConfig>) {
  const ville = trouverVille(context.config);
  const response = await context.http.fetch({
    url: `${api}/${encodeURIComponent(ville.id)}?f=json&lang=fr`,
    method: 'GET',
    headers,
    signal: context.signal,
    timeoutMs: 8000,
    maxBytes: 512 * 1024,
    // Environnement Canada met la page à jour environ toutes les heures.
    cacheMs: 5 * 60_000,
  });
  if (response.status === 404)
    throw new AddonCollectError('not_found', `Page météo absente pour ${ville.nom}.`);
  if (response.status === 429)
    throw new AddonCollectError(
      'quota',
      'Environnement Canada limite les demandes pour le moment.',
      true,
    );
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', 'Environnement Canada est indisponible.', true);
  if (response.status !== 200)
    throw new AddonCollectError(
      'upstream',
      `Réponse HTTP ${response.status} inattendue d’Environnement Canada.`,
    );
  let page: unknown;
  try {
    page = response.json();
  } catch {
    throw new AddonCollectError('malformed', 'Page météo illisible.');
  }
  const data: MeteoCanadaData = { ville: ville.nom, ...lirePage(page, context.now()) };
  data.periodes = data.periodes.slice(0, context.config.periodes);
  if (!validateData(data)) throw new AddonCollectError('malformed', 'Page météo incohérente.');
  return {
    data,
    freshMs: 10 * 60_000,
    source: { provider: 'eccc', sourceId: ville.id },
  };
}

const degres = (n: number) => `${Math.round(n)} °C`.replace('-', '−');
/** À l'oral : « moins 6 », « plus 3 » n'est pas dit. */
const ditDegres = (n: number) => {
  const r = Math.round(n);
  return r < 0 ? `moins ${-r}` : `${r}`;
};
const minuscule = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function ligne(p: Periode): string {
  const borne = p.classe === 'min' ? 'min. ' : p.classe === 'max' ? 'max. ' : '';
  const t = p.temperature === null ? '' : `, ${borne}${degres(p.temperature)}`;
  return `${p.resume}${t}`.slice(0, 160);
}

function present(
  snapshot: ModuleSnapshot<MeteoCanadaData>,
  _context: AddonPresentContext,
): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucune météo à présenter.');
  const { actuel, periodes, avertissements } = data;
  const oral: string[] = [];
  if (actuel) {
    const parts = [`il fait ${ditDegres(actuel.temperature)} degrés`];
    if (actuel.condition) parts.push(minuscule(actuel.condition));
    if (actuel.ressenti !== null && Math.round(actuel.ressenti) !== Math.round(actuel.temperature))
      parts.push(`ressenti ${ditDegres(actuel.ressenti)}`);
    oral.push(`À ${data.ville}, ${parts.join(', ')}.`);
  } else oral.push(`Météo à ${data.ville}.`);
  for (const p of periodes.slice(0, 2)) {
    const t =
      p.temperature === null
        ? ''
        : `, ${p.classe === 'min' ? 'minimum' : 'maximum'} ${ditDegres(p.temperature)}`;
    oral.push(`${p.nom} : ${minuscule(p.resume)}${t}.`);
  }
  if (avertissements.length) oral.push(`${avertissements.join('. ')} en vigueur.`);
  const items = [
    ...avertissements.slice(0, 1).map((a) => ({
      label: avecEmoji('triangle-alert', 'Avertissement'),
      value: a.slice(0, 160),
      ...icone('triangle-alert'),
    })),
    ...periodes.map((p) => ({
      label: avecEmoji(p.icone, p.nom).slice(0, 80),
      value: ligne(p),
      ...icone(p.icone),
    })),
  ].slice(0, 5);
  return {
    title: `Météo · ${data.ville}`.slice(0, 80),
    ...(actuel ? icone(actuel.icone) : {}),
    primaryValue: actuel ? avecEmoji(actuel.icone, degres(actuel.temperature)) : null,
    subtitle:
      [actuel?.condition, actuel?.ressenti != null ? `ressenti ${degres(actuel.ressenti)}` : null]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 120) || null,
    description: snapshot.status === 'stale' ? 'Dernier relevé connu, à vérifier.' : null,
    items,
    summary: oral.join(' ').slice(0, 500),
    sources: ['meteo_canada'],
  };
}

const addon: AddonDefinition<MeteoCanadaConfig, MeteoCanadaData> = {
  id: 'meteo_canada',
  apiVersion: 1,
  version: '1.0.1',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Environnement Canada',
  display: {
    name: 'Météo Canada',
    description:
      'Conditions actuelles, prévisions et avertissements d’Environnement Canada pour une ville canadienne, avec icônes.',
    icon: 'cloud-sun',
    keywords: [
      'météo',
      'temps',
      'température',
      'pluie',
      'neige',
      'avertissement',
      'canada',
      'québec',
    ],
    example: { label: 'Météo à Québec', ref: 'quebec' },
    spoken: { head: 'la météo', repeats: ['meteo', 'temps'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { ville: 'Montréal', periodes: 3 },
  dataVersion: 1,
  dataSchema,
  freshMs: 10 * 60_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire la météo d’Environnement Canada pour la ville réglée : température, conditions, prévisions des prochaines périodes et avertissements en vigueur, et afficher la carte Météo Canada. ' +
        'Utiliser pour toute question de météo du foyer : « quelle est la météo ? », « quel temps fait-il ? », « et demain ? », « va-t-il neiger ce soir ? », « y a-t-il un avertissement météo ? ». ' +
        // Plusieurs modules météo peuvent être installés sans source (la Météo livrée avec
        // Cornelius, par exemple) : le modèle les choisissait et répondait qu'aucun module
        // n'était réglé. Une source Météo Canada autorisée l'emporte sur un outil météo sans source.
        'Si une source Météo Canada est autorisée, c’est cet outil qu’il faut appeler, et non un autre outil météo sans source. ' +
        'Dire les avertissements s’il y en a.',
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
    present(snapshot) {
      const data = snapshot.data;
      const actuel = data?.actuel ?? null;
      return {
        layout: 'metric',
        title: 'Météo',
        ...(actuel ? icone(actuel.icone) : {}),
        value: actuel ? avecEmoji(actuel.icone, degres(actuel.temperature)) : null,
        subtitle: data
          ? ([data.avertissements[0], actuel?.condition].filter(Boolean)[0]?.slice(0, 120) ?? null)
          : null,
        items: (data?.periodes ?? []).slice(0, 2).map((p) => ({
          label: avecEmoji(p.icone, p.nom).slice(0, 80),
          value: ligne(p),
          ...icone(p.icone),
        })),
      };
    },
  },
};

export default addon;
