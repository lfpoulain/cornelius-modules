# Module Perturbations

Le module Perturbations rassemble les annonces de trafic des exploitants suisses et n’en garde que celles qui touchent les lignes et les arrêts du foyer. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `perturbations`).

## Ce que fait le module

- Il répond à « est-ce que ça roule sur la ligne 7 ? » et affiche une carte « Perturbations » : le nombre d’annonces, puis une entrée par annonce avec ses lignes et son texte.
- Il ne retient que les annonces en cours qui nomment une ligne surveillée ou citent un arrêt surveillé, ou dont le texte les mentionne. Le reste du flux national est ignoré, comme les annonces terminées ou pas encore commencées.
- Un arrêt seul (« Chailly ») vise ce lieu et les arrêts qui portent son nom (« Lausanne, Chailly-Village »), pas une autre localité (« Chailly-Montreux », « Chailly-sur-Montreux »). « Lausanne, Chailly-Village » vise cet arrêt précis.
- « B 7 » et « 7 » désignent la même ligne : le flux publie le numéro public seul (`PublishedLineName`), la saisie garde la forme habituelle. Les autres lettres comptent : « m2 » n’est pas le bus 2, « S1 » n’est pas la ligne 1.
- Une phrase courte : le flux propose chaque annonce en trois tailles, le module prend la variante S quand elle existe, sinon le résumé d’en-tête, puis coupe à la première phrase pour la carte.
- Sans annonce, la carte dit « Aucune » : le silence est une information, pas une panne. Un flux dont les annonces ne se lisent pas (format changé, flux coupé) donne une erreur, jamais un faux « Aucune ».
- Le total annoncé compte toutes les annonces trouvées ; la carte en montre cinq au plus.
- Une lecture reste fraîche dix minutes : pendant ce temps, Cornelius ne redemande pas le flux. C’est ce qui tient la limite du fournisseur, le cache HTTP du cœur ne s’appliquant pas à un flux aussi lourd (voir les limites).

## Jeton requis

Le module a besoin d’un jeton SIRI-SX (gratuit), à demander sur [api-manager.opentransportdata.swiss](https://api-manager.opentransportdata.swiss/), produit **SIRI-SX-UNPLANNED**. Il se colle dans l’administration, **Mise en route → Clés et jetons**, ou dans le fichier `.env` avant de redémarrer :

```ini
CORNELIUS_SIRI_SX_TOKEN=votre-jeton
```

## Réglages d’une source

Dans **Modules → Perturbations → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Lignes surveillées | Lignes dont les perturbations vous intéressent, séparées par des virgules. « 801:121 » vise la seule ligne 121 de l’exploitant 801 (CarPostal) | `B 7, B 8` |
| Arrêts surveillés | Noms d’arrêts ou de quartiers à surveiller aussi, séparés par des points-virgules (la virgule sert à « Lausanne, Chailly-Village ») | `Chailly` |
| Annonces affichées | Nombre d’annonces sur la carte, dans l’ordre du flux, de 1 à 5 | `5` |

## Limites

- Le fournisseur limite à deux appels par minute et trois mille par jour. Le module demande un cache de dix minutes, mais le cœur refuse de mettre en cache une réponse de plus de deux mégaoctets : ce flux en fait plusieurs, donc chaque lecture le retélécharge. Le module reste dans les clous parce que la fraîcheur est de dix minutes et que la voix interroge peu, mais un enchaînement de questions rapprochées peut renvoyer une erreur de quota explicite, jamais une carte vide.
- Une ligne désignée par son seul numéro ramasse les annonces de tous les réseaux qui portent ce numéro. Pour lever l’ambiguïté, précisez l’exploitant, tel qu’il figure dans `LineRef` (« 85:801:2242 » : exploitant 801) : « 801:121 ».
- Le flux ne couvre que les annonces non planifiées : les travaux annoncés longtemps à l’avance sont dans un autre flux, plus lourd, non utilisé ici.
- Une annonce sans ligne ni lieu identifiables ne peut pas être filtrée et reste écartée.
- En cas de jeton refusé, le module le dit et n’affiche rien.

## Outil vocal et affichage permanent

L’outil s’appelle `perturbations__read`, sans argument.

Ce module ne propose pas d’affichage permanent.

## Auteur

[Malvu](https://github.com/Malvu)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
