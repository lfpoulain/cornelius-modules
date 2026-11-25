/**
 * Regénère les tables du module Radio à partir de la base des fuseaux horaires de l'IANA
 * (domaine public) : radio/fuseaux.json (fuseau → pays, anciens noms compris, comme
 * America/Montreal ou Canada/Eastern) et la liste des pays de radio/config.schema.json, avec leurs
 * noms français (ICU de Node). À relancer après une mise à jour de la base des fuseaux.
 *
 *   node scripts/fuseaux-radio.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const radio = join(dirname(fileURLToPath(import.meta.url)), '..', 'radio');
const source = 'https://raw.githubusercontent.com/eggert/tz/main';
const lire = async (nom) => {
  const reponse = await fetch(`${source}/${nom}`, { signal: AbortSignal.timeout(30_000) });
  if (!reponse.ok) throw new Error(`${nom} : HTTP ${reponse.status}`);
  return reponse.text();
};

// zone.tab : « code du pays, coordonnées, fuseau ».
const canon = {};
for (const ligne of (await lire('zone.tab')).split('\n')) {
  if (!ligne || ligne.startsWith('#')) continue;
  const [code, , zone] = ligne.split('\t');
  canon[zone] = code;
}
// backward : anciens noms (« Link cible alias », « #= » donne le fuseau voulu s'il diffère).
const fuseaux = { ...canon };
for (const ligne of (await lire('backward')).split('\n')) {
  const m = /^Link\s+(\S+)\s+(\S+)(?:\s+#=\s*(\S+))?/u.exec(ligne);
  if (!m || fuseaux[m[2]]) continue;
  const code = canon[m[3] ?? ''] ?? canon[m[1]];
  if (code) fuseaux[m[2]] = code;
}

const noms = new Intl.DisplayNames(['fr'], { type: 'region' });
const pays = [...new Set(Object.values(canon))]
  .map((code) => ({ const: code, title: noms.of(code) }))
  .filter((p) => p.title && p.title !== p.const)
  .sort((a, b) => a.title.localeCompare(b.title, 'fr'));

writeFileSync(
  join(radio, 'fuseaux.json'),
  JSON.stringify(
    Object.fromEntries(Object.entries(fuseaux).sort(([a], [b]) => a.localeCompare(b))),
  ) + '\n',
);
const schema = JSON.parse(readFileSync(join(radio, 'config.schema.json'), 'utf8'));
schema.properties.pays.oneOf = [{ const: '', title: 'Selon le fuseau horaire du foyer' }, ...pays];
writeFileSync(join(radio, 'config.schema.json'), JSON.stringify(schema, null, 2) + '\n');
console.log(
  `${Object.keys(fuseaux).length} fuseaux, ${pays.length} pays. Lancez « npm run format ».`,
);
