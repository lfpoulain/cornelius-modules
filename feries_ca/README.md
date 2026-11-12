# Module Jours fériés au Canada

Le module Jours fériés au Canada donne **le prochain jour férié et les suivants** de votre province ou territoire, ou ceux du calendrier fédéral si votre employeur le suit, d’après [canada-holidays.ca](https://canada-holidays.ca). Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `feries_ca`).

Le module Vacances et jours fériés livré pour la France (`vacances`) ne convient pas au Canada : autres jours, autre source.

## Ce que fait le module

- Il répond à « c’est quand le prochain congé férié ? », « est-ce férié lundi ? » ou « c’est quand l’Action de grâce ? » et affiche une carte « Jours fériés · Québec ». Exemple réel (12 novembre 2026, Québec) :

  > Le prochain jour férié au Québec : Noël, le vendredi 25 décembre, dans 43 jours. Ensuite : le Jour de l’An, le vendredi 1er janvier ; le Vendredi saint ou lundi de Pâques, au choix de l’employeur, le vendredi 26 mars.

- Le jour même : « Aujourd’hui, c’est la Fête nationale du Québec, jour férié au Québec. »
- La liste de l’année en cours et de la suivante est dans les données de la réponse : Cornelius peut répondre pour n’importe quel jour férié de ces deux années.
- **Date observée** : quand un jour férié tombe une fin de semaine et qu’il est reporté, le congé observé est dit (« congé observé le lundi 28 décembre »). Les jours sont comptés dans le fuseau du foyer.
- **Québec** : la loi laisse à l’employeur le choix entre le Vendredi saint et le lundi de Pâques ; la source ne donne que le premier, le module le précise.
- **Affichage permanent** : le compte à rebours jusqu’au prochain jour férié (« Dans 43 jours », « Noël · 25 déc. ») et les deux suivants, recalculé à minuit.

## Sources des données

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Jours fériés par province et territoire, et des employeurs fédéraux | [canada-holidays.ca](https://canada-holidays.ca/api) (`/api/v1/provinces/{code}`, `/api/v1/holidays?federal=true`) | Gratuit, sans jeton ; chaque province renvoie aussi le lien de sa source officielle (CNESST pour le Québec) |

Deux requêtes par relevé (l’année en cours et la suivante), gardées un jour en cache.

## Réglages d’une source

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Province ou territoire | Les 13 provinces et territoires | Québec |
| Mon employeur suit le calendrier fédéral | À cocher pour un employeur sous réglementation fédérale (banques, transport aérien, ferroviaire et interprovincial, télécommunications, fonction publique fédérale) : les jours fériés fédéraux remplacent ceux de la province | non coché |

## Limites

- Seuls les jours fériés reconnus par la province (ou le fédéral) : pas les congés propres à une entreprise, une convention collective ou une municipalité.
- Le calendrier scolaire n’est pas couvert : il n’existe pas de source commune au Canada, ni même au Québec.
- canada-holidays.ca est un service bénévole sans garantie : en panne, le module répond « canada-holidays.ca est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `feries_ca__read`. L’affichage permanent montre le prochain jour férié et les deux suivants.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
