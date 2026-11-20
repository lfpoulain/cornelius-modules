/**
 * Relit chaque flux du catalogue des Titres de l'actualité (actu/catalogue.json) et dit ceux qui
 * ne répondent plus, ou plus en RSS ou Atom. Un flux peut disparaître sans prévenir : à lancer
 * avant de toucher au catalogue, et de temps en temps. Aucune dépendance.
 *
 *   node scripts/verifier-flux-actu.mjs
 *
 * Sortie : une ligne par flux en échec, puis le bilan ; code 1 si un flux est en échec.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(readFileSync(join(racine, 'actu', 'catalogue.json'), 'utf8'));

/** Un flux est bon s'il répond 200 avec au moins un article RSS (<item>) ou Atom (<entry>). */
async function verifier(flux) {
  try {
    const reponse = await fetch(flux.url, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (reponse.status !== 200) return `HTTP ${reponse.status}`;
    const texte = await reponse.text();
    if (!/<(rss|feed|rdf:RDF)[\s>]/iu.test(texte)) return 'pas un flux RSS ou Atom';
    if (!/<(item|entry)[\s>]/iu.test(texte)) return 'aucun article';
    return null;
  } catch (erreur) {
    return erreur instanceof Error ? erreur.message : String(erreur);
  }
}

// Quelques flux à la fois, pour ne pas solliciter un même site d'un coup.
const echecs = [];
for (let i = 0; i < catalogue.length; i += 6) {
  const lot = catalogue.slice(i, i + 6);
  const resultats = await Promise.all(lot.map(verifier));
  lot.forEach((flux, j) => {
    if (resultats[j]) {
      echecs.push(flux);
      console.log(`ÉCHEC  ${flux.id} (${flux.url}) : ${resultats[j]}`);
    }
  });
}
console.log(`${catalogue.length - echecs.length} flux sur ${catalogue.length} répondent.`);
process.exit(echecs.length ? 1 : 0);
