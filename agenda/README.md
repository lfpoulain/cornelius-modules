# Module Agenda

Le module Agenda lit les prochains rendez-vous d’un agenda partagé (Google Agenda, iCloud, Outlook…) par son lien iCal privé. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `agenda`).

## Ce que fait le module

- Il répond à « qu’est-ce qu’on a demain ? », « c’est quand le dentiste ? » ou « mon agenda de la semaine » : « Aujourd’hui : Dentiste de Léa à 16 h et Séance photo à 18 h. Demain : Foot de Tom à 18 h 30. Et 4 autres dans les 7 prochains jours. »
- À l’oral, il donne trois jours et six rendez-vous au plus, puis le nombre de ceux qui restent.
- On peut préciser à la voix : « et samedi ? », « la semaine prochaine ? », « qu’est-ce qu’on a dans quinze jours ? ». Jusqu’à deux mois à l’avance, deux semaines à la fois.
- La carte « Agenda · Famille » donne le prochain rendez-vous, son lieu, puis les cinq suivants.
- Un rendez-vous en cours est annoncé « en cours, jusqu’à 11 h » ; un rendez-vous fini disparaît aussitôt, sans attendre la relecture de l’agenda.
- Les journées entières se disent « toute la journée », un séjour « jusqu’au lundi 26 octobre ».
- L’agenda est relu au plus tous les quarts d’heure. Les heures sont dites dans le fuseau du foyer (`CORNELIUS_TIMEZONE`, Europe/Paris par défaut), quel que soit celui de l’événement.

## Trouver le lien iCal privé

| Service | Où le trouver |
| --- | --- |
| Google Agenda | Sur ordinateur : **Paramètres** → l’agenda, à gauche → **Intégrer l’agenda** → **Adresse secrète au format iCal** |
| iCloud | Dans l’app Calendrier : partager l’agenda → **Calendrier public** → copier le lien (`webcal://…`) |
| Outlook.com | **Paramètres** → **Calendrier** → **Calendriers partagés** → **Publier un calendrier** → lien **ICS** |

> [!WARNING]
> Ce lien donne accès à tout l’agenda, sans mot de passe. Cornelius le garde dans les réglages de la source, sur cet ordinateur, et ne l’écrit ni dans le journal, ni sur le miroir, ni dans ses réponses. S’il a été partagé par erreur, réinitialisez-le chez Google, iCloud ou Outlook, puis collez le nouveau.

## Réglages d’une source

Dans **Modules → Agenda → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Lien iCal privé | L’adresse ci-dessus, en `https://` ou `webcal://` | vide |
| Jours à l’avance | De 1 à 14, aujourd’hui compris | 7 |
| Lire les descriptions | Garde la description de chaque rendez-vous pour répondre quand on la demande | oui |
| Longueur des descriptions | Caractères gardés au plus par description, de 50 à 2 000 ; au-delà, elle est coupée | 300 |

Les descriptions ne sont ni dites d’office ni affichées sur la carte : Cornelius s’en sert quand on lui demande « qu’est-ce qu’il y a dans la description du dentiste ? » ou « c’est quoi les détails de la réunion ? ». Le HTML de Google Agenda (gras, listes, liens) est retiré, comme le bloc « Rejoindre avec Google Meet ». Elles partent au fournisseur vocal avec le reste de l’agenda : plus elles sont longues, plus chaque question sur l’agenda coûte. Une source réglée avant la version 1.2.0 les lit, coupées à 300 caractères ; rouvrez-la pour choisir.

Une source par agenda : « Agenda de la famille », « Agenda de Léa » (propriétaire : Léa), « Le foot de Tom »…

## Ce que le module comprend

Le titre, le lieu et la description ; les événements simples, les journées entières et les séjours ; les fuseaux horaires, y compris les noms Windows d’Outlook ; les répétitions chaque jour, chaque semaine (certains jours), chaque mois (« le 15 », « le 2e mardi », « le dernier vendredi ») et chaque année, avec leur fin ou leur nombre d’occurrences ; les occurrences supprimées ou déplacées ; les événements annulés.

## Limites

- Un lien qui renvoie vers un autre serveur (certains liens iCloud) est suivi, trois fois au plus, et jamais vers une adresse non chiffrée (`http://`). Au-delà, il faut coller l’adresse finale.
- Les règles de répétition rares (toutes les heures, `BYSETPOS`, `BYWEEKNO`) ne sont pas lues : l’événement n’apparaît qu’à sa première date.
- Un agenda de plus de 8 Mo est coupé : ses derniers événements dans le fichier peuvent manquer. La carte et la réponse le disent (« Agenda incomplet »).
- Les invitations, les réponses et les rappels de l’agenda ne sont pas gérés : seulement ce qui est prévu.
- Seul le bloc de visio de Google Meet est retiré des descriptions. Celui d’une invitation Teams ou Zoom reste, dans la limite de longueur.
- Si l’agenda ne répond pas, Cornelius annonce le dernier agenda connu, à vérifier.

## Outil vocal et affichage permanent

L’outil s’appelle `agenda__read`. Il accepte deux précisions : le premier jour à lire (`debut`, de 0 aujourd’hui à 60) et le nombre de jours (`jours`, de 1 à 14). Une lecture précisée n’est ni gardée en cache, ni enregistrée. Les descriptions voyagent dans les données de la réponse (`events[].description`), pas dans la phrase dite.

Avec « Afficher en permanence sur le miroir », le miroir montre les trois prochains rendez-vous avec leur jour et leur heure, ou « Rien de prévu ». Il se met à jour au début et à la fin de chaque rendez-vous, et à minuit, sans relire l’agenda.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [ics.ts](ics.ts) (lecture iCalendar), [config.schema.json](config.schema.json)
