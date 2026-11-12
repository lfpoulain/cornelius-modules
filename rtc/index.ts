/**
 * Trajets en autobus du RTC (Québec) : le trajet vient de Transitous (horaires officiels du RTC),
 * puis l'heure réelle du prochain passage à l'arrêt vient des données temps réel de l'appli Nomade
 * du RTC. Si le temps réel ne répond pas, l'horaire prévu est dit comme tel.
 */
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

type Favori = { nom: string; dit: string; adresse: string };
type RtcConfig = {
  depart: string;
  adresseDepart?: string;
  latitude?: number | null;
  longitude?: number | null;
  favoris: Favori[];
};
type Depart = { heure: string; reel: boolean };
type RtcData = {
  vers: string;
  destination: string;
  ligne: string;
  direction: string;
  arret: string;
  noArret: string;
  marcheMin: number;
  dureeMin: number;
  correspondances: string[];
  departs: Depart[];
};

const transitous = 'https://api.transitous.org/api';
const rtc = 'https://api-iv.rtcquebec.ca/api/legacy';
/** Identification honnête : ce module ne se fait pas passer pour l'appli Nomade. */
const headers = {
  'User-Agent': 'Cornelius-module-rtc/1.0 (usage personnel)',
  Accept: 'application/json',
};
const validateData = compile<RtcData>(dataSchema);

/** Environ 100 m : assez pour un trajet, sans la position exacte du domicile. */
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const minutes = (ms: number) => Math.round(ms / 60_000);
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

type Context = AddonCollectContext<RtcConfig>;

async function getJson(
  context: Context,
  url: string,
  label: string,
  extra: { timeoutMs?: number; cacheMs?: number; maxBytes?: number } = {},
) {
  const response = await context.http.fetch({
    url,
    method: 'GET',
    headers,
    signal: context.signal,
    timeoutMs: extra.timeoutMs ?? 6000,
    maxBytes: extra.maxBytes ?? 512 * 1024,
    cacheMs: extra.cacheMs,
  });
  if (response.status === 429)
    throw new AddonCollectError('quota', `${label} limite les demandes pour le moment.`, true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', `${label} est indisponible.`, true);
  if (response.status !== 200)
    throw new AddonCollectError(
      'upstream',
      `Réponse HTTP ${response.status} inattendue de ${label}.`,
    );
  try {
    return response.json() as unknown;
  } catch {
    throw new AddonCollectError('malformed', `Réponse illisible de ${label}.`);
  }
}

/** La destination : un favori nommé dans la demande, sinon la demande telle quelle. */
export function destinationFor(
  config: RtcConfig,
  query: string | undefined,
): { vers: string; adresse: string } {
  if (!query) {
    const first = config.favoris[0];
    if (!first)
      throw new AddonCollectError(
        'config_invalid',
        'Ajoutez au moins une destination favorite pour tester.',
      );
    return { vers: first.dit, adresse: first.adresse };
  }
  const asked = ` ${plain(query)} `;
  const favori = config.favoris.find((f) => asked.includes(` ${plain(f.nom)} `));
  if (favori) return { vers: favori.dit, adresse: favori.adresse };
  const text = query.replace(/\s+/g, ' ').trim().slice(0, 150);
  // Dit sans la ville ni le reste après la virgule : « au 2325 rue de l’Université ».
  const dit = text.split(',')[0]!.trim() || text;
  // « au Château Frontenac » se dit tel quel, mais se cherche sans la préposition.
  const article = /^(?:à la|à l[’']|à|au|aux)\s*/iu.exec(text);
  if (article && article[0].length < text.length)
    return { vers: dit, adresse: text.slice(article[0].length) };
  return { vers: /^chez\s/iu.test(dit) ? dit : `à ${dit}`, adresse: text };
}

const motsGeneriques = new Set(
  'rue avenue av boulevard boul bd chemin ch place rang route montee cote terrasse croissant allee promenade autoroute de du des la le les l d et est ouest nord sud e o'.split(
    ' ',
  ),
);

/**
 * Avec un numéro civique, le résultat doit être sur la rue demandée : sinon le géocodeur remplace
 * une adresse qu'il ne connaît pas par une voisine d'orthographe (vu à Montréal : « 1500 rue
 * Berri » → « 1500 Rue Serre », à l'autre bout de la ville), sans le dire.
 */
export function surLaRue(adresse: string, resultat: Record<string, unknown>): boolean {
  const sansVille = adresse.split(',')[0]!;
  const nom = ` ${plain(`${resultat.street ?? ''} ${resultat.name ?? ''}`)} `;
  const contient = (texte: string) =>
    plain(texte)
      .split(' ')
      .filter((w) => w.length > 1 && !motsGeneriques.has(w))
      .every((w) => nom.includes(` ${w} `));
  const civique = /^\s*\d+[a-z]?\s+(.+)$/iu.exec(sansVille);
  if (civique) return contient(civique[1]!);
  // Une intersection (« 1re Avenue et 41e Rue ») : les deux rues, pas une voisine.
  const rues = sansVille.split(/\s+et\s+|\s*\/\s*/iu);
  if (rues.length === 2) return rues.every(contient);
  return true;
}

/** Ville ajoutée à une adresse qui n'en a pas, si la première recherche ne donne rien. */
const ville = 'Québec';

async function geocode(context: Context, adresse: string, near: string) {
  // Le géocodeur est mondial : un homonyme lointain peut sortir en premier. On garde le premier
  // résultat à moins de 80 km du départ, et qui correspond bien à l'adresse demandée.
  const [lat0, lon0] = near.split(',').map(Number) as [number, number];
  const proche = (r: Record<string, unknown>) =>
    typeof r.lat === 'number' &&
    typeof r.lon === 'number' &&
    Math.hypot(r.lat - lat0, (r.lon - lon0) * Math.cos((lat0 * Math.PI) / 180)) * 111 < 80;
  for (const text of adresse.includes(',') ? [adresse] : [adresse, `${adresse}, ${ville}`]) {
    // Le géocodeur ne reconnaît pas l'apostrophe typographique : « Carrefour de l’Estrie »
    // donnait des « Carrefour » en France, « Carrefour de l'Estrie » le bon lieu.
    const params = new URLSearchParams({
      text: text.replace(/[’‘]/gu, "'"),
      language: 'fr',
      place: near,
    });
    const results = await getJson(context, `${transitous}/v1/geocode?${params}`, 'Transitous', {
      cacheMs: 10 * 60_000,
    });
    const first = Array.isArray(results)
      ? (results as Record<string, unknown>[]).find((r) => proche(r) && surLaRue(adresse, r))
      : undefined;
    if (!first) continue;
    const name =
      [first.houseNumber, first.street ?? first.name].filter(Boolean).join(' ') ||
      String(first.name ?? adresse);
    return { lat: first.lat as number, lon: first.lon as number, name: name.slice(0, 160) };
  }
  throw new AddonCollectError(
    'not_found',
    `Adresse introuvable : ${adresse.slice(0, 120)}. Essayez une intersection proche (« 1re Avenue et 41e Rue ») ou un lieu connu.`,
  );
}

type Leg = Record<string, any>;

/** Centre de Québec : point de recherche de l'adresse de départ. */
const region = '46.813,-71.208';

/**
 * Le départ, arrondi à ~100 m : les coordonnées si le client les a saisies (elles priment), sinon
 * l'adresse réglée, trouvée par Transitous.
 */
async function origine(context: Context): Promise<string> {
  const { adresseDepart, latitude, longitude } = context.config;
  if (typeof latitude === 'number' && typeof longitude === 'number')
    return `${rounded(latitude)},${rounded(longitude)}`;
  if (adresseDepart?.trim()) {
    const lieu = await geocode(context, adresseDepart.trim(), region);
    return `${rounded(lieu.lat)},${rounded(lieu.lon)}`;
  }
  throw new AddonCollectError('config_invalid', 'Indiquez l’adresse du départ.');
}

/** Premier tronçon en transport d'un itinéraire, avec la marche qui le précède. */
function firstRide(itinerary: Leg) {
  const legs: Leg[] = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  const index = legs.findIndex((leg) => leg.mode && leg.mode !== 'WALK');
  if (index < 0) return null;
  const ride = legs[index]!;
  const walk = legs.slice(0, index).reduce((sum, leg) => sum + (Number(leg.duration) || 0), 0);
  const stopId = String(ride.from?.stopId ?? '');
  return {
    ligne: String(ride.routeShortName ?? '').trim(),
    direction: String(ride.headsign ?? '').trim(),
    arret: String(ride.from?.name ?? '').trim(),
    stopId,
    // Arrêts du RTC chez Transitous : « ca-qc-RTC_1-2857 » ; 2857 est le numéro de l'arrêt.
    noArret: stopId.startsWith('ca-qc-RTC_') ? (stopId.split('-').pop() ?? '') : '',
    depart: String(ride.scheduledStartTime ?? ride.startTime ?? ''),
    marcheMin: minutes(walk * 1000),
    autres: legs
      .slice(index + 1)
      .filter((leg) => leg.mode && leg.mode !== 'WALK')
      .map((leg) => String(leg.routeShortName ?? '').trim())
      .filter(Boolean),
  };
}

/** Passages réels de la ligne à l'arrêt, d'après les autobus en route (appli Nomade du RTC). */
async function realtime(context: Context, ligne: string, noArret: string) {
  const routes = await getJson(context, `${rtc}/ListeParcours?source=appmobileios`, 'Le RTC', {
    cacheMs: 10 * 60_000,
  });
  const route = Array.isArray(routes)
    ? (routes as Leg[]).find((r) => String(r.noParcours) === ligne)
    : undefined;
  if (!route) return { heures: [] as number[], arret: null as string | null };
  const buses: Leg[] = [];
  for (const code of [route.codeDirectionPrincipale, route.codeDirectionRetour]) {
    if (code === undefined || code === null) continue;
    const params = new URLSearchParams({
      source: 'appmobile',
      noParcours: ligne,
      codeDirection: String(code),
    });
    const list = await getJson(context, `${rtc}/ListeAutobus_Parcours?${params}`, 'Le RTC', {
      timeoutMs: 5000,
    });
    if (Array.isArray(list)) buses.push(...(list as Leg[]).slice(0, 15));
  }
  const heures: number[] = [];
  let arret: string | null = null;
  // Quatre lectures à la fois au plus : le RTC n'est pas sollicité plus qu'une appli.
  for (let start = 0; start < buses.length; start += 4) {
    const batch = buses.slice(start, start + 4).map(async (bus) => {
      const params = new URLSearchParams({
        source: 'appmobileios',
        idVoyage: String(bus.idVoyage),
        idAutobus: String(bus.idAutobus),
      });
      const stops = await getJson(context, `${rtc}/ListeHoraire_Autobus?${params}`, 'Le RTC', {
        timeoutMs: 5000,
      });
      if (!Array.isArray(stops)) return;
      for (const stop of stops as Leg[]) {
        if (String(stop.arret?.noArret) !== noArret) continue;
        const at = Date.parse(String(stop.horaire));
        if (Number.isFinite(at)) heures.push(at);
        if (!arret && typeof stop.arret?.description === 'string') arret = stop.arret.description;
      }
    });
    await Promise.all(batch);
  }
  return { heures: [...new Set(heures)].sort((a, b) => a - b), arret };
}

async function collect(context: Context) {
  const { config } = context;
  const from = await origine(context);
  const { vers, adresse } = destinationFor(config, context.query);
  const target = await geocode(context, adresse, from);
  const params = new URLSearchParams({
    fromPlace: from,
    toPlace: `${rounded(target.lat)},${rounded(target.lon)}`,
    numItineraries: '5',
    time: new Date(context.now()).toISOString(),
  });
  const plan = (await getJson(context, `${transitous}/v5/plan?${params}`, 'Transitous', {
    timeoutMs: 10_000,
    maxBytes: 2 * 1024 * 1024,
  })) as Leg;
  const itineraries: Leg[] = Array.isArray(plan?.itineraries) ? plan.itineraries : [];
  const withRide = itineraries
    .map((itinerary) => ({ itinerary, ride: firstRide(itinerary) }))
    .filter((entry): entry is { itinerary: Leg; ride: NonNullable<ReturnType<typeof firstRide>> } =>
      Boolean(entry.ride?.ligne),
    );
  // Le trajet qui arrive le plus tôt, pas le premier proposé par Transitous.
  const fin = (entry: { itinerary: Leg }) => {
    const at = Date.parse(String(entry.itinerary.endTime ?? ''));
    return Number.isFinite(at) ? at : Infinity;
  };
  const best = [...withRide].sort((a, b) => fin(a) - fin(b))[0];
  if (!best) throw new AddonCollectError('not_found', `Aucun trajet en autobus trouvé ${vers}.`);
  const { ride } = best;
  // Horaire prévu : les autres itinéraires qui prennent la même ligne au même arrêt.
  // Deux itinéraires peuvent prendre le même autobus : une heure n'est gardée qu'une fois.
  const prevus = [
    ...new Set(
      withRide
        .filter((entry) => entry.ride.ligne === ride.ligne && entry.ride.stopId === ride.stopId)
        .map((entry) => Date.parse(entry.ride.depart))
        .filter(Number.isFinite),
    ),
  ].sort((a, b) => a - b);
  let reels: number[] = [];
  let arret = ride.arret;
  if (ride.noArret) {
    try {
      const live = await realtime(context, ride.ligne, ride.noArret);
      reels = live.heures.filter((at) => at >= context.now() - 30_000);
      if (live.arret) arret = live.arret;
    } catch (error) {
      // Le temps réel est un plus : sans lui, l'horaire prévu reste dit comme tel.
      if (context.signal.aborted) throw error;
    }
  }
  const lastReal = reels.length ? reels[reels.length - 1]! : -Infinity;
  const departs: Depart[] = [
    ...reels.map((at) => ({ heure: new Date(at).toISOString(), reel: true })),
    ...prevus
      .filter((at) => at > lastReal + 3 * 60_000 && at >= context.now() - 30_000)
      .map((at) => ({ heure: new Date(at).toISOString(), reel: false })),
  ].slice(0, 6);
  const data: RtcData = {
    vers: vers.slice(0, 80),
    destination: target.name,
    ligne: ride.ligne.slice(0, 16),
    direction: ride.direction.slice(0, 120),
    arret: (arret || ride.noArret || 'arrêt').slice(0, 120),
    noArret: (ride.noArret || '?').slice(0, 16),
    marcheMin: Math.min(240, ride.marcheMin),
    dureeMin: Math.max(1, Math.min(600, minutes((Number(best.itinerary.duration) || 60) * 1000))),
    correspondances: ride.autres.slice(0, 4).map((l) => l.slice(0, 16)),
    departs,
  };
  if (!validateData(data)) throw new AddonCollectError('malformed', 'Trajet RTC incohérent.');
  return {
    data,
    empty: departs.length === 0,
    freshMs: 60_000,
    source: { provider: 'rtc', sourceId: `${data.ligne}:${data.noArret}` },
  };
}

const heure = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('fr-CA', { hour: 'numeric', minute: '2-digit', timeZone })
    .format(new Date(at))
    .replace(':', ' h ');

function dans(ms: number): string {
  const m = minutes(ms);
  if (m <= 0) return 'dans moins d’une minute';
  return `dans ${m} minute${m > 1 ? 's' : ''}`;
}

/** « H.-Mercier / D'Aiguillon » se dit « H.-Mercier et D'Aiguillon ». */
const arretDit = (arret: string) => arret.replace(/\s*\/\s*/g, ' et ');

function present(
  snapshot: ModuleSnapshot<RtcData>,
  context: AddonPresentContext,
): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucun trajet à présenter.');
  const now = context.now();
  // Un autobus qu'on ne peut plus attraper à pied n'est pas « le prochain ».
  const atteignables = data.departs
    .map((d) => ({ at: Date.parse(d.heure), reel: d.reel }))
    .filter((d) => d.at >= now + data.marcheMin * 60_000 - 30_000);
  const [prochain, suivant] = atteignables;
  const lieu = `à l’arrêt ${arretDit(data.arret)}${data.marcheMin ? `, à ${data.marcheMin} minute${data.marcheMin > 1 ? 's' : ''} à pied` : ''}`;
  const correspondance = data.correspondances.length
    ? ` Correspondance avec le ${data.correspondances.join(', puis le ')}.`
    : '';
  const summary = prochain
    ? `Pour te rendre ${data.vers}, le prochain autobus est le ${data.ligne} ${dans(prochain.at - now)}${prochain.reel ? '' : ' selon l’horaire'}, ${lieu}. ` +
      `La durée du trajet est de ${data.dureeMin} minutes.${correspondance}` +
      (suivant
        ? ` Le bus suivant est prévu ${dans(suivant.at - now)}${suivant.reel ? '' : ' selon l’horaire'}.`
        : '')
    : `Pour te rendre ${data.vers}, je ne trouve pas de ${data.ligne} à attraper dans l’heure ${lieu}. La durée du trajet est de ${data.dureeMin} minutes.`;
  return {
    title: `Transports RTC · ${data.vers}`.slice(0, 80),
    primaryValue: prochain
      ? `${data.ligne} ${dans(prochain.at - now).replace('dans ', 'dans ')}`.slice(0, 120)
      : null,
    subtitle: `${arretDit(data.arret)} → ${data.destination}`.slice(0, 120),
    description: snapshot.status === 'stale' ? 'Dernier relevé connu, à vérifier.' : null,
    items: [
      ...atteignables.slice(0, 3).map((d) => ({
        label: `${data.ligne} ${data.direction}`.slice(0, 80),
        value: `${heure(d.at, context.timeZone)} · ${d.reel ? 'temps réel' : 'horaire prévu'}`,
      })),
      {
        label: 'Durée du trajet',
        value: `${data.dureeMin} min, dont ${data.marcheMin} min à pied`,
      },
    ],
    summary: summary.slice(0, 500),
    sources: ['rtc'],
  };
}

const addon: AddonDefinition<RtcConfig, RtcData> = {
  id: 'rtc',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'RTC Québec (Transitous et temps réel Nomade)',
  display: {
    // « Transports RTC » : rangé à côté de « Transports » (Île-de-France) dans l'administration.
    name: 'Transports RTC',
    description:
      'Prochain autobus du RTC vers une destination, à l’heure réelle, et durée du trajet.',
    icon: 'bus',
    keywords: ['autobus', 'bus', 'rtc', 'trajet', 'transport', 'québec', 'métrobus'],
    example: { label: 'Depuis la maison', ref: 'maison' },
    spoken: { head: 'le trajet', repeats: ['trajet', 'autobus', 'bus'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { depart: 'la maison', favoris: [] },
  dataVersion: 1,
  dataSchema,
  freshMs: 60_000,
  tools: [
    {
      name: 'trajet',
      description:
        'Trouver le prochain autobus du RTC (Québec) depuis le point de départ de la source vers une destination, avec l’heure réelle du passage à l’arrêt, la durée du trajet et le bus suivant. Affiche la carte Transports RTC. ' +
        'Utiliser pour « comment je vais au travail ? », « c’est quand le prochain bus pour Place Laurier ? ». ' +
        'query : la destination seulement, soit le mot-clé d’une destination favorite (« travail »), soit une adresse ou un lieu à Québec, précédé de sa préposition (« au Château Frontenac », « à l’Université Laval »). ' +
        'Si la personne nomme un lieu dont tu as mémorisé l’adresse (« chez Marie »), passe cette adresse. La réponse prend quelques secondes. ' +
        'Dis toujours les trois éléments du résultat, dans l’ordre, sans en omettre : le prochain autobus et dans combien de minutes, la durée du trajet, puis le bus suivant.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef', 'query'],
        properties: { instanceRef: { type: ['string', 'null'] }, query: { type: 'string' } },
      },
      query: { maxLength: 200 },
    },
  ],
  collect,
  present,
};

export default addon;
