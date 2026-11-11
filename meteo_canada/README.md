# Module Météo Canada

Le module Météo Canada donne la météo d’une ville canadienne d’après Environnement et Changement climatique Canada : conditions actuelles, prévisions des prochaines périodes et avertissements en vigueur, avec des icônes. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `meteo_canada`).

## Ce que fait le module

- Il répond à « quel temps fait-il ? », « va-t-il neiger ce soir ? » ou « y a-t-il un avertissement météo ? » et affiche une carte « Météo · Québec » : la température, la condition et le ressenti, puis une ligne par période (« Ce soir et cette nuit », « Jeudi »…). Exemple réel :

  > À Québec, il fait 2 degrés, partiellement nuageux, ressenti moins 6. Ce soir et cette nuit : généralement nuageux, minimum moins 6. Jeudi : alternance de soleil et de nuages, maximum 3.

- **Avertissements** : un avertissement en vigueur (verglas, pluie, vent, tempête…) passe en première ligne de la carte et est dit à la fin. Il disparaît à son expiration.
- **Icônes** : chaque condition reçoit son icône (soleil, lune, nuages, pluie, neige, verglas, orage, brouillard, vent), d’après les codes officiels d’Environnement Canada. Avec un Cornelius qui sait dessiner les icônes des cartes (`cardIcons`), ce sont de vraies icônes ; sinon, des émojis dans le texte de la carte (☀️ ⛅ 🌧️ ❄️ ⚠️). Ni l’un ni l’autre n’est dit à la voix.
- **Affichage permanent** : la température en grand, la condition (ou l’avertissement) et les deux prochaines périodes.
- Le ressenti n’est dit que s’il est plausible (refroidissement éolien à 10 °C ou moins, humidex à 20 °C ou plus) : la source en publie parfois d’absurdes.
- Les données restent en cache 10 minutes ; Environnement Canada met ses pages à jour environ toutes les heures.

## Sources des données

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Conditions, prévisions, avertissements | [API GeoMet-OGC](https://api.weather.gc.ca/) d’Environnement et Changement climatique Canada, collection `citypageweather-realtime`, en français | [Licence du gouvernement ouvert – Canada](https://open.canada.ca/fr/licence-du-gouvernement-ouvert-canada), sans jeton |
| Liste des villes (`villes.json`) | La même collection, réduite à l’identifiant, au nom et aux coordonnées des 844 villes (relevée le 2026-11-11) | Idem |

La liste complète des villes pèse 28 Mo chez Environnement Canada : le module en garde une copie réduite (31 Ko) pour trouver une ville sans requête, puis ne lit que la page de cette ville (environ 35 Ko).

## Réglages d’une source

Dans **Modules → Météo Canada → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Ville | Nom d’une ville d’Environnement Canada (« Québec », « Lévis »), suivi au besoin de la province pour un homonyme (« Windsor, ON ») | Montréal |
| Latitude, longitude | Au choix, à la place de la ville : la ville la plus proche (150 km au plus) ; si elles sont saisies, elles passent avant | vides |
| Périodes de prévision | Nombre de périodes affichées, de 1 à 5 ; les deux premières sont dites à la voix | 3 |

Sans province, une ville du Québec passe d’abord, puis la première de la liste.

## Limites

- Canada seulement, aux 844 villes d’Environnement Canada : un village absent prend le nom de la ville voisine, ou des coordonnées.
- Certaines stations ne donnent pas de condition ni de code d’icône : la carte ne montre alors que la température, sans rien inventer.
- En panne, le module répond « Environnement Canada est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `meteo_canada__read`, sans précision à la voix. Avec « Afficher en permanence sur le miroir », le miroir montre la température, la condition ou l’avertissement, et les deux prochaines périodes.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
