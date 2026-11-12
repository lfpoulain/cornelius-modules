/** Vélos en libre-service : disponibilité d'une station, selon la norme ouverte GBFS. */
import { AddonCollectError, type AddonDefinition, type AddonHttpClient } from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type VelosConfig = {
  systemUrl: string;
  systemLabel: string;
  stationId: string;
  stationLabel: string;
};
type VelosData = {
  station: string;
  system: string;
  open: boolean;
  bikes: number;
  mechanical: number | null;
  electric: number | null;
  docks: number | null;
  reported: string | null;
};

type Json = Record<string, unknown>;

/** Catalogue public des réseaux GBFS, tenu par MobilityData. */
const catalogUrl = 'https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv';
// Canada : àVélo (Québec), BIXI (Montréal), Accès Vélo (Saguenay), Bike Share Toronto, Mobi…
const countries = new Set(['FR', 'BE', 'CH', 'LU', 'MC', 'CA']);
/**
 * Autopartage de voitures et engins sans station : le catalogue les mêle aux vélos, mais
 * ils n'ont pas de station où lire une disponibilité.
 */
const excluded =
  /citiz|citedia|citédia|marguerite|getaround|leo\s*(and|&)\s*go|zity|free2move|ubeeqo|communauto|marcel|clem|share\s*now|bird|dott|lime|tier|voi\b|pony|cooltra|yego|felyx|cityscoot/iu;
/** Plateformes d'autopartage de voitures, quel que soit le nom du service qu'elles portent. */
const carSharingHosts = /(^|\.)(citiz\.fr|getaround\.com)$/iu;

const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/**
 * Durée de partage des réponses dans le cache du cœur : plusieurs sources d'un même réseau,
 * et chaque recherche, relisent le même fichier (450 Ko pour l'état des stations Vélib').
 */
const shared = {
  discovery: 10 * 60_000,
  catalog: 10 * 60_000,
  stations: 10 * 60_000,
  status: 30_000,
};

async function getText(
  http: AddonHttpClient,
  url: string,
  signal: AbortSignal | undefined,
  what: string,
  cacheMs: number,
): Promise<string> {
  const response = await http.fetch({
    url,
    method: 'GET',
    signal,
    timeoutMs: 10_000,
    maxBytes: 4 * 1024 * 1024,
    cacheMs,
  });
  if (response.status === 404) throw new AddonCollectError('not_found', `${what} introuvable.`);
  if (response.status === 401 || response.status === 403)
    throw new AddonCollectError('forbidden', `${what} : accès refusé par le réseau.`);
  if (response.status === 429)
    throw new AddonCollectError('quota', `${what} : trop de demandes, réessayer plus tard.`, true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', `${what} : le réseau ne répond pas.`, true);
  if (response.status !== 200)
    throw new AddonCollectError(
      'upstream',
      `${what} : réponse HTTP ${response.status} inattendue.`,
    );
  return response.text();
}

async function getJson(
  http: AddonHttpClient,
  url: string,
  signal: AbortSignal | undefined,
  what: string,
  cacheMs: number,
): Promise<Json> {
  const text = await getText(http, url, signal, what, cacheMs);
  try {
    return record(JSON.parse(text));
  } catch {
    throw new AddonCollectError('malformed', `${what} : réponse illisible.`);
  }
}

/** Flux annoncés par gbfs.json : liste directe en 3.0, par langue (fr de préférence) en 2.x. */
async function discover(http: AddonHttpClient, url: string, signal: AbortSignal | undefined) {
  const data = record((await getJson(http, url, signal, 'Réseau', shared.discovery)).data);
  const byLanguage = record(
    data.fr ?? data[Object.keys(data).find((key) => key !== 'feeds') ?? ''],
  );
  const feeds = list(data.feeds ?? byLanguage.feeds).map(record);
  const feed = (name: string) => {
    const found = feeds.find((entry) => entry.name === name)?.url;
    return typeof found === 'string' ? found : null;
  };
  return { feed };
}

/** Nom d'une station : texte simple en 2.x, liste de traductions en 3.0. */
function stationName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const names = list(value).map(record);
  const pick = names.find((name) => name.language === 'fr') ?? names[0];
  return typeof pick?.text === 'string' ? pick.text.trim() || null : null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/** Lecture d'une ligne CSV, guillemets et virgules internes compris. */
function csvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/**
 * Vélos électriques : par les types de véhicules (3.0, et 2.x récents) quand le réseau
 * les décrit, sinon par le champ propre à Vélib'. Inconnus, ils restent null.
 */
function split(
  status: Json,
  propulsion: Map<string, string>,
): { mechanical: number | null; electric: number | null } {
  const available = list(status.vehicle_types_available).map(record);
  if (available.length && propulsion.size) {
    let mechanical = 0;
    let electric = 0;
    for (const entry of available) {
      const n = count(entry.count) ?? 0;
      const type = propulsion.get(String(entry.vehicle_type_id));
      if (type === undefined) return { mechanical: null, electric: null };
      if (type === 'human') mechanical += n;
      else electric += n;
    }
    return { mechanical, electric };
  }
  const types = list(status.num_bikes_available_types).map(record);
  if (types.length) {
    const sum = (key: string) =>
      types.reduce((total, entry) => total + (count(entry[key]) ?? 0), 0);
    return { mechanical: sum('mechanical'), electric: sum('ebike') };
  }
  return { mechanical: null, electric: null };
}

function reportedAt(value: unknown): string | null {
  const ms =
    typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const plural = (n: number, word: string) => `${n === 0 ? 'aucun' : n} ${word}${n > 1 ? 's' : ''}`;

const addon: AddonDefinition<VelosConfig, VelosData> = {
  id: 'velos',
  apiVersion: 1,
  version: '1.2.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Vélos en libre-service',
  display: {
    name: 'Vélos en libre-service',
    description:
      'Vélos et places libres d’une station : Vélib’, V’Lille, Vélo’v, STAR, TBM, BIXI, àVélo…',
    icon: 'bike',
    keywords: ['vélo', 'vélib', 'libre-service', 'station', 'gbfs', 'v’lille', 'vélo’v', 'star'],
    example: { label: 'Vélos de la maison', ref: 'maison' },
    spoken: { head: 'les vélos', repeats: ['velos', 'velo', 'velib', 'station'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: {
    systemUrl: 'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json',
    systemLabel: 'Vélib’ Métropole',
    stationId: '213688169',
    stationLabel: 'Benjamin Godard - Victor Hugo',
  },
  dataVersion: 1,
  dataSchema,
  // Une station change de minute en minute : relue au plus toutes les deux minutes.
  freshMs: 2 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les vélos et les places libres de la station de vélos en libre-service configurée ' +
        'et afficher sa carte. Utiliser pour « il reste des vélos à la station ? » ou ' +
        '« je peux reposer mon vélo ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  search: {
    fields: [
      {
        kind: 'system',
        label: 'Réseau',
        target: 'systemUrl',
        labelTarget: 'systemLabel',
        placeholder: 'Ville ou nom du réseau',
      },
      {
        kind: 'station',
        label: 'Station',
        target: 'stationId',
        labelTarget: 'stationLabel',
        dependsOn: 'systemUrl',
        placeholder: 'Nom de la station',
      },
    ],
    async find(input, context) {
      const query = normalize(input.query ?? '');
      if (query.length < 2) return [];
      if (input.kind === 'system') {
        const lines = (
          await getText(
            context.http,
            catalogUrl,
            context.signal,
            'Catalogue des réseaux',
            shared.catalog,
          )
        )
          .split(/\r?\n/u)
          .filter(Boolean);
        const header = csvRow(lines[0] ?? '');
        const column = (name: string) => header.indexOf(name);
        const [country, name, location, url] = [
          column('Country Code'),
          column('Name'),
          column('Location'),
          column('Auto-Discovery URL'),
        ];
        return lines
          .slice(1)
          .map(csvRow)
          .filter((row) => countries.has(row[country] ?? '') && !excluded.test(row[name] ?? ''))
          .filter((row) => /^https:\/\//u.test(row[url] ?? ''))
          .filter((row) => !carSharingHosts.test(new URL(row[url]!).hostname))
          .filter((row) => normalize(`${row[name]} ${row[location]}`).includes(query))
          .slice(0, 12)
          .map((row) => ({ id: row[url]!, label: row[name]!, detail: row[location] || undefined }));
      }
      if (input.kind === 'station') {
        const systemUrl = input.values.systemUrl;
        if (typeof systemUrl !== 'string' || !/^https:\/\//u.test(systemUrl)) return [];
        const { feed } = await discover(context.http, systemUrl, context.signal);
        const infoUrl = feed('station_information');
        if (!infoUrl)
          throw new AddonCollectError(
            'not_found',
            'Ce réseau n’a pas de stations : vélos ou engins en libre accès.',
          );
        const stations = list(
          record(
            (await getJson(context.http, infoUrl, context.signal, 'Stations', shared.stations))
              .data,
          ).stations,
        ).map(record);
        return stations
          .map((station) => ({ station, name: stationName(station.name) }))
          .filter((entry) => entry.name && normalize(entry.name).includes(query))
          .slice(0, 12)
          .map(({ station, name }) => ({
            id: String(station.station_id),
            label: name!,
            detail:
              [
                typeof station.address === 'string' ? station.address : null,
                count(station.capacity) !== null ? `${station.capacity} places` : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined,
          }));
      }
      return [];
    },
  },
  async collect(context) {
    const { systemUrl, systemLabel, stationId, stationLabel } = context.config;
    const { feed } = await discover(context.http, systemUrl, context.signal);
    const statusUrl = feed('station_status');
    if (!statusUrl)
      throw new AddonCollectError('not_found', 'Ce réseau ne publie pas l’état de ses stations.');
    const typesUrl = feed('vehicle_types');
    const [status, types] = await Promise.all([
      getJson(context.http, statusUrl, context.signal, 'État des stations', shared.status),
      typesUrl
        ? getJson(context.http, typesUrl, context.signal, 'Types de vélos', shared.discovery).catch(
            () => ({}),
          )
        : {},
    ]);
    const stations = list(record(status.data).stations).map(record);
    if (!stations.length)
      throw new AddonCollectError('malformed', 'État des stations : réponse inattendue.');
    const station = stations.find((entry) => String(entry.station_id) === stationId);
    if (!station)
      throw new AddonCollectError('not_found', 'Station introuvable : la chercher à nouveau.');
    const propulsion = new Map(
      list(record(record(types).data).vehicle_types)
        .map(record)
        .map(
          (type) =>
            [String(type.vehicle_type_id), String(type.propulsion_type ?? 'human')] as const,
        ),
    );
    const bikes = count(station.num_vehicles_available) ?? count(station.num_bikes_available);
    if (bikes === null) throw new AddonCollectError('malformed', 'État de la station illisible.');
    // 2.x écrit 0 et 1, 3.0 des booléens.
    const flag = (value: unknown) => value === true || value === 1;
    return {
      data: {
        station: stationLabel,
        system: systemLabel,
        open: flag(station.is_installed) && flag(station.is_renting),
        bikes,
        ...split(station, propulsion),
        docks: count(station.num_docks_available),
        reported: reportedAt(station.last_reported),
      },
      source: { provider: new URL(systemUrl).hostname, sourceId: stationId },
    };
  },
  ambient: {
    present(snapshot) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucune station à afficher.');
      return {
        layout: 'metric',
        title: 'Vélos',
        value: data.open ? capitalize(plural(data.bikes, 'vélo')) : 'Fermée',
        subtitle: data.station.slice(0, 120),
        items: data.open
          ? [
              ...(data.electric !== null
                ? [{ label: 'Électriques', value: String(data.electric) }]
                : []),
              ...(data.docks !== null
                ? [{ label: 'Places libres', value: String(data.docks) }]
                : []),
            ]
          : [],
      };
    },
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune station à présenter.');
    const stale = snapshot.status === 'stale';
    const items: { label: string; value: string }[] = [];
    if (data.mechanical !== null)
      items.push({ label: 'Mécaniques', value: String(data.mechanical) });
    if (data.electric !== null) items.push({ label: 'Électriques', value: String(data.electric) });
    if (data.docks !== null) items.push({ label: 'Places libres', value: String(data.docks) });
    let spoken: string;
    if (!data.open) spoken = `La station ${data.station} est fermée pour le moment.`;
    else {
      const electric = data.electric
        ? `, dont ${data.electric} électrique${data.electric > 1 ? 's' : ''}`
        : '';
      const docks =
        data.docks === null
          ? ''
          : ` et ${data.docks === 0 ? 'aucune place libre' : `${data.docks} place${data.docks > 1 ? 's' : ''} libre${data.docks > 1 ? 's' : ''}`}`;
      spoken = `Station ${data.station} : ${plural(data.bikes, 'vélo')}${data.bikes ? electric : ''}${docks}.`;
    }
    return {
      title: `Vélos · ${data.system}`.slice(0, 80),
      primaryValue: data.open ? capitalize(plural(data.bikes, 'vélo')) : 'Station fermée',
      subtitle: data.station.slice(0, 120),
      description: stale ? 'Dernier état connu : la station a pu changer depuis.' : null,
      items: data.open ? items : [],
      summary: (stale ? 'D’après le dernier état connu, à vérifier. ' : '') + spoken,
      sources: ['velos'],
    };
  },
};

export default addon;
