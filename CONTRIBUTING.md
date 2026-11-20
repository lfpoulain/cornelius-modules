# Contribuer à cornelius-modules

Merci de vouloir enrichir Cornelius. Cette page explique comment proposer un module, ou en améliorer un, et ce qu’il faut vérifier avant de l’envoyer. Le pas à pas d’écriture est dans [Créer un module](docs/creer-un-module.md).

## Proposer un module

1. Ouvrez d’abord un ticket qui décrit le besoin, la source des données (adresse de l’API, licence, jeton éventuel) et ce que Cornelius dirait.
2. Créez une branche à partir de `main`, avec un module par branche.
3. Copiez le gabarit (`cp -r _template <id>`), puis suivez le tutoriel.
4. Ouvrez une demande de fusion qui explique ce que fait le module et comment vous l’avez vérifié : tests automatiques, et essai réel dans l’administration et à la voix.

Ne joignez jamais un jeton, une clé, un fichier `.env` ou une réponse de fournisseur qui contient des données personnelles.

## Avant d’envoyer

Avec Cornelius cloné à côté de ce dépôt (et `npm ci` lancé dedans) :

```sh
npm run format:check
npm run check
npm test
```

`npm run format` corrige la mise en forme. Les mêmes vérifications tournent à chaque envoi (`.github/workflows/check.yml`), contre la branche `main` de Cornelius. Pour une première contribution, GitHub attend qu’un mainteneur autorise la vérification avant de la lancer.

## Ce qu’un module doit avoir

- Un dossier `<id>/` à la racine, identique au champ `id`, sans tiret, différent des modules livrés avec Cornelius (`clock`, `weather`, `transit`, `ragator`).
- Le contrat importé par `#cornelius/addons`, `#cornelius/validation` et, dans les tests, `#cornelius/testing`. Aucun chemin vers `../cornelius/`.
- Des tests écrits avec `createTestModule`, sur des réponses enregistrées du vrai fournisseur (`fixtures/`), sans réseau.
- Une fiche `<id>/README.md` remplie à partir de [la fiche du gabarit](_template/README.md), avec la licence des données.
- Une ligne dans le tableau des modules du [README](README.md#-les-modules) et dans le [CHANGELOG](CHANGELOG.md).
- Un champ `display` (nom, description, icône, phrase vocale) et `minCoreVersion: '0.2.0'`, ou plus si le module s’appuie sur un ajout plus récent de Cornelius.
- Des fixtures sans contenu protégé : les réponses de fournisseurs de données publiques sont enregistrées telles quelles ; pour la presse, des articles fictifs au format exact du flux.

## Le code partagé

Le dossier `_lib/` réunit ce que plusieurs modules utilisent ; son nom commence par « _ », Cornelius ne le charge donc pas comme un module. Il contient `flux.ts` (lecture des flux RSS et Atom, coupe des textes sur un mot, ancienneté « il y a 3 heures ») `temps.ts` (jour civil, minuit suivant, heure murale dans le fuseau du foyer, changements d’heure compris) et `transitous.ts` (trajets en transport en commun d’après Transitous : géocodage, itinéraire, passages à l’arrêt, phrase et carte, communs aux modules de transport du Québec). Un module l’importe par un chemin relatif (`../_lib/temps.js`) et reste sans autre dépendance. Une fonction n’y entre que lorsqu’au moins deux modules s’en servent ; avant, elle reste dans son module, comme `agenda/ics.ts`.

## Conventions

- TypeScript strict ; aucun avertissement de `npm run check`.
- Textes en français (cartes, réponses orales, messages d’erreur, fiches), phrases courtes, sans tiret long.
- Une donnée absente n’est jamais inventée : une panne n’est pas « zéro ».
- Jours et heures se calculent dans le fuseau du foyer (`context.timeZone`), jamais à Paris en dur.
- Les besoins qui dépassent le contrat (nouveau type de carte, outil qui agit) se discutent dans [Cornelius](https://github.com/lfpoulain/Cornelius) : le contrat et sa [référence](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md) y évoluent ensemble.

## Licence des contributions

Ce dépôt est sous [licence MIT](LICENSE), à la différence de Cornelius. En proposant un changement, vous confirmez en être l’auteur ou avoir le droit de le proposer, et vous acceptez qu’il soit distribué sous cette licence. Vous gardez vos droits d’auteur : la licence MIT donne les mêmes droits à tous, vous compris, et ne cède rien de plus aux auteurs de Cornelius.

L’auteur d’un module est cité dans sa fiche (section « Auteur ») et dans l’entrée du [CHANGELOG](CHANGELOG.md) qui l’ajoute.
