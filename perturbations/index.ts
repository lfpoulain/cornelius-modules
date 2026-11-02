/**
 * Perturbations : les annonces de trafic qui touchent les lignes et les arrêts du foyer.
 * Source : SIRI-SX du hub suisse (opentransportdata.swiss), qui rassemble les annonces de
 * tous les exploitants, TL comprises.
 */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type PerturbationsConfig = { lignes: string; arrets: string; limite: number };

type Perturbation = {
  lignes: string[];
  lieux: string[];
  texte: string;
  fin: string | null;
  cause: string | null;
};

type PerturbationsData = {
  perturbations: Perturbation[];
  filtre: { lignes: string[]; arrets: string[] };
};

const feedUrl = 'https://api.opentransportdata.swiss/la/siri-sx-unplanned';

/** Tout le flux fait plusieurs mégaoctets : on le borne, sans le tronquer par surprise. */
const maxFeedBytes = 16 * 1024 * 1024;

/** Texte comparable : accents retirés, minuscules, espaces simples. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/** « B 7 » et « 7 » désignent la même ligne : on ne garde que le numéro quand il y en a un. */
function lineKey(value: string): string {
  const compact = fold(value).replace(/\s+/gu, '');
  const numbered = /^([a-z]{1,3})?(\d{1,3})$/u.exec(compact);
  return numbered ? numbered[2]! : compact;
}

/** Décode les quelques entités que le flux utilise dans ses textes. */
function decode(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gu, '&')
    .trim();
}

function textTag(block: string, tag: string, lang = 'FR'): string | null {
  const match = new RegExp(`<${tag} xml:lang="${lang}">([\\s\\S]*?)</${tag}>`, 'u').exec(block);
  return match ? decode(match[1]!) : null;
}

function allTags(block: string, tag: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gu');
  for (const match of block.matchAll(pattern)) {
    const value = decode(match[1]!);
    if (value) found.push(value);
  }
  return found;
}

/** Tous les textes d'une balise dans une langue donnée, espaces normalisés. */
function textsIn(block: string, tag: string, lang = 'FR'): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag} xml:lang="${lang}">([\\s\\S]*?)</${tag}>`, 'gu');
  for (const match of block.matchAll(pattern)) {
    const value = decode(match[1]!).replace(/\s+/gu, ' ').trim();
    if (value) found.push(value);
  }
  return found;
}

/** Fin de validité : la première période suffit, les annonces en ont une seule en pratique. */
function endTime(block: string): string | null {
  const match = /<ValidityPeriod>[\s\S]*?<EndTime>([^<]+)<\/EndTime>/u.exec(block);
  if (!match) return null;
  const parsed = new Date(match[1]!.trim());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/**
 * Le flux publie la même annonce en trois tailles (S, M, L), plus un résumé d'en-tête, et tous
 * les exploitants ne remplissent pas tout. Dans l'ordre : la variante S, faite pour l'oral ; le
 * résumé d'en-tête, qui est une phrase entière ; puis le plus court des textes qui restent, à
 * condition qu'il soit informatif — les fragments du genre « Concerne : ligne 7 » ne le sont pas.
 */
function bestText(block: string): string | null {
  for (const section of block.split('<TextualContent>').slice(1)) {
    if (!/<TextualContentSize>S<\/TextualContentSize>/u.test(section)) continue;
    const short = textTag(section, 'SummaryText');
    if (short && short.length >= 12) return short;
  }
  const summary = textTag(block, 'Summary');
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

/** Une annonce, ramenée à ses lignes, ses lieux et une phrase en français. */
function readSituation(block: string): Perturbation | null {
  const texte =
    bestText(block) ??
    textTag(block, 'Summary', 'DE') ??
    textTag(block, 'SummaryText', 'EN') ??
    textTag(block, 'Summary');
  if (!texte) return null;
  const lignes = [
    ...new Set(allTags(block, 'PublishedLineName').map((line) => line.slice(0, 24))),
  ].slice(0, 6);
  const lieux = [
    ...new Set([...allTags(block, 'PlaceName'), ...allTags(block, 'StopPlaceName')]),
  ].slice(0, 4);
  const cause = textTag(block, 'ReasonText') ?? null;
  return {
    lignes,
    lieux: lieux.map((lieu) => lieu.slice(0, 80)),
    texte: texte.replace(/\s+/gu, ' ').slice(0, 300),
    fin: endTime(block),
    cause: cause ? cause.replace(/\s+/gu, ' ').slice(0, 120) : null,
  };
}

/** Une annonce nous concerne-t-elle ? Par ses lignes, ses lieux, ou son texte. */
function concerns(perturbation: Perturbation, lignes: string[], arrets: string[]): boolean {
  if (lignes.length === 0 && arrets.length === 0) return true;
  const lines = new Set(perturbation.lignes.map(lineKey));
  if (lignes.some((ligne) => lines.has(lineKey(ligne)))) return true;
  const haystack = fold(`${perturbation.lieux.join(' ')} ${perturbation.texte}`);
  return arrets.some((arret) => {
    // Nom entier, pas sous-chaîne : « Chailly » ne doit pas attraper « Chailly-sur-Montreux ».
    // Les deux formes sont essayées, avec la ville (« Lausanne, Chailly-Village ») et sans.
    const comma = arret.indexOf(',');
    const noms = [fold(arret), comma >= 0 ? fold(arret.slice(comma + 1)) : ''].filter(
      (nom) => nom.length >= 3,
    );
    return noms.some((nom) => new RegExp(`(?:^| )${nom}(?: |$)`, 'u').test(haystack));
  });
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
  // Le flux est limité à deux appels par minute : dix minutes de cache, le maximum du cœur.
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
    const lignes = context.config.lignes
      .split(/[,;]/u)
      .map((ligne) => ligne.trim())
      .filter((ligne) => ligne.length > 0);
    const arrets = context.config.arrets
      .split(/[,;]/u)
      .map((arret) => arret.trim())
      .filter((arret) => arret.length > 0);
    const limite = Math.min(8, Math.max(1, Math.round(context.config.limite)));

    const response = await context.http.fetch({
      url: feedUrl,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: context.signal,
      timeoutMs: 20_000,
      maxBytes: maxFeedBytes,
      // Deux appels par minute au plus côté fournisseur : on garde la réponse dix minutes.
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
    // Ce qui n'est pas du SIRI-SX est refusé ; un SIRI-SX sans annonce, lui, est une bonne
    // nouvelle : « rien à signaler », et la carte le dit.
    if (!/<Siri[\s>]/u.test(body))
      throw new AddonCollectError('malformed', 'Réponse SIRI-SX illisible.', false);
    const nowMs = context.now();
    const found: Perturbation[] = [];
    for (const block of body.split('<PtSituationElement>').slice(1)) {
      const perturbation = readSituation(block);
      if (!perturbation) continue;
      // Une annonce terminée reste dans le flux un moment : on l'écarte.
      if (perturbation.fin && new Date(perturbation.fin).getTime() < nowMs) continue;
      if (!concerns(perturbation, lignes, arrets)) continue;
      found.push(perturbation);
    }
    // La coupe à `limite` ne doit pas fausser le total annoncé à l'oral.
    const retenues = found.slice(0, limite);
    return {
      data: { perturbations: retenues, filtre: { lignes, arrets } },
      empty: retenues.length === 0,
      source: { provider: 'siri-sx', sourceId: lignes.join(', ') || arrets.join(', ') || 'toutes' },
    };
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune perturbation à présenter.');
    const filtre = [...data.filtre.lignes, ...data.filtre.arrets].join(', ') || 'tout le réseau';
    const nombre = data.perturbations.length;
    if (nombre === 0) {
      return {
        title: 'Perturbations',
        primaryValue: 'Aucune',
        subtitle: filtre.slice(0, 120),
        description: null,
        items: [],
        summary: `Aucune perturbation signalée pour ${filtre}.`,
        sources: ['opendata.swiss'],
      };
    }
    const items = data.perturbations.slice(0, 5).map((perturbation) => ({
      label: (perturbation.lignes.join(', ') || perturbation.lieux.join(', ') || 'Annonce').slice(
        0,
        80,
      ),
      value: firstSentence(perturbation.texte, 160),
    }));
    const first = data.perturbations[0]!;
    return {
      title: 'Perturbations',
      primaryValue: `${nombre} perturbation${nombre > 1 ? 's' : ''}`,
      subtitle: filtre.slice(0, 120),
      description: snapshot.status === 'stale' ? 'Dernier relevé connu, à vérifier.' : null,
      items,
      summary: firstSentence(
        `${nombre} perturbation${nombre > 1 ? 's' : ''} en cours pour ${filtre}. ` +
          `${first.lignes.length > 0 ? `${first.lignes.join(', ')} : ` : ''}${first.texte}`,
        200,
      ),
      sources: ['opendata.swiss'],
    };
  },
};

export default addon;
