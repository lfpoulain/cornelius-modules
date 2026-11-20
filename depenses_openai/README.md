# Module Dépenses OpenAI

Le module Dépenses OpenAI dit ce que Cornelius coûte chez OpenAI. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code (identifiant `depenses_openai`).

## Ce que fait le module

- Il répond à « combien a coûté Cornelius ce mois-ci ? » et affiche une carte « Dépenses OpenAI » :
  - le total du mois en cours, en dollars ;
  - la dépense du jour et des 7 derniers jours ;
  - les 3 usages qui coûtent le plus (`gpt-live-1`, `gpt-6-luna`, images…).
- Si un budget mensuel est réglé, le module signale quand 80 % du budget est atteint, puis quand il est dépassé, sur la carte comme sur l’affichage permanent.
- Un mois sans dépense affiche « 0,00 $ ce mois-ci » : zéro est une vraie valeur, pas une panne.
- Les données restent en cache une heure, jamais au-delà de minuit chez le foyer.

## Jeton requis

L’API des coûts de l’organisation (`GET /v1/organization/costs`) n’accepte qu’une **clé Admin** OpenAI (gratuite, mais réservée aux administrateurs de l’organisation), pas la clé de Cornelius. Elle se crée sur <https://platform.openai.com/settings/organization/admin-keys>.

- Créez-la sur **votre compte OpenAI personnel**, celui qui paie Cornelius.
- Choisissez la lecture seule si OpenAI le propose.
- Saisissez-la dans l’administration de Cornelius (**Mise en route → Clés et jetons**), ou ajoutez-la dans le fichier `.env` puis redémarrez Cornelius. La valeur saisie dans l’administration passe avant celle du fichier.

```ini
CORNELIUS_OPENAI_ADMIN_KEY=votre-cle-admin
```

La clé est enregistrée en clair sur l’appareil de Cornelius, et elle agit sur toute l’organisation OpenAI. Révoquez-la si l’appareil est perdu ou change de mains.

## Réglages d’une source

Dans **Modules → Dépenses OpenAI → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Projet OpenAI | `proj_…` du projet de Cornelius (Settings → Projects) ; vide : toute l’organisation | vide |
| Budget mensuel ($) | Seuil de l’alerte de budget ; vide : pas d’alerte (comparé aux montants en dollars seulement) | 10 |

## Limites

- **Jours et fuseau horaire** : le mois et « aujourd’hui » sont ceux du foyer (`CORNELIUS_TIMEZONE`). L’API d’OpenAI ne compte que par journée UTC (`bucket_width=1d`) : le module prend les journées UTC de même date. À Paris, la journée d’OpenAI commence donc à 1 h (heure d’hiver) ou 2 h (heure d’été). La carte et la phrase le précisent (« par journée UTC »).
- OpenAI publie les coûts avec du retard, parfois plusieurs heures. Pour une journée sans aucun montant, la carte indique « Aujourd’hui : rien de publié pour l’instant » plutôt que 0,00 $ : l’API renvoie la même journée vide quand rien n’est encore publié et quand rien n’a été dépensé, le module ne peut pas les distinguer. À l’inverse, une journée publiée en partie s’affiche comme un montant ordinaire.
- Les 7 derniers jours peuvent commencer le mois précédent : du 1er au 6, le module lit aussi la fin du mois d’avant, sans la compter dans le total du mois.
- Les avoirs (montants négatifs) sont déduits. À l’oral, un jour en négatif est annoncé comme « un avoir ». Si OpenAI renvoyait plusieurs devises, la lecture échouerait plutôt que d’additionner des montants incompatibles.
- Appel vérifié le 31 octobre 2026 avec une vraie clé Admin : `start_time`, `bucket_width=1d`, `limit=31`, `group_by=line_item` et `project_ids` sont acceptés. Le 2 novembre, la lecture depuis la fin du mois précédent a aussi été vérifiée en réel. Les libellés `line_item` ont la forme « modèle, usage » (`gpt-6-luna, input`) ou le nom seul (`gpt-live-1`, `web search tool calls`). La réponse d’exemple des tests (`fixtures/costs.json`) est reconstituée à ce format, avec les mêmes champs : dates, organisation, projet et montants sont fictifs.
- Le filtre par projet n’a été essayé qu’avec une organisation à un seul projet.
- Au plus 3 pages sont lues ; au-delà, la carte indique « Relevé incomplet ». Il en va de même si OpenAI annonce d’autres pages sans donner le moyen de les lire. Une réponse de plus de 2 Mo est refusée. La pagination n’a pas été rencontrée en réel (un mois tient sur une page) : elle n’est couverte que par les tests.
- En cas de panne, la carte reprend le dernier relevé et l’annonce comme tel. Après minuit, ce relevé est daté (« Le 31 octobre ») au lieu d’être dit « d’aujourd’hui », et son mois est nommé (« en octobre ») s’il est terminé.
- Le solde de crédits n’est pas lu : il n’existe pas d’API officielle connue pour cela.
- Le module ne remplace pas le plafond de dépense du compte OpenAI.
- Données : celles de votre propre organisation OpenAI, aucune licence de données tierce.

## Outil vocal et affichage permanent

L’outil s’appelle `depenses_openai__read`. Avec « Afficher en permanence sur le miroir », le miroir montre le total du mois, le budget s’il est réglé (avec l’alerte à 80 % et 100 %), et la dépense du jour.

## Auteur

tigul_one (tigul_one@hotmail.fr).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
