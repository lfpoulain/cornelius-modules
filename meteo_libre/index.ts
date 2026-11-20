/** Prévisions météo d'un lieu, d'après l'API libre et gratuite Open-Meteo (sans jeton). */
import {
  AddonCollectError,
  type AddonDefinition,
  type AddonPresentation,
  type AddonPresentContext,
  type ModuleSnapshot,
} from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { dateIn, nextMidnight } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type MeteoLibreConfig = { place: string; latitude: number; longitude: number; days: number };
type MeteoDay = {
  date: string;
  tmin: number;
  tmax: number;
  summary: string;
  rainProbability: number | null;
  windKmh: number | null;
};
type MeteoLibreData = { place: string; days: MeteoDay[] };

const baseUrl = 'https://api.open-meteo.com/v1/forecast';
const validateData = compile<MeteoLibreData>(dataSchema);

/** Codes météo de l'OMM (WMO 4677) employés par Open-Meteo, dits en français. */
export function weatherLabel(code: unknown): string {
  switch (code) {
    case 0:
      return 'Ciel dégagé';
    case 1:
      return 'Plutôt dégagé';
    case 2:
      return 'Partiellement nuageux';
    case 3:
      return 'Couvert';
    case 45:
    case 48:
      return 'Brouillard';
    case 51:
    case 53:
    case 55:
      return 'Bruine';
    case 56:
    case 57:
      return 'Bruine verglaçante';
    case 61:
      return 'Pluie faible';
    case 63:
      return 'Pluie';
    case 65:
      return 'Forte pluie';
    case 66:
    case 67:
      return 'Pluie verglaçante';
    case 71:
      return 'Neige faible';
    case 73:
      return 'Neige';
    case 75:
      return 'Forte neige';
    case 77:
      return 'Grains de neige';
    case 80:
      return 'Averses faibles';
    case 81:
      return 'Averses';
    case 82:
      return 'Fortes averses';
    case 85:
    case 86:
      return 'Averses de neige';
    case 95:
      return 'Orage';
    case 96:
    case 99:
      return 'Orage avec grêle';
    default:
      return 'Conditions variables';
  }
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Réponse daily d'Open-Meteo : listes alignées par jour. Une valeur absente reste absente. */
function parseDays(payload: unknown, keep: number): MeteoDay[] {
  const daily =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>).daily : null;
  if (!daily || typeof daily !== 'object')
    throw new AddonCollectError('malformed', 'Prévisions Open-Meteo illisibles.');
  const column = (name: string, required = false) => {
    const values = (daily as Record<string, unknown>)[name];
    if (Array.isArray(values)) return values;
    if (required) throw new AddonCollectError('malformed', 'Prévisions Open-Meteo incomplètes.');
    return [];
  };
  const time = column('time', true);
  const codes = column('weather_code');
  const max = column('temperature_2m_max', true);
  const min = column('temperature_2m_min', true);
  const rain = column('precipitation_probability_max');
  const wind = column('wind_speed_10m_max');
  const days: MeteoDay[] = [];
  for (let index = 0; index < time.length && days.length < keep; index += 1) {
    const date = time[index];
    const tmin = min[index];
    const tmax = max[index];
    // Sans date ni températures, le jour n'est pas annoncé : rien n'est inventé.
    if (typeof date !== 'string' || !finite(tmin) || !finite(tmax)) continue;
    days.push({
      date,
      tmin: Math.round(tmin),
      tmax: Math.round(tmax),
      summary: weatherLabel(codes[index]),
      rainProbability: finite(rain[index]) ? Math.round(rain[index] as number) : null,
      windKmh: finite(wind[index]) ? Math.round(wind[index] as number) : null,
    });
  }
  if (!days.length)
    throw new AddonCollectError('malformed', 'Open-Meteo ne donne aucun jour exploitable.');
  return days;
}

/** Coordonnées arrondies à 2 décimales (environ 1 km) : assez pour Open-Meteo, moins précis
 * que le domicile, et deux sources proches partagent le cache. */
const rounded = (value: number) => Math.round(value * 100) / 100;

/** Prévisions d'aujourd'hui et des jours suivants, jamais celles d'un jour passé. */
function currentDays(data: MeteoLibreData, today: string): MeteoDay[] {
  return data.days.filter((day) => day.date >= today);
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(date + 'T12:00:00Z'),
  );
}

/** « aujourd'hui », « demain » ou le nom du jour : un jour n'est jamais dit sous un autre. */
function dayName(date: string, today: string, tomorrow: string): string {
  if (date === today) return 'aujourd’hui';
  if (date === tomorrow) return 'demain';
  return weekday(date);
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function present(
  snapshot: ModuleSnapshot<MeteoLibreData>,
  context: AddonPresentContext,
): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucune prévision à présenter.');
  const today = dateIn(context.now(), context.timeZone);
  const tomorrow = dateIn(nextMidnight(context.now(), context.timeZone), context.timeZone);
  const days = currentDays(data, today);
  const first = days[0];
  if (!first)
    return {
      title: 'Météo libre',
      primaryValue: null,
      subtitle: data.place,
      description: 'Pas de prévision à jour pour ce lieu.',
      items: [],
      summary: `Pas de prévision à jour pour ${data.place}.`,
      sources: ['meteo_libre'],
    };
  // Le premier jour gardé n'est pas forcément aujourd'hui (température du jour absente).
  const firstName = first.date === today ? null : dayName(first.date, today, tomorrow);
  const items = days.slice(1, 6).map((day) => ({
    label: dayName(day.date, today, tomorrow),
    value: `${day.tmin} / ${day.tmax} °C · ${day.summary}`,
  }));
  const next = days[1];
  const stale = snapshot.status === 'stale';
  const summary = [
    `${stale ? 'Dernière prévision connue' : 'Météo'} à ${data.place}${firstName ? `, ${firstName}` : ''} : ${first.tmin} / ${first.tmax} °C, ${first.summary.toLowerCase()}.`,
    first.rainProbability !== null && first.rainProbability >= 40
      ? `Risque de pluie ${first.rainProbability} %.`
      : null,
    first.windKmh !== null && first.windKmh >= 40 ? `Vent jusqu’à ${first.windKmh} km/h.` : null,
    next
      ? `${capitalized(dayName(next.date, today, tomorrow))} ${next.tmin} / ${next.tmax} °C, ${next.summary.toLowerCase()}.`
      : null,
    stale ? 'À vérifier.' : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: 'Météo libre',
    primaryValue: `${first.tmin} / ${first.tmax} °C`,
    subtitle: `${data.place} · ${firstName ? capitalized(firstName) + ' · ' : ''}${first.summary}`,
    description: stale ? 'Dernière prévision connue, à vérifier.' : null,
    items,
    summary: summary.slice(0, 500),
    sources: ['meteo_libre'],
  };
}

const addon: AddonDefinition<MeteoLibreConfig, MeteoLibreData> = {
  id: 'meteo_libre',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Météo libre (Open-Meteo)',
  display: {
    name: 'Météo libre',
    description: 'Prévisions du jour et des jours suivants pour un lieu, sans jeton (Open-Meteo).',
    icon: 'cloud-sun',
    keywords: ['météo', 'temps', 'prévisions', 'pluie', 'température', 'open-meteo'],
    example: { label: 'Météo à Brest', ref: 'brest' },
    // « les prévisions de brest » : distinct de « la météo » de la Météo du cœur.
    spoken: { head: 'les prévisions', repeats: ['meteo', 'temps', 'previsions'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { place: 'Paris', latitude: 48.86, longitude: 2.35, days: 3 },
  dataVersion: 1,
  dataSchema,
  freshMs: 30 * 60_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les prévisions météo du lieu configuré, d’après Open-Meteo, et afficher la carte Météo libre : températures, temps, risque de pluie, vent. ' +
        'Utiliser pour « quel temps fait-il ? », « va-t-il pleuvoir demain ? », « météo de la semaine ». ' +
        'Si une autre source météo répond aussi, préférer celle que la personne nomme.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const { config } = context;
    const latitude = rounded(config.latitude);
    const longitude = rounded(config.longitude);
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
      // Les jours sont ceux du fuseau du foyer, pas ceux du lieu ni de l'UTC.
      timezone: context.timeZone,
      forecast_days: String(Math.min(7, Math.max(1, config.days))),
    });
    const response = await context.http.fetch({
      url: `${baseUrl}?${params.toString()}`,
      method: 'GET',
      signal: context.signal,
      timeoutMs: 6000,
      maxBytes: 64 * 1024,
      // Deux sources du même lieu partagent la réponse.
      cacheMs: 5 * 60_000,
    });
    if (response.status === 400)
      throw new AddonCollectError(
        'config_invalid',
        'Open-Meteo refuse la demande : vérifiez la latitude et la longitude du lieu.',
      );
    if (response.status === 429)
      throw new AddonCollectError('quota', 'Quota quotidien d’Open-Meteo atteint.', true);
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'Open-Meteo est indisponible.', true);
    if (response.status !== 200)
      throw new AddonCollectError(
        'upstream',
        `Réponse HTTP ${response.status} inattendue d’Open-Meteo.`,
      );
    let payload: unknown;
    try {
      payload = response.json();
    } catch {
      throw new AddonCollectError('malformed', 'Prévisions Open-Meteo illisibles.');
    }
    const data = { place: config.place, days: parseDays(payload, config.days) };
    if (!validateData(data))
      throw new AddonCollectError('malformed', 'Prévisions Open-Meteo invalides.');
    return {
      data,
      // Une prévision du jour ne vaut que jusqu'à minuit : la veille n'est jamais servie fraîche.
      freshMs: Math.min(
        30 * 60_000,
        Math.max(5_000, nextMidnight(context.now(), context.timeZone) - context.now()),
      ),
      source: { provider: 'open-meteo', sourceId: `${latitude},${longitude}` },
    };
  },
  ambient: {
    present(snapshot, context) {
      const card = present(snapshot, context);
      return {
        layout: 'metric',
        title: 'Météo',
        value: card.primaryValue ?? 'Indisponible',
        // Données sous licence CC BY 4.0 : la source reste citée à l'écran.
        subtitle: `${card.subtitle ?? ''} · Open-Meteo`.slice(0, 120),
        items: [],
        // À minuit, la prévision du jour devient celle de la veille : la carte passe au lendemain.
        refreshAt: new Date(nextMidnight(context.now(), context.timeZone)).toISOString(),
      };
    },
  },
  present,
};

export default addon;
