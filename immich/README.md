# Module Immich

Le module Immich permet de consulter les souvenirs du jour et de rechercher des photos par mots-clés depuis une instance [Immich](https://immich.app/) auto-hébergée. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `immich`).

## Ce que fait le module

- Il répond à « montre nos souvenirs » et affiche une carte « Souvenirs Immich » avec les clichés « ce jour-là » des années précédentes (ou une sélection aléatoire de la photothèque s’il n’y a aucun souvenir daté du jour, annoncée comme telle).
- Il répond à « cherche mes photos de vacances » et affiche une carte « Photos : vacances » grâce à la recherche sémantique CLIP d’Immich (`POST /api/search/smart`).
- Quand aucun souvenir ni photo n’est disponible, il affiche « Aucun souvenir aujourd’hui » ou « Aucune photo trouvée ».
- Les données restent en cache une minute.

## Jeton requis

Le module a besoin d’une clé API Immich (gratuite, générée depuis les paramètres du compte sur votre serveur Immich). Saisissez-la dans l’administration de Cornelius ou ajoutez-la dans le fichier `.env` puis redémarrez Cornelius :

```ini
CORNELIUS_IMMICH_API_KEY=votre-cle-api-immich
```

La clé est déclarée au niveau du module : toutes les sources configurées utilisent cette même clé et accèdent donc au même compte Immich. Pour partager des photos devant le foyer, utilisez de préférence un compte dédié ou une photothèque partagée.

## Réglages d’une source

Dans **Modules → Immich → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse du serveur Immich | Adresse HTTP ou HTTPS de votre serveur Immich (ex. `http://192.168.1.50:2283`) | `http://immich.local:2283` |
| Nom de la photothèque | Nom affiché sur la carte et utilisé dans le résumé vocal (ex. Foyer) | `Foyer` |
| Nombre de clichés par défaut | Nombre maximal de souvenirs ou photos retournés par défaut (1 à 10) | `5` |

## Limites

- **Confidentialité et données externes** : le miroir affiche les noms de fichiers des photos ainsi que la ville et le pays issus des métadonnées EXIF, visibles par toute personne dans la pièce. Ces métadonnées textuelles sont également transmises au fournisseur du modèle vocal/LLM configuré pour formuler la réponse orale.
- Le module repose sur une clé API unique pour tout le foyer : il ne sépare pas plusieurs comptes Immich distincts par profil reconnu.
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
