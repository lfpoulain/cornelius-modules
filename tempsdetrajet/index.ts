/**
 * Trajet : l'heure d'arrivée estimée d'un trajet en voiture, avec le trafic en direct.
 * Fournisseur : TomTom (API Routing, « Calculate Route »). Le module demande l'itinéraire le
 * plus rapide au moment de la lecture ; il ne calcule aucun trajet lui-même.
 */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { wallIn } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

/** `origin` et `destination` sont des « latitude,longitude » remplis par la recherche d'adresse. */
type TrajetConfig = {
  origin: string;
  originLabel: string;
  destination: string;
  destinationLabel: string;
};
/** Réglages de la version 1 : quatre nombres saisis à la main. */
type TrajetConfigV1 = {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
};
type TrajetData = {
  travelSeconds: number;
  freeFlowSeconds: number | null;
  delaySeconds: number | null;
  distanceMeters: number;
};

/** Ce que le module lit dans la réponse de TomTom : le reste est ignoré, jamais deviné. */
type RoutingPayload = {
  routes: {
    summary: {
      travelTimeInSeconds: number;
      lengthInMeters: number;
      trafficDelayInSeconds?: number;
      noTrafficTravelTimeInSeconds?: number;
    };
  }[];
};
const validatePayload = compile<RoutingPayload>({
  type: 'object',
  required: ['routes'],
  properties: {
    routes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['summary'],
        properties: {
          summary: {
            type: 'object',
            required: ['travelTimeInSeconds', 'lengthInMeters'],
            properties: {
              travelTimeInSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
              lengthInMeters: { type: 'integer', minimum: 0, maximum: 2000000 },
              trafficDelayInSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
              noTrafficTravelTimeInSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
            },
          },
        },
      },
    },
  },
});

/** Ce que le module lit dans une recherche d'adresse TomTom : le reste est ignoré. */
type SearchPayload = {
  results: {
    position: { lat: number; lon: number };
    address?: { freeformAddress?: string; municipality?: string };
    poi?: { name?: string };
  }[];
};
const validateSearch = compile<SearchPayload>({
  type: 'object',
  required: ['results'],
  properties: { results: { type: 'array', maxItems: 50 } },
});
const validateSearchResult = compile<SearchPayload['results'][number]>({
  type: 'object',
  required: ['position'],
  properties: {
    position: {
      type: 'object',
      required: ['lat', 'lon'],
      properties: {
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lon: { type: 'number', minimum: -180, maximum: 180 },
      },
    },
    address: {
      type: 'object',
      properties: { freeformAddress: { type: 'string' }, municipality: { type: 'string' } },
    },
    poi: { type: 'object', properties: { name: { type: 'string' } } },
  },
});

const baseUrl = 'https://api.tomtom.com/routing/1/calculateRoute';
const searchUrl = 'https://api.tomtom.com/search/2/search';
const minute = 60_000;

/**
 * Une adresse choisie est arrondie à 3 décimales (une centaine de mètres) : TomTom reçoit un
 * repère proche plutôt que la porte exacte, pour un calcul de trajet presque identique.
 */
const approximate = (value: number) => value.toFixed(3);

const pointPattern = /^(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)$/u;

/** « 44.84130,-0.56930 » pour l'adresse du service, ou null si le point est hors du globe. */
function readPoint(value: string): string | null {
  const match = pointPattern.exec(value);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

/**
 * Enveloppe un appel réseau : une panne de transport (délai, DNS, taille dépassée) devient une
 * erreur au message fixe. L'erreur d'origine n'est jamais relayée, car son texte peut reprendre
 * l'adresse demandée, donc la clé. Une annulation voulue (signal) garde son erreur d'origine.
 */
async function guarded<T>(call: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AddonCollectError || signal?.aborted) throw error;
    throw new AddonCollectError('unavailable', 'TomTom est injoignable.', true);
  }
}

/** Un texte venu du fournisseur : sans caractère de contrôle, espaces réduits. */
function clean(value: string | undefined): string {
  return (value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Longueur maximale d'une recherche d'adresse. */
const maxQueryLength = 120;

/**
 * Traduit un statut d'échec de TomTom en erreur de module. Aucun message ne reprend l'adresse
 * demandée : elle contient la clé.
 */
function failFor(status: number, invalidMessage: string): never {
  if (status === 401 || status === 403) throw new AddonCollectError('auth', 'Clé TomTom refusée.');
  if (status === 400 || status === 404)
    throw new AddonCollectError('invalid_params', invalidMessage);
  if (status === 429) throw new AddonCollectError('quota', 'Quota TomTom atteint.', true);
  if (status >= 500) throw new AddonCollectError('unavailable', 'TomTom est indisponible.', true);
  throw new AddonCollectError('upstream', `Réponse HTTP ${status} inattendue.`);
}

/** « 8 h », « 8 h 05 » : la façon dont on dit l'heure, dans le fuseau du foyer. */
function clock(ms: number, zone: string): string {
  const { hour, minute: min } = wallIn(ms, zone);
  return min === 0 ? `${hour} h` : `${hour} h ${String(min).padStart(2, '0')}`;
}

/** « 34 min », « 1 h 05 » : une durée de trajet arrondie à la minute. */
function duration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

function distance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${Math.round(meters / 100) / 10} km`.replace('.', ',');
}

/** « +9 min de trafic », ou « Trafic fluide » sous la minute ; null si le retard est inconnu. */
function delayText(data: TrajetData): string | null {
  if (data.delaySeconds === null) return null;
  return data.delaySeconds < 60 ? 'Trafic fluide' : `+${duration(data.delaySeconds)} de trafic`;
}

/** Les lignes communes à la carte et à l'affichage permanent. */
function lines(data: TrajetData): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = [];
  const delay = delayText(data);
  if (delay) items.push({ label: 'Trafic', value: delay });
  if (data.freeFlowSeconds !== null)
    items.push({ label: 'Sans trafic', value: duration(data.freeFlowSeconds) });
  items.push({ label: 'Distance', value: distance(data.distanceMeters) });
  return items;
}

/** Deux repères de démonstration à Bordeaux : à remplacer par le départ et l'arrivée réels. */
const defaultConfig: TrajetConfig = {
  origin: '44.841,-0.569',
  originLabel: 'Place de la Bourse, Bordeaux (exemple)',
  destination: '44.826,-0.556',
  destinationLabel: 'Gare Saint-Jean, Bordeaux (exemple)',
};

const addon: AddonDefinition<TrajetConfig, TrajetData> = {
  id: 'tempsdetrajet',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'TomTom',
  display: {
    name: 'Temps de trajet',
    description: 'Heure d’arrivée estimée d’un trajet en voiture, selon le trafic en direct.',
    icon: 'car',
    keywords: ['trajet', 'trafic', 'arrivée', 'route', 'travail', 'bouchon', 'embouteillage'],
    example: { label: 'Trajet vers le travail', ref: 'travail' },
    spoken: { head: 'le trajet', repeats: ['trajet'] },
  },
  secrets: [
    {
      name: 'tomtomKey',
      env: 'CORNELIUS_TOMTOM_KEY',
      label: 'une clé TomTom',
      url: 'https://developer.tomtom.com/',
      note: 'gratuit',
    },
  ],
  configVersion: 2,
  configSchema,
  configDefaults: defaultConfig,
  // Version 1 : quatre nombres. Les points sont arrondis comme ceux de la recherche (environ
  // 100 m). Si un nombre manque ou n'en est pas un, on revient aux repères de démonstration :
  // la personne refait la recherche, plutôt que de voir la migration échouer.
  configMigrate(fromVersion, config) {
    if (fromVersion >= 2) return config as TrajetConfig;
    const old = config as Partial<TrajetConfigV1>;
    const numbers = [
      old.originLatitude,
      old.originLongitude,
      old.destinationLatitude,
      old.destinationLongitude,
    ];
    if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value)))
      return { ...defaultConfig };
    const [oLat, oLon, dLat, dLon] = numbers as number[];
    return {
      origin: `${approximate(oLat!)},${approximate(oLon!)}`,
      originLabel: 'Départ',
      destination: `${approximate(dLat!)},${approximate(dLon!)}`,
      destinationLabel: 'Arrivée',
    };
  },
  search: {
    fields: [
      {
        kind: 'origin',
        label: 'Départ',
        target: 'origin',
        labelTarget: 'originLabel',
        placeholder: 'Adresse ou lieu de départ',
      },
      {
        kind: 'destination',
        label: 'Arrivée',
        target: 'destination',
        labelTarget: 'destinationLabel',
        placeholder: 'Adresse ou lieu d’arrivée',
      },
    ],
    async find(input, context) {
      const key = context.secret('tomtomKey');
      if (!key) throw new AddonCollectError('config_invalid', 'Clé TomTom manquante.');
      const query = (input.query ?? '').trim().slice(0, maxQueryLength).trim();
      if (query.length < 3) return [];
      const response = await guarded(
        () =>
          context.http.fetch({
            url:
              `${searchUrl}/${encodeURIComponent(query)}.json?key=${encodeURIComponent(key)}` +
              '&limit=6&countrySet=FR&language=fr-FR',
            method: 'GET',
            signal: context.signal,
            timeoutMs: 5000,
            maxBytes: 128 * 1024,
          }),
        context.signal,
      );
      if (response.status !== 200) failFor(response.status, 'Recherche d’adresse refusée.');
      let payload: unknown;
      try {
        payload = response.json();
      } catch {
        throw new AddonCollectError('malformed', 'Réponse de recherche illisible.');
      }
      if (!validateSearch(payload))
        throw new AddonCollectError('malformed', 'Réponse de recherche invalide.');
      const found = new Map<string, { id: string; label: string; detail?: string }>();
      for (const result of payload.results) {
        // Un résultat sans position exploitable est écarté : il n'est jamais deviné.
        if (!validateSearchResult(result)) continue;
        const id = `${approximate(result.position.lat)},${approximate(result.position.lon)}`;
        if (found.has(id)) continue;
        const address = clean(result.address?.freeformAddress);
        const name = clean(result.poi?.name);
        const label = (name && address ? `${name}, ${address}` : name || address).slice(0, 120);
        if (!label) continue;
        const city = clean(result.address?.municipality).slice(0, 80);
        found.set(id, { id, label, ...(city ? { detail: city } : {}) });
      }
      return [...found.values()];
    },
  },
  dataVersion: 1,
  dataSchema,
  // Cinq minutes : le trafic bouge, mais pas à chaque seconde, et le quota gratuit est mensuel.
  freshMs: 5 * minute,
  tools: [
    {
      name: 'read',
      description:
        'Lire l’heure d’arrivée estimée du trajet configuré, avec le trafic actuel, et afficher sa carte. ' +
        'Utiliser pour « à quelle heure j’arrive ? », « combien de temps pour aller au travail ? » ou « y a-t-il du trafic ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'], maxLength: 80 } },
      },
    },
  ],
  async collect(context) {
    const key = context.secret('tomtomKey');
    if (!key) throw new AddonCollectError('config_invalid', 'Clé TomTom manquante.');
    // Deux points relus et recomposés en nombres : aucune partie libre dans l'adresse.
    const origin = readPoint(context.config.origin);
    const destination = readPoint(context.config.destination);
    if (!origin || !destination)
      throw new AddonCollectError(
        'config_invalid',
        'Départ ou arrivée invalide : choisissez-les de nouveau dans la recherche d’adresse.',
      );
    const places = `${origin}:${destination}`;
    const query = [
      `key=${encodeURIComponent(key)}`,
      // Sans heure de départ, TomTom calcule pour maintenant, trafic en direct compris.
      'traffic=true',
      'travelMode=car',
      'routeType=fastest',
      // Demande aussi la durée sans trafic, pour dire de combien le trafic retarde.
      'computeTravelTimeFor=all',
    ].join('&');
    const response = await guarded(
      () =>
        context.http.fetch({
          url: `${baseUrl}/${places}/json?${query}`,
          method: 'GET',
          signal: context.signal,
          timeoutMs: 5000,
          maxBytes: 256 * 1024,
        }),
      context.signal,
    );
    if (response.status !== 200)
      failFor(
        response.status,
        'Itinéraire refusé : vérifiez le départ et l’arrivée dans les réglages.',
      );
    let payload: unknown;
    try {
      payload = response.json();
    } catch {
      throw new AddonCollectError('malformed', 'Réponse de TomTom illisible.');
    }
    if (!validatePayload(payload))
      throw new AddonCollectError('malformed', 'Itinéraire TomTom invalide.');
    const summary = payload.routes[0]!.summary;
    const freeFlow = summary.noTrafficTravelTimeInSeconds ?? null;
    // Le retard annoncé par TomTom, sinon l'écart avec la durée sans trafic, sinon inconnu.
    const delay =
      summary.trafficDelayInSeconds ??
      (freeFlow === null ? null : Math.max(0, summary.travelTimeInSeconds - freeFlow));
    return {
      data: {
        travelSeconds: summary.travelTimeInSeconds,
        freeFlowSeconds: freeFlow,
        delaySeconds: delay,
        distanceMeters: summary.lengthInMeters,
      },
      source: { provider: 'tomtom', sourceId: 'calculate-route' },
    };
  },
  ambient: {
    present(snapshot, context) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucun trajet à afficher.');
      const now = context.now();
      return {
        layout: 'metric',
        title: 'Trajet',
        // L'arrivée suit l'heure : durée du dernier relevé ajoutée à maintenant.
        value: `Arrivée ${clock(now + data.travelSeconds * 1000, context.timeZone)}`,
        subtitle: `${duration(data.travelSeconds)} en partant maintenant`,
        items: lines(data),
        // L'heure d'arrivée change à la minute suivante, sans nouvelle requête.
        refreshAt: new Date(now - (now % minute) + minute).toISOString(),
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun trajet à présenter.');
    const stale = snapshot.status === 'stale';
    const arrival = clock(context.now() + data.travelSeconds * 1000, context.timeZone);
    const trafficSpoken =
      data.delaySeconds === null
        ? ''
        : data.delaySeconds < 60
          ? ', sans retard dû au trafic'
          : `, dont ${duration(data.delaySeconds)} de trafic`;
    return {
      title: 'Trajet',
      primaryValue: `Arrivée vers ${arrival}`,
      subtitle: `${duration(data.travelSeconds)} en partant maintenant`,
      description: stale ? 'Dernier relevé connu, à vérifier.' : null,
      items: lines(data),
      summary: stale
        ? `Dernier relevé connu : en partant maintenant, arrivée vers ${arrival} (${duration(data.travelSeconds)} de route) ; à vérifier.`
        : `En partant maintenant, arrivée vers ${arrival} : ${duration(data.travelSeconds)} de route${trafficSpoken}.`,
      sources: ['tempsdetrajet'],
    };
  },
};

export default addon;
