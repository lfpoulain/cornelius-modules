/**
 * Radio : fait jouer un poste de radio sur le miroir (« mets France Inter », « trouve un poste
 * de jazz »), d'après l'annuaire de Jokobee™ Radio. Chaque demande renvoie un seul poste, déjà
 * vérifié en train de jouer : flux audio direct en https et logo. Le cœur relaie et joue le flux
 * (outil de lecture, Cornelius 0.4.1).
 */
import {
  AddonCollectError,
  type AddonCollectContext,
  type AddonDefinition,
  type AddonPresentation,
  type ModuleSnapshot,
} from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type RadioConfig = { pays?: string | null };
type RadioData = { poste: string | null; pays: string | null };
type Poste = { nom: string; flux: string; logo: string | null; pays: string | null };
type Context = AddonCollectContext<RadioConfig>;

/** Adresse de l'API de l'annuaire, réservée au module Radio de Cornelius. */
export const api = 'https://radio.jokobee.com/api/cornelius/v1/poste';
/** Page où chaque personne obtient sa clé gratuite, avec son adresse courriel. */
export const pageCle = 'https://radio.jokobee.com/cornelius';

/** Fuseaux des pays proposés en premier, d'après le fuseau du foyer. */
const paysDuFuseau: Record<string, string> = {
  'Europe/Paris': 'FR',
  'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH',
  'Europe/Luxembourg': 'LU',
  'Europe/Monaco': 'MC',
};
const fuseauxCanadiens = new Set(
  [
    'Atikokan',
    'Blanc-Sablon',
    'Cambridge_Bay',
    'Creston',
    'Dawson',
    'Dawson_Creek',
    'Edmonton',
    'Fort_Nelson',
    'Glace_Bay',
    'Goose_Bay',
    'Halifax',
    'Inuvik',
    'Iqaluit',
    'Moncton',
    'Montreal',
    'Rankin_Inlet',
    'Regina',
    'Resolute',
    'St_Johns',
    'Swift_Current',
    'Toronto',
    'Vancouver',
    'Whitehorse',
    'Winnipeg',
    'Yellowknife',
  ].map((zone) => `America/${zone}`),
);

/** Pays où chercher d'abord : le réglage de la source, sinon celui du fuseau du foyer. */
export function paysDuFoyer(config: RadioConfig, timeZone: string): string | null {
  if (config.pays) return config.pays;
  if (fuseauxCanadiens.has(timeZone) || timeZone.startsWith('Canada/')) return 'CA';
  return paysDuFuseau[timeZone] ?? null;
}

/** Une réponse de l'API, vérifiée champ par champ avant d'être rendue au lecteur. */
function poste(value: unknown): Poste {
  const p = (value as { poste?: Record<string, unknown> } | null)?.poste;
  const nom = typeof p?.nom === 'string' ? p.nom.trim() : '';
  const flux = typeof p?.flux === 'string' ? p.flux : '';
  const logo = typeof p?.logo === 'string' && p.logo.startsWith('https://') ? p.logo : null;
  const pays = typeof p?.pays === 'string' && /^[A-Z]{2}$/u.test(p.pays) ? p.pays : null;
  if (!nom || !flux.startsWith('https://') || flux.length > 2000)
    throw new AddonCollectError('malformed', 'Réponse illisible de l’annuaire des postes.');
  return { nom: nom.slice(0, 80), flux, logo: logo && logo.length <= 2000 ? logo : null, pays };
}

/** Un poste par son nom, ou au hasard dans un genre. */
async function trouver(context: Context, cle: string, demande: { nom?: string; genre?: string }) {
  const params = new URLSearchParams();
  if (demande.nom) params.set('nom', demande.nom);
  if (demande.genre) params.set('genre', demande.genre);
  const pays = paysDuFoyer(context.config, context.timeZone);
  if (pays) params.set('pays', pays);
  const response = await context.http.fetch({
    url: `${api}?${params}`,
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${cle}` },
    signal: context.signal,
    // L'annuaire vérifie que le flux joue vraiment avant de répondre.
    timeoutMs: 15_000,
    maxBytes: 64 * 1024,
  });
  let body: { erreur?: string } | null = null;
  try {
    body = response.json() as { erreur?: string };
  } catch {
    if (response.status === 200)
      throw new AddonCollectError('malformed', 'Réponse illisible de l’annuaire des postes.');
  }
  if (response.status === 200) return poste(body);
  if (response.status === 404) return null;
  if (response.status === 401)
    throw new AddonCollectError(
      'auth',
      body?.erreur === 'ailleurs'
        ? 'Cette clé sert déjà à un autre Cornelius : chaque Cornelius a besoin de sa propre clé.'
        : `Clé Radio refusée : obtenez-en une sur ${pageCle}.`,
    );
  if (response.status === 429)
    throw new AddonCollectError('quota', 'Limite de demandes atteinte pour aujourd’hui.', true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', 'L’annuaire des postes est indisponible.', true);
  throw new AddonCollectError('upstream', `Réponse HTTP ${response.status} inattendue.`);
}

async function collect(context: Context) {
  const cle = context.secret('radioKey')?.trim();
  if (!cle)
    throw new AddonCollectError(
      'config_invalid',
      `Clé Radio absente : obtenez-la gratuitement sur ${pageCle}.`,
    );
  const pays = paysDuFoyer(context.config, context.timeZone);
  // Tester, affichage : rien à jouer, aucune demande à l'annuaire (la limite est par jour).
  if (!context.play || !context.query)
    return {
      data: { poste: null, pays },
      source: { provider: 'jokobee-radio', sourceId: 'radio' },
    };
  const demande = context.query.replace(/\s+/gu, ' ').trim().slice(0, 80);
  const genre = context.args?.genre === true;
  const trouve = await trouver(context, cle, genre ? { genre: demande } : { nom: demande });
  if (!trouve)
    throw new AddonCollectError(
      'not_found',
      genre
        ? `Aucun poste de « ${demande} » disponible.`
        : `Aucun poste « ${demande} » disponible sur Cornelius.`,
    );
  return {
    data: { poste: trouve.nom, pays },
    source: { provider: 'jokobee-radio', sourceId: 'radio' },
    playback: {
      url: trouve.flux,
      title: trouve.nom,
      subtitle: 'En direct',
      imageUrl: trouve.logo,
      kind: 'live' as const,
    },
  };
}

function present(snapshot: ModuleSnapshot<RadioData>): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucun poste à présenter.');
  return {
    title: 'Radio',
    primaryValue: data.poste,
    subtitle: data.poste ? 'En direct sur le miroir' : 'Prête : demandez un poste par son nom',
    description: null,
    items: [],
    summary: data.poste
      ? `${data.poste} joue sur le miroir.`
      : 'La radio est prête : demandez un poste par son nom, ou un genre.',
    sources: ['radio'],
  };
}

const parametres = (description: string) => ({
  type: 'object' as const,
  additionalProperties: false,
  required: ['instanceRef', 'query'],
  properties: {
    instanceRef: { type: ['string', 'null'] },
    query: { type: 'string', description },
  },
});

const addon: AddonDefinition<RadioConfig, RadioData> = {
  id: 'radio',
  apiVersion: 1,
  version: '1.0.0',
  // Outil de lecture : Cornelius 0.4.1. Provisoirement omis tant que beta annonce 0.4.0.
  sourceLabel: 'radio.jokobee.com',
  display: {
    name: 'Radio',
    // 160 caractères au plus (contrat des modules).
    description:
      'Fait jouer un poste de radio sur le miroir, par son nom ou au hasard dans un genre. Source : radio.jokobee.com · radio@jokobee.com.',
    icon: 'music',
    keywords: ['radio', 'poste', 'station', 'musique', 'écouter', 'joue', 'mets'],
    example: { label: 'Radio', ref: 'radio' },
    spoken: { head: 'la radio', repeats: ['radio', 'poste', 'station'] },
  },
  secrets: [
    {
      name: 'radioKey',
      env: 'CORNELIUS_RADIO_KEY',
      label: 'une clé Radio',
      url: pageCle,
      note: 'gratuite, une par adresse courriel',
    },
  ],
  configVersion: 1,
  configSchema,
  configDefaults: { pays: null },
  dataVersion: 1,
  dataSchema,
  freshMs: 60_000,
  tools: [
    {
      name: 'ecouter',
      description:
        'Faire jouer un poste de radio sur le miroir, par son nom (« mets France Inter », « mets RTL »). query : le nom du poste. ' +
        'Pour un genre (« trouve un poste de jazz »), utiliser l’argument genre.',
      parameters: parametres('Le nom du poste, ou le genre si genre est vrai.'),
      query: { maxLength: 80 },
      arguments: {
        genre: {
          type: 'boolean',
          description:
            'Vrai quand la demande est un genre de musique ou de contenu (« jazz », « classique », « nouvelles ») : un poste au hasard de ce genre.',
        },
      },
      play: true,
    },
  ],
  collect,
  present,
};

export default addon;
