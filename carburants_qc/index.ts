/**
 * Prix des carburants au Québec, d'après Régie essence Québec (Régie de l'énergie) : la loi oblige
 * les détaillants à y déclarer leurs prix dès qu'ils changent. Les stations les moins chères
 * autour d'un code postal et une station préférée. Carburants québécois :
 * ordinaire (« Régulier » dans les données), super, diesel. Prix dits en dollars.
 */
import {
  AddonCollectError,
  type AddonCollectContext,
  type AddonDefinition,
  type AddonHttpClient,
  type AddonPresentation,
  type AddonPresentContext,
  type AddonSearchResult,
  type ModuleSnapshot,
} from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type Carburant = 'Régulier' | 'Super' | 'Diesel';
const carburants: Carburant[] = ['Régulier', 'Super', 'Diesel'];
/** Ce que dit Cornelius : « l’ordinaire » plutôt que « le régulier » des données. */
const noms: Record<Carburant, { oral: string; court: string; argument: string }> = {
  Régulier: { oral: 'l’ordinaire', court: 'Ordinaire', argument: 'ordinaire' },
  Super: { oral: 'le super', court: 'Super', argument: 'super' },
  Diesel: { oral: 'le diesel', court: 'Diesel', argument: 'diesel' },
};

type CarburantsConfig = {
  codePostal?: string;
  latitude?: number | null;
  longitude?: number | null;
  rayonKm: number;
  carburants: Carburant[];
  stationId?: string | null;
  stationLabel?: string | null;
  exclusions?: string[];
  miroir?: 'Meilleur prix' | 'Station préférée';
};
type Prix = { carburant: Carburant; cents: number | null };
/** Une station et ses prix pour les carburants choisis ; distance nulle sans zone. */
type Station = { nom: string; adresse: string; distanceKm: number | null; prix: Prix[] };
/** Le meilleur prix d'un carburant : la station du rayon la moins chère, ou la préférée. */
type Meilleur = { carburant: Carburant; cents: number; station: Station; favorite: boolean };
type CarburantsData = {
  rayonKm: number;
  zone: boolean;
  meilleurs: Meilleur[];
  favorite: Station | null;
  releve: string;
};

type Json = Record<string, any>;
type Context = AddonCollectContext<CarburantsConfig>;

const flux = 'https://regieessencequebec.ca/stations.geojson.gz';
const headers = { 'User-Agent': 'Cornelius-module-carburants_qc/1.0', Accept: 'application/json' };
const validateData = compile<CarburantsData>(dataSchema);

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

/** « 169.9¢ » → 169,9 cents ; un prix absent ou hors de toute vraisemblance est écarté. */
export function cents(prix: unknown): number | null {
  const n = Number(String(prix ?? '').replace(/[^\d.]/gu, ''));
  return Number.isFinite(n) && n >= 50 && n <= 1000 ? Math.round(n * 10) / 10 : null;
}

/** Identifiant stable d'une station : ses coordonnées (les données n'en donnent pas). */
export const idStation = (f: Json) => {
  const [lon, lat] = (f.geometry?.coordinates ?? []) as number[];
  return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
};
const nomStation = (p: Json) =>
  String(p.brand || p.Name || 'Station')
    .trim()
    .slice(0, 80);
const prixDe = (p: Json, carburant: Carburant) => {
  const ligne = (Array.isArray(p.Prices) ? (p.Prices as Json[]) : []).find(
    (x) => x.GasType === carburant,
  );
  return ligne && ligne.IsAvailable !== false ? cents(ligne.Price) : null;
};

function distanceKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function lire(
  http: AddonHttpClient,
  signal: AbortSignal | undefined,
  url: string,
  quoi: string,
) {
  const response = await http.fetch({
    url,
    method: 'GET',
    headers,
    signal,
    timeoutMs: 10_000,
    // Environ 2 Mo une fois décompressé (le serveur le compresse pour le transport).
    maxBytes: 6 * 1024 * 1024,
    cacheMs: 60_000,
  });
  if (response.status === 429)
    throw new AddonCollectError('quota', `${quoi} limite les demandes pour le moment.`, true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', `${quoi} est indisponible.`, true);
  if (response.status !== 200)
    throw new AddonCollectError(
      'upstream',
      `Réponse HTTP ${response.status} inattendue de ${quoi}.`,
    );
  try {
    return response.json() as Json;
  } catch {
    throw new AddonCollectError('malformed', `Réponse illisible de ${quoi}.`);
  }
}

async function lireStations(http: AddonHttpClient, signal: AbortSignal | undefined) {
  const geo = await lire(http, signal, flux, 'Régie essence Québec');
  const features = Array.isArray(geo?.features) ? (geo.features as Json[]) : null;
  if (!features?.length) throw new AddonCollectError('malformed', 'Liste des stations illisible.');
  return {
    stations: features.filter(
      (f) => Array.isArray(f.geometry?.coordinates) && f.properties?.Status !== 'Fermée',
    ),
    releve: String(geo.metadata?.generated_at ?? ''),
  };
}

/** « g1v2l9 », « G1V 2L9 » → « G1V2L9 » ; null si ce n'est pas un code postal du Québec (G, H, J). */
export function codePostal(texte: unknown): string | null {
  const code = String(texte ?? '')
    .replace(/\s+/gu, '')
    .toUpperCase();
  return /^[GHJ]\d[A-Z]\d[A-Z]\d$/u.test(code) ? code : null;
}
/** « G1V2L9 » → « G1V 2L9 », pour les messages. */
const codeEcrit = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

const median = (valeurs: number[]) => {
  const v = [...valeurs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

/**
 * Le centre d'un code postal, d'après les stations de la Régie qui le partagent : le code exact
 * d'abord, sinon ses trois premiers caractères (la région de tri d'acheminement). Aucun géocodeur :
 * le code postal ne quitte pas Cornelius. Médiane plutôt que moyenne, pour qu'une station mal placée
 * ne déplace pas la zone ; si moins de 80 % des stations sont à 15 km de ce centre, le code couvre un
 * trop grand territoire (régions de tri rurales comme G0A, de Portneuf à Charlevoix) et il est écarté
 * plutôt que de chercher au mauvais endroit. Mesuré sur le relevé du 2026-11-12 : 343 régions de tri
 * sur 383 retenues, 2 156 codes exacts sur 2 159.
 */
export function centreDuCodePostal(stations: Json[], code: string): [number, number] | null {
  for (const longueur of [6, 3]) {
    const points = stations
      .filter((f) =>
        (codePostal(f.properties?.PostalCode) ?? '').startsWith(code.slice(0, longueur)),
      )
      .map((f) => {
        const [lon, lat] = f.geometry.coordinates as number[];
        return [lat!, lon!] as [number, number];
      });
    if (!points.length) continue;
    const c: [number, number] = [median(points.map((p) => p[0])), median(points.map((p) => p[1]))];
    if (points.filter((p) => distanceKm(c, p) <= 15).length >= 0.8 * points.length) return c;
  }
  return null;
}

/** Le centre de la zone : les coordonnées si elles sont saisies (elles priment), sinon le code postal. */
function centre(config: CarburantsConfig, stations: Json[]): [number, number] | null {
  const { latitude, longitude } = config;
  if (typeof latitude === 'number' && typeof longitude === 'number') return [latitude, longitude];
  const code = codePostal(config.codePostal);
  if (!code) return null;
  const c = centreDuCodePostal(stations, code);
  if (!c)
    throw new AddonCollectError(
      'not_found',
      `Le code postal ${codeEcrit(code)} ne situe aucune zone : aucune station proche ne le partage, ou il couvre un trop grand territoire. Saisissez la latitude et la longitude, ou le code postal d’une station voisine.`,
    );
  return c;
}

/** Les types de voie s'écrivent en entier ou abrégés : une seule forme des deux côtés. */
const abreviations: Record<string, string> = {
  boulevard: 'boul',
  bd: 'boul',
  blvd: 'boul',
  avenue: 'av',
  ave: 'av',
  chemin: 'ch',
  route: 'rte',
  saint: 'st',
  sainte: 'ste',
};
/** Ce qu'une adresse de Google ajoute et que la Régie n'écrit pas : province et pays. */
const motsIgnores = new Set(['qc', 'canada']);
const motsDe = (texte: string) =>
  plain(texte)
    .split(' ')
    .filter(Boolean)
    .map((m) => abreviations[m] ?? m);
/** Les mots d'une recherche de station : « 2831 Boul. Laurier, Québec, QC G1V 2L9 ». */
export const motsCherches = (requete: string) => motsDe(requete).filter((m) => !motsIgnores.has(m));
/** Les mots d'une station où chercher, code postal compris avec et sans espace. */
export const motsDeStation = (p: Json) => [
  ...motsDe(
    `${p.brand ?? ''} ${p.Name ?? ''} ${p.Address ?? ''} ${p.PostalCode ?? ''} ${p.Region ?? ''}`,
  ),
  (codePostal(p.PostalCode) ?? '').toLowerCase(),
];

/** Distance d'édition bornée : vrai si les deux mots diffèrent d'au plus une lettre. */
function uneFaute(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  // Une lettre changée, ajoutée ou retirée : le reste doit être identique.
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
  );
}

/**
 * Pertinence d'une station pour une recherche, de 0 à 1 : la part des mots cherchés qu'on y
 * retrouve, pondérée. Un mot correspond s'il commence un mot de la station (« sainte » pour
 * « Sainte-Foy »), ou à une lettre près pour les mots de cinq lettres ou plus (« Lorier »).
 * Le numéro civique doit être exact et pèse triple ; le code postal (« G1V », « 2L9 » ou « G1V2L9 »)
 * pèse double. Ainsi l'ordre des mots, la bannière absente, « QC » ou une faute de frappe ne font
 * plus échouer la recherche : les stations les plus proches de ce qui est tapé viennent en tête.
 */
export function pertinence(cherches: string[], station: string[]): number {
  if (!cherches.length) return 0;
  let total = 0;
  let trouve = 0;
  for (const m of cherches) {
    const numero = /^\d+$/u.test(m);
    const poids = numero ? 3 : /^([a-z]\d[a-z]|\d[a-z]\d|[a-z]\d[a-z]\d[a-z]\d)$/u.test(m) ? 2 : 1;
    total += poids;
    const exact = station.some((s) => (numero ? s === m : s.startsWith(m)));
    if (exact) trouve += poids;
    else if (!numero && m.length >= 5 && station.some((s) => uneFaute(m, s))) trouve += poids * 0.8;
  }
  return trouve / total;
}
/** En dessous, la station est trop loin de ce qui est tapé pour être proposée. */
const pertinenceMinimale = 0.6;

/**
 * Une exclusion écarte toute station dont la bannière, le nom ou l'adresse contient tous ses mots :
 * « Costco » écarte la bannière (réservée aux membres), « Shell Laurier » une seule station.
 */
export function exclue(p: Json, exclusions: string[] | undefined): boolean {
  const texte = ` ${motsDe(`${p.brand ?? ''} ${p.Name ?? ''} ${p.Address ?? ''}`).join(' ')} `;
  return (exclusions ?? []).some((e) => {
    const mots = motsDe(e);
    return mots.length > 0 && mots.every((m) => texte.includes(` ${m} `));
  });
}

const carburantDemande = (valeur: unknown): Carburant | null =>
  carburants.find((c) => noms[c].argument === valeur || c === valeur) ?? null;

/** Les carburants choisis, dans l'ordre des données ; un carburant demandé à la voix les remplace. */
function carburantsVoulus(config: CarburantsConfig, demande: unknown): Carburant[] {
  const un = carburantDemande(demande);
  if (un) return [un];
  const choisis = carburants.filter((c) => config.carburants?.includes(c));
  return choisis.length ? choisis : ['Régulier'];
}

async function collect(context: Context) {
  const { config } = context;
  const voulus = carburantsVoulus(config, context.args?.carburant);
  const avecCoordonnees =
    typeof config.latitude === 'number' && typeof config.longitude === 'number';
  if (!avecCoordonnees && !codePostal(config.codePostal) && !config.stationId)
    throw new AddonCollectError(
      'config_invalid',
      'Indiquez votre code postal, des coordonnées ou une station préférée.',
    );
  const { stations, releve } = await lireStations(context.http, context.signal);
  const ici = centre(config, stations);
  // Les stations du rayon, quel que soit leur code postal, sans les stations exclues.
  const dansLeRayon = ici
    ? stations
        .map((f) => {
          const [lon, lat] = f.geometry.coordinates as number[];
          return { f, distanceKm: distanceKm(ici, [lat!, lon!]) };
        })
        .filter((s) => s.distanceKm <= config.rayonKm && !exclue(s.f.properties, config.exclusions))
    : [];
  // Les carburants choisis seulement : ceux dont le foyer a besoin.
  const station = (f: Json, km: number | null): Station => ({
    nom: nomStation(f.properties),
    adresse: String(f.properties.Address ?? '')
      .trim()
      .slice(0, 160),
    distanceKm: km === null ? null : Math.round(km * 10) / 10,
    prix: voulus.map((c) => ({ carburant: c, cents: prixDe(f.properties, c) })),
  });
  let favF: Json | undefined;
  if (config.stationId) {
    favF = stations.find((s) => idStation(s) === config.stationId);
    if (!favF)
      throw new AddonCollectError(
        'not_found',
        'Station préférée introuvable : la chercher à nouveau.',
      );
  }
  let favorite: Station | null = null;
  if (favF) {
    const [lon, lat] = favF.geometry.coordinates as number[];
    favorite = station(favF, ici ? distanceKm(ici, [lat!, lon!]) : null);
  }
  // Meilleur prix de chaque carburant choisi (demande de Luc, 2026-11-12) : la station du rayon
  // la moins chère, à égalité la plus proche. La station préférée l'emporte si elle est au même
  // prix ou moins cher : rien de mieux à annoncer pour ce carburant.
  const meilleurs: Meilleur[] = ici
    ? voulus.flatMap((carburant): Meilleur[] => {
        const s = dansLeRayon
          .filter((s) => prixDe(s.f.properties, carburant) !== null)
          .sort(
            (a, b) =>
              prixDe(a.f.properties, carburant)! - prixDe(b.f.properties, carburant)! ||
              a.distanceKm - b.distanceKm,
          )[0];
        const duFavori = favF ? prixDe(favF.properties, carburant) : null;
        if (favorite && duFavori !== null && (!s || duFavori <= prixDe(s.f.properties, carburant)!))
          return [{ carburant, cents: duFavori, station: favorite, favorite: true }];
        if (!s) return [];
        return [
          {
            carburant,
            cents: prixDe(s.f.properties, carburant)!,
            station: station(s.f, s.distanceKm),
            favorite: false,
          },
        ];
      })
    : [];
  const data: CarburantsData = {
    rayonKm: config.rayonKm,
    zone: ici !== null,
    meilleurs,
    favorite,
    releve: releve.slice(0, 40) || new Date(context.now()).toISOString(),
  };
  if (!validateData(data))
    throw new AddonCollectError('malformed', 'Prix des carburants incohérents.');
  return {
    data,
    empty: !meilleurs.length && !favorite?.prix.some((p) => p.cents !== null),
    freshMs: 5 * 60_000,
    source: {
      provider: 'regie-essence-quebec',
      sourceId: `${voulus.join('+')}:${config.stationId ?? ''}`,
    },
  };
}

/** Carte : « 1,699 $/L ». */
export const enDollars = (c: number) => `${(c / 100).toFixed(3).replace('.', ',')} $/L`;
/**
 * Miroir, colonne étroite : le prix seul, arrondi au cent (« 1,91 »), l'unité dans le sous-titre.
 * Même avec une espace insécable, le miroir coupait « 1,909 $ » avant le « $ ».
 */
export const prixCourt = (c: number) => (Math.round(c) / 100).toFixed(2).replace('.', ',');
/** Miroir, quand la colonne de gauche ne porte que le carburant : « 2,07 $/L », arrondi au cent. */
export const prixLitre = (c: number) => `${prixCourt(c)} $/L`;
/** Oral : 169,9 cents → « 1 dollar 70 » ; 200 → « 2 dollars ». */
export function ditEnDollars(c: number): string {
  const total = Math.round(c);
  const dollars = Math.floor(total / 100);
  const reste = total % 100;
  const d = `${dollars} dollar${dollars > 1 ? 's' : ''}`;
  return reste ? `${d} ${String(reste).padStart(2, '0')}` : d;
}
/** « 3355 av. Duval, Québec » → « 3355 avenue Duval » (à l'oral, sans la ville). */
export function adresseDite(adresse: string): string {
  return adresse
    .split(',')[0]!
    .replace(/\bav\.\s*/giu, 'avenue ')
    .replace(/\bboul\.\s*/giu, 'boulevard ')
    .replace(/\bch\.\s*/giu, 'chemin ')
    .replace(/\brte\s+/giu, 'route ')
    .replace(/\s+/gu, ' ')
    .trim();
}
const distanceDite = (km: number) =>
  km < 1
    ? `à ${Math.max(100, Math.round(km * 10) * 100)} mètres`
    : `à ${Math.round(km)} kilomètre${Math.round(km) > 1 ? 's' : ''}`;

/** Carte : « 3,4 km », et en mètres sous le kilomètre (« 100 m » plutôt que « 0 km »). */
const km = (d: number) =>
  d < 1 ? `${Math.max(100, Math.round(d * 10) * 100)} m` : `${String(d).replace('.', ',')} km`;
/** Miroir et carte : « 2831 boul. Laurier, Québec » → « 2831 Laurier ». */
export function adresseCourte(adresse: string): string {
  return adresseDite(adresse)
    .replace(/^(\d+[a-z]?\s+)(boulevard|avenue|chemin|rue|route|rang|montée|place)\s+/iu, '$1')
    .trim();
}
const connus = (s: Station) => s.prix.filter((p) => p.cents !== null);
/** Oral : « super 1 dollar 94, diesel 2 dollars 74 ». */
const prixDits = (s: Station) =>
  connus(s)
    .map((p) => `${noms[p.carburant].argument} ${ditEnDollars(p.cents!)}`)
    .join(', ');
/** Oral : « Petro-Canada, 1350 chemin Sainte-Foy, à 4 kilomètres ». */
const stationDite = (s: Station) =>
  `${s.nom}, ${adresseDite(s.adresse)}${s.distanceKm === null ? '' : `, ${distanceDite(s.distanceKm)}`}`;
/** Petits mots d'un nom de rue, sans initiale : « de l'Église » donne « É ». */
const particules = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'au', 'aux']);
/**
 * Initiales de la rue : « 2500 René-Lévesque » donne « R-L », « 800 de l'Église » « É »,
 * « 1350 Sainte-Foy » « S-F ». Un nombre (« 4e ») est gardé tel quel.
 */
export function initialesRue(adresse: string): string {
  return initiales(adresseCourte(adresse).replace(/^\s*\d+[a-z]?\s+/iu, ''));
}
/**
 * Initiales d'un nom, sans les petits mots ; le trait d'union d'un nom composé est gardé
 * (« René-Lévesque » donne « R-L ») et un nombre (« 4e ») reste tel quel.
 */
function initiales(texte: string): string {
  return texte
    .split(/[\s’']+/u)
    .filter((mot) => mot && !particules.has(mot.toLowerCase()))
    .map((mot) =>
      mot
        .split('-')
        .filter(Boolean)
        // Un nombre (« 4e ») ou un chiffre romain (« Louis-XIV » donne « L-XIV ») reste entier.
        .map((partie) =>
          /^\d/u.test(partie) || /^[IVXLC]{2,}$/u.test(partie)
            ? partie
            : partie.charAt(0).toUpperCase(),
        )
        .join('-'),
    )
    .join('')
    .slice(0, 8);
}
/**
 * Bannière sur le miroir : en entier si elle est courte (« Esso », « Ultramar »), en initiales
 * au-delà de 8 caractères (« Petro-Canada » donne « P-C », « Canadian Tire » « CT »).
 */
export const banniere = (nom: string) => (nom.length > 8 ? initiales(nom) : nom);
/**
 * Miroir : la bannière, le numéro civique et les initiales de la rue (« Esso 2500 R-L »), pour
 * distinguer deux stations de la même bannière d'un coup d'œil.
 */
const repere = (s: Station) => {
  const numero = /^\s*(\d+[a-z]?)\b/iu.exec(s.adresse)?.[1];
  const rue = initialesRue(s.adresse);
  return [banniere(s.nom), numero, rue].filter(Boolean).join(' ');
};
/**
 * Sous-titre de la tuile à plusieurs stations : la bannière (courte) et l'adresse de chacune,
 * « Esso 2500 René-Lévesque · Mobil 2400 René-Lévesque ». Le miroir le coupe au-delà de deux
 * lignes (environ 64 caractères) : une rue déjà écrite en entier passe alors en initiales
 * (« Mobil 2400 R-L »), puis, s'il le faut encore, toutes les rues sauf la première.
 */
export function sousTitreAdresses(stations: Station[]): string {
  const parties = stations.map((s) => {
    const adresse = adresseCourte(s.adresse);
    const numero = /^\s*(\d+[a-z]?)\b/iu.exec(adresse)?.[1] ?? '';
    const rue = adresse.slice(numero.length).trim();
    return { banniere: banniere(s.nom), numero, rue, initiales: initialesRue(s.adresse) };
  });
  const ecrire = (abreger: (rue: string, i: number) => boolean) =>
    parties
      .map((p, i) =>
        [p.banniere, p.numero, abreger(p.rue, i) ? p.initiales : p.rue].filter(Boolean).join(' '),
      )
      .join(' · ');
  const limite = 64;
  const complet = ecrire(() => false);
  if (complet.length <= limite) return complet;
  const repetees = ecrire((rue, i) => parties.findIndex((p) => p.rue === rue) < i);
  if (repetees.length <= limite) return repetees;
  return ecrire((_rue, i) => i > 0);
}
/** Écrit : « Petro-Canada, 1350 Sainte-Foy ». */
const stationEcrite = (s: Station) => `${s.nom}, ${adresseCourte(s.adresse)}`;

/** « l’ordinaire et le diesel », « l’ordinaire, le super et le diesel ». */
const enumeration = (mots: string[]) =>
  mots.length < 2 ? (mots[0] ?? '') : `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}`;

/**
 * Les meilleurs prix regroupés par station, dans l'ordre des carburants : une même station la
 * moins chère pour plusieurs carburants n'est dite qu'une fois. Un carburant → une adresse ;
 * trois carburants → une à trois adresses.
 */
function parStation(meilleurs: Meilleur[]) {
  const groupes: { station: Station; favorite: boolean; prix: Meilleur[] }[] = [];
  for (const m of meilleurs) {
    const g = groupes.find(
      (g) => g.station.nom === m.station.nom && g.station.adresse === m.station.adresse,
    );
    if (g) g.prix.push(m);
    else groupes.push({ station: m.station, favorite: m.favorite, prix: [m] });
  }
  return groupes;
}

function present(
  snapshot: ModuleSnapshot<CarburantsData>,
  _context: AddonPresentContext,
): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucun prix à présenter.');
  const { favorite: fav, meilleurs } = data;
  const groupes = parStation(meilleurs);
  const oralParts: string[] = [];
  if (fav)
    oralParts.push(
      connus(fav).length
        ? `Ta station ${fav.nom}, ${adresseDite(fav.adresse)} : ${prixDits(fav)}.`
        : `Ta station ${fav.nom}, ${adresseDite(fav.adresse)}, ne publie aucun prix pour le moment.`,
    );
  const rayon = `dans un rayon de ${data.rayonKm} kilomètres`;
  if (groupes.length === 1 && groupes[0]!.favorite)
    oralParts.push(`C’est le meilleur prix ${rayon}.`);
  else if (groupes.length) {
    // Une phrase par station : « l’ordinaire à 1 dollar 70 et le diesel à 2 dollars 76 chez Mobil,
    // 4535 boulevard Henri-Bourassa, à 4 kilomètres ».
    const phrases = groupes.map((g) => {
      const prix = enumeration(
        g.prix.map((m) => `${noms[m.carburant].oral} à ${ditEnDollars(m.cents)}`),
      );
      return g.favorite ? `${prix} à ta station` : `${prix} chez ${stationDite(g.station)}`;
    });
    oralParts.push(
      `${meilleurs.length > 1 ? 'Meilleurs prix' : 'Meilleur prix'} ${rayon} : ${phrases.join(' ; ')}.`,
    );
  } else if (data.zone && !fav) oralParts.push(`Aucune station ne publie de prix ${rayon}.`);
  const items = [
    ...meilleurs.map((m) => ({
      label:
        `${noms[m.carburant].court} · ${m.favorite ? 'ta station' : stationEcrite(m.station)}`.slice(
          0,
          80,
        ),
      value: enDollars(m.cents),
    })),
    ...(fav
      ? [
          {
            label: `Ta station : ${stationEcrite(fav)}`.slice(0, 80),
            value:
              connus(fav)
                .map((p) => `${noms[p.carburant].court} ${enDollars(p.cents!)}`)
                .join(' · ')
                .slice(0, 160) || 'Aucun prix publié',
          },
        ]
      : []),
  ].slice(0, 5);
  const seule = groupes.length === 1 ? groupes[0]! : null;
  const tete = meilleurs[0]?.cents ?? (fav ? connus(fav)[0]?.cents : undefined);
  return {
    title: 'Carburants',
    primaryValue: tete === undefined || tete === null ? null : enDollars(tete),
    subtitle: seule
      ? `${seule.favorite ? 'Ta station : ' : 'Meilleur prix : '}${stationEcrite(seule.station)}${seule.station.distanceKm === null ? '' : ` (${km(seule.station.distanceKm)})`}`.slice(
          0,
          120,
        )
      : groupes.length
        ? `Meilleurs prix (${data.rayonKm} km)`
        : fav
          ? stationEcrite(fav).slice(0, 120)
          : null,
    description: snapshot.status === 'stale' ? 'Derniers prix connus, à vérifier.' : null,
    items,
    summary: (oralParts.join(' ') || 'Aucun prix à dire pour le moment.').slice(0, 500),
    sources: ['carburants_qc'],
  };
}

const addon: AddonDefinition<CarburantsConfig, CarburantsData> = {
  id: 'carburants_qc',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Régie essence Québec (Régie de l’énergie)',
  display: {
    name: 'Prix des carburants au Québec',
    // 160 caractères au plus (contrat des modules).
    description:
      'Prix des carburants au Québec (Régie de l’énergie) : votre station préférée et le meilleur prix autour de votre code postal, pour vos carburants.',
    icon: 'fuel',
    keywords: [
      'essence',
      'gaz',
      'carburant',
      'ordinaire',
      'super',
      'diesel',
      'prix',
      'station',
      'québec',
    ],
    example: { label: 'Carburants près de chez nous', ref: 'carburants' },
    spoken: { head: 'le prix de l’essence', repeats: ['essence', 'gaz', 'carburant'] },
  },
  configVersion: 1,
  configSchema,
  // Aucun lieu par défaut : chaque foyer saisit son code postal ou sa station.
  configDefaults: {
    rayonKm: 5,
    carburants: ['Régulier'],
    stationId: null,
    stationLabel: null,
    exclusions: [],
    miroir: 'Meilleur prix',
  },
  dataVersion: 1,
  dataSchema,
  freshMs: 5 * 60_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les prix des carburants au Québec (Régie de l’énergie) : la station préférée et le meilleur prix autour du code postal réglé, et afficher la carte Prix des carburants au Québec. ' +
        'Utiliser pour « combien coûte l’essence ? », « où est le gaz le moins cher ? », « et le diesel ? ». Les prix sont en dollars par litre.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
      arguments: {
        carburant: {
          type: 'string',
          enum: carburants.map((c) => noms[c].argument),
          description:
            'Un seul carburant demandé (« et le diesel ? »), à la place de ceux des réglages : ordinaire, super ou diesel.',
        },
      },
    },
  ],
  search: {
    fields: [
      {
        kind: 'station',
        label: 'Station préférée',
        target: 'stationId',
        labelTarget: 'stationLabel',
        placeholder: 'Ville, adresse ou bannière (« Québec », « Costco Lévis »)',
        clearLabel: 'Aucune station préférée',
      },
    ],
    async find(input, context) {
      if (input.kind !== 'station') return [];
      const mots = motsCherches(input.query ?? '');
      if (!mots.length || plain(input.query ?? '').length < 2) return [];
      const { stations } = await lireStations(context.http, context.signal);
      // Les plus pertinentes d'abord ; à égalité, l'ordre de la Régie.
      const trouvees = stations
        .map((f) => ({ f, score: pertinence(mots, motsDeStation(f.properties as Json)) }))
        .filter((s) => s.score >= pertinenceMinimale)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.f);
      const resultats: AddonSearchResult[] = [];
      for (const f of trouvees) {
        const p = f.properties as Json;
        resultats.push({
          id: idStation(f),
          label: `${nomStation(p)} · ${String(p.Address ?? '').trim()}`.slice(0, 120),
          detail:
            carburants
              .map((c) => [c, prixDe(p, c)] as const)
              .filter(([, prix]) => prix !== null)
              .map(([c, prix]) => `${noms[c].court} ${enDollars(prix!)}`)
              .join(' · ') || 'Aucun prix publié',
        });
        if (resultats.length >= 20) break;
      }
      return resultats;
    },
  },
  collect,
  present,
  ambient: {
    // Le miroir range chaque ligne en deux colonnes (étiquette grise, valeur en blanc) et n'en
    // montre que trois. Deux sources du module donnent deux tuiles : « Station préférée » et
    // « Meilleur prix » (choix du foyer, 2026-11-12). Le nom de la tuile est celui de la source.
    present(snapshot, context) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucun prix à afficher.');
      const { favorite: fav, meilleurs } = data;
      const tuile = (subtitle: string | null, items: { label: string; value: string }[]) => ({
        layout: 'metric' as const,
        title: 'Carburants',
        value: null,
        subtitle: subtitle?.slice(0, 120) ?? null,
        items: items.slice(0, 3),
      });
      if ((context.instance.config as CarburantsConfig).miroir === 'Station préférée')
        return fav
          ? tuile(
              stationEcrite(fav),
              fav.prix.map((p) => ({
                label: noms[p.carburant].court,
                value: p.cents === null ? '—' : prixLitre(p.cents),
              })),
            )
          : tuile('Aucune station préférée', []);
      const groupes = parStation(meilleurs);
      if (!groupes.length)
        return tuile(
          data.zone ? `Aucun prix dans un rayon de ${data.rayonKm} km` : 'Indiquez un code postal',
          [],
        );
      if (groupes.length === 1 && groupes[0]!.favorite)
        return tuile('Ta station est déjà la moins chère', []);
      const seule = groupes.length === 1 ? groupes[0]! : null;
      // Une seule station pour tous les carburants : elle en sous-titre, puis type et prix.
      if (seule)
        return tuile(
          `${stationEcrite(seule.station)}${seule.station.distanceKm === null ? '' : ` (${km(seule.station.distanceKm)})`}`,
          seule.prix.map((m) => ({ label: noms[m.carburant].court, value: prixLitre(m.cents) })),
        );
      // Plusieurs stations. Le miroir rétrécit les deux colonnes d'une ligne ensemble dès qu'elle
      // déborde : une adresse dans une ligne écrasait le prix ou le carburant (« 1,9 / 1 »,
      // « Supe / r »). Les lignes restent donc courtes (« Super · Esso », « 1,91 $/L ») et les
      // adresses passent dans le sous-titre, qui occupe toute la largeur.
      // Jusqu'à trois carburants, donc trois stations. La ligne ne porte que la bannière
      // (« Diesel · Mobil »), sauf quand la même bannière revient à des adresses différentes (deux
      // Esso) : alors le numéro civique et les initiales de la rue (« Super · Esso 2500 R-L »). Le
      // sous-titre donne les adresses complètes, dans le même ordre. Le prix se contente de « $ »
      // pour que la ligne tienne entière.
      const stations = groupes.filter((g) => !g.favorite).map((g) => g.station);
      const doublons = new Set(
        stations.map((s) => s.nom).filter((nom, i, liste) => liste.indexOf(nom) !== i),
      );
      const adresses = sousTitreAdresses(stations);
      return tuile(
        adresses || `Rayon de ${data.rayonKm} km`,
        meilleurs.map((m) => ({
          label: `${noms[m.carburant].court} · ${
            m.favorite
              ? 'ta station'
              : doublons.has(m.station.nom)
                ? repere(m.station)
                : banniere(m.station.nom)
          }`.slice(0, 80),
          value: prixLitre(m.cents),
        })),
      );
    },
  },
};

export default addon;
