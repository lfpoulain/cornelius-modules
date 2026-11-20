/**
 * Trajets de la région métropolitaine de Montréal : métro, autobus et REM de la STM, autobus du
 * RTL, autobus et trains d'exo. Le trajet et les passages viennent de Transitous (horaires
 * officiels GTFS), sans jeton, par la bibliothèque commune `_lib/transitous.ts`.
 *
 * Avec la clé d'API de la STM du foyer (facultative), deux plus pour les trajets de la STM :
 * l'état du service (avis sur la ligne) et l'heure réelle des autobus (GTFS-RT, lue seulement
 * par un cœur qui sait rendre un corps binaire). Sans clé, l'horaire de Transitous, sans avis.
 */
import type { AddonDefinition } from '#cornelius/addons';
import {
  collecteur,
  descriptionOutil,
  outilTrajet,
  presentation,
  trajetSchema,
  vehiculeDit as vehiculeDuReseau,
  type Context,
  type Leg,
  type Passage,
  type Reseau,
  type TrajetConfig,
  type TrajetData,
} from '../_lib/transitous.js';
import configSchema from './config.schema.json' with { type: 'json' };
import { lirePassages, type PassagesReels } from './gtfs-rt.js';

export { arretDit, destinationFor, lieuDit, surLaRue } from '../_lib/transitous.js';

/** Nom du jeton lu par `context.secret()`. */
const cle = 'stmApiKey';

/**
 * Le réseau, dit après le véhicule (« l’autobus 28 du RTL ») ; rien pour la STM, réseau par
 * défaut du module, ni pour le REM, déjà nommé.
 */
export function reseauDit(leg: Leg): string {
  const id = String(leg.agencyId ?? '').trim();
  const nom = String(leg.agencyName ?? '').trim();
  if (id === 'STM' || /^Société de transport de Montréal$/iu.test(nom) || /\bREM\b/u.test(nom))
    return '';
  if (id === 'RTL' || /Longueuil/u.test(nom)) return ' du RTL';
  if (id === 'STL' || /Société de transport de Laval/iu.test(nom)) return ' de la STL';
  if (/^exo\b/iu.test(nom)) return ' d’exo';
  return nom ? ` (${nom})` : '';
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
    .trim()
    .replace(/'/gu, '’');
  if (clean.length <= 200 && /[.!?]$/u.test(clean)) return clean;
  const court = clean.slice(0, 200);
  const fin = Math.max(court.lastIndexOf('. '), court.lastIndexOf('! '), court.lastIndexOf('? '));
  return fin > 40 ? court.slice(0, fin + 1) : court.trim();
}

/**
 * Temps réel de la STM (GTFS-RT TripUpdates, protobuf, environ 2 Mo pour tout le réseau, sans
 * filtre possible) : lu seulement si le cœur sait rendre un corps binaire (`bytes()`), gardé
 * 30 secondes dans le cache partagé. Le métro n'y figure pas : ses passages restent prévus.
 */
const tempsReelUrl = 'https://api.stm.info/pub/od/gtfs-rt/ic/v2/tripUpdates';
/** Le cœur n'a pas `bytes()` : inutile de retélécharger 2 Mo à chaque question. */
let sansLectureBinaire = false;
/** Vrai si le cœur a montré qu'il ne sait pas rendre un corps binaire (tests, diagnostic). */
export const coeurSansLectureBinaire = () => sansLectureBinaire;

/** « 20261111_15:20_ca-qc-STM_302247349 » (Transitous) → « 302247349 » (STM). */
export function voyageStm(tripId: string): string {
  return /STM_([^_]+)$/u.exec(tripId)?.[1] ?? '';
}

async function passagesReels(
  context: Context,
  apiKey: string,
  voyages: Set<string>,
): Promise<PassagesReels> {
  if (!voyages.size || sansLectureBinaire) return new Map();
  try {
    const response = await context.http.fetch({
      url: tempsReelUrl,
      method: 'GET',
      headers: { Accept: 'application/x-protobuf', apiKey },
      signal: context.signal,
      timeoutMs: 8000,
      maxBytes: 6 * 1024 * 1024,
      cacheMs: 30_000,
    });
    // `bytes()` arrive avec Cornelius 0.4.0 : sans lui (0.3.0), l'horaire.
    const bytes = (response as { bytes?: () => Uint8Array }).bytes;
    if (typeof bytes !== 'function') {
      sansLectureBinaire = true;
      return new Map();
    }
    if (response.status !== 200 || response.truncated) return new Map();
    return lirePassages(bytes.call(response), voyages);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    // Clé refusée, quota, panne ou flux illisible : les heures restent celles de l'horaire.
    return new Map();
  }
}

/** État du service de la STM (JSON, ~14 ko) : une lecture par 3 minutes au plus, par Cornelius. */
const etatService = 'https://api.stm.info/pub/od/i3/v1/messages/etatservice';

/**
 * Avis en cours sur la ligne (« ouverture tardive », détour…), sans « Service normal ». Un plus :
 * clé refusée, quota ou panne, et la réponse reste celle de l'horaire, sans avis.
 */
async function avisStm(context: Context, apiKey: string, ligne: string): Promise<string[]> {
  try {
    const response = await context.http.fetch({
      url: etatService,
      method: 'GET',
      headers: { Accept: 'application/json', apiKey },
      signal: context.signal,
      timeoutMs: 4000,
      maxBytes: 512 * 1024,
      // Trois minutes : un avis change rarement.
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

/** Un arrêt de la STM chez Transitous : « ca-qc-STM_51051 ». */
const arretStm = (stopId: string) => /^ca-qc-STM_(.+)$/u.exec(stopId)?.[1] ?? '';

const reseau: Reseau = {
  id: 'stm',
  sigle: 'STM',
  ville: 'Montréal',
  centre: '45.508,-73.587',
  avisDit: 'Avis de la STM',
  reseauDit,
  vehicule(leg) {
    if (leg.mode !== 'TRAM') return undefined;
    // « A4-A1 » (branches communes) ne se dit pas : « le REM » suffit.
    const short = String(leg.routeShortName ?? '').trim();
    return short && !short.includes('-') ? `le REM ${short}` : 'le REM';
  },
  async tempsReel(context: Context, passages: Passage[], stopId: string) {
    const apiKey = context.secret(cle);
    const arret = arretStm(stopId);
    if (!apiKey || !arret) return [];
    const voyages = passages.map((p) => voyageStm(p.tripId));
    const reels = await passagesReels(context, apiKey, new Set(voyages.filter(Boolean)));
    return voyages.map((voyage) => reels.get(voyage)?.get(arret));
  },
  async complement(context, { ligne, stopId }) {
    // L'état du service est celui de la STM : un autobus 8 du RTL n'a pas les avis de la ligne 8.
    if (!arretStm(stopId)) return {};
    const apiKey = context.secret(cle);
    if (!apiKey) return { remarque: 'Horaire seulement : sans clé STM, ni avis ni temps réel.' };
    return { avis: await avisStm(context, apiKey, ligne) };
  },
};

export const vehiculeDit = (leg: Leg) => vehiculeDuReseau(leg, reseau);

const addon: AddonDefinition<TrajetConfig, TrajetData> = {
  id: 'stm',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Transitous et état du service STM',
  display: {
    // « Transports STM » : rangé à côté de « Transports » (Île-de-France) et « Transports RTC ».
    name: 'Transports STM',
    // 160 caractères au plus (contrat des modules).
    description:
      'Région métropolitaine de Montréal, au Québec : métro, autobus, train et REM (STM, RTL, exo), trajet, départs et avis de la STM.',
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
  // Facultative : sans elle, le module reste à l'horaire de Transitous, sans avis ni temps réel.
  secrets: [
    {
      name: cle,
      env: 'CORNELIUS_STM_API_KEY',
      label: 'une clé d’API de la STM',
      url: 'https://portail.developpeurs.stm.info/apihub/#/signup',
      note: 'facultative : avis et temps réel',
    },
  ],
  configVersion: 1,
  configSchema,
  // Aucun lieu par défaut : chaque foyer saisit le sien (rien de personnel dans le module partagé).
  configDefaults: { favoris: [] },
  dataVersion: 1,
  dataSchema: trajetSchema,
  freshMs: 60_000,
  tools: [
    outilTrajet(
      descriptionOutil(
        reseau,
        'dans la région métropolitaine de Montréal, au Québec (STM, RTL à Longueuil, exo : autobus et trains de banlieue, REM)',
        '« comment je vais au Centre Bell ? », « c’est quand le prochain métro pour l’Université de Montréal ? »',
        '« au Centre Bell », « à l’Université de Montréal »',
      ) + ' S’il y a un avis de la STM, dis-le à la fin.',
    ),
  ],
  collect: collecteur(reseau),
  present: presentation(reseau),
};

export default addon;
