# Module Titres de l’actualité

Le module Titres de l’actualité lit les premiers titres d’un journal, d’après son flux RSS ou Atom. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `actu`).

## Ce que fait le module

- Il répond à « quelles sont les nouvelles ? » ou « les titres du jour » : « Les titres de franceinfo : … » suivi des titres, dans l’ordre du journal.
- La carte « Actu · franceinfo » donne le premier titre, son résumé et son ancienneté, puis les suivants.
- Seuls les titres sont lus. Pour en savoir plus sur un sujet, Cornelius passe par sa recherche web.
- Le flux est relu au plus tous les quarts d’heure.

## Réglages d’une source

Dans **Modules → Titres de l’actualité → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Journal et zone | Recherche dans le catalogue : un pays, une région ou un journal (« Québec », « Bretagne », « TVA »), ou l’adresse d’un flux collée telle quelle | franceinfo · national |
| Titres annoncés | De 1 à 5, dans l’ordre du journal | 3 |

### Choisir un journal par zone

Le champ **Journal et zone** cherche dans un catalogue de flux essayés, classés par pays, province et région ([catalogue.json](catalogue.json)) :

| Pays | National | Régional |
| --- | --- | --- |
| Canada | Radio-Canada, TVA Nouvelles, Noovo Info, La Presse, Le Journal de Montréal | Radio-Canada : 22 régions (Québec, Montréal et environs, Estrie, Saguenay–Lac-Saint-Jean, Ottawa-Gatineau, Toronto, Manitoba…) ; Noovo Info : région de Québec, Montréal et environs |
| France | franceinfo, Le Monde, Ouest-France, 20 Minutes | France 3 : les 13 régions |
| Suisse | RTS Info | |

- La région demandée passe d’abord (« Québec » donne « Radio-Canada · Région de Québec »), puis les flux du pays du foyer, d’après son fuseau horaire, puis les flux nationaux.
- Chaque résultat dit sa zone : « Canada › Québec › Région de Québec · régional ».
- Une adresse collée dans le champ (`https://…`) est gardée telle quelle : tout flux RSS ou Atom reste possible.
- Pour les nouvelles du pays **et** celles de la région, ajoutez deux sources : « Les titres » (national) et « Près de chez nous » (régional).
- Les sources réglées avant la version 1.2.0 (adresse seule) ne changent pas.

Le catalogue n’a que des flux vérifiés avec ce module (titres lus, date récente) le 2026-11-12. Écartés : Le Soleil (plus de flux), les flux Noovo d’Estrie, de Mauricie et du Saguenay (vides ou d’un seul titre vieux de plus d’un jour).

Une source par journal ou par rubrique : « Les titres », « Le sport », « L’actu locale »…

## Limites

- Une ancienne adresse qui renvoie vers la nouvelle (`francetvinfo.fr` vers `franceinfo.fr`) est suivie, trois fois au plus, et jamais vers une adresse non chiffrée (`http://`). Au-delà, Cornelius demande l’adresse finale : l’ouvrir dans un navigateur montre où elle mène.
- Un flux de plus de 512 Ko est coupé : seuls ses premiers titres sont lus, ce qui suffit.
- Si le journal ne répond pas, Cornelius annonce les derniers titres connus comme tels.

## Outil vocal et affichage permanent

L’outil s’appelle `actu__read`. Avec « Afficher en permanence sur le miroir », le miroir montre les trois premiers titres, sous le nom du journal.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json), lecture du flux : [_lib/flux.ts](../_lib/flux.ts)
