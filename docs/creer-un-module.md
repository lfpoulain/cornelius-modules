# Créer un module

Ce tutoriel construit pas à pas, dans ce dépôt, un module d’informations à partir du gabarit : un module « parking » qui annonce les places libres. Il s’adresse à une développeuse ou un développeur à l’aise avec TypeScript. Les règles complètes du contrat sont dans la [référence](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md).

Un module d’informations lit une source, garde des données propres et fournit la réponse orale et la carte. Pour déclencher une action (ouvrir un portail), utilisez plutôt une [commande HTTP](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md#les-commandes-http) de Cornelius : aucun code n’est nécessaire.

Ce tutoriel construit une lecture ordinaire, la même à chaque appel et gardée en cache. Pour un module qui répond à une question libre (chercher dans des documents, interroger un service), suivez les mêmes étapes, puis déclarez un [outil à la demande](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md#loutil-à-la-demande) : `collect` reçoit alors la question dans `context.query`. Le module livré [Ragator](https://github.com/lfpoulain/Cornelius/blob/main/addons/ragator/index.ts) en est l’exemple.

## Avant de commencer

- Cornelius 0.2.0 ou plus récent est cloné **à côté** de ce dépôt, dans `../cornelius`, et `npm ci` y a été lancé. Ailleurs, indiquez son dossier dans `CORNELIUS_DIR`.
- Rien à installer ici : `npm test`, `npm run check` et `npm run format` utilisent les outils de Cornelius.
- Le dossier `_lib/` réunit le code partagé par les modules : `flux.ts` (flux RSS et Atom, texte coupé, ancienneté), `temps.ts` (jour civil, minuit suivant, heure murale dans le fuseau du foyer) et `transitous.ts` (trajets en transport en commun d’après Transitous, pour les modules de transport du Québec).

## 1. Copier le gabarit

Le dossier `_template` contient un module complet relié à un fournisseur fictif, avec ses schémas, une réponse d’exemple et ses tests. Son nom commence par `_` : Cornelius ne le charge pas. Depuis la racine de ce dépôt :

```sh
cp -r _template parking
```

```powershell
Copy-Item -Recurse _template parking
```

Vous obtenez :

| Fichier | Rôle |
| --- | --- |
| `index.ts` | La définition du module, exportée par défaut |
| `config.schema.json` | Les réglages d’une source |
| `data.schema.json` | Les données gardées après chaque lecture |
| `fixtures/availability.json` | Une réponse fictive du fournisseur, pour les tests |
| `addon.test.ts` | Les tests, lancés par `npm test` |
| `README.md` | La fiche du module, à remplir |

## 2. Choisir l’identifiant

Dans `index.ts`, le champ `id` doit être **identique au nom du dossier**. Il commence par une lettre minuscule, puis contient au plus 31 minuscules, chiffres ou `_` (motif `^[a-z][a-z0-9_]{0,31}$`). Pas de tiret : un dossier `parking-gare` serait ignoré sans message, alors que `parking_gare` convient.

L’identifiant ne doit pas être celui d’un module livré avec Cornelius (`clock`, `weather`, `transit`, `ragator`) : le module externe serait refusé, et le module livré resterait en place.

Le gabarit déclare déjà `id: 'parking'`. Pour un dossier d’un autre nom, changez `id` et la valeur de `sources` dans `present` : sinon le module est refusé au démarrage (« identifiant « parking » différent du dossier. »).

Remplacez ensuite les éléments fictifs : `sourceLabel` (le nom du fournisseur, affiché sur les cartes), `baseUrl`, le `provider` renvoyé par `collect`, les types `ParkingConfig` et `ParkingData`, les textes.

Pour les imports :

- le contrat vient de `#cornelius/addons` et `#cornelius/validation`, les outils de test de `#cornelius/testing`. Jamais de chemin vers `../cornelius/` : Cornelius résout ces alias vers lui-même, où qu’il soit installé ;
- le code partagé du dépôt s’importe par un chemin relatif (`../_lib/temps.js`) ;
- les imports locaux gardent l’extension `.js` (`./index.js`) ;
- les fichiers JSON s’importent avec `with { type: 'json' }`.

L’outil vocal prend le nom `<id>__read` : ici `parking__read`.

## 3. Présenter le module dans l’administration

Avec `display`, le module se présente comme un module livré : son nom, sa phrase, son icône, son groupe et la tournure de la phrase à prononcer.

```ts
display: {
  name: 'Parking',
  description: 'Places libres du parking de votre choix.',
  icon: 'car',
  keywords: ['parking', 'places', 'stationnement'],
  example: { label: 'Parking de la gare', ref: 'gare' },
  spoken: { head: 'les places', repeats: ['parking', 'places'] },
},
```

- `name` (40 caractères au plus) et `description` (une phrase de 160 caractères au plus) remplacent le `sourceLabel` et le texte générique.
- `icon` se choisit dans la [liste des icônes](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md#la-présentation-dans-ladministration) ; un autre nom fait refuser le module.
- `group` vaut `daily` (« Au quotidien », par défaut) ou `home` (« Maison »).
- `example` préremplit les exemples du formulaire d’une nouvelle source.
- `spoken` règle la phrase proposée sous « Nom affiché » : « les places de la gare » plutôt que « la source de Parking de la gare ». Les mots de `repeats`, en minuscules sans accents, sont retirés de l’identifiant.

## 4. Décrire les réglages et les données

`config.schema.json` décrit les réglages d’une source. Le formulaire de l’administration est construit à partir de lui :

```json
"parkingId": {
  "title": "Parking",
  "description": "Identifiant du parking chez le fournisseur.",
  "type": "string",
  "pattern": "^[a-z0-9_-]{1,64}$",
  "examples": ["demo"]
}
```

- `title` devient le libellé du champ et `description` le texte d’aide. Sans description, un champ qui a un `minimum` et un `maximum` affiche « De … à … ».
- Le premier élément de `examples` sert d’exemple dans le champ (« ex. demo »).
- `maxLength` limite la saisie. `pattern`, `minimum`, `maximum` et les champs requis sont contrôlés par le serveur à l’enregistrement, qui affiche ses erreurs en français sous chaque champ.
- Un booléen devient un interrupteur. Un champ nommé `timeZone` devient une liste de fuseaux. Un type `["string", "null"]` rend le champ facultatif.

Pour un choix dans une liste, préférez une **liste déroulante** à un texte contrôlé par un motif. `oneOf` donne un libellé à chaque choix, et un `const: null` le choix « vide » :

```json
"fuel": {
  "title": "Carburant principal",
  "type": ["string", "null"],
  "oneOf": [
    { "const": null, "title": "Tous" },
    { "const": "gazole", "title": "Gazole" },
    { "const": "sp98", "title": "SP98" }
  ]
}
```

Pour plusieurs éléments de même forme, une **liste répétée** (`type: "array"`) : de textes, de choix, ou de petits objets dont chaque propriété devient une colonne. Le module [Poubelles](../poubelles/config.schema.json) en est l’exemple, un bac par ligne :

```json
"bacs": {
  "title": "Bacs ramassés",
  "type": "array",
  "minItems": 1,
  "maxItems": 8,
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["bac", "jours"],
    "properties": {
      "bac": { "title": "Bac", "type": "string", "oneOf": [{ "const": "verre", "title": "Verre" }] },
      "jours": { "title": "Jours de ramassage", "type": "string", "minLength": 1, "maxLength": 80 }
    }
  }
}
```

Il n’y a pas d’éditeur pour un objet hors d’une liste, ni pour une liste dans une liste.

`configDefaults` (dans `index.ts`) préremplit le formulaire de création. Il ne complète pas une configuration existante. Si la forme des réglages change, augmentez `configVersion` et écrivez `configMigrate`, qui reprend les sources déjà réglées (voir le module Poubelles, passé d’un champ par bac à une liste).

`data.schema.json` décrit les données normalisées que `collect` renvoie. Le serveur les vérifie après chaque lecture : des données non conformes sont refusées comme « mal formées ». Déclarez `additionalProperties: false`, les champs requis, et des bornes.

Ni les réglages ni les données ne contiennent de secret. Un jeton se déclare à part (voir la [référence](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md#les-secrets)).

## 5. Écrire la collecte

`collect` interroge le fournisseur avec le client fourni par le cœur (`context.http`), jamais avec `fetch`. Transmettez toujours `context.signal`, pour qu’une lecture devenue inutile s’arrête :

```ts
const response = await context.http.fetch({
  url: `${baseUrl}/parkings/${encodeURIComponent(context.config.parkingId)}`,
  method: 'GET',
  signal: context.signal,
  timeoutMs: 4000,
  maxBytes: 32 * 1024,
});
```

Le client du cœur suit jusqu’à trois redirections d’un GET, respecte l’encodage annoncé, et se présente avec un User-Agent « Cornelius/x.y.z ». Deux options utiles :

- `cacheMs` (10 minutes au plus) partage une réponse entre les sources et les recherches : pour un gros fichier commun, comme le catalogue et l’état d’un réseau de vélos dans le module [Vélos](../velos/index.ts) ;
- `response.truncated` dit que la réponse a été coupée à `maxBytes` : le module DEVRAIT le dire, comme l’[Agenda](../agenda/index.ts) (« Agenda incomplet »).

Traduisez chaque statut en une erreur `AddonCollectError` avec un message court et compréhensible. La réponse n’a pas de propriété `ok`, et `json()` lève une exception sur un texte illisible :

```ts
if (response.status === 404) throw new AddonCollectError('not_found', 'Parking introuvable.');
// …
let payload: unknown;
try {
  payload = response.json();
} catch {
  throw new AddonCollectError('malformed', 'Réponse du fournisseur illisible.');
}
```

Vérifiez la réponse avant de l’utiliser (le gabarit compile un validateur), puis renvoyez les données et leur source :

```ts
return {
  data: { name: payload.name, available: payload.available },
  // Zéro place est une information utile : ce n'est pas un résultat « empty ».
  source: { provider: 'parking-demo', sourceId: context.config.parkingId },
  // Pas de date d'observation inventée : fetchedAt sera fourni par le cœur.
};
```

N’inventez jamais de valeur : une panne n’est pas « zéro place ». Quand la source répond sans **rien à signaler** (aucun passage cette nuit, rien de publié), renvoyez `empty: true` : le cœur appellera quand même `present`, qui le dira. Les codes d’erreur sont listés dans la [référence](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md#les-erreurs-de-collecte).

La fraîcheur `freshMs` va de 5 secondes à 24 heures. Pour une donnée du jour, renvoyez `freshMs` jusqu’à minuit, comme l’[Éphéméride](../ephemeride/index.ts).

## 6. Présenter la carte et la réponse orale

`present` transforme les données en carte et en phrase à dire. Elle est synchrone, sans réseau et sans effet de bord :

```ts
present(snapshot) {
  const data = snapshot.data;
  if (!data) throw new Error('Aucune disponibilité à présenter.');
  const stale = snapshot.status === 'stale';
  return {
    title: 'Parking',
    primaryValue: `${data.available} place${data.available === 1 ? '' : 's'}`,
    subtitle: data.name,
    description: stale ? 'Dernière disponibilité connue, à vérifier.' : null,
    items: [],
    summary: stale
      ? `Dernière disponibilité connue à ${data.name} : ${data.available} places ; à vérifier.`
      : `${data.name} : ${data.available} places disponibles.`,
    sources: ['parking'],
  };
},
```

- Respectez les longueurs maximales (titre de 80 caractères, cinq lignes au plus…) : une carte trop longue est refusée et Cornelius répond que les données sont illisibles. Utilisez `null`, jamais une chaîne vide.
- Avec `status === 'stale'`, les données datent d’avant une panne : dites-le.
- Avec `status === 'empty'`, dites qu’il n’y a rien à signaler (« Aucun passage prévu pour le moment »). Si `present` lève une exception sur un relevé vide, Cornelius dit « La source ne fournit aucune donnée utile pour le moment. ».
- « Aujourd’hui », « demain », « ce soir » et les heures se calculent dans **le fuseau du foyer**, `context.timeZone`, jamais à Paris en dur. `_lib/temps.ts` fournit `dateIn`, `dayIn`, `nextMidnight` et `nextWallTime`.

## 7. Proposer l’affichage permanent (facultatif)

Avec un champ `ambient`, l’administration propose « Afficher en permanence sur le miroir » pour les sources du module :

```ts
ambient: {
  present(snapshot, context) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune disponibilité à afficher.');
    return {
      layout: 'metric',
      title: 'Parking',
      value: `${data.available} places`,
      subtitle: data.name,
      items: [],
    };
  },
},
```

`layout` vaut `'metric'` (une valeur en grand) ou `'list'` (trois lignes au plus). Sur le miroir, l’en-tête est le « Nom affiché » de la source (« Parking de la gare ») : `title` est obligatoire mais n’y apparaît pas. La date du relevé s’affiche dessous, sauf avec `showCollectedAt: false`. Retirez ce bloc si le module ne s’y prête pas.

Si le texte dépend de l’heure (« ce soir », « dans 3 jours », « en cours »), donnez `refreshAt` : l’instant où il cesse d’être juste. Cornelius recalcule alors la présentation à cet instant, sans nouvelle collecte :

```ts
refreshAt: new Date(nextMidnight(context.now(), context.timeZone)).toISOString(),
```

Les modules [Poubelles](../poubelles/index.ts) (midi, 17 h, minuit) et [Agenda](../agenda/index.ts) (début ou fin du prochain rendez-vous) en sont les exemples.

## 8. Accepter des précisions à la voix (facultatif)

Pour une lecture que la voix précise (« et samedi ? », « et le SP98 ? »), déclarez des `arguments` sur l’outil : un entier borné, un choix dans une liste, ou oui-non. Cornelius les annonce au modèle, les contrôle, puis les passe à `collect` dans `context.args` :

```ts
arguments: {
  debut: {
    type: 'integer',
    minimum: 0,
    maximum: 60,
    description: 'Premier jour à lire, compté depuis aujourd’hui : 0 aujourd’hui, 1 demain.',
  },
},
```

Sans argument, la lecture est ordinaire, avec cache. Avec un argument, c’est une lecture à la demande : rien n’est mis en cache ni enregistré. `collect` doit tenir compte de l’argument dans ses données, car `present` ne voit que le relevé. Voir l’[Agenda](../agenda/index.ts) (`debut`, `jours`) et les [Carburants](../carburants/index.ts) (`carburant`).

## 9. Déclarer la version de Cornelius nécessaire

Le contrat `apiVersion: 1` ne change pas sans prévenir, mais Cornelius ajoute des fonctions compatibles. `display`, `arguments`, `refreshAt`, `context.timeZone`, les listes du formulaire, `cacheMs` et `createTestModule` sont arrivés avec Cornelius 0.2.0 : un module qui s’en sert le déclare.

```ts
minCoreVersion: '0.2.0',
```

Sur un Cornelius plus ancien, le module est alors refusé au démarrage avec la raison (« nécessite Cornelius 0.2.0 ou plus récent (installé : 0.1.0). ») au lieu d’échouer à la première lecture. La version installée est celle du `package.json` de Cornelius ; le tableau des versions est dans la [référence](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md#versions-et-migrations).

## 10. Tester

Les tests passent par `createTestModule` de `#cornelius/testing` : le module tourne dans le vrai cœur, avec une base en mémoire, une horloge réglable et un réseau simulé par une table d’adresses. Ils ne contactent aucun serveur.

```ts
const f = createTestModule(t, addon, {
  at: '2026-09-22T10:00:00Z',
  routes: { '/parkings/': payload },
});
const result = await f.read();
assert.deepEqual(f.contract(result), []);
```

- `routes` associe un morceau d’adresse à une réponse : un objet (envoyé en JSON), une chaîne, ou `{ status, body, truncated }`. `f.route(…)` en change ou en ajoute en cours de test (une panne, une réponse vide).
- `f.at(…)` et `f.advance(ms)` règlent l’horloge ; `timeZone` change le fuseau du foyer.
- `f.invoke('read', { debut: 4 })` appelle l’outil comme le modèle, arguments contrôlés compris.
- `f.ambient()` donne l’affichage permanent ; `f.configure(…)` change les réglages ; `f.calls` liste les requêtes envoyées.
- `f.contract(résultat)` liste les écarts au contrat : définition, relevé, carte, affichage permanent et résultat d’outil.

Adaptez `addon.test.ts` et la réponse fictive au vrai fournisseur, sans oublier l’adresse attendue dans le premier test. Les tests du gabarit vérifient déjà le contrat, le cache, les lectures simultanées, la valeur zéro, la panne initiale, le repli sur le dernier relevé, la réponse mal formée et la source inconnue. Enregistrez de vraies réponses quand les données sont publiques ; pour la presse, écrivez des articles fictifs au format exact du flux.

```sh
npm test
npm run check
npm run format
```

`npm test` lance les tests de tous les dossiers du dépôt, gabarit et `_lib` compris, avec le Cornelius voisin. `npm run check` vérifie les types contre son contrat. Depuis Cornelius, `npm run test:modules` fait la même chose que `npm test` ici.

## 11. Installer et essayer

1. Redémarrez Cornelius : les modules ne sont lus qu’au démarrage. Il charge ce dépôt s’il est cloné à côté de lui (ou dans `CORNELIUS_MODULES_DIR`).
2. Ouvrez **Modules**. Le module apparaît dans son groupe, sous son nom et son icône (`display`), avec le badge « À configurer ». S’il est refusé, l’encadré « Module non chargé », en bas de la page, donne la raison (« identifiant … différent du dossier », « icône « … » inconnue »…).
3. Cliquez sur le nom du module pour le déplier, puis sur **Ajouter une source**. Remplissez le formulaire et cliquez sur **Ajouter**. Une valeur refusée par `config.schema.json` est signalée sous son champ, ou sous sa case dans une liste (par exemple « Format invalide. »).
4. Cliquez sur **Tester** : avec un vrai fournisseur, c’est un vrai appel, sans passer par le cache. Le résultat s’affiche sous la source : « Réponse À jour · … », ou « Échec. » suivi du message de `collect` (« Échec. Introuvable : Parking introuvable. »). Tant que l’adresse fictive du gabarit est en place, le test échoue. Sous le nom de la source, l’aperçu reprend la valeur et le sous-titre de la carte.
5. Si le module déclare `ambient`, activez **Afficher en permanence sur le miroir** dans la source : la valeur apparaît sur le miroir dès qu’une présence est confirmée devant la caméra.
6. En conversation, demandez l’information, avec ses précisions si l’outil déclare des arguments. La phrase proposée sous « Nom affiché » suit `display.spoken` (« les places de la gare »).

## 12. Liste de contrôle

- [ ] Dossier et `id` identiques, différents des modules livrés ; le module se charge sans « Module non chargé ».
- [ ] Imports par `#cornelius/addons`, `#cornelius/validation` et `#cornelius/testing`, aucun chemin vers `../cornelius/`.
- [ ] `display` rempli : nom, description, icône de la liste, exemple, phrase vocale.
- [ ] `minCoreVersion: '0.2.0'` dès qu’un ajout de 0.2.0 est utilisé.
- [ ] Fournisseur fictif, adresse et textes du gabarit remplacés.
- [ ] Champs de réglage avec `title`, `description` et bornes ; choix en liste déroulante ; valeurs par défaut vérifiées ; `configMigrate` si la forme a changé.
- [ ] Collecte avec `context.http` et `context.signal`, réponse validée, erreurs explicites ; `cacheMs` pour un fichier commun ; `truncated` dit.
- [ ] Jours et heures dans `context.timeZone` ; « rien à signaler » dit par `present` ; `refreshAt` si l’affichage dépend de l’heure.
- [ ] Aucun secret dans les réglages, les données, les réponses fictives, les cartes ou le journal.
- [ ] Carte dans les limites, dernier relevé annoncé comme tel.
- [ ] `ambient` présent seulement si l’affichage permanent a un sens.
- [ ] Tests avec `createTestModule` ; `npm test`, `npm run check` et `npm run format:check` passent.
- [ ] Fiche `<id>/README.md` remplie : ce que fait le module, réglages, jeton et lien d’inscription, limites, outil vocal, auteur.
- [ ] Module ajouté au tableau du [README](../README.md#-les-modules) et au [CHANGELOG](../CHANGELOG.md).
- [ ] Essai réel dans l’administration et à la voix, noté à part des tests automatiques.

## Avec un assistant de code

```text
Crée un module Cornelius pour [besoin], identifiant [id] (minuscules, chiffres, « _ »),
dans le dépôt cornelius-modules. Lis docs/creer-un-module.md, puis dans ../cornelius :
docs/modules/reference.md, shared/addons.ts, server/addons/runtime.ts,
server/addons/registry.ts et server/addons/testing.ts. Pars d'une copie de _template,
sans garder son fournisseur fictif. Inspire-toi du module le plus proche de ce dépôt
(agenda, poubelles, vacances, velos…) ou de ../cornelius/addons, sans les modifier.

Source réelle : [documentation de l'API, adresses autorisées, format des réponses].
Réglages : [champs, titres, descriptions, choix en liste, listes, valeurs par défaut].
Jeton : [nom de la variable .env, jamais sa valeur ; la déclaration dans secrets suffit].
Lecture : [ordinaire avec read, arguments typés, ou outil à la demande avec query].
Fraîcheur : [durée, et traitement d'une donnée déjà ancienne].
Carte et oral : [faits prioritaires, comportement sans donnée, rien à signaler].
Affichage permanent : [oui ou non ; metric ou list ; valeur et lignes ; refreshAt].

Respecte le contrat v1 et ses limites ; déclare display et minCoreVersion 0.2.0.
Calcule jours et heures dans context.timeZone. Importe uniquement par
#cornelius/addons, #cornelius/validation, #cornelius/testing et ../_lib. Ne modifie pas
Cornelius : si le besoin dépasse le contrat, décris l'évolution nécessaire. Livre la
définition, les schémas, des réponses fictives, des tests avec createTestModule et la
fiche [id]/README.md, et ajoute le module au tableau du README et au CHANGELOG. Vérifie
npm test, npm run check et npm run format:check. Indique ce qui est testé et ce qui
reste à essayer avec le vrai fournisseur et à la voix.
```

## Voir aussi

- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- [Fiche à remplir](../_template/README.md)
- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md) : sources, jetons, catalogue
- Modules de ce dépôt, comme exemples : [Agenda](../agenda/README.md) (arguments, `refreshAt`), [Poubelles](../poubelles/README.md) (liste répétée, migration), [Vélos](../velos/README.md) (recherche assistée, `cacheMs`), [Titres de l’actualité](../actu/README.md) (flux RSS)
