/**
 * Trajets de la STS (Sherbrooke) : autobus. Le trajet et les passages viennent de Transitous
 * (horaires GTFS de la STS), sans jeton, par la bibliothèque commune `_lib/transitous.ts`.
 * Transitous n'a pas de temps réel pour la STS : les heures sont dites « selon l'horaire ». Le jour
 * où il en aura, l'indicateur realTime est déjà lu.
 */
import type { AddonDefinition } from '#cornelius/addons';
import {
  collecteur,
  descriptionOutil,
  outilTrajet,
  presentation,
  trajetSchema,
  type Leg,
  type Reseau,
  type TrajetConfig,
  type TrajetData,
} from '../_lib/transitous.js';
import configSchema from './config.schema.json' with { type: 'json' };

export { arretDit, destinationFor, lieuDit, surLaRue } from '../_lib/transitous.js';

/** Le réseau, dit après le véhicule ; rien pour la STS, réseau du module. */
export function reseauDit(leg: Leg): string {
  const id = String(leg.agencyId ?? '').trim();
  const nom = String(leg.agencyName ?? '').trim();
  if (id === 'STS' || /Société de transport de Sherbrooke/iu.test(nom)) return '';
  return nom ? ` (${nom})` : '';
}

const reseau: Reseau = {
  id: 'sts',
  sigle: 'STS',
  ville: 'Sherbrooke',
  centre: '45.404,-71.893',
  reseauDit,
};

const addon: AddonDefinition<TrajetConfig, TrajetData> = {
  id: 'sts',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Transitous (horaires de la STS)',
  display: {
    name: 'Transports STS',
    // 160 caractères au plus (contrat des modules).
    description:
      'Région de Sherbrooke, au Québec : autobus de la STS ; prochain départ selon l’horaire, durée du trajet et départ suivant.',
    icon: 'bus',
    keywords: ['autobus', 'bus', 'sts', 'trajet', 'transport', 'sherbrooke', 'estrie'],
    example: { label: 'Depuis la maison', ref: 'maison' },
    spoken: { head: 'le trajet', repeats: ['trajet', 'autobus', 'bus'] },
  },
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
        'dans la région de Sherbrooke, au Québec (autobus de la STS)',
        '« comment je vais à l’Université de Sherbrooke ? », « c’est quand le prochain autobus pour le Carrefour de l’Estrie ? »',
        '« à l’Université de Sherbrooke », « au Cégep de Sherbrooke »',
      ),
    ),
  ],
  collect: collecteur(reseau),
  present: presentation(reseau),
};

export default addon;
