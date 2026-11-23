/**
 * Trajets en transport en commun d'après Transitous (https://transitous.org), sans jeton :
 * géocodage, itinéraire et passages à l'arrêt, horaires GTFS et temps réel publiés par chaque
 * réseau. Partagé par les modules de transport du Québec (STM, RTC, STO, STS) : chaque module
 * donne sa région, la façon de dire son réseau et ce qui lui est propre (avis, temps réel).
 *
 * Une donnée absente n'est jamais inventée : sans durée chez Transitous, aucune durée n'est dite ;
 * sans passage trouvé, aucun départ n'est promis.
 */
import {
  AddonCollectError,
  type AddonCollectContext,
  type AddonPresentation,
  type AddonPresentContext,
  type ModuleSnapshot,
} from '#cornelius/addons';
import { compile } from '#cornelius/validation';

export type Favori = { nom: string; dit: string; adresse: string };
export type TrajetConfig = {
  adresseDepart?: string;
  latitude?: number | null;
  longitude?: number | null;
  favoris: Favori[];
};
export type Depart = { heure: string; reel: boolean };
export type TrajetData = {
  vers: string;
  destination: string;
  vehicule: string;
  ligne: string;
  direction: string;
  arret: string;
  marcheMin: number;
  /** Durée de l'itinéraire, null si Transitous ne la donne pas. */
  dureeMin: number | null;
  correspondances: string[];
  departs: Depart[];
  /** Avis du réseau sur la ligne, dits à la fin. */
  avis?: string[];
  /** Précision affichée sur la carte (« horaire seulement… »), jamais dite. */
  remarque?: string;
};
/** Un tronçon, un arrêt ou un résultat de Transitous, lu champ par champ. */
export type Leg = Record<string, any>;
/** Un passage prévu à l'arrêt, avant le temps réel propre au réseau. */
export type Passage = { prevu: number; reel: boolean; tripId: string };
export type Context = AddonCollectContext<TrajetConfig>;

/** Ce qui distingue un réseau des autres. */
export interface Reseau {
  /** Identifiant du module (« sto »), cité dans les sources de la carte. */
  id: string;
  /** Sigle du réseau (« STO ») : « Transports STO », « Avis STO ». */
  sigle: string;
  /** Ville ajoutée à une adresse qui n'en a pas, au deuxième essai du géocodage. */
  ville: string;
  /** Centre de la région (« lat,lon ») : point de recherche de l'adresse de départ. */
  centre: string;
  /** Le réseau dit après le véhicule (« du RTL ») ; '' pour le réseau du module. */
  reseauDit(leg: Leg): string;
  /** Le véhicule dit autrement que par défaut (le REM, l'O-Train), sinon undefined. */
  vehicule?(leg: Leg): string | undefined;
  /** Heures réelles d'une source propre au réseau, une par passage (undefined : l'horaire). */
  tempsReel?(
    context: Context,
    passages: Passage[],
    stopId: string,
  ): Promise<(number | undefined)[]>;
  /** Avis du réseau et remarque de la carte, pour le premier tronçon. */
  complement?(
    context: Context,
    trajet: { ligne: string; stopId: string },
  ): Promise<{ avis?: string[]; remarque?: string }>;
  /** Début des avis dits à la voix (« Avis de la STM »). */
  avisDit?: string;
}

export const transitous = 'https://api.transitous.org/api';

/** Schéma des données gardées, commun aux modules de transport. */
export const trajetSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'TrajetData v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'vers',
    'destination',
    'vehicule',
    'ligne',
    'direction',
    'arret',
    'marcheMin',
    'dureeMin',
    'correspondances',
    'departs',
  ],
  properties: {
    vers: { type: 'string', minLength: 1, maxLength: 80 },
    destination: { type: 'string', minLength: 1, maxLength: 160 },
    vehicule: { type: 'string', minLength: 1, maxLength: 80 },
    ligne: { type: 'string', minLength: 1, maxLength: 40 },
    direction: { type: 'string', maxLength: 120 },
    arret: { type: 'string', minLength: 1, maxLength: 120 },
    marcheMin: { type: 'integer', minimum: 0, maximum: 240 },
    dureeMin: { type: ['integer', 'null'], minimum: 1, maximum: 600 },
    correspondances: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    departs: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heure', 'reel'],
        properties: {
          heure: { type: 'string', format: 'date-time' },
          reel: { type: 'boolean' },
        },
      },
    },
    avis: {
      type: 'array',
      maxItems: 2,
      items: { type: 'string', minLength: 1, maxLength: 200 },
    },
    remarque: { type: 'string', minLength: 1, maxLength: 160 },
  },
} as const;
const validateData = compile<TrajetData>(trajetSchema);

/** Environ 100 m : assez pour un trajet, sans la position exacte du domicile. */
export const rounded = (value: number) => Math.round(value * 1000) / 1000;
const minutes = (ms: number) => Math.round(ms / 60_000);
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** « Carrefour de l'Estrie » (GTFS, géocodeur) → « Carrefour de l’Estrie », pour l'oral et la carte. */
export const typo = (text: string) => text.replace(/'/gu, '’');

/** « 1 minute », « 4 minutes ». */
export const minutesDit = (n: number) => `${n} minute${n > 1 ? 's' : ''}`;

/** « dans moins d’une minute », « dans 1 minute », « dans 6 minutes ». */
export function dans(ms: number): string {
  const m = minutes(ms);
  return m <= 0 ? 'dans moins d’une minute' : `dans ${minutesDit(m)}`;
}

/** Lecture JSON de Transitous ; le User-Agent reste celui du cœur. */
export async function getJson(
  context: Context,
  url: string,
  extra: { timeoutMs?: number; cacheMs?: number; maxBytes?: number } = {},
): Promise<unknown> {
  const response = await context.http.fetch({
    url,
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: context.signal,
    timeoutMs: extra.timeoutMs ?? 8000,
    maxBytes: extra.maxBytes ?? 1024 * 1024,
    cacheMs: extra.cacheMs,
  });
  if (response.status === 429)
    throw new AddonCollectError('quota', 'Transitous limite les demandes pour le moment.', true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', 'Transitous est indisponible.', true);
  if (response.status !== 200)
    throw new AddonCollectError(
      'upstream',
      `Réponse HTTP ${response.status} inattendue de Transitous.`,
    );
  try {
    return response.json() as unknown;
  } catch {
    throw new AddonCollectError('malformed', 'Réponse illisible de Transitous.');
  }
}

/** La destination : un favori nommé dans la demande, sinon la demande telle quelle. */
export function destinationFor(
  config: Pick<TrajetConfig, 'favoris'>,
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
  // Dit sans la ville ni le reste après la virgule : « au 4777 avenue Pierre-De Coubertin ».
  const dit = text.split(',')[0]!.trim() || text;
  // « au Centre Bell » se dit tel quel, mais se cherche sans la préposition.
  // « aux » avant « au », et une espace exigée (sauf après « l’ ») : « Auteuil » reste entier.
  const article = /^(?:à la\s+|à l[’']\s*|aux\s+|au\s+|à\s+)/iu.exec(text);
  if (article && article[0].length < text.length)
    return { vers: dit, adresse: text.slice(article[0].length) };
  return { vers: /^chez\s/iu.test(dit) ? dit : `à ${dit}`, adresse: text };
}

/** « Ligne 1 - Verte » → « le métro, ligne verte » ; autobus 144 → « l’autobus 144 ». */
export function vehiculeDit(leg: Leg, reseau: Reseau): string {
  const propre = reseau.vehicule?.(leg);
  if (propre) return propre;
  const short = String(leg.routeShortName ?? '').trim();
  const long = String(leg.routeLongName ?? '').trim();
  switch (leg.mode) {
    case 'SUBWAY': {
      const color = /-\s*([^-]+)$/u.exec(long)?.[1]?.trim().toLowerCase();
      return color ? `le métro, ligne ${color}` : `le métro, ligne ${short}`;
    }
    case 'BUS':
      return `l’autobus ${short}${reseau.reseauDit(leg)}`;
    case 'RAIL':
    case 'REGIONAL_RAIL':
    case 'SUBURBAN': {
      // Trains d'exo : « 11 - Vaudreuil/Hudson » se dit « ligne Vaudreuil/Hudson ».
      const ligne = long.replace(/^\d+\s*-\s*/u, '');
      if (reseau.reseauDit(leg) === ' d’exo') return `le train d’exo, ligne ${ligne || short}`;
      return `le train ${short || long}${reseau.reseauDit(leg)}`.trim();
    }
    default:
      return `la ligne ${short || long}`.trim();
  }
}

/**
 * « STATION BERRI-UQAM » → « station Berri-UQAM », « King / Wellington » → « King et
 * Wellington », « Carrefour de l'Estrie » → « Carrefour de l’Estrie » ; les sigles courts restent
 * en capitales.
 */
export function arretDit(nom: string): string {
  // « Station de la GAPPE #2 » : le quai ne se dit pas. « T. D'Youville » (RTC) : un terminus.
  const name = nom
    .replace(/\s*#\s*\d+$/u, '')
    .replace(/^T\.\s*/u, 'Terminus ')
    .trim();
  if (name !== name.toUpperCase())
    return typo(
      name
        .replace(/^(Station|Gare|Terminus) /u, (mot) => mot.toLowerCase())
        // Un mot en capitales dans un nom en minuscules (« GAPPE ») se dit comme un nom propre ;
        // les sigles courts (STO, UQO, CHUS) restent.
        .replace(/\b\p{Lu}{5,}\b/gu, (mot) => mot.charAt(0) + mot.slice(1).toLowerCase())
        .replace(/\s*\/\s*/g, ' et '),
    );
  const small = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et']);
  return typo(
    name
      .toLowerCase()
      .replace(/[a-zà-ÿ]+/giu, (word, offset: number) => {
        if (small.has(word) && offset > 0) return word;
        // « ST-LAURENT » se dit « Saint-Laurent », pas « S-T ».
        if (word === 'st') return 'Saint';
        if (word === 'ste') return 'Sainte';
        if (word.length <= 4 && !/[aeiouy]/u.test(word.slice(1))) return word.toUpperCase();
        if (['uqam', 'chum', 'ets', 'cegep', 'udem'].includes(word)) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .replace(/^(Station|Gare|Terminus) /u, (mot) => mot.toLowerCase())
      .replace(/\s*\/\s*/g, ' et '),
  );
}

/** « à la station Berri-UQAM », « à la gare Parc », « au terminus Longueuil », « à l’arrêt Jean-Talon et Saint-Denis ». */
export function lieuDit(arret: string): string {
  if (/^(station|gare) /u.test(arret)) return `à la ${arret}`;
  if (/^terminus /u.test(arret)) return `au ${arret}`;
  return `à l’arrêt ${arret}`;
}

const motsGeneriques = new Set(
  'rue avenue av boulevard boul bd chemin ch place rang route montee cote terrasse croissant allee promenade autoroute de du des la le les l d et est ouest nord sud e o'.split(
    ' ',
  ),
);

/**
 * Les mots d'un nom de rue, sous une seule écriture : « St-Denis » et « Saint-Denis », « Ste-Catherine »
 * et « Sainte-Catherine », « 1ère Avenue » et « 1re Avenue » (écritures courantes au Québec,
 * qu'OpenStreetMap écrit en entier ou selon l'usage officiel).
 */
function motsDeRue(texte: string): string[] {
  return plain(texte)
    .split(' ')
    .filter(Boolean)
    .map((w) =>
      w === 'st'
        ? 'saint'
        : w === 'ste'
          ? 'sainte'
          : w.replace(/^(\d+)(?:ere|re)$/u, '$1re').replace(/^(\d+)(?:ieme|eme)$/u, '$1e'),
    );
}

/**
 * Avec un numéro civique, le résultat doit être sur la rue demandée : sinon le géocodeur remplace
 * une adresse qu'il ne connaît pas par une voisine d'orthographe (« 1500 rue Berri » → « 1500 Rue
 * Serre », à l'autre bout de la ville), sans le dire.
 */
export function surLaRue(adresse: string, resultat: Leg): boolean {
  const sansVille = adresse.split(',')[0]!;
  const nom = ` ${motsDeRue(`${resultat.street ?? ''} ${resultat.name ?? ''}`).join(' ')} `;
  const contient = (texte: string) =>
    motsDeRue(texte)
      .filter((w) => w.length > 1 && !motsGeneriques.has(w))
      .every((w) => nom.includes(` ${w} `));
  const civique = /^\s*\d+[a-z]?\s+(.+)$/iu.exec(sansVille);
  if (civique) return contient(civique[1]!);
  // Une intersection (« Saint-Denis et Mont-Royal ») : les deux rues, pas une voisine
  // (« Berri et Sainte-Catherine » sortait « Guy et Sainte-Catherine »).
  const rues = sansVille.split(/\s+et\s+|\s*\/\s*/iu);
  if (rues.length === 2) return rues.every(contient);
  return true;
}

async function geocode(context: Context, reseau: Reseau, adresse: string, near: string) {
  // Le géocodeur est mondial : « Stade olympique » sort d'abord à La Réunion. On garde le premier
  // résultat à moins de 80 km du départ, et qui correspond bien à l'adresse demandée.
  const [lat0, lon0] = near.split(',').map(Number) as [number, number];
  const proche = (r: Leg) =>
    typeof r.lat === 'number' &&
    typeof r.lon === 'number' &&
    Math.hypot(r.lat - lat0, (r.lon - lon0) * Math.cos((lat0 * Math.PI) / 180)) * 111 < 80;
  for (const text of adresse.includes(',') ? [adresse] : [adresse, `${adresse}, ${reseau.ville}`]) {
    // Le géocodeur ne reconnaît pas l'apostrophe typographique : « Carrefour de l’Estrie »
    // donnait des « Carrefour » en France, « Carrefour de l'Estrie » le bon lieu.
    const params = new URLSearchParams({
      text: text.replace(/[’‘]/gu, "'"),
      language: 'fr',
      place: near,
    });
    const results = await getJson(context, `${transitous}/v1/geocode?${params}`, {
      cacheMs: 10 * 60_000,
    });
    const first = Array.isArray(results)
      ? (results as Leg[]).find((r) => proche(r) && surLaRue(adresse, r))
      : undefined;
    if (!first) continue;
    const name =
      [first.houseNumber, first.street ?? first.name].filter(Boolean).join(' ') ||
      String(first.name ?? adresse);
    return {
      lat: first.lat as number,
      lon: first.lon as number,
      name: arretDit(name).slice(0, 160),
    };
  }
  throw new AddonCollectError(
    'not_found',
    `Adresse introuvable : ${adresse.slice(0, 120)}. Essayez une intersection proche ou un lieu connu.`,
  );
}

/**
 * Le départ, arrondi à ~100 m : les coordonnées si le foyer les a saisies (elles priment), sinon
 * l'adresse réglée, trouvée par Transitous.
 */
async function origine(context: Context, reseau: Reseau): Promise<string> {
  const { adresseDepart, latitude, longitude } = context.config;
  if (typeof latitude === 'number' && typeof longitude === 'number')
    return `${rounded(latitude)},${rounded(longitude)}`;
  if (adresseDepart?.trim()) {
    const lieu = await geocode(context, reseau, adresseDepart.trim(), reseau.centre);
    return `${rounded(lieu.lat)},${rounded(lieu.lon)}`;
  }
  throw new AddonCollectError('config_invalid', 'Indiquez l’adresse du départ.');
}

/** Premier tronçon en transport d'un itinéraire, avec la marche qui le précède. */
function firstRide(itinerary: Leg, reseau: Reseau) {
  const legs: Leg[] = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  const index = legs.findIndex((leg) => leg.mode && leg.mode !== 'WALK');
  if (index < 0) return null;
  const ride = legs[index]!;
  const walk = legs.slice(0, index).reduce((sum, leg) => sum + (Number(leg.duration) || 0), 0);
  return {
    leg: ride,
    ligne: String(ride.routeShortName ?? '').trim(),
    direction: String(ride.headsign ?? '').trim(),
    arret: String(ride.from?.name ?? '').trim(),
    stopId: String(ride.from?.stopId ?? ''),
    marcheMin: minutes(walk * 1000),
    autres: legs
      .slice(index + 1)
      .filter((leg) => leg.mode && leg.mode !== 'WALK')
      .map((leg) => vehiculeDit(leg, reseau)),
  };
}

/** Durée de l'itinéraire en minutes, null si Transitous ne la donne pas. */
function dureeDe(itinerary: Leg): number | null {
  const secondes = Number(itinerary.duration);
  if (!Number.isFinite(secondes) || secondes <= 0) return null;
  return Math.max(1, Math.min(600, minutes(secondes * 1000)));
}

/** La collecte d'un module de transport : départ, destination, itinéraire, passages. */
export function collecteur(reseau: Reseau) {
  return async function collect(context: Context) {
    const { config } = context;
    const from = await origine(context, reseau);
    const { vers, adresse } = destinationFor(config, context.query);
    const target = await geocode(context, reseau, adresse, from);
    const plan = (await getJson(
      context,
      `${transitous}/v5/plan?${new URLSearchParams({
        fromPlace: from,
        toPlace: `${rounded(target.lat)},${rounded(target.lon)}`,
        numItineraries: '3',
        time: new Date(context.now()).toISOString(),
      })}`,
      { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 },
    )) as Leg;
    const itineraries: Leg[] = Array.isArray(plan?.itineraries) ? plan.itineraries : [];
    // Le trajet qui arrive le plus tôt, pas le premier proposé (vu : autobus 97 en 67 minutes
    // proposé avant le métro en 35 minutes).
    const best = itineraries
      .map((itinerary) => ({
        itinerary,
        ride: firstRide(itinerary, reseau),
        fin: Date.parse(String(itinerary.endTime ?? '')),
      }))
      .filter((entry) => entry.ride?.ligne)
      .sort(
        (a, b) =>
          (Number.isFinite(a.fin) ? a.fin : Infinity) - (Number.isFinite(b.fin) ? b.fin : Infinity),
      )[0];
    if (!best?.ride)
      throw new AddonCollectError(
        'not_found',
        `Aucun trajet en transport en commun trouvé ${typo(vers)}.`,
      );
    const { ride } = best;
    // Les passages suivants de la même ligne, dans la même direction, au même arrêt.
    const times = (await getJson(
      context,
      `${transitous}/v5/stoptimes?${new URLSearchParams({ stopId: ride.stopId, n: '30' })}`,
      { timeoutMs: 8000 },
    )) as Leg;
    // Un passage prévu il y a peu peut être réellement à venir (autobus en retard) : on garde les
    // vingt dernières minutes, que le temps réel départage.
    const lus: Passage[] = (Array.isArray(times?.stopTimes) ? (times.stopTimes as Leg[]) : [])
      .filter(
        (s) =>
          !s.cancelled &&
          s.pickupType !== 'NOT_ALLOWED' &&
          String(s.routeShortName ?? '').trim() === ride.ligne &&
          String(s.headsign ?? '').trim() === ride.direction,
      )
      .map((s) => ({
        prevu: Date.parse(String(s.place?.departure ?? s.place?.arrival ?? '')),
        reel: s.realTime === true,
        tripId: String(s.tripId ?? ''),
      }));
    // Les départs du même tronçon dans les itinéraires de Transitous : à un arrêt très desservi,
    // les 30 passages lus ne couvrent parfois qu'une vingtaine de minutes, avant l'autobus choisi
    // (vu au terminus D'Youville, à Québec).
    const duPlan: Passage[] = itineraries
      .map((itinerary) => firstRide(itinerary, reseau))
      .filter(
        (r) =>
          r !== null &&
          r.ligne === ride.ligne &&
          r.stopId === ride.stopId &&
          r.direction === ride.direction,
      )
      .map((r) => ({
        prevu: Date.parse(String(r!.leg.startTime ?? '')),
        reel: r!.leg.realTime === true,
        tripId: String(r!.leg.tripId ?? ''),
      }))
      .filter(
        (p) =>
          !lus.some(
            (s) => (p.tripId && s.tripId === p.tripId) || Math.abs(s.prevu - p.prevu) < 60_000,
          ),
      );
    // Seuls les passages qu'on peut encore attraper à pied comptent, avant de n'en garder que
    // quelques-uns : à une ligne fréquente (métro aux 3 minutes) et loin de l'arrêt, les premiers
    // passages lus seraient tous trop tôt.
    const marche = ride.marcheMin * 60_000;
    const candidats = [...lus, ...duPlan]
      .filter(
        (s, i, tous) =>
          Number.isFinite(s.prevu) &&
          s.prevu >= context.now() + marche - 20 * 60_000 &&
          tous.findIndex((t) => t.prevu === s.prevu && t.tripId === s.tripId) === i,
      )
      .sort((a, b) => a.prevu - b.prevu)
      .slice(0, 10);
    const reels = reseau.tempsReel ? await reseau.tempsReel(context, candidats, ride.stopId) : [];
    const passages: Depart[] = candidats
      .map((s, i) => {
        const reel = reels[i];
        return reel === undefined ? { at: s.prevu, reel: s.reel } : { at: reel, reel: true };
      })
      .filter((s) => s.at >= context.now() + marche - 30_000)
      .sort((a, b) => a.at - b.at)
      .slice(0, 6)
      .map((s) => ({ heure: new Date(s.at).toISOString(), reel: s.reel }));
    const complement = reseau.complement
      ? await reseau.complement(context, { ligne: ride.ligne, stopId: ride.stopId })
      : {};
    const data: TrajetData = {
      vers: typo(vers).slice(0, 80),
      destination: target.name,
      vehicule: typo(vehiculeDit(ride.leg, reseau)).slice(0, 80),
      ligne: ride.ligne.slice(0, 40),
      direction: typo(ride.direction).slice(0, 120),
      arret: arretDit(ride.arret || 'arrêt').slice(0, 120),
      marcheMin: Math.min(240, ride.marcheMin),
      dureeMin: dureeDe(best.itinerary),
      correspondances: ride.autres.slice(0, 4).map((l) => typo(l).slice(0, 80)),
      departs: passages,
      ...(complement.avis?.length ? { avis: complement.avis } : {}),
      ...(complement.remarque ? { remarque: complement.remarque.slice(0, 160) } : {}),
    };
    if (!validateData(data))
      throw new AddonCollectError('malformed', `Trajet ${reseau.sigle} incohérent.`);
    return {
      data,
      // Un trajet trouvé reste une réponse utile, même sans passage qu'on peut encore attraper :
      // la phrase le dit, avec l'arrêt, la marche et la durée.
      empty: false,
      freshMs: 60_000,
      source: { provider: 'transitous', sourceId: `${data.ligne}:${ride.stopId}`.slice(0, 128) },
    };
  };
}

const heure = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('fr-CA', { hour: 'numeric', minute: '2-digit', timeZone })
    .format(new Date(at))
    .replace(':', ' h ');

/** « de » contracté : « du métro », « du REM », « des trains », « de l’autobus 7 ». */
export const deDit = (vehicule: string) =>
  /^le /u.test(vehicule)
    ? `du ${vehicule.slice(3)}`
    : /^les /u.test(vehicule)
      ? `des ${vehicule.slice(4)}`
      : `de ${vehicule}`;

/** La carte et la phrase d'un module de transport. */
export function presentation(reseau: Reseau) {
  return function present(
    snapshot: ModuleSnapshot<TrajetData>,
    context: AddonPresentContext,
  ): AddonPresentation {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun trajet à présenter.');
    const now = context.now();
    // Un passage qu'on ne peut plus attraper à pied n'est pas « le prochain ».
    const atteignables = data.departs
      .map((d) => ({ at: Date.parse(d.heure), reel: d.reel }))
      .filter((d) => d.at >= now + data.marcheMin * 60_000 - 30_000);
    const [prochain, suivant] = atteignables;
    const lieu = `${lieuDit(data.arret)}${data.marcheMin ? `, à ${minutesDit(data.marcheMin)} à pied` : ''}`;
    const horaire = (reel: boolean) => (reel ? '' : ' selon l’horaire');
    const duree =
      data.dureeMin === null ? '' : ` La durée du trajet est de ${minutesDit(data.dureeMin)}.`;
    const correspondance = data.correspondances.length
      ? ` Correspondance avec ${data.correspondances.join(', puis ')}.`
      : '';
    const avis = data.avis?.length
      ? ` ${reseau.avisDit ?? `Avis ${reseau.sigle}`} : ${data.avis.map((a) => (/[.!?]$/u.test(a) ? a : `${a}.`)).join(' ')}`
      : '';
    const summary = prochain
      ? `Pour te rendre ${data.vers}, le prochain départ est ${data.vehicule} ${dans(prochain.at - now)}${horaire(prochain.reel)}, ${lieu}.` +
        duree +
        correspondance +
        (suivant
          ? ` Le suivant est prévu ${dans(suivant.at - now)}${horaire(suivant.reel)}.`
          : '') +
        avis
      : // Aucun passage à attraper parmi ceux lus : rien n'est promis (ni « dans l'heure », ni plus tard).
        `Pour te rendre ${data.vers}, je ne trouve pas de prochain départ ${deDit(data.vehicule)} ${lieu}.` +
        duree +
        avis;
    return {
      title: `Transports ${reseau.sigle} · ${data.vers}`.slice(0, 80),
      primaryValue: prochain ? `${data.ligne} ${dans(prochain.at - now)}`.slice(0, 120) : null,
      subtitle: `${data.arret} → ${data.destination}`.slice(0, 120),
      description:
        snapshot.status === 'stale'
          ? 'Dernier relevé connu, à vérifier.'
          : data.avis?.length
            ? `Avis ${reseau.sigle} : ${data.avis[0]}`.slice(0, 160)
            : (data.remarque ?? null),
      items: [
        ...atteignables.slice(0, 3).map((d) => ({
          label: `${data.ligne} ${data.direction}`.slice(0, 80),
          value: `${heure(d.at, context.timeZone)} · ${d.reel ? 'temps réel' : 'horaire prévu'}`,
        })),
        data.dureeMin === null
          ? { label: 'Marche jusqu’à l’arrêt', value: `${data.marcheMin} min` }
          : {
              label: 'Durée du trajet',
              value: `${data.dureeMin} min, dont ${data.marcheMin} min à pied`,
            },
      ],
      summary: summary.slice(0, 500),
      sources: [reseau.id],
    };
  };
}

/** La description de l'outil `trajet`, commune aux modules. */
export function descriptionOutil(
  reseau: Reseau,
  region: string,
  exemples: string,
  query: string,
): string {
  return (
    `Trouver le prochain départ en transport en commun ${region} depuis le point de départ de la source vers une destination, avec la durée du trajet et le départ suivant. Affiche la carte Transports ${reseau.sigle}. ` +
    `Utiliser pour ${exemples}. ` +
    `query : la destination seulement, soit le mot-clé d’une destination favorite, soit une adresse ou un lieu de la région, précédé de sa préposition (${query}). ` +
    'Si la personne nomme un lieu dont tu as mémorisé l’adresse, passe cette adresse. La réponse prend quelques secondes. ' +
    'Dis toujours, dans l’ordre et sans en omettre : le prochain départ et dans combien de minutes, la durée du trajet quand elle est donnée, puis le départ suivant.'
  );
}

/** L'outil vocal `trajet`, commun aux modules. */
export function outilTrajet(description: string) {
  return {
    name: 'trajet',
    description,
    parameters: {
      type: 'object' as const,
      additionalProperties: false,
      required: ['instanceRef', 'query'],
      properties: { instanceRef: { type: ['string', 'null'] }, query: { type: 'string' } },
    },
    query: { maxLength: 200 },
  };
}
