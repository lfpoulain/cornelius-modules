/**
 * Perturbations : les annonces de trafic qui touchent les lignes et les arrêts du foyer.
 * Source : SIRI-SX du hub suisse (opentransportdata.swiss), qui rassemble les annonces de
 * tous les exploitants, TL comprises.
 */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };
import { plainText, tagText } from '../_lib/flux.js';

type PerturbationsConfig = { lignes: string; arrets: string; limite: number };

type Perturbation = {
  /** Numéros publics des lignes touchées, tels que le voyageur les lit (`PublishedLineName`). */
  lignes: string[];
  /**
   * Les mêmes lignes sous la forme « exploitant:numéro public » : l'exploitant vient de
   * `LineRef` (« 85:801:2242 » donne 801), le numéro de `PublishedLineName` (121). C'est ce qui
   * distingue la ligne 121 de CarPostal de toutes les autres lignes 121 du pays.
   */
  reseaux: string[];
  lieux: string[];
  texte: string;
  fin: string | null;
  cause: string | null;
};

type PerturbationsData = {
  perturbations: Perturbation[];
  /** Annonces trouvées pour le foyer, avant la coupe à `limite`. */
  total: number;
  filtre: { lignes: string[]; arrets: string[] };
};

const feedUrl = 'https://api.opentransportdata.swiss/la/siri-sx-unplanned';

/** Tout le flux peut peser plusieurs mégaoctets : on le borne, sans le tronquer par surprise. */
const maxFeedBytes = 16 * 1024 * 1024;

/** Une carte de miroir montre cinq lignes au plus : c'est aussi la limite du réglage. */
const maxAnnonces = 5;

/** Balise d'ouverture d'une annonce, avec ou sans préfixe d'espace de noms et attributs. */
const situationOpening = /<(?:\w+:)?PtSituationElement\b[^>]*>/gu;

/** Texte comparable : accents retirés, minuscules, espaces simples. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/**
 * Nom de lieu comparable : comme `fold`, mais le tiret reste. « Chailly-sur-Montreux » est un
 * seul mot, qui ne se confond plus avec « Chailly ».
 */
function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, ' ')
    .replace(/\s*-\s*/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/(?:^-|-$)/gu, '')
    .trim();
}

/**
 * « B 7 », « Bus 7 » et « 7 » désignent la même ligne : on retire le seul mot « bus », que le
 * flux n'écrit pas. Les autres lettres font partie du nom : « m2 » n'est pas le bus 2, « S1 »
 * ni « IC 1 » ne sont la ligne 1.
 */
function lineKey(value: string): string {
  const compact = fold(value).replace(/\s+/gu, '');
  const bus = /^(?:bus|b)(\d{1,4}[a-z]?)$/u.exec(compact);
  return bus ? bus[1]! : compact;
}

/** Les annonces d'un flux SIRI-SX, préfixes d'espace de noms retirés pour la lecture. */
function situations(body: string): { found: number; blocks: string[] } {
  const xml = body.replace(/<(\/?)\w+:(?=\w)/gu, '<$1');
  const openings = [...xml.matchAll(situationOpening)];
  const blocks: string[] = [];
  for (const [index, opening] of openings.entries()) {
    const start = opening.index + opening[0].length;
    const next = openings[index + 1]?.index ?? xml.length;
    const end = xml.indexOf('</PtSituationElement>', start);
    // Une annonce sans fermeture avant la suivante (ou la fin) est coupée : on ne la lit pas.
    if (end >= 0 && end <= next) blocks.push(xml.slice(start, end));
  }
  return { found: openings.length, blocks };
}

/** Contenu de toutes les balises `name` du bloc, attributs permis. */
function allContents(block: string, name: string): string[] {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gu');
  return [...block.matchAll(pattern)].map((match) => match[1] ?? '');
}

/** Textes d'une balise dans une langue donnée (`xml:lang`), où que soit l'attribut. */
function textsIn(block: string, name: string, lang = 'FR'): string[] {
  const pattern = new RegExp(
    `<${name}\\s[^>]*\\bxml:lang="${lang}"[^>]*>([\\s\\S]*?)</${name}>`,
    'gu',
  );
  return [...block.matchAll(pattern)]
    .map((match) => plainText(match[1] ?? ''))
    .filter((value) => value.length > 0);
}

function textIn(block: string, name: string, lang = 'FR'): string | null {
  return textsIn(block, name, lang)[0] ?? null;
}

function instant(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Période de validité qui contient maintenant : chaque `ValidityPeriod` est lue pour elle-même,
 * sans déborder sur la suivante. `en cours` est faux si aucune période n'a commencé ou si toutes
 * sont terminées ; `fin` est la fin de la période en cours, ou null si elle est ouverte.
 */
function validity(block: string, now: number): { enCours: boolean; fin: string | null } {
  const periods = allContents(block, 'ValidityPeriod');
  // Sans période, l'annonce vaut tant qu'elle est publiée.
  if (periods.length === 0) return { enCours: true, fin: null };
  for (const period of periods) {
    const start = instant(tagText(period, 'StartTime'));
    const end = instant(tagText(period, 'EndTime'));
    if (start !== null && start > now) continue;
    if (end !== null && end < now) continue;
    return { enCours: true, fin: end === null ? null : new Date(end).toISOString() };
  }
  return { enCours: false, fin: null };
}

/**
 * Le flux publie la même annonce en trois tailles (S, M, L), plus un résumé d'en-tête, et tous
 * les exploitants ne remplissent pas tout. Dans l'ordre : la variante S, faite pour l'oral ; le
 * résumé d'en-tête, qui est une phrase entière ; puis le plus court des textes qui restent, à
 * condition qu'il soit informatif — les fragments du genre « Concerne : ligne 7 » ne le sont pas.
 */
function bestText(block: string): string | null {
  for (const section of allContents(block, 'TextualContent')) {
    if (tagText(section, 'TextualContentSize') !== 'S') continue;
    const short = textIn(section, 'SummaryText');
    if (short && short.length >= 12) return short;
  }
  const summary = textIn(block, 'Summary');
  if (summary && summary.length >= 12) return summary;
  const others = textsIn(block, 'SummaryText').filter((value) => value.length >= 20);
  if (others.length === 0) return null;
  others.sort((a, b) => a.length - b.length);
  return others[0]!;
}

/** Coupe à la première phrase : une carte de miroir se lit d'un coup d'œil. */
function firstSentence(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const period = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('.\n'),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  if (period >= max * 0.4) return cut.slice(0, period + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** « 85:801:2242 » donne 801 : le pays, l'exploitant, puis un identifiant interne. */
function operatorOf(lineRef: string): string | null {
  const parts = lineRef
    .split(':')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length >= 2 ? parts[parts.length - 2]! : null;
}

/** Une annonce, ramenée à ses lignes, ses lieux et une phrase en français. */
function readSituation(block: string): Omit<Perturbation, 'fin'> | null {
  const texte =
    bestText(block) ??
    textIn(block, 'Summary', 'DE') ??
    textIn(block, 'SummaryText', 'EN') ??
    tagText(block, 'Summary');
  if (!texte) return null;
  const lignes = new Set<string>();
  const reseaux = new Set<string>();
  for (const line of allContents(block, 'AffectedLine')) {
    // Le numéro public est celui du voyageur ; `LineRef` ne sert qu'à nommer l'exploitant.
    const published = tagText(line, 'PublishedLineName')?.slice(0, 24);
    if (!published) continue;
    lignes.add(published);
    const operator = operatorOf(tagText(line, 'LineRef') ?? '');
    if (operator) reseaux.add(`${operator}:${lineKey(published)}`.slice(0, 40));
  }
  // Une ligne citée hors d'un bloc `AffectedLine` reste une ligne touchée.
  for (const content of allContents(block, 'PublishedLineName')) {
    const published = plainText(content).slice(0, 24);
    if (published) lignes.add(published);
  }
  const lieux = new Set(
    [...allContents(block, 'PlaceName'), ...allContents(block, 'StopPlaceName')]
      .map((content) => plainText(content).slice(0, 80))
      .filter((lieu) => lieu.length > 0),
  );
  const cause = textIn(block, 'ReasonText');
  return {
    lignes: [...lignes].slice(0, 6),
    reseaux: [...reseaux].filter((reseau) => reseau.length >= 3).slice(0, 6),
    lieux: [...lieux].slice(0, 4),
    texte: texte.slice(0, 300),
    cause: cause ? cause.slice(0, 120) : null,
  };
}

/** Le nom surveillé figure-t-il, mot pour mot, dans ce texte ? Tirets compris. */
function phraseIn(haystack: string, nom: string): boolean {
  const escaped = nom.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^| )${escaped}(?: |$)`, 'u').test(haystack);
}

/**
 * Un lieu de l'annonce (« Lausanne, Chailly-Village ») correspond-il au nom surveillé ?
 * - « Lausanne, Chailly-Village » : la même localité, et le même arrêt ou un arrêt qui commence
 *   par ce nom.
 * - « Chailly » : la localité entière (« Chailly » seul), ou un arrêt de n'importe quelle
 *   localité qui porte ce nom ou commence par lui (« Chailly-Village »). Une autre localité
 *   (« Chailly-Montreux, village ») n'est pas « Chailly ».
 */
function placeMatches(lieu: string, surveille: string): boolean {
  const split = (value: string) => {
    const comma = value.indexOf(',');
    return comma >= 0
      ? { localite: foldName(value.slice(0, comma)), arret: foldName(value.slice(comma + 1)) }
      : { localite: foldName(value), arret: '' };
  };
  const place = split(lieu);
  const wanted = split(surveille);
  const arretMatches = (arret: string, nom: string) =>
    nom.length >= 3 &&
    (arret === nom ||
      arret.startsWith(`${nom}-`) ||
      arret.startsWith(`${nom} `) ||
      arret.split(' ').includes(nom));
  if (wanted.arret)
    return place.localite === wanted.localite && arretMatches(place.arret, wanted.arret);
  return place.localite === wanted.localite || arretMatches(place.arret, wanted.localite);
}

/** Une annonce nous concerne-t-elle ? Par ses lignes, ses lieux, ou son texte. */
function concerns(
  perturbation: Omit<Perturbation, 'fin'>,
  lignes: string[],
  arrets: string[],
): boolean {
  if (lignes.length === 0 && arrets.length === 0) return true;
  const lines = new Set(perturbation.lignes.map(lineKey));
  const reseaux = new Set(perturbation.reseaux);
  for (const ligne of lignes) {
    // « 801:121 » désigne la ligne 121 de l'exploitant 801, sans ramasser les autres lignes 121.
    const avecOperateur = /^([^:]+):(.+)$/u.exec(ligne.trim());
    if (avecOperateur) {
      if (reseaux.has(`${avecOperateur[1]!.trim()}:${lineKey(avecOperateur[2]!)}`)) return true;
      continue;
    }
    if (lines.has(lineKey(ligne))) return true;
  }
  const texte = foldName(perturbation.texte);
  return arrets.some(
    (arret) =>
      perturbation.lieux.some((lieu) => placeMatches(lieu, arret)) ||
      // Dans le texte libre, le nom doit y être entier : « Chailly » n'attrape pas
      // « Chailly-sur-Montreux », et « Lausanne, Chailly-Village » se cherche tel quel.
      (foldName(arret).length >= 3 && phraseIn(texte, foldName(arret))),
  );
}

/** Réglage en liste : `séparateurs` découpe, les entrées vides tombent. */
function listOf(value: string, separators: RegExp): string[] {
  return value
    .split(separators)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const addon: AddonDefinition<PerturbationsConfig, PerturbationsData> = {
  id: 'perturbations',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'opentransportdata.swiss',
  display: {
    name: 'Perturbations',
    description: 'Travaux, déviations et lignes interrompues, sur les lignes et arrêts du foyer.',
    icon: 'bell',
    group: 'daily',
    keywords: ['perturbation', 'travaux', 'déviation', 'retard', 'ligne', 'bus', 'trafic'],
    example: { label: 'Mes lignes', ref: 'mes-lignes' },
    spoken: { head: 'les perturbations', repeats: ['perturbations'] },
  },
  secrets: [
    {
      name: 'siriSxToken',
      env: 'CORNELIUS_SIRI_SX_TOKEN',
      label: 'un jeton SIRI-SX',
      url: 'https://api-manager.opentransportdata.swiss/',
      note: 'gratuit',
    },
  ],
  configVersion: 1,
  configSchema,
  configDefaults: {
    lignes: 'B 7, B 8',
    arrets: 'Chailly',
    limite: 5,
  },
  dataVersion: 1,
  dataSchema,
  // Le flux est limité à deux appels par minute : une lecture reste fraîche dix minutes, et le
  // cœur ne redemande pas le flux pendant ce temps.
  freshMs: 10 * 60_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les perturbations en cours sur les lignes et les arrêts du foyer et afficher la ' +
        'carte des perturbations. Utiliser pour « y a-t-il une perturbation ? », « ça roule sur ' +
        'la ligne 7 ? », « des travaux sur mon bus ? », « pourquoi mon bus est en retard ? ». ' +
        'Sans annonce, le dire simplement : l’absence de perturbation est une information.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const token = context.secret('siriSxToken');
    if (!token)
      throw new AddonCollectError(
        'config_invalid',
        'Jeton SIRI-SX absent : ajoutez CORNELIUS_SIRI_SX_TOKEN dans le fichier .env.',
        false,
      );
    // Une ligne ne contient jamais de virgule : les deux séparateurs sont permis. Un arrêt, lui,
    // peut s'écrire « Lausanne, Chailly-Village » : la liste des arrêts se sépare par « ; ».
    const lignes = listOf(context.config.lignes, /[,;]/u);
    const arrets = listOf(context.config.arrets, /;/u);
    const limite = Math.min(maxAnnonces, Math.max(1, Math.round(context.config.limite)));

    const response = await context.http.fetch({
      url: feedUrl,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: context.signal,
      timeoutMs: 20_000,
      maxBytes: maxFeedBytes,
      // Le cœur ne garde en cache que les réponses modestes : un flux lourd est retéléchargé, et
      // c'est la fraîcheur de dix minutes (`freshMs`) qui tient la limite du fournisseur.
      cacheMs: 10 * 60_000,
    });
    if (response.status === 401 || response.status === 403)
      throw new AddonCollectError(
        'auth',
        'Jeton SIRI-SX refusé : vérifiez CORNELIUS_SIRI_SX_TOKEN.',
        false,
      );
    if (response.status === 429)
      throw new AddonCollectError(
        'quota',
        'Le flux SIRI-SX limite à deux appels par minute : réessayez dans un instant.',
        true,
      );
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'Le flux SIRI-SX ne répond pas.', true);
    if (response.status !== 200)
      throw new AddonCollectError(
        'upstream',
        `Le flux SIRI-SX a répondu ${response.status}.`,
        false,
      );
    const body = response.text();
    // Un flux coupé au plafond de lecture donnerait des annonces incomplètes : on le dit.
    if (response.truncated)
      throw new AddonCollectError(
        'malformed',
        'Le flux SIRI-SX dépasse la taille lue : annonces incomplètes.',
        false,
      );
    // Ce qui n'est pas du SIRI-SX est refusé ; un SIRI-SX sans annonce, lui, est une bonne
    // nouvelle : « rien à signaler », et la carte le dit.
    if (!/<(?:\w+:)?Siri[\s>]/u.test(body))
      throw new AddonCollectError('malformed', 'Réponse SIRI-SX illisible.', false);
    const { found: balises, blocks } = situations(body);
    const lues = blocks.map(readSituation);
    // Des annonces présentes mais aucune lisible : le format a changé ou le flux est coupé. Dire
    // « aucune perturbation » serait un faux « rien à signaler ».
    if (balises > 0 && !lues.some((lue) => lue !== null))
      throw new AddonCollectError(
        'malformed',
        'Flux SIRI-SX illisible : annonces présentes mais aucune lue.',
        false,
      );
    const nowMs = context.now();
    const trouvees: Perturbation[] = [];
    for (const [index, lue] of lues.entries()) {
      if (!lue) continue;
      // Une annonce terminée reste dans le flux un moment, et une annonce peut être publiée
      // avant de commencer : seules celles en cours sont retenues.
      const periode = validity(blocks[index]!, nowMs);
      if (!periode.enCours) continue;
      if (!concerns(lue, lignes, arrets)) continue;
      trouvees.push({ ...lue, fin: periode.fin });
    }
    // Le total est celui des annonces trouvées ; la coupe à `limite` ne vaut que pour la carte.
    // L'ordre reste celui du flux : c'est le fournisseur qui décide de la priorité.
    const retenues = trouvees.slice(0, limite);
    return {
      data: { perturbations: retenues, total: trouvees.length, filtre: { lignes, arrets } },
      empty: retenues.length === 0,
      source: {
        provider: 'siri-sx',
        sourceId: (lignes.join(', ') || arrets.join('; ') || 'toutes').slice(0, 128),
      },
    };
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune perturbation à présenter.');
    const filtre =
      [...data.filtre.lignes, ...data.filtre.arrets].join(', ').slice(0, 120) || 'tout le réseau';
    const nombre = Math.max(data.total, data.perturbations.length);
    if (nombre === 0) {
      return {
        title: 'Perturbations',
        primaryValue: 'Aucune',
        subtitle: filtre,
        description: null,
        items: [],
        summary: `Aucune perturbation signalée pour ${filtre}.`,
        sources: ['perturbations'],
      };
    }
    const items = data.perturbations.slice(0, maxAnnonces).map((perturbation) => ({
      label: (perturbation.lignes.join(', ') || perturbation.lieux.join(', ') || 'Annonce').slice(
        0,
        80,
      ),
      value: firstSentence(perturbation.texte, 160),
    }));
    const montrees = items.length;
    const first = data.perturbations[0]!;
    return {
      title: 'Perturbations',
      primaryValue: `${nombre} perturbation${nombre > 1 ? 's' : ''}`,
      subtitle: filtre,
      description:
        snapshot.status === 'stale'
          ? 'Dernier relevé connu, à vérifier.'
          : montrees < nombre
            ? `Les ${montrees} premières sur ${nombre}.`
            : null,
      items,
      summary: firstSentence(
        `${nombre} perturbation${nombre > 1 ? 's' : ''} en cours pour ${filtre}. ` +
          `${first.lignes.length > 0 ? `${first.lignes.join(', ')} : ` : ''}${first.texte}`,
        200,
      ),
      sources: ['perturbations'],
    };
  },
};

export default addon;
