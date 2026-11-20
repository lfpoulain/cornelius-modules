# Immich (`immich`)

Module de consultation des souvenirs (« ce jour-là ») et de recherche sémantique de photos sur une instance [Immich](https://immich.app/) auto-hébergée.

## Confidentialité

- Ce module n’expose pas d’affichage permanent (`ambient`) afin qu’aucune photo personnelle ne reste affichée en veille sur le miroir.
- Associez chaque instance dans l’administration à un profil reconnu par caméra : seul le propriétaire identifié devant le miroir peut interroger sa photothèque.

## Configuration

- **URL du serveur Immich** (`serverUrl`) : adresse de votre serveur Immich (ex. `http://192.168.1.50:2283`).
- **Prénom du propriétaire** (`userName`) : prénom affiché sur la carte.
- **Nombre de clichés par défaut** (`defaultCount`) : entre `1` et `10` (défaut : `5`).

## Secret requis

- `CORNELIUS_IMMICH_API_KEY` : clé API générée depuis les paramètres du compte utilisateur sur Immich.

## Outils vocaux

- `immich__memories` : souvenirs « ce jour-là » (ou sélection aléatoire si aucun souvenir du jour).
- `immich__search` : recherche sémantique CLIP par mots-clés (`query`).
