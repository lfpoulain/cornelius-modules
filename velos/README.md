# Module Vélos en libre-service

Le module Vélos en libre-service dit combien de vélos et de places libres compte une station, dans la plupart des réseaux de France et du Canada : Vélib’, V’Lille, Vélo’v, LE vélo STAR, Le Vélo TBM, Naolib, BIXI, àVélo… Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `velos`).

## Ce que fait le module

- Il répond à « il reste des vélos à la station ? » ou « je peux reposer mon vélo ? » : « Station Benjamin Godard - Victor Hugo : 20 vélos, dont 4 électriques et 14 places libres. »
- La carte « Vélos · Vélib’ Métropole » donne le nombre de vélos, puis les mécaniques, les électriques et les places libres, quand le réseau les distingue.
- Une station fermée est annoncée comme telle, jamais comme « aucun vélo ».
- L’état est relu au plus toutes les deux minutes. Les stations d’un même réseau et la recherche partagent les fichiers du réseau : plusieurs sources ne multiplient pas les requêtes.

## Source

La norme ouverte [GBFS](https://gbfs.org/fr/), que publient les réseaux eux-mêmes, sans jeton. Le réseau se choisit dans le [catalogue de MobilityData](https://github.com/MobilityData/gbfs/blob/master/systems.csv). Les versions 2.x et 3.0 de la norme sont lues, ainsi que le décompte des vélos électriques propre à Vélib’.

## Réglages d’une source

Dans **Modules → Vélos en libre-service → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Réseau | Recherche par ville ou par nom (« Rennes », « Vélo’v », « Bordeaux ») parmi les réseaux de France, Belgique, Suisse, Luxembourg, Monaco et du Canada (« Québec » pour àVélo, « BIXI », « Saguenay ») | Vélib’ Métropole |
| Station | Recherche par nom de station, sans accents, une fois le réseau choisi. Chaque résultat montre l’adresse et le nombre de places. | Benjamin Godard - Victor Hugo |

Une source par station : « Vélos de la maison », « Vélos du bureau »…

## Limites

- Seuls les réseaux **à stations** sont proposés : l’autopartage de voitures (Citiz, Getaround, Marguerite…) et les engins sans station (trottinettes et vélos Lime, Dott, Bird…) sont écartés de la recherche.
- Un réseau absent du catalogue de MobilityData ne peut pas être choisi.
- Mécaniques et électriques ne sont distingués que si le réseau les publie (LE vélo STAR ne donne que le total).
- Si le réseau ne répond pas, Cornelius annonce le dernier état connu, à vérifier.

## Outil vocal et affichage permanent

L’outil s’appelle `velos__read`. Avec « Afficher en permanence sur le miroir », le miroir montre le nombre de vélos en grand, le nom de la station, puis les électriques et les places libres.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
