# Module Radio

Le module Radio fait jouer un poste de radio sur le miroir : on le demande par son nom (« mets France Inter ») ou par un genre (« trouve un poste de jazz »). Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `radio`).

Source : radio.jokobee.com · radio@jokobee.com

## Ce que fait le module

- « Mets France Inter », « mets RTL » : le poste qui porte ce nom joue sur le miroir, celui du pays du foyer d’abord.
- « Trouve un poste de jazz », « mets de la musique classique » : un poste au hasard parmi les plus écoutés de ce genre.
- Le bandeau du miroir montre le nom et le logo du poste, avec le bouton **Arrêter**. « Arrête la radio », « reprends » et « plus fort » sont des commandes communes de Cornelius.
- Pendant une conversation, la radio baisse quand Cornelius écoute et se tait quand il parle.
- Chaque demande renvoie un seul poste, déjà vérifié en train de jouer : un flux audio direct en https et son logo.

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

## Limites

- **Flux en https seulement, sans HLS** : le lecteur de Cornelius ne joue que des flux audio directs (MP3, AAC, Ogg, Opus) en https. Un poste qui ne diffuse qu’en HLS (Radio-Canada, ICI Musique, par exemple) ou qu’en http n’est pas proposé : « aucun poste disponible ».
- 100 demandes par clé et par jour, et des limites par adresse : largement assez pour un foyer.
- Un poste reconnu dont le flux ne répond pas en ce moment : « Ce poste ne répond pas pour l’instant » ; un nom inconnu : « Aucun poste … disponible ».
- Une réponse peut prendre quelques secondes : l’annuaire vérifie que le poste joue vraiment avant de répondre.
- Le miroir seulement : les satellites ne jouent pas encore la radio.
- **Conditions d’utilisation** : l’annuaire des postes est réservé à l’usage personnel avec Cornelius. Sa copie, son aspiration ou sa revente sont interdites, et une clé peut être coupée en cas d’abus. Les flux restent soumis aux conditions de leurs diffuseurs.

## Outil vocal

L’outil s’appelle `radio__ecouter` : un outil de lecture (Cornelius 0.4.1). Il reçoit le nom du poste, ou un genre avec l’argument `genre` à vrai. **Tester** ne fait aucune demande à l’annuaire. Ce module ne propose pas d’affichage permanent : le bandeau de lecture du miroir le remplace.

## Auteur

[LucQuebec](https://github.com/LucQuebec), pour [Jokobee™](https://jokobee.com).

## Voir aussi

- [Le lecteur audio](https://github.com/lfpoulain/Cornelius/blob/beta/docs/fonctionnalites/lecteur-audio.md)
- [Référence du contrat des modules : l’outil de lecture](https://github.com/lfpoulain/Cornelius/blob/beta/docs/modules/reference.md#loutil-de-lecture)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
