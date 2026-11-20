/**
 * Trajets du RTC (Québec) : autobus, Métrobus et correspondances. Le trajet et les passages
 * viennent de Transitous (horaires GTFS du RTC), sans jeton, par la bibliothèque commune
 * `_lib/transitous.ts`. Les heures sans temps réel sont dites « selon l'horaire ».
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

/** Le réseau, dit après le véhicule (« l’autobus 11 de la STLévis ») ; rien pour le RTC. */
export function reseauDit(leg: Leg): string {
  const id = String(leg.agencyId ?? '').trim();
  const nom = String(leg.agencyName ?? '').trim();
  if (id === 'RTC' || /Réseau de transport de la Capitale|^RTC$/iu.test(nom)) return '';
  if (/Société de transport de Lévis/iu.test(nom)) return ' de la STLévis';
  return nom ? ` (${nom})` : '';
}

const reseau: Reseau = {
  id: 'rtc',
  sigle: 'RTC',
  ville: 'Québec',
  centre: '46.813,-71.208',
  reseauDit,
};

const addon: AddonDefinition<TrajetConfig, TrajetData> = {
  id: 'rtc',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Transitous (horaires du RTC)',
  display: {
    // « Transports RTC » : rangé à côté de « Transports » (Île-de-France) dans l'administration.
    name: 'Transports RTC',
    // 160 caractères au plus (contrat des modules).
    description:
      'Région de Québec : autobus et Métrobus du RTC ; prochain départ, durée du trajet et départ suivant.',
    icon: 'bus',
    keywords: ['autobus', 'bus', 'rtc', 'trajet', 'transport', 'québec', 'métrobus'],
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
        'dans la région de Québec (autobus et Métrobus du RTC)',
        '« comment je vais à l’Université Laval ? », « c’est quand le prochain autobus pour Place Laurier ? »',
        '« au Château Frontenac », « à l’Université Laval »',
      ),
    ),
  ],
  collect: collecteur(reseau),
  present: presentation(reseau),
};

export default addon;
