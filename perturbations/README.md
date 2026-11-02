# Module Perturbations

Le module Perturbations rassemble les annonces de trafic des exploitants suisses et n'en garde que celles qui touchent les lignes et les arrêts du foyer. Cette fiche s'adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `perturbations`).

## Ce que fait le module

- Il répond à « est-ce que ça roule sur la ligne 7 ? » et affiche une carte « Perturbations » : le nombre d'annonces, puis une entrée par annonce avec ses lignes et son texte.
- Il ne retient que les annonces qui nomment une ligne surveillée ou citent un arrêt surveillé, ou dont le texte les mentionne. Le reste du flux national est ignoré.
- « B 7 » et « 7 » désignent la même ligne : le flux publie le numéro seul, la saisie garde la forme habituelle.
- Une phrase courte : le flux propose chaque annonce en trois tailles, le module prend la variante S quand elle existe, sinon le résumé d'en-tête, puis coupe à la première phrase pour la carte.
- Sans annonce, la carte dit « Aucune » : le silence est une information, pas une panne.
- Les données restent en cache dix minutes, le maximum autorisé par le cœur et la seule façon de tenir la limite du fournisseur.

## Jeton requis

Le module a besoin d'un jeton SIRI-SX (gratuit), à demander sur [api-manager.opentransportdata.swiss](https://api-manager.opentransportdata.swiss/), produit **SIRI-SX-UNPLANNED**. Il se colle dans l'administration, **Mise en route → Clés et jetons**, ou dans le fichier `.env` avant de redémarrer :

```ini
CORNELIUS_SIRI_SX_TOKEN=votre-jeton
```

## Réglages d'une source

Dans **Modules → Perturbations → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Lignes surveillées | Lignes dont les perturbations vous intéressent, séparées par des virgules. « 820:7 » vise la seule ligne 7 de l'exploitant 820 | `B 7, B 8` |
| Arrêts surveillés | Noms d'arrêts ou de quartiers à surveiller aussi | `Chailly` |
| Annonces affichées | Nombre d'annonces sur la carte, dans l'ordre du flux | `5` |

## Limites

- Le fournisseur limite à deux appels par minute et trois mille par jour. Le module demande un cache de dix minutes, mais le cœur refuse de mettre en cache une réponse de plus de deux mégaoctets : ce flux en fait plusieurs, donc chaque lecture le retélécharge. Le module reste dans les clous parce que la fraîcheur est de dix minutes et que la voix interroge peu, mais un enchaînement de questions rapprochées peut renvoyer une erreur de quota explicite, jamais une carte vide.
- Une ligne désignée par son seul numéro ramasse les annonces de tous les réseaux qui portent ce numéro. Pour lever l'ambiguïté, précisez l'exploitant : « 820:7 ».
- Le flux ne couvre que les annonces non planifiées : les travaux annoncés longtemps à l'avance sont dans un autre flux, plus lourd, non utilisé ici.
- Une annonce sans ligne ni lieu identifiables ne peut pas être filtrée et reste écartée.
- En cas de jeton refusé, le module le dit et n'affiche rien.

## Outil vocal et affichage permanent

L'outil s'appelle `perturbations__read`, sans argument.

Ce module ne propose pas d'affichage permanent.

## Auteur

[Malvu](https://github.com/Malvu)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
