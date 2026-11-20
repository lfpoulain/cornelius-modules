/**
 * Trajets de la STO (Gatineau) : autobus et Rapibus, avec les correspondances d'OC Transpo vers
 * Ottawa. Le trajet, les passages et leur heure réelle viennent de Transitous (horaires GTFS et
 * temps réel de la STO), sans jeton, par la bibliothèque commune `_lib/transitous.ts`. Les heures
 * sans temps réel sont dites « selon l'horaire ».
 */
import type { AddonDefinition } from '#cornelius/addons';
import {
  collecteur,
  descriptionOutil,
  outilTrajet,
  presentation,
  trajetSchema,
  vehiculeDit as vehiculeDuReseau,
  type Leg,
  type Reseau,
  type TrajetConfig,
  type TrajetData,
} from '../_lib/transitous.js';
import configSchema from './config.schema.json' with { type: 'json' };

export { arretDit, destinationFor, lieuDit, surLaRue } from '../_lib/transitous.js';

/**
 * Le réseau, dit après le véhicule (« l’autobus 95 d’OC Transpo ») ; rien pour la STO, réseau par
 * défaut du module.
 */
export function reseauDit(leg: Leg): string {
  const id = String(leg.agencyId ?? '').trim();
  const nom = String(leg.agencyName ?? '').trim();
  if (id === 'STO' || /^STO$|Société de transport de l.Outaouais/iu.test(nom)) return '';
  if (/OC Transpo/iu.test(nom)) return ' d’OC Transpo';
  return nom ? ` (${nom})` : '';
}

const reseau: Reseau = {
  id: 'sto',
  sigle: 'STO',
  ville: 'Gatineau',
  centre: '45.477,-75.701',
  reseauDit,
  vehicule(leg) {
    if (leg.mode !== 'TRAM') return undefined;
    // L'O-Train d'OC Transpo, à Ottawa.
    const short = String(leg.routeShortName ?? '').trim();
    return short ? `l’O-Train, ligne ${short}` : 'l’O-Train';
  },
};

export const vehiculeDit = (leg: Leg) => vehiculeDuReseau(leg, reseau);

const addon: AddonDefinition<TrajetConfig, TrajetData> = {
  id: 'sto',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Transitous (horaires et temps réel de la STO)',
  display: {
    name: 'Transports STO',
    // 160 caractères au plus (contrat des modules).
    description:
      'Région de Gatineau, au Québec : autobus et Rapibus de la STO, correspondances OC Transpo vers Ottawa ; prochain départ, durée, suivant.',
    icon: 'bus',
    keywords: ['autobus', 'bus', 'rapibus', 'sto', 'trajet', 'transport', 'gatineau', 'ottawa'],
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
        'dans la région de Gatineau, au Québec (STO : autobus et Rapibus ; OC Transpo pour aller à Ottawa)',
        '« comment je vais au Musée canadien de l’histoire ? », « c’est quand le prochain autobus pour le centre-ville d’Ottawa ? »',
        '« au Musée canadien de l’histoire », « à la station de la Gappe »',
      ),
    ),
  ],
  collect: collecteur(reseau),
  present: presentation(reseau),
};

export default addon;
