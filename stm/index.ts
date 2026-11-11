/**
 * Trajets de la STM (Montréal) : métro, autobus et REM. Le trajet et les passages viennent de
 * Transitous (horaires officiels GTFS), sans jeton. Transitous n'a pas encore le temps réel de la
 * STM : les heures sont dites « selon l'horaire ». Le jour où il l'aura, le drapeau `realTime` de
 * ses réponses est déjà lu, et les heures réelles passeront sans changer ce module.
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
import { cleStm } from './cle.js';

type Favori = { nom: string; dit: string; adresse: string };
type StmConfig = {
  depart: string;
  adresseDepart?: string;
  latitude?: number | null;
  longitude?: number | null;
  favoris: Favori[];
};
type Depart = { heure: string; reel: boolean };
type StmData = {
  vers: string;
  destination: string;
  vehicule: string;
  ligne: string;
  direction: string;
  arret: string;
  marcheMin: number;
  dureeMin: number;
  correspondances: string[];
  departs: Depart[];
  avis?: string[];
};

const transitous = 'https://api.transitous.org/api';
const headers = {
  'User-Agent': 'Cornelius-module-stm/1.0 (usage personnel)',
  Accept: 'application/json',
};
const validateData = compile<StmData>(dataSchema);

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

type Context = AddonCollectContext<StmConfig>;
type Leg = Record<string, any>;

async function getJson(
  context: Context,
  url: string,
  extra: { timeoutMs?: number; cacheMs?: number; maxBytes?: number } = {},
) {
  const response = await context.http.fetch({
    url,
    method: 'GET',
    headers,
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
  config: StmConfig,
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
  const article = /^(?:à la|à l[’']|à|au|aux)\s*/iu.exec(text);
  if (article && article[0].length < text.length)
    return { vers: dit, adresse: text.slice(article[0].length) };
  return { vers: /^chez\s/iu.test(dit) ? dit : `à ${dit}`, adresse: text };
}

/** « Ligne 1 - Verte » → « le métro, ligne verte » ; autobus 144 → « l’autobus 144 ». */
export function vehiculeDit(leg: Leg): string {
  const short = String(leg.routeShortName ?? '').trim();
  const long = String(leg.routeLongName ?? '').trim();
  switch (leg.mode) {
    case 'SUBWAY': {
      const color = /-\s*([^-]+)$/u.exec(long)?.[1]?.trim().toLowerCase();
      return color ? `le métro, ligne ${color}` : `le métro, ligne ${short}`;
    }
    case 'BUS':
      return `l’autobus ${short}`;
    case 'TRAM':
      // « A4-A1 » (branches communes) ne se dit pas : « le REM » suffit.
      return short && !short.includes('-') ? `le REM ${short}` : 'le REM';
    case 'RAIL':
    case 'REGIONAL_RAIL':
    case 'SUBURBAN':
      return `le train ${short || long}`.trim();
    default:
      return `la ligne ${short || long}`.trim();
  }
}

/** « STATION BERRI-UQAM » → « station Berri-UQAM » ; les sigles courts restent en capitales. */
export function arretDit(name: string): string {
  if (name !== name.toUpperCase())
    return name.replace(/^Station /u, 'station ').replace(/\s*\/\s*/g, ' et ');
  const small = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et']);
  return name
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
    .replace(/^Station /u, 'station ')
    .replace(/\s*\/\s*/g, ' et ');
}

const motsGeneriques = new Set(
  'rue avenue av boulevard boul bd chemin ch place rang route montee cote terrasse croissant allee promenade autoroute de du des la le les l d et est ouest nord sud e o'.split(
    ' ',
  ),
);

/**
 * Avec un numéro civique, le résultat doit être sur la rue demandée : sinon le géocodeur remplace
 * une adresse qu'il ne connaît pas par une voisine d'orthographe (« 1500 rue Berri » → « 1500 Rue
 * Serre », à l'autre bout de la ville), sans le dire.
 */
export function surLaRue(adresse: string, resultat: Leg): boolean {
  const sansVille = adresse.split(',')[0]!;
  const nom = ` ${plain(`${resultat.street ?? ''} ${resultat.name ?? ''}`)} `;
  const contient = (texte: string) =>
    plain(texte)
      .split(' ')
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

/** Ville ajoutée à une adresse qui n'en a pas, si la première recherche ne donne rien. */
const ville = 'Montréal';

async function geocode(context: Context, adresse: string, near: string) {
  // Le géocodeur est mondial : « Stade olympique » sort d'abord à La Réunion. On garde le premier
  // résultat à moins de 80 km du départ, et qui correspond bien à l'adresse demandée.
  const [lat0, lon0] = near.split(',').map(Number) as [number, number];
  const proche = (r: Leg) =>
    typeof r.lat === 'number' &&
    typeof r.lon === 'number' &&
    Math.hypot(r.lat - lat0, (r.lon - lon0) * Math.cos((lat0 * Math.PI) / 180)) * 111 < 80;
  for (const text of adresse.includes(',') ? [adresse] : [adresse, `${adresse}, ${ville}`]) {
    const params = new URLSearchParams({ text, language: 'fr', place: near });
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
    `Adresse introuvable : ${adresse.slice(0, 120)}. Essayez une intersection proche (« Saint-Denis et Mont-Royal ») ou un lieu connu.`,
  );
}

/**
 * Texte d'avis dit à la voix : sans l'étiquette « [Ouverture tardive] », sans HTML (les liens de
 * la STM, parfois coupés : « <a class="external" »), arrêté à la dernière phrase complète.
 */
export function phraseAvis(text: string): string {
  const clean = text
    .replace(/^\[[^\]]*\]\s*/u, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/<.*$/su, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (clean.length <= 200 && /[.!?]$/u.test(clean)) return clean;
  const court = clean.slice(0, 200);
  const fin = Math.max(court.lastIndexOf('. '), court.lastIndexOf('! '), court.lastIndexOf('? '));
  return fin > 40 ? court.slice(0, fin + 1) : court.trim();
}

/** État du service de la STM (JSON, ~14 ko) : une lecture par 3 minutes au plus, par Cornelius. */
const etatService = 'https://api.stm.info/pub/od/i3/v1/messages/etatservice';

/**
 * Avis en cours sur la ligne (« ouverture tardive », détour…), sans « Service normal ». Un plus :
 * clé refusée, quota ou panne, et la réponse reste celle de l'horaire, sans avis.
 */
async function avisStm(context: Context, ligne: string): Promise<string[]> {
  try {
    const response = await context.http.fetch({
      url: etatService,
      method: 'GET',
      headers: { ...headers, apiKey: cleStm() },
      signal: context.signal,
      timeoutMs: 4000,
      maxBytes: 512 * 1024,
      // Trois minutes : un avis change rarement, et la clé est partagée par tous les foyers.
      cacheMs: 3 * 60_000,
    });
    if (response.status !== 200) return [];
    const body = response.json() as Leg;
    const now = context.now() / 1000;
    const alerts: Leg[] = Array.isArray(body?.alerts) ? body.alerts : [];
    return alerts
      .filter((a) =>
        (Array.isArray(a.informed_entities) ? (a.informed_entities as Leg[]) : []).some(
          (e) => String(e.route_short_name ?? '') === ligne,
        ),
      )
      .filter((a) =>
        (Array.isArray(a.active_periods) ? (a.active_periods as Leg[]) : [a.active_periods]).some(
          (p) => p && (Number(p.start) || 0) <= now && (p.end == null || Number(p.end) >= now),
        ),
      )
      .map((a) =>
        String(
          (a.header_texts as Leg[] | undefined)?.find((t) => t.language === 'fr')?.text ?? '',
        ).trim(),
      )
      .filter((text) => text && !/^service normal/iu.test(text))
      .map((text) => phraseAvis(text))
      .filter(Boolean)
      .slice(0, 2);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return [];
  }
}

/** Centre de Montréal : point de recherche de l'adresse de départ. */
const region = '45.508,-73.587';

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

function firstRide(itinerary: Leg) {
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
      .map(vehiculeDit),
  };
}

async function collect(context: Context) {
  const { config } = context;
  const from = await origine(context);
  const { vers, adresse } = destinationFor(config, context.query);
  const target = await geocode(context, adresse, from);
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
      ride: firstRide(itinerary),
      fin: Date.parse(String(itinerary.endTime ?? '')),
    }))
    .filter((entry) => entry.ride?.ligne)
    .sort(
      (a, b) =>
        (Number.isFinite(a.fin) ? a.fin : Infinity) - (Number.isFinite(b.fin) ? b.fin : Infinity),
    )[0];
  if (!best?.ride)
    throw new AddonCollectError('not_found', `Aucun trajet en transport en commun trouvé ${vers}.`);
  const { ride } = best;
  // Les passages suivants de la même ligne, dans la même direction, au même arrêt.
  const times = (await getJson(
    context,
    `${transitous}/v5/stoptimes?${new URLSearchParams({ stopId: ride.stopId, n: '30' })}`,
    { timeoutMs: 8000 },
  )) as Leg;
  const passages: Depart[] = (Array.isArray(times?.stopTimes) ? (times.stopTimes as Leg[]) : [])
    .filter(
      (s) =>
        !s.cancelled &&
        s.pickupType !== 'NOT_ALLOWED' &&
        String(s.routeShortName ?? '').trim() === ride.ligne &&
        String(s.headsign ?? '').trim() === ride.direction,
    )
    .map((s) => ({
      at: Date.parse(String(s.place?.departure ?? s.place?.arrival ?? '')),
      reel: s.realTime === true,
    }))
    .filter((s) => Number.isFinite(s.at) && s.at >= context.now() - 30_000)
    .sort((a, b) => a.at - b.at)
    .slice(0, 6)
    .map((s) => ({ heure: new Date(s.at).toISOString(), reel: s.reel }));
  if (!passages.length) {
    const at = Date.parse(String(ride.leg.startTime ?? ''));
    if (Number.isFinite(at))
      passages.push({ heure: new Date(at).toISOString(), reel: ride.leg.realTime === true });
  }
  const data: StmData = {
    vers: vers.slice(0, 80),
    destination: target.name,
    vehicule: vehiculeDit(ride.leg).slice(0, 80),
    ligne: ride.ligne.slice(0, 40),
    direction: ride.direction.slice(0, 120),
    arret: arretDit(ride.arret || 'arrêt').slice(0, 120),
    marcheMin: Math.min(240, ride.marcheMin),
    dureeMin: Math.max(1, Math.min(600, minutes((Number(best.itinerary.duration) || 60) * 1000))),
    correspondances: ride.autres.slice(0, 4).map((l) => l.slice(0, 80)),
    departs: passages,
    avis: await avisStm(context, ride.ligne),
  };
  if (!validateData(data)) throw new AddonCollectError('malformed', 'Trajet STM incohérent.');
  return {
    data,
    empty: passages.length === 0,
    freshMs: 60_000,
    source: { provider: 'transitous', sourceId: `${data.ligne}:${ride.stopId}`.slice(0, 128) },
  };
}

function dans(ms: number): string {
  const m = minutes(ms);
  if (m <= 0) return 'dans moins d’une minute';
  return `dans ${m} minute${m > 1 ? 's' : ''}`;
}

const heure = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('fr-CA', { hour: 'numeric', minute: '2-digit', timeZone })
    .format(new Date(at))
    .replace(':', ' h ');

function present(
  snapshot: ModuleSnapshot<StmData>,
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
  const lieu = `${/^station /u.test(data.arret) ? 'à la' : 'à l’arrêt'} ${data.arret}${data.marcheMin ? `, à ${data.marcheMin} minute${data.marcheMin > 1 ? 's' : ''} à pied` : ''}`;
  const horaire = (reel: boolean) => (reel ? '' : ' selon l’horaire');
  const correspondance = data.correspondances.length
    ? ` Correspondance avec ${data.correspondances.join(', puis ')}.`
    : '';
  const avis = data.avis?.length
    ? ` Avis de la STM : ${data.avis.map((a) => (/[.!?]$/u.test(a) ? a : `${a}.`)).join(' ')}`
    : '';
  const summary = prochain
    ? `Pour te rendre ${data.vers}, le prochain départ est ${data.vehicule} ${dans(prochain.at - now)}${horaire(prochain.reel)}, ${lieu}. ` +
      `La durée du trajet est de ${data.dureeMin} minutes.${correspondance}` +
      (suivant ? ` Le suivant est prévu ${dans(suivant.at - now)}${horaire(suivant.reel)}.` : '') +
      avis
    : `Pour te rendre ${data.vers}, je ne trouve pas de départ ${lieu} dans l’heure. La durée du trajet est de ${data.dureeMin} minutes.${avis}`;
  return {
    title: `Transports STM · ${data.vers}`.slice(0, 80),
    primaryValue: prochain ? `${data.ligne} ${dans(prochain.at - now)}`.slice(0, 120) : null,
    subtitle: `${data.arret} → ${data.destination}`.slice(0, 120),
    description:
      snapshot.status === 'stale'
        ? 'Dernier relevé connu, à vérifier.'
        : data.avis?.length
          ? `Avis STM : ${data.avis[0]}`.slice(0, 160)
          : null,
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
    sources: ['stm'],
  };
}

const addon: AddonDefinition<StmConfig, StmData> = {
  id: 'stm',
  apiVersion: 1,
  version: '1.2.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Transitous et état du service STM',
  display: {
    // « Transports STM » : rangé à côté de « Transports » (Île-de-France) et « Transports RTC ».
    name: 'Transports STM',
    // 160 caractères au plus (contrat des modules).
    description:
      'Prochain métro, autobus ou REM à Montréal, durée du trajet, départ suivant et disponibilité du réseau (état du service de la STM).',
    icon: 'train-front',
    keywords: [
      'métro',
      'autobus',
      'bus',
      'stm',
      'rem',
      'trajet',
      'transport',
      'montréal',
      'état du service',
      'panne',
      'interruption',
    ],
    example: { label: 'Depuis Berri-UQAM', ref: 'berri' },
    spoken: { head: 'le trajet', repeats: ['trajet', 'metro', 'autobus', 'bus'] },
  },
  configVersion: 1,
  configSchema,
  // Aucun lieu par défaut : chaque foyer saisit le sien (rien de personnel dans le module partagé).
  configDefaults: { depart: 'la maison', favoris: [] },
  dataVersion: 1,
  dataSchema,
  freshMs: 60_000,
  tools: [
    {
      name: 'trajet',
      description:
        'Trouver le prochain départ de la STM (Montréal : métro, autobus, REM) depuis le point de départ de la source vers une destination, avec la durée du trajet et le départ suivant. Affiche la carte Transports STM. ' +
        'Utiliser pour « comment je vais au Centre Bell ? », « c’est quand le prochain métro pour l’Université de Montréal ? ». ' +
        'query : la destination seulement, soit le mot-clé d’une destination favorite, soit une adresse ou un lieu à Montréal, précédé de sa préposition (« au Centre Bell », « à l’Université de Montréal »). ' +
        'Si la personne nomme un lieu dont tu as mémorisé l’adresse, passe cette adresse. La réponse prend quelques secondes. ' +
        'Dis toujours les trois éléments du résultat, dans l’ordre, sans en omettre : le prochain départ et dans combien de minutes, la durée du trajet, puis le départ suivant. S’il y a un avis de la STM, dis-le à la fin.',
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
