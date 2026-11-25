# Module Immich

Le module Immich permet de consulter les souvenirs du jour et de rechercher des photos par mots-clés depuis une instance [Immich](https://immich.app/) auto-hébergée. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `immich`).

## Ce que fait le module

- Il répond à « montre nos souvenirs » et affiche une carte « Souvenirs Immich » avec les clichés « ce jour-là » des années précédentes (ou une sélection aléatoire de la photothèque s’il n’y a aucun souvenir daté du jour, annoncée comme telle).
- Il répond à « affiche la dernière photo » ou « mes dernières photos » et affiche une carte « Dernières photos » triée par date décroissante (`POST /api/search/metadata`).
- Il répond à « cherche mes photos de vacances » et affiche une carte « Photos : vacances » grâce à la recherche sémantique CLIP d’Immich (`POST /api/search/smart`).
- Quand aucun souvenir ni photo n’est disponible, il affiche « Aucun souvenir aujourd’hui » ou « Aucune photo trouvée ».
- Les données restent en cache une minute.

## Jeton requis

Le module a besoin d’une clé API Immich (gratuite, générée depuis les paramètres du compte sur votre serveur Immich).

- **Une clé par profil (`perSource: true`)** : sur un cœur Cornelius qui prend en charge les jetons par source, vous pouvez saisir une clé API Immich propre à chaque source rattachée à un profil. Chaque personne reconnue devant le miroir par reconnaissance faciale accède alors uniquement à sa propre photothèque Immich avec une clé révocable individuellement.
- **Clé partagée du foyer (repli)** : si vous saisissez une clé au niveau du module (dans l’administration ou via `.env`), elle sert de repli pour toute source sans clé propre, et reste le comportement par défaut sur un cœur plus ancien qui ignore `perSource` :

```ini
CORNELIUS_IMMICH_API_KEY=votre-cle-api-immich
```

## Réglages d’une source

Dans **Modules → Immich → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse du serveur Immich | Adresse HTTP ou HTTPS de votre serveur Immich (ex. `http://192.168.1.50:2283`) | `http://immich.local:2283` |
| Nom de la photothèque | Nom affiché sur la carte et utilisé dans le résumé vocal (ex. Foyer) | `Foyer` |
| Nombre de clichés par défaut | Nombre maximal de souvenirs ou photos retournés par défaut (1 à 10) | `5` |

## Limites

- **Confidentialité et données externes** : le miroir affiche les noms de fichiers des photos ainsi que la ville et le pays issus des métadonnées EXIF, visibles par toute personne dans la pièce. Ces métadonnées textuelles sont également transmises au fournisseur du modèle vocal/LLM configuré pour formuler la réponse orale.
- Sur un cœur Cornelius antérieur à la prise en charge de `perSource`, toutes les sources utilisent la clé unique du module.
- La recherche sémantique (`search`) est filtrée sur les images (`type: IMAGE`) et dépend du modèle CLIP activé sur votre serveur Immich.
- En cas d’adresse invalide ou de clé absente (`config_invalid`), de clé refusée (`401`), de réponse illisible ou tronquée au-delà de 2 Mio (`malformed`), ou de serveur injoignable (`unavailable`), le module signale l’incident sans le masquer par une carte vide.
- Licence des données : données privées hébergées sur votre propre instance Immich.

## Outil vocal et affichage permanent

Le module déclare deux outils : `immich__memories` (souvenirs du jour ou sélection aléatoire) et `immich__search` (recherche par `query`). Tous deux acceptent le paramètre `count` (entre `1` et `10`). Ce module ne propose pas d’affichage permanent (`ambient`), afin de ne pas laisser d’informations personnelles affichées en veille sur le miroir.

## Auteur

Ewan Berthomieu ([ewan-berthomieu](https://github.com/ewan-berthomieu)).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
