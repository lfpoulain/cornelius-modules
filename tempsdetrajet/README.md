# Module Temps de trajet

Le module Temps de trajet donne l’heure d’arrivée estimée d’un trajet en voiture, avec le trafic en direct. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `tempsdetrajet`).

## Ce que fait le module

- Il répond à « à quelle heure j’arrive ? » et affiche une carte « Trajet » : l’heure d’arrivée en valeur principale, la durée du trajet, puis le retard dû au trafic, la durée sans trafic et la distance.
- Le fournisseur choisit lui-même l’itinéraire le plus rapide au moment de la lecture. Le module ne compare pas d’itinéraires.
- L’heure d’arrivée suppose un départ **maintenant** : c’est la durée du dernier relevé ajoutée à l’heure actuelle. Avec l’affichage permanent, elle avance à chaque minute sans nouvelle requête.
- Le trafic est relevé au plus toutes les 5 minutes (`freshMs`). Le relevé n’est renouvelé que pendant qu’une personne est devant le miroir.

## Jeton requis

Le module a besoin d’une **clé API TomTom gratuite**, à créer sur [developer.tomtom.com](https://developer.tomtom.com/) : un compte, puis une clé depuis le tableau de bord. D’après la [page des tarifs](https://docs.tomtom.com/pricing), la formule gratuite ne demande pas de carte bancaire et couvre, **chaque mois**, 20 000 requêtes d’itinéraire (Routing) et 2 500 requêtes de recherche d’adresse (Search). C’est un usage limité : voir « Quota gratuit » plus bas. Ajoutez la clé dans le fichier `.env` puis redémarrez Cornelius :

```ini
CORNELIUS_TOMTOM_KEY=votre-cle
```

Elle peut aussi se saisir dans **Mise en route → Clés et jetons**. Elle n’est jamais écrite dans le code ni dans les réglages d’une source.

## Réglages d’une source

Dans **Modules → Temps de trajet → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Départ | Se choisit par **recherche d’adresse** : tapez une rue ou un lieu, puis **Chercher** et cliquez le résultat | Place de la Bourse, Bordeaux (exemple) |
| Arrivée | Même recherche | Gare Saint-Jean, Bordeaux (exemple) |

Les valeurs par défaut sont des repères de démonstration : remplacez-les par vos adresses. La recherche demande au moins 3 lettres, ne cherche qu’en France et propose six résultats au plus.

**Confidentialité.** L’adresse tapée part chez TomTom au moment de la recherche. Le point retenu est ensuite **arrondi à environ 100 mètres** avant d’être enregistré et envoyé pour calculer le trajet : TomTom reçoit un repère proche, pas la porte exacte. Pour ne pas lui donner non plus l’adresse tapée, cherchez une rue ou un lieu voisin plutôt que votre numéro.

Une adresse de domicile est une donnée personnelle : TomTom reçoit la recherche et le point arrondi pour fournir le service, et le libellé choisi reste enregistré dans les réglages de la source, sur votre installation. Il n’est pas affiché sur le miroir.

## Un profil, plusieurs destinations

Cornelius gère déjà le choix de la personne : chaque source a un **propriétaire**, et une source personnelle ne sert et ne s’affiche que lorsque sa propriétaire est reconnue par la caméra.

- **Un trajet par personne** : créez une source par personne (« Trajet de Sacha ») avec son départ et son arrivée, et réglez son propriétaire. Une source du foyer s’affiche pour tout le monde.
- **Plusieurs destinations pour la même personne** : créez une source par destination (« travail », « salle de sport », « école »). À la voix, prononcez son nom : « à quelle heure j’arrive à la salle de sport ? ». Sans précision, Cornelius demande laquelle. L’affichage permanent ne dépend pas de la voix : activez « Afficher en permanence sur le miroir » seulement sur le trajet du matin.
- Pour **changer une adresse**, ouvrez la source, refaites la recherche du champ concerné et enregistrez : le relevé est effacé et recalculé.

Le miroir affiche quatre sources permanentes au plus. Avec la reconnaissance désactivée, seules les sources du foyer s’affichent.

## Limites

- Le module annonce une durée de route, pas un temps garanti : les accidents et les ralentissements soudains ne sont connus qu’au relevé suivant.
- Le départ est toujours « maintenant ». Une heure de départ fixe n’est pas gérée.
- Le module ne change pas de destination tout seul selon l’heure : une source par destination, choisie à la voix ou affichée en permanence.
- Le retard dû au trafic vient du champ `trafficDelayInSeconds` de TomTom. S’il manque, il se déduit de la durée sans trafic ; si celle-ci manque aussi, il n’est pas affiché.
- Les sources créées avec la version 1 (coordonnées saisies à la main) sont reprises automatiquement, leurs points arrondis à environ 100 mètres ; leur départ et leur arrivée s’affichent « Départ » et « Arrivée » jusqu’à la prochaine recherche. Si leurs réglages sont illisibles, la source retrouve les repères de démonstration : refaites alors la recherche.
- En cas de panne, le dernier relevé est gardé et annoncé comme « dernier relevé connu ».
- **Formats de réponse à valider.** Les tests utilisent des réponses d’exemple écrites d’après la documentation de TomTom (`fixtures/route.json` et `fixtures/search.json`), pas des réponses réelles. Avant de compter sur le module, faites **Tester** dans l’administration avec votre clé, puis une recherche d’adresse : une réponse de forme différente donne « Réponse illisible », ou aucun résultat, jamais une durée ni une adresse inventée.

## Quota gratuit

Vérifié sur la [page des tarifs](https://docs.tomtom.com/pricing) et la [FAQ](https://docs.tomtom.com/platform/documentation/status-and-support/faqs) de TomTom le 30 octobre 2026. Ces conditions peuvent changer : relisez-les avant de compter dessus.

- **Gratuit** : 20 000 requêtes d’itinéraire et 2 500 recherches d’adresse par mois, sans carte bancaire.
- **Au-delà** : les requêtes sont refusées (erreur 429 chez TomTom). Le module affiche alors « Quota TomTom atteint » et garde le dernier relevé. Les conditions exactes au-delà du quota gratuit figurent chez TomTom, pas ici.
- **Ce que consomme le module** : une requête d’itinéraire au plus toutes les 5 minutes par source, et seulement pendant qu’une personne est devant le miroir, soit 12 par heure et par source au maximum. Une recherche d’adresse ne part que lorsque vous cliquez sur **Chercher** dans les réglages.
- **Usage commercial** : la FAQ de TomTom l’autorise pour la formule gratuite ; les conditions détaillées sont dans ses conditions générales, à lire vous-même.
- TomTom classe l’API de recherche utilisée ici (Search) comme de génération précédente et recommande Places Search pour les nouveaux projets : elle peut un jour disparaître.

## Sécurité

- La clé TomTom n'est lue que par Cornelius (variable d'environnement ou saisie dans l'administration). Le module ne la cite dans aucun message d'erreur, y compris en cas de panne réseau.
- Utilisez une clé réservée à Cornelius, et renouvelez-la si vous pensez qu'elle a fuité. TomTom l'attend dans l'adresse de la requête : évitez de journaliser les adresses des requêtes sortantes.
- Seuls deux services TomTom sont appelés (recherche et itinéraire), en HTTPS. Les réponses sont validées, limitées en taille et en durée ; une réponse inattendue donne une erreur, jamais une valeur devinée.
- Les textes reçus de TomTom (libellés, villes) sont nettoyés des caractères de contrôle et limités en longueur. La recherche est limitée à 120 caractères.

## Outil vocal et affichage permanent

L’outil s’appelle `tempsdetrajet__read`. Avec « Afficher en permanence sur le miroir », le miroir montre « Arrivée 8 h 42 » en grand, la durée en dessous, puis jusqu’à trois lignes : trafic, durée sans trafic et distance.

## Auteur

[Bunchfr](https://github.com/Bunchfr), avec l’aide de Claude.

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
