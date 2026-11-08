# Module Météo libre

Le module Météo libre donne les prévisions du jour et des jours suivants pour un lieu, d’après l’API libre et gratuite [Open-Meteo](https://open-meteo.com/), sans jeton ni inscription. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `meteo_libre`).

## Ce que fait le module

- Il répond à « quel temps fait-il ? », « va-t-il pleuvoir demain ? » ou « météo de la semaine » et affiche une carte « Météo » : températures minimale et maximale du jour, temps, puis une ligne par jour suivant (5 au plus).
- À l’oral, il cite le risque de pluie à partir de 40 % et le vent à partir de 40 km/h.
- Les jours suivent le fuseau du foyer. Le lendemain, un relevé de la veille ne garde que les jours à venir.
- Une valeur absente chez Open-Meteo n’est jamais inventée : un jour sans température est écarté, et une probabilité de pluie absente n’est pas dite.
- Les données restent en cache 30 minutes. Deux sources du même lieu partagent la réponse 5 minutes.

## Réglages d’une source

Dans **Modules → Météo libre → Ajouter une source** :

| Réglage            | Effet                                                                  | Par défaut |
| ------------------ | ---------------------------------------------------------------------- | ---------- |
| Lieu               | Nom dit et affiché pour ce lieu                                        | Paris      |
| Latitude           | En degrés décimaux, par exemple 48.39 pour Brest                       | 48.86      |
| Longitude          | En degrés décimaux, négative à l’ouest de Greenwich : -4.49 pour Brest | 2.35       |
| Jours de prévision | Aujourd’hui compris, de 1 à 7                                          | 3          |

Pour trouver les coordonnées d’un lieu, un clic droit sur la carte d’OpenStreetMap ou de Google Maps les affiche.

## Limites

- Usage non commercial gratuit, limité par Open-Meteo à 10 000 appels par jour : largement assez pour un foyer (une collecte toutes les 30 minutes par lieu).
- Prévisions par modèle numérique, sans les vigilances officielles de Météo-France.
- En cas de panne, la source annonce la dernière prévision connue, à vérifier ; sans aucun succès précédent, elle dit qu’Open-Meteo est indisponible.
- Données d’Open-Meteo sous licence [CC BY 4.0](https://open-meteo.com/en/license) : la source s’appelle « Météo libre (Open-Meteo) » dans l’administration et sur les cartes.

## Outil vocal et affichage permanent

L’outil s’appelle `meteo_libre__read`. Avec « Afficher en permanence sur le miroir », le miroir montre les températures du jour et le temps, et passe au lendemain à minuit.

## Auteur

Louis ([NeuTroNBZh](https://github.com/NeuTroNBZh)).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
