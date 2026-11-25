# Module Radio

Le module Radio fait jouer un poste de radio sur le miroir : on le demande par son nom (« mets France Inter ») ou par un genre (« trouve un poste de jazz »). Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `radio`).

Source : radio.jokobee.com · radio@jokobee.com

## Ce que fait le module

- « Mets France Inter », « mets RTL » : le poste qui porte ce nom joue sur le miroir, celui du pays du foyer d’abord.
- « Trouve un poste de jazz », « mets de la musique classique » : un poste au hasard parmi les plus écoutés de ce genre.
- Le bandeau du miroir montre le nom et le logo du poste, avec le bouton **Arrêter**. « Arrête la radio », « reprends » et « plus fort » sont des commandes communes de Cornelius.
- Pendant une conversation, la radio baisse quand Cornelius écoute et se tait quand il parle.
- Chaque demande renvoie un seul poste : son adresse de diffusion telle que l’annuaire la connaît (flux audio direct, ou HLS `.m3u8` comme ICI Musique ou FIP) et son logo. Cornelius la joue et dit lui-même si le poste est en panne ou dans un format qu’il ne lit pas.

## Clé requise

Le module a besoin d’une clé Radio, gratuite, une par adresse courriel, à obtenir sur https://radio.jokobee.com/cornelius : adresse courriel, puis le lien reçu par courriel, puis **Ma clé** pour la copier. Saisissez-la dans l’administration (**Modules → Radio**), ou dans le fichier `.env` puis redémarrez Cornelius :

```ini
CORNELIUS_RADIO_KEY=votre-clé
```

Ensuite, la clé se gère dans **Clés et accès**, section **Modules**, carte **Clé Radio**, toujours visible : **Remplacer** pour en saisir une nouvelle, **Effacer** pour la supprimer, et le lien **Obtenir la clé sur radio.jokobee.com** pour en demander une à tout moment.

Une clé sert à un seul Cornelius à la fois : utilisée par un autre Cornelius (une autre adresse) dans la dernière demi-heure, elle est refusée. Questions : radio@jokobee.com.

## Réglages d’une source

Dans **Modules → Radio → Ajouter une source** :

| Réglage              | Effet                                                                                   | Par défaut                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Pays cherché d’abord | Les postes de ce pays passent en premier, ailleurs ensuite ; tous les pays, en français | Selon le fuseau horaire du foyer : son pays, d’après la table des fuseaux de l’IANA (anciens noms compris) |

## Service et vie privée

Les postes viennent de l’annuaire de Jokobee™ Radio ([radio.jokobee.com](https://radio.jokobee.com)), exploité par Jokobee™, l’entreprise de l’auteur de ce module ([LucQuebec](https://github.com/LucQuebec)). À chaque demande, le module lui envoie la clé Radio, le nom ou le genre demandé (tel que la reconnaissance vocale l’a écrit) et le pays cherché d’abord ; l’annuaire voit aussi l’adresse IP du serveur de Cornelius.

Ce que l’annuaire garde :

- **Journal des demandes vocales**, pour améliorer la recherche : le texte reçu, le pays, le poste trouvé ou non et la durée de la recherche, jamais la clé ni l’adresse IP. Gardé 7 jours.
- **Vos 10 dernières demandes réussies**, liées à la clé (donc à l’adresse courriel) : le texte demandé, le nom et l’identifiant du poste trouvé, la date. Elles servent seulement à retrouver plus vite les postes que vous demandez souvent ; effacées 90 jours après la dernière demande, ou dès que la clé est effacée ou révoquée.
- **Une seule instance par clé** : une empreinte de l’adresse IP (jamais l’adresse elle-même), en mémoire, 30 minutes, et un compteur de demandes par jour.
- **Journaux techniques** de l’hébergement : l’adresse IP des requêtes, 30 jours au plus, pour la sécurité et le bon fonctionnement.

L’adresse courriel donnée pour obtenir la clé sert seulement à l’envoyer et à gérer l’accès : le serveur garde l’adresse, la date d’acceptation des conditions et l’empreinte de la clé (jamais la clé elle-même). Tout est effacé sur demande (**Ma clé → Supprimer mon accès**), ou après 12 mois sans usage ; une clé demandée mais jamais utilisée est effacée après 30 jours. Jamais de publicité ni de profilage.

Politique de confidentialité : https://www.jokobee.com/radio-privacy-fr. Conditions d’utilisation de l’annuaire : https://www.jokobee.com/radio-terms-fr. Questions : radio@jokobee.com.

Ce service n’appartient pas au projet Cornelius : sa disponibilité, ses conditions et le traitement des données relèvent de son exploitant. Voir [Services tiers](../README.md#-services-tiers).

## Limites

- **HLS** (Radio-Canada, ICI Musique, FIP, CBC Music) : rendu tel quel, avec une version de Cornelius qui lit le HLS. Avec une version plus ancienne, Cornelius dit simplement : « Le format de diffusion de ce poste n’est pas pris en charge pour le moment. »
- **http, listes m3u ou pls** : « Le format de diffusion de ce poste n’est pas pris en charge pour le moment », sans réessayer.
- 100 demandes par clé et par jour, et des limites par adresse : largement assez pour un foyer.
- Un poste dont le flux ne répond pas en ce moment : Cornelius le dit à la lecture (« Flux introuvable », « Le flux est injoignable ») ; un nom inconnu : « Aucun poste … disponible ».
- Le miroir seulement : les satellites ne jouent pas encore la radio.
- **Conditions d’utilisation** : l’annuaire des postes est réservé à l’usage personnel avec Cornelius. Sa copie, son aspiration ou sa revente sont interdites, et une clé peut être coupée en cas d’abus. Les flux restent soumis aux conditions de leurs diffuseurs.

## Outil vocal

L’outil s’appelle `radio__ecouter` : un outil de lecture (Cornelius 0.4.1). Il reçoit le nom du poste, ou un genre avec l’argument `genre` à vrai. **Tester** ne fait aucune demande à l’annuaire. Ce module ne propose pas d’affichage permanent : le bandeau de lecture du miroir le remplace.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Le lecteur audio](https://github.com/lfpoulain/Cornelius/blob/main/docs/fonctionnalites/lecteur-audio.md)
- [Référence du contrat des modules : l’outil de lecture](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md#loutil-de-lecture)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
