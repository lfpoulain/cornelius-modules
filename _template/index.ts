/** Exemple pédagogique : remplacer le fournisseur fictif avant toute installation. */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type ParkingConfig = { parkingId: string };
type ParkingData = { name: string; available: number };

// Ici le fournisseur fictif utilise déjà le format normalisé du module.
// Avec une API réelle, valider sa réponse puis convertir vers ParkingData.
const validatePayload = compile<ParkingData>(dataSchema);
const baseUrl = 'https://parking.example.invalid';

const addon: AddonDefinition<ParkingConfig, ParkingData> = {
  id: 'parking',
  apiVersion: 1,
  version: '1.0.0',
  // Les extensions de Cornelius 0.2.0 (display, arguments, refreshAt, timeZone…) : le
  // déclarer fait refuser proprement le module par un Cornelius plus ancien.
  minCoreVersion: '0.2.0',
  sourceLabel: 'Parkings (démonstration)',
  // Présentation dans l'administration : nom, phrase, icône (liste dans la référence),
  // exemple de source et tournure de la phrase à prononcer (« les places de la gare »).
  display: {
    name: 'Parking',
    description: 'Places libres du parking de votre choix.',
    icon: 'car',
    keywords: ['parking', 'places', 'stationnement'],
    example: { label: 'Parking de la gare', ref: 'gare' },
    spoken: { head: 'les places', repeats: ['parking', 'places'] },
  },
  // Facultatif : jetons à renseigner dans le fichier .env. Le module les lit par
  // context.secret(name) ; l'administration affiche « Ce module a besoin d’<label> (<note>).
  // Ajoutez <env> dans le fichier .env puis redémarrez Cornelius. », avec le lien url, et
  // bloque l'ajout de source tant que le jeton manque. Elle ne voit jamais sa valeur.
  //   name  : nom passé à context.secret() ;
  //   env   : variable du fichier .env, en majuscules (CORNELIUS_…) ;
  //   label : nom du jeton précédé de « un » ou « une » ;
  //   url   : page d'inscription (http ou https) ; note : précision courte, ex. « gratuit » ;
  //   optional : true si le module fonctionne sans (moins de fonctions), cœur 0.4.1 et plus.
  // La déclaration suffit : server/app.ts branche chaque jeton déclaré, saisi dans
  // l'administration ou lu dans le fichier .env. Rien d'autre à ajouter dans le cœur.
  // secrets: [
  //   {
  //     name: 'parkingToken',
  //     env: 'CORNELIUS_PARKING_TOKEN',
  //     label: 'un jeton Parkings',
  //     url: 'https://parking.example.invalid/inscription',
  //     note: 'gratuit',
  //   },
  // ],
  configVersion: 1,
  configSchema,
  configDefaults: { parkingId: 'demo' },
  dataVersion: 1,
  dataSchema,
  freshMs: 60_000,
  // Un outil peut aussi être un outil à la demande (query), avoir des arguments typés, ou
  // faire écouter un flux sur le miroir (play: true, cœur 0.4.1 : collect rend alors
  // playback). Voir « L'outil de lecture » dans docs/modules/reference.md de Cornelius.
  tools: [
    {
      name: 'read',
      description:
        'Lire les places disponibles du parking configuré et afficher sa carte. ' +
        'Utiliser pour « reste-t-il des places au parking ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const response = await context.http.fetch({
      url: `${baseUrl}/parkings/${encodeURIComponent(context.config.parkingId)}`,
      method: 'GET',
      signal: context.signal,
      timeoutMs: 4000,
      maxBytes: 32 * 1024,
    });
    if (response.status === 401 || response.status === 403)
      throw new AddonCollectError('auth', 'Accès au fournisseur refusé.');
    if (response.status === 404) throw new AddonCollectError('not_found', 'Parking introuvable.');
    if (response.status === 429)
      throw new AddonCollectError('quota', 'Quota du fournisseur atteint.', true);
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'Fournisseur indisponible.', true);
    if (response.status !== 200)
      throw new AddonCollectError('upstream', `Réponse HTTP ${response.status} inattendue.`);
    let payload: unknown;
    try {
      payload = response.json();
    } catch {
      throw new AddonCollectError('malformed', 'Réponse du fournisseur illisible.');
    }
    if (!validatePayload(payload))
      throw new AddonCollectError('malformed', 'Disponibilité du parking invalide.');
    return {
      data: { name: payload.name, available: payload.available },
      // Zéro place est une information utile : ce n'est pas un résultat « empty ».
      source: { provider: 'parking-demo', sourceId: context.config.parkingId },
      // Pas de date d'observation inventée : fetchedAt sera fourni par le cœur.
    };
  },
  ambient: {
    present(snapshot) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucune disponibilité à afficher.');
      return {
        layout: 'metric',
        title: 'Parking',
        value: `${data.available} places`,
        subtitle: data.name,
        items: [],
      };
    },
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune disponibilité à présenter.');
    const stale = snapshot.status === 'stale';
    return {
      title: 'Parking',
      primaryValue: `${data.available} place${data.available === 1 ? '' : 's'}`,
      subtitle: data.name,
      description: stale ? 'Dernière disponibilité connue, à vérifier.' : null,
      items: [],
      summary: stale
        ? `Dernière disponibilité connue à ${data.name} : ${data.available} places ; à vérifier.`
        : `${data.name} : ${data.available} places disponibles.`,
      sources: ['parking'],
    };
  },
};

export default addon;
