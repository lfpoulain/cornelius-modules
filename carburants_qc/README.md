# Module Prix des carburants au Québec

Le module Prix des carburants au Québec donne **les prix de votre station préférée et le meilleur prix de chaque carburant autour de votre code postal**, pour les carburants dont vous avez besoin, d’après les prix que les détaillants déclarent à la Régie de l’énergie. Prix en dollars, carburants québécois : ordinaire, super, diesel. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `carburants_qc`).

Le module Prix des carburants livré pour la France (`carburants`) ne convient pas au Québec : autres données, autres carburants (SP95, gazole…), prix en euros.

## Ce que fait le module

- Il répond à « combien coûte l’essence ? », « où est le gaz le moins cher ? » ou « et le diesel ? ». Exemples réels (relevé du 12 novembre 2026, code postal G1V 2L9) :

  > Meilleurs prix dans un rayon de 5 kilomètres : l’ordinaire à 1 dollar 67 et le super à 1 dollar 87 chez Costco, 3233 avenue Watt, à 3 kilomètres ; le diesel à 2 dollars 77 chez Shell, 2831 boulevard Laurier, à 100 mètres.

  Avec super et diesel et la station préférée Shell du boulevard Laurier :

  > Ta station Shell, 2831 boulevard Laurier : super 2 dollars 07, diesel 2 dollars 77. Meilleurs prix dans un rayon de 5 kilomètres : le super à 1 dollar 87 chez Costco, 3233 avenue Watt, à 3 kilomètres ; le diesel à 2 dollars 77 à ta station.

- **Carburants** : un, deux ou les trois, selon vos besoins. La Régie ne publie que ces trois-là : ni l’intermédiaire (octane 89, « Plus » ou « Extra » selon les bannières), ni l’E85, ni le propane.
- **Meilleur prix de chaque carburant**, avec le nom et l’adresse de la station : la moins chère du rayon, à égalité la plus proche. Une station la moins chère pour plusieurs carburants n’est dite qu’une fois : un carburant donne une adresse, trois carburants d’une à trois adresses. Si la station préférée est au même prix ou moins chère pour un carburant, c’est elle qui est retenue (« à ta station ») ; si elle l’est pour tous, Cornelius dit « C’est le meilleur prix ».
- **Autour de chez vous** : le code postal place le centre de la zone ; toutes les stations du rayon comptent ensuite, quel que soit leur code postal.
- **Stations exclues** : une bannière (« Costco » si vous n’êtes pas membre) ou une station (« Shell Laurier ») n’est jamais proposée comme meilleur prix. La station préférée reste dite.
- **Sur le miroir** (affichage permanent) : le miroir range chaque ligne en deux colonnes (étiquette en gris, valeur en blanc) et n’en montre que trois. Le réglage « Sur le miroir » choisit la tuile de la source ; deux sources du module donnent deux tuiles (le nom de la tuile est celui de la source) :

  ```text
  MEILLEUR PRIX                          MA STATION
  Rayon de 5 km                          Shell, 2831 Laurier
  Super · Costco, 3233 Watt  1,869 $/L   Super          2,069 $/L
  Diesel · ta station        2,769 $/L   Diesel         2,769 $/L
  ```

  Quand une seule station est la moins chère pour tous les carburants, elle passe en sous-titre et les lignes ne portent que le type et le prix. La tuile « Meilleur prix » affiche « Ta station est déjà la moins chère » quand c’est le cas ; pour cela, la station préférée doit aussi être réglée dans cette source. Le miroir montre moins de tuiles sur un petit écran (deux sur un téléphone). Pas de moyenne.
- Prix en dollars : 169,9 ¢ se dit « 1 dollar 70 » et s’affiche « 1,699 $/L ». L’ordinaire des données s’appelle « Régulier » ; Cornelius dit « l’ordinaire ».
- Le relevé reste en cache 1 minute ; une réponse est rafraîchie après 5 minutes.

## Sources des données

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Stations, adresses, prix déclarés | [Régie essence Québec](https://regieessencequebec.ca/) (Régie de l’énergie), `stations.geojson.gz` | Données publiques, gratuites, sans jeton ; la Loi sur les produits pétroliers oblige les détaillants à déclarer leurs prix. Aucune licence n’est publiée. |

Un seul fichier (environ 2 Mo une fois décompressé, 2 471 stations) sert à tout : zone, prix et recherche de la station.

## Réglages d’une source

Dans **Modules → Prix des carburants au Québec → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Code postal | Centre de la zone (« G1V 2L9 », avec ou sans espace) | vide |
| Latitude, longitude | Au choix, à la place du code postal ; si elles sont saisies, elles passent avant | vides |
| Rayon de recherche | De 1 à 50 km autour du centre | 5 km |
| Carburants | Un ou plusieurs : ordinaire (« Régulier »), super, diesel ; « et le diesel ? » se demande aussi à la voix | Régulier |
| Station préférée | Cherchée par bannière, adresse, ville ou code postal, dans n’importe quel ordre ; une adresse copiée de Google convient | aucune |
| Stations exclues | Jusqu’à 10 bannières ou stations écartées | aucune |
| Sur le miroir | La tuile de cette source : « Meilleur prix » ou « Station préférée » | Meilleur prix |

Le module ne contient aucun lieu par défaut : chaque foyer saisit son code postal, ses coordonnées ou sa station préférée.

## Recherche de la station préférée

La recherche classe les stations par pertinence au lieu d’exiger chaque mot tapé : « 2831 Boul. Laurier, Québec, QC G1V 2L9 » copiée de Google, « Laurier 2831 », « Shell Laurier » ou « G1V 2L9 » trouvent la station. Règles :

- l’ordre des mots est libre, la bannière facultative, « QC » et « Canada » sont ignorés ;
- « boulevard » et « boul. », « avenue » et « av. », « chemin » et « ch. », « Saint » et « St » se valent ;
- un mot peut n’être que le début d’un mot de la station (« sainte » pour « Sainte-Foy ») ; à partir de cinq lettres, une faute d’une lettre est tolérée (« Lorier » pour « Laurier ») ;
- le numéro civique doit être exact et pèse le plus ; le code postal, avec ou sans espace, pèse double ;
- une station est proposée si elle réunit au moins 60 % du poids des mots tapés, les plus pertinentes en tête (20 au plus).

## Vie privée

**Le code postal ne quitte pas Cornelius.** Le module télécharge le relevé complet de la Régie et situe le code postal d’après les stations qui le partagent : aucun géocodeur, aucune requête qui contienne le code postal ou les coordonnées.

## Limites

- **Code postal sans station** : le centre est celui des stations qui portent le même code ; à défaut, celui des stations de la même région de tri (les trois premiers caractères, « G1V »). Médiane plutôt que moyenne, pour qu’une station mal placée ne déplace pas la zone.
- **Régions rurales** : un code de région de tri rurale (deuxième caractère 0, comme G0A, de Portneuf à Charlevoix) couvre parfois des centaines de kilomètres. Si le code exact n’a pas de station et que les stations de la région de tri sont trop éloignées les unes des autres (moins de 80 % à 15 km de leur centre), le module le dit plutôt que de chercher au mauvais endroit : saisir alors la latitude et la longitude, ou le code postal d’une station voisine. Sur le relevé du 12 novembre 2026, 343 régions de tri sur 383 et 2 156 codes exacts sur 2 159 situent une zone.
- **Distances à vol d’oiseau** : à Québec, une station de Lévis peut être à 4 km de l’autre côté du fleuve.
- Les prix sont ceux que les détaillants déclarent ; une station qui ne déclare pas un carburant n’est pas comptée pour lui.
- Les stations n’ont pas d’identifiant dans les données : la station préférée est retrouvée par ses coordonnées. Si la Régie la déplace sur la carte, il faut la chercher à nouveau.

## Outil vocal et affichage permanent

L’outil s’appelle `carburants_qc__read`. Il reçoit facultativement un carburant (`carburant` : `ordinaire`, `super` ou `diesel`), à la place de ceux des réglages. L’affichage permanent est décrit plus haut.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
