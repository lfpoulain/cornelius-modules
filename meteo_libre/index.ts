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
  const column = (name: string) => {
    const values = (daily as Record<string, unknown>)[name];
    return Array.isArray(values) ? values : [];
  };
  const time = column('time');
  const codes = column('weather_code');
  const max = column('temperature_2m_max');
  const min = column('temperature_2m_min');
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
  return days;
}

/** Prévisions d'aujourd'hui et des jours suivants : un relevé de la veille perd son premier jour. */
function currentDays(data: MeteoLibreData, context: AddonPresentContext): MeteoDay[] {
  const today = dateIn(context.now(), context.timeZone);
  const days = data.days.filter((day) => day.date >= today);
  return days.length ? days : data.days.slice(-1);
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(date + 'T12:00:00Z'),
  );
}

function present(
  snapshot: ModuleSnapshot<MeteoLibreData>,
  context: AddonPresentContext,
): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucune prévision à présenter.');
  const days = currentDays(data, context);
  const today = days[0];
  if (!today)
    return {
      title: 'Météo',
      primaryValue: null,
      subtitle: data.place,
      description: 'Open-Meteo ne donne aucune prévision pour ce lieu.',
      items: [],
      summary: `Pas de prévision disponible pour ${data.place}.`,
      sources: ['meteo_libre'],
    };
  const items = days.slice(1, 6).map((day) => ({
    label: weekday(day.date),
    value: `${day.tmin} / ${day.tmax} °C · ${day.summary}`,
  }));
  const stale = snapshot.status === 'stale';
  const summary = [
    `${stale ? 'Dernière prévision connue' : 'Météo'} à ${data.place} : ${today.tmin} / ${today.tmax} °C, ${today.summary.toLowerCase()}.`,
    today.rainProbability !== null && today.rainProbability >= 40
      ? `Risque de pluie ${today.rainProbability} %.`
      : null,
    today.windKmh !== null && today.windKmh >= 40 ? `Vent jusqu'à ${today.windKmh} km/h.` : null,
    items[0] ? `Demain ${items[0].value.replace(' · ', ', ').toLowerCase()}.` : null,
    stale ? 'À vérifier.' : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: 'Météo',
    primaryValue: `${today.tmin} / ${today.tmax} °C`,
    subtitle: `${data.place} · ${today.summary}`,
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
    spoken: { head: 'la météo', repeats: ['meteo', 'temps', 'previsions'] },
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
        'Lire les prévisions météo du lieu configuré et afficher la carte Météo : températures, temps, risque de pluie, vent. ' +
        'Utiliser pour « quel temps fait-il ? », « va-t-il pleuvoir demain ? », « météo de la semaine ».',
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
    const params = new URLSearchParams({
      latitude: String(config.latitude),
      longitude: String(config.longitude),
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
        'Open-Meteo refuse ce lieu : vérifiez la latitude et la longitude.',
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
    const sourceId = `${config.latitude},${config.longitude}`;
    return data.days.length
      ? { data, source: { provider: 'open-meteo', sourceId } }
      : { data, empty: true, source: { provider: 'open-meteo', sourceId } };
  },
  ambient: {
    present(snapshot, context) {
      const card = present(snapshot, context);
      return {
        layout: 'metric',
        title: 'Météo',
        value: card.primaryValue ?? 'Indisponible',
        subtitle: card.subtitle?.slice(0, 120) ?? null,
        items: [],
        // À minuit, la prévision du jour devient celle de la veille : la carte passe au lendemain.
        refreshAt: new Date(nextMidnight(context.now(), context.timeZone)).toISOString(),
      };
    },
  },
  present,
};

export default addon;
