# Module Temps de trajet

Le module Temps de trajet donne l’heure d’arrivée estimée d’un trajet en voiture, avec le trafic en direct. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `tempsdetrajet`).

## Ce que fait le module

- Il répond à « à quelle heure j’arrive ? » et affiche une carte « Trajet » : l’heure d’arrivée en valeur principale, la durée du trajet, puis le retard dû au trafic, la durée sans trafic et la distance.
- Le fournisseur choisit lui-même l’itinéraire le plus rapide au moment de la lecture. Le module ne compare pas d’itinéraires.
- L’heure d’arrivée suppose un départ **maintenant** : c’est la durée du dernier relevé ajoutée à l’heure actuelle. Avec l’affichage permanent, elle avance à chaque minute sans nouvelle requête.
- Le trafic est relevé au plus toutes les 5 minutes (`freshMs`). Le relevé n’est renouvelé que pendant qu’une personne est devant le miroir.

## Jeton requis

Le module a besoin d’une clé TomTom (gratuite à la date de rédaction, voir les limites), à demander sur [developer.tomtom.com](https://developer.tomtom.com/). Ajoutez-la dans le fichier `.env` puis redémarrez Cornelius :

```ini
CORNELIUS_TOMTOM_KEY=votre-cle
```

Elle peut aussi se saisir dans **Mise en route → Clés et jetons**. Elle n’est jamais écrite dans le code ni dans les réglages d’une source.

## Réglages d’une source

Dans **Modules → Trajet → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Départ | Se choisit par **recherche d’adresse** : tapez une rue ou un lieu, puis **Chercher** et cliquez le résultat | Place de la Bourse, Bordeaux (exemple) |
| Arrivée | Même recherche | Gare Saint-Jean, Bordeaux (exemple) |

Les valeurs par défaut sont des repères de démonstration : remplacez-les par vos adresses. La recherche demande au moins 3 lettres, ne cherche qu’en France et propose six résultats au plus. Une même saisie est gardée 10 minutes en mémoire, ce qui épargne le quota.

**Confidentialité.** L’adresse tapée part chez TomTom au moment de la recherche. Le point retenu est ensuite **arrondi à environ 100 mètres** avant d’être enregistré et envoyé pour calculer le trajet : TomTom reçoit un repère proche, pas la porte exacte. Un point saisi à la main avec plus de précision est arrondi de la même façon avant l’envoi. Pour ne pas lui donner non plus l’adresse tapée, cherchez une rue ou un lieu voisin plutôt que votre numéro.

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
- La recherche d’adresse utilise l’API de recherche de TomTom, en plus de l’API de calcul d’itinéraire. Son quota gratuit n’est pas vérifié ici.
- Le palier gratuit annoncé sur la [page des tarifs TomTom](https://docs.tomtom.com/pricing) est de 20 000 requêtes par mois pour le Routing. Ses conditions d’usage et ce qui arrive au-delà ne figurent pas sur cette page : lisez les conditions de TomTom avant de l’utiliser.
- Le retard affiché est l’écart entre la durée avec trafic et la durée sans trafic (`noTrafficTravelTimeInSeconds`), pour que « sans trafic + retard = durée » reste vrai sur la carte. À défaut de durée sans trafic, le champ `trafficDelayInSeconds` de TomTom (les incidents du moment) est utilisé ; sinon le retard n’est pas affiché.
- En cas de panne, le dernier relevé est gardé et annoncé comme « dernier relevé connu ».
- **Réponses de référence.** Les tests s’appuient sur deux réponses réelles de TomTom, enregistrées le 2 novembre 2026 sur des lieux publics : un itinéraire de la gare Saint-Jean vers le centre de Bordeaux (`fixtures/route.json`) et la recherche « gare saint-jean bordeaux » (`fixtures/search.json`). Si TomTom change la forme de ses réponses, le module affiche « Réponse illisible », ou ne propose aucun résultat, jamais une durée ni une adresse inventée.

## Sécurité

- La clé TomTom n’est lue que par Cornelius (variable d’environnement ou saisie dans l’administration). Le module ne la cite dans aucun message d’erreur, y compris en cas de panne réseau.
- Utilisez une clé réservée à Cornelius, et renouvelez-la si vous pensez qu’elle a fuité. TomTom l’attend dans l’adresse de la requête : évitez de journaliser les adresses des requêtes sortantes.
- Seuls deux services TomTom sont appelés (recherche et itinéraire), en HTTPS. Les réponses sont validées, limitées en taille et en durée ; une réponse inattendue donne une erreur, jamais une valeur devinée.
- Les textes reçus de TomTom (libellés, villes) sont nettoyés des caractères de contrôle et limités en longueur. La recherche est limitée à 120 caractères.

## Outil vocal et affichage permanent

L’outil s’appelle `tempsdetrajet__read`. Avec « Afficher en permanence sur le miroir », le miroir montre « Arrivée 8 h 42 » en grand, la durée en dessous, puis jusqu’à trois lignes : trafic, durée sans trafic et distance.

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
