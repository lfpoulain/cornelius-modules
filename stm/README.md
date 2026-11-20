# Module Transports STM

Le module Transports STM couvre la **région métropolitaine de Montréal, au Québec** : il donne le prochain départ en transport en commun (métro et autobus de la STM, autobus du RTL à Longueuil, autobus et trains de banlieue d’exo, REM) vers une destination, la durée du trajet et le départ suivant. Avec la clé d’API de la STM du foyer, facultative, il ajoute les avis de la STM sur la ligne et l’heure réelle des autobus. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `stm`).

## Ce que fait le module

- Il répond à « comment je vais au Centre Bell ? » ou « c’est quand le prochain métro pour la station Saint-Michel ? » et affiche une carte « Transports STM · au Centre Bell » : la ligne et le délai, puis les départs suivants et la durée du trajet. Exemple réel :

  > Pour te rendre au Centre Bell, le prochain départ est le métro, ligne orange dans 1 minute selon l’horaire, à la station Berri-UQAM, à 1 minute à pied. La durée du trajet est de 11 minutes. Le suivant est prévu dans 4 minutes selon l’horaire.

- **Avis de la STM** (avec la clé) : si la STM publie un avis en cours sur la ligne du trajet (interruption, ouverture tardive, détour), il est dit à la fin : « Avis de la STM : Ce samedi 14 novembre, le service métro débutera seulement vers 9h30 sur la ligne 5 - Bleue… ». « Service normal du métro » n’est jamais dit.
- **Temps réel des autobus** (avec la clé, et Cornelius 0.4.0 ou plus récent, qui sait lire une réponse binaire avec `bytes()`) : le module lit le flux temps réel de la STM (GTFS-RT) et donne l’heure réelle des autobus en route. Le métro n’y figure pas, ni un autobus qui n’a pas quitté son terminus : leurs heures restent celles de l’horaire, et la réponse le dit (« selon l’horaire »). Avec Cornelius 0.3.0, tout reste « selon l’horaire », sans erreur.
- **Sans clé** : l’horaire de Transitous, sans avis ni temps réel. La carte d’un trajet de la STM le dit : « Horaire seulement : sans clé STM, ni avis ni temps réel. »
- Parmi les itinéraires proposés, le module retient celui qui arrive le plus tôt. « Le prochain » est le premier départ qu’on peut attraper, marche jusqu’à la station comprise.
- Rien n’est inventé : sans durée chez Transitous, aucune durée n’est dite ; sans passage à attraper, le module le dit sans promettre de départ.
- Les données restent en cache 1 minute ; le flux temps réel, 30 secondes ; l’état du service, 3 minutes.

La mécanique commune (géocodage, itinéraire, passages, phrase et carte) est dans [`_lib/transitous.ts`](../_lib/transitous.ts) ; ce qui est propre à la STM (avis, temps réel, décodeur GTFS-RT [gtfs-rt.ts](gtfs-rt.ts)) reste dans ce module.

## Réseaux couverts

| Réseau | Ce que Cornelius dit | Temps réel | Avis |
| --- | --- | --- | --- |
| STM (Montréal) : métro, autobus | « le métro, ligne verte », « l’autobus 51 » | Autobus (clé et `bytes()`) | Oui (clé) |
| RTL (Longueuil) | « l’autobus 8 du RTL » | Selon Transitous | Non |
| exo : autobus des couronnes | « l’autobus 708 d’exo » | Selon Transitous | Non |
| exo : trains de banlieue | « le train d’exo, ligne Saint-Jérôme » | Selon Transitous | Non |
| REM | « le REM » | Selon Transitous | Non |

Le lieu de départ est dit selon son genre : « à la station Berri-UQAM », « à la gare Parc », « au terminus Longueuil », « à l’arrêt … ». L’état du service et le temps réel de la STM ne valent que pour un trajet qui commence sur une ligne de la STM : un autobus 8 du RTL n’a pas les avis de la ligne 8 de la STM.

**Laval** : la STL n’est pas encore dans Transitous. À Laval, le module donne le métro (Montmorency, De la Concorde, Cartier), les autobus et les trains d’exo, mais pas les autobus de la STL.

## Clé d’API de la STM (facultative)

Le module fonctionne sans clé. La clé de la STM, obtenue en créant un compte sur son portail des développeurs, apporte deux plus pour les trajets de la STM :

- l’**état du service** : les avis en cours sur la ligne (interruption, ouverture tardive, détour), dits à la fin de la réponse ;
- le **temps réel des autobus** (GTFS-RT), avec Cornelius 0.4.0 ou plus récent.

Chaque foyer demande la sienne : créez un compte sur le [portail des développeurs de la STM](https://portail.developpeurs.stm.info/apihub/#/signup) (présentation sur la [page Développeurs de la STM](https://www.stm.info/fr/a-propos/developpeurs)), activez-le, puis copiez l’« API key » de votre application (le secret partagé n’est pas utile). Saisissez-la dans la carte du module ou dans **Clés et jetons**, ou dans le fichier `.env`, puis redémarrez Cornelius :

```ini
CORNELIUS_STM_API_KEY=votre-cle
```

L’état du service et le temps réel ne sont lus que lorsqu’une question de trajet est posée, jamais en tâche de fond, puis gardés 3 minutes et 30 secondes dans le cache de l’installation. Le décodage du flux temps réel (protobuf) est fait par le module, sans dépendance, pour les seuls voyages de l’arrêt. Clé refusée, quota atteint ou STM injoignable : la réponse reste celle de l’horaire, sans avis.

L’administration de Cornelius (0.3.0 et 0.4.0) traite un jeton déclaré comme requis : tant que la clé manque, elle affiche « Jeton manquant » et grise « Ajouter une source ». Le module, lui, fonctionne sans clé.

## Sources des données et licences

| Donnée | Source | Licence, conditions |
| --- | --- | --- |
| Itinéraire, ligne, station, durée ; passages suivants | [Transitous](https://transitous.org), `v5/plan` et `v5/stoptimes` | [Conditions de l’API Transitous](https://transitous.org/api/) : gratuite, sans jeton, usage non commercial, avec un lien vers [ses sources](https://transitous.org/sources/) |
| Horaires de la STM, repris par Transitous ; état du service et temps réel (`api.stm.info`) | Société de transport de Montréal (GTFS, `i3/v1/messages/etatservice`, `gtfs-rt/ic/v2/tripUpdates`) | [Données ouvertes de la STM](https://www.stm.info/fr/a-propos/developpeurs) : CC BY 4.0, la STM mentionnée comme source ; horaires du métro indicatifs |
| Horaires du RTL, repris par Transitous | Réseau de transport de Longueuil (GTFS) | [Conditions d’utilisation des données GTFS du RTL](https://www.rtl-longueuil.qc.ca/fr-CA/donnees-ouvertes/) : le RTL mentionné comme source |
| Horaires d’exo, repris par Transitous | exo (GTFS par secteur et trains) | [Données ouvertes d’exo](https://exo.quebec/fr/a-propos/donnees-ouvertes) : [CC BY 4.0 de Données Québec](https://www.donneesquebec.ca/licence/#cc-by) |
| Horaires du REM, repris par Transitous | REM (GTFS) | [CC BY 4.0 de Données Québec](https://www.donneesquebec.ca/licence/#cc-by) |
| Destination et départ → coordonnées | Transitous, `v1/geocode` | Données © les contributeurs d’[OpenStreetMap](https://www.openstreetmap.org/copyright), sous licence ODbL |

## Réglages d’une source

Dans **Modules → Transports STM → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse du départ | Adresse, intersection ou station (« Berri-UQAM », « Saint-Denis et Mont-Royal »), cherchée près du centre de Montréal | vide |
| Latitude, longitude du départ | Au choix, à la place de l’adresse ; si elles sont saisies, elles passent avant | vides |
| Destinations favorites | Mot-clé dit à la voix (« travail »), formulation dans la réponse (« au travail »), adresse | aucune |

Le module ne contient aucun lieu par défaut : chaque foyer saisit le sien. **Tester** calcule le trajet vers la première destination favorite.

## Vie privée

L’adresse du départ est envoyée à Transitous pour la trouver (au plus une fois par 10 minutes) ; le départ part ensuite **arrondi à environ 100 m**. Une intersection proche est plus discrète que l’adresse exacte. Les coordonnées saisies partent elles aussi arrondies. La STM ne reçoit que la clé du foyer, jamais de position.

## Limites

- Région métropolitaine de Montréal et ses couronnes (latitude 45,0 à 46,1, longitude -74,6 à -72,9) ; les lieux à plus de 80 km du départ sont écartés.
- Le géocodeur de Transitous (OpenStreetMap) remplace sans prévenir une adresse qu’il ne connaît pas par une voisine d’orthographe (« 1500 rue Berri » → « 1500 rue Serre »). Le module le refuse : avec un numéro civique, le résultat doit être sur la rue demandée ; pour une intersection, il doit contenir les deux rues. Sinon : « Adresse introuvable… Essayez une intersection proche ou un lieu connu ».
- Sans ville dans l’adresse, une deuxième recherche ajoute « , Montréal ».
- Les horaires du métro publiés par la STM sont indicatifs (le métro passe à intervalles) : la réponse le dit (« selon l’horaire »).
- Les passages suivants viennent des 30 prochains passages de l’arrêt : à un arrêt très desservi, le départ suivant peut manquer, et il n’est alors pas dit.
- Transitous est un service communautaire sans garantie : en panne, le module répond « Transitous est indisponible ».

## Outil vocal et affichage permanent

L’outil s’appelle `stm__trajet`. Il reçoit la destination (`query`) : un mot-clé de destination favorite, ou une adresse ou un lieu à Montréal avec sa préposition (« au Centre Bell », « à l’Université de Montréal »). Une destination mémorisée par Cornelius (« retiens que chez Marie c’est au 123 rue X, Montréal ») lui est passée par son adresse. Ce module ne propose pas d’affichage permanent.

## Auteur

[LucQuebec](https://github.com/LucQuebec)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [gtfs-rt.ts](gtfs-rt.ts), [config.schema.json](config.schema.json), [\_lib/transitous.ts](../_lib/transitous.ts)
