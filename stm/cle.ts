/**
 * Clé publique de l'application « Transports STM » (portail des développeurs de la STM),
 * déclarée publique auprès de la STM et partagée par tous les foyers. Brouillée seulement pour
 * échapper aux robots qui cherchent des clés en clair : ce n'est pas un secret.
 */
const brouillee = 'L1hLVgRZC0BGTgsKBhNYBBxGTF10DEcMAV5bF0IbWFpVRA==';
const sel = 'Cornelius-module-stm';

export function cleStm(): string {
  const octets = Uint8Array.from(atob(brouillee), (c) => c.charCodeAt(0));
  return String.fromCharCode(...octets.map((b, i) => b ^ sel.charCodeAt(i % sel.length)));
}
