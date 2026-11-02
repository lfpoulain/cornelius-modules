# Module Dépenses OpenAI

Le module Dépenses OpenAI dit ce que Cornelius coûte chez OpenAI. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code (identifiant `depenses_openai`).

## Ce que fait le module

- Il répond à « combien a coûté Cornelius ce mois-ci ? » et affiche une carte « Dépenses OpenAI » :
  - le total du mois en cours, en dollars ;
  - la dépense du jour et des 7 derniers jours ;
  - les 3 usages qui coûtent le plus (`gpt-live-1`, `gpt-6-luna`, images…).
- Si un budget mensuel est réglé, le module signale quand 80 % du budget est atteint, puis quand il est dépassé, sur la carte comme sur l’affichage permanent.
- Un mois sans dépense affiche « 0,00 $ ce mois-ci » : zéro est une vraie valeur, pas une panne.
- Les données restent en cache une heure.

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
| Budget mensuel ($) | Seuil de l’alerte de budget ; vide : pas d’alerte | 10 |

## Limites

- **Jours et fuseau horaire** : le mois et « aujourd’hui » sont ceux du foyer (`CORNELIUS_TIMEZONE`). L’API d’OpenAI ne compte que par journée UTC (`bucket_width=1d`) : le module prend les journées UTC de même date. À Paris, la journée d’OpenAI commence donc à 1 h (heure d’hiver) ou 2 h (heure d’été). La carte et la phrase le précisent (« par journée UTC »).
- OpenAI publie les coûts avec du retard, parfois plusieurs heures. Tant que rien n’est publié pour la journée, la carte indique « Aujourd’hui : pas encore publié » plutôt que 0,00 $.
- Les 7 derniers jours peuvent commencer le mois précédent : du 1er au 6, le module lit aussi la fin du mois d’avant, sans la compter dans le total du mois.
- Les avoirs (montants négatifs) sont déduits. Si OpenAI renvoyait plusieurs devises, la lecture échouerait plutôt que d’additionner des montants incompatibles.
- Appel vérifié le 31 octobre 2026 avec une vraie clé Admin : `start_time`, `bucket_width=1d`, `limit=31`, `group_by=line_item` et `project_ids` sont acceptés. Les libellés `line_item` ont la forme « modèle, usage » (`gpt-6-luna, input`) ou le nom seul (`gpt-live-1`, `web search tool calls`). La réponse d’exemple des tests reprend ce format, anonymisé (organisation, projet et montants fictifs).
- Le filtre par projet n’a été essayé qu’avec une organisation à un seul projet.
- Au plus 3 pages sont lues ; au-delà, la carte indique « Relevé incomplet ».
- En cas de panne, la carte reprend le dernier relevé et l’annonce comme tel.
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
