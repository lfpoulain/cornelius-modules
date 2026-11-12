import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, {
  avertissement,
  coeurAvecIcones,
  iconeDe,
  ressentiPlausible,
  trouverVille,
} from './index.js';
// Pages réelles d'Environnement Canada (GeoMet-OGC, citypageweather-realtime, en français),
// relevées le 2026-11-11 vers 22 h 05 UTC : Québec (sans avertissement), West Vancouver
// (avertissement jaune de pluie en vigueur, station sans condition ni code d'icône, et un
// refroidissement éolien publié de −2 °C par 16,7 °C).
import quebec from './fixtures/qc-133.json' with { type: 'json' };
import westVancouver from './fixtures/bc-99.json' with { type: 'json' };

const at = '2026-11-11T22:05:00Z';
const routes = (request: { url: string }) => {
  if (request.url.includes('/items/qc-133')) return quebec as Record<string, unknown>;
  if (request.url.includes('/items/bc-99')) return westVancouver as Record<string, unknown>;
  return { status: 404 };
};
// Un cœur qui connaît les icônes des cartes les reçoit ; sinon, un émoji dans le texte.
const avec = coeurAvecIcones();
const texte = (emoji: string, valeur: string) => (avec ? valeur : `${emoji} ${valeur}`);
const ic = (nom: string) => (avec ? { icon: nom } : {});

test('Québec : température, ressenti, prévisions, oral et affichage permanent', async (t) => {
  const f = createTestModule(t, addon, { config: { ville: 'Québec', periodes: 3 }, at, routes });
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { ville: 'Québec', periodes: 6 }).ok, false);
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  if (!result.ok) return assert.fail(result.error.message);
  assert.equal(
    new URL(f.calls[0]!.url).pathname,
    '/collections/citypageweather-realtime/items/qc-133',
  );
  assert.equal(result.card.title, 'Météo · Québec');
  assert.equal(result.card.primaryValue, texte('🌙', '2 °C'));
  assert.equal(result.card.subtitle, 'Partiellement nuageux · ressenti −6 °C');
  assert.deepEqual(result.card.items, [
    {
      label: texte('☁️', 'Ce soir et cette nuit'),
      value: 'Généralement nuageux, min. −6 °C',
      ...ic('cloud'),
    },
    {
      label: texte('⛅', 'Jeudi'),
      value: 'Alternance de soleil et de nuages, max. 3 °C',
      ...ic('cloud-sun'),
    },
    {
      label: texte('🌙', 'Jeudi soir et nuit'),
      value: 'Quelques nuages, min. −6 °C',
      ...ic('cloud-moon'),
    },
  ]);
  if (avec) assert.equal((result.card as { icon?: string }).icon, 'cloud-moon');
  assert.equal(
    result.presentation.summary,
    'À Québec, il fait 2 degrés, partiellement nuageux, ressenti moins 6. ' +
      'Ce soir et cette nuit : généralement nuageux, minimum moins 6. ' +
      'Jeudi : alternance de soleil et de nuages, maximum 3.',
  );
  // Les émojis restent hors de l'oral.
  assert.doesNotMatch(result.presentation.summary, /[☀🌙☁⛅🌧❄⚠]/u);
  const ambient = f.ambient().content!;
  assert.equal(ambient.value, texte('🌙', '2 °C'));
  assert.equal(ambient.items.length, 2);
});

test('West Vancouver : avertissement en vigueur, ressenti absurde écarté, province', async (t) => {
  const f = createTestModule(t, addon, {
    config: { ville: 'West Vancouver, BC', periodes: 2 },
    at,
    routes,
  });
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  if (!result.ok) return assert.fail(result.error.message);
  assert.equal(result.card.subtitle, null, 'ni condition ni ressenti inventés');
  assert.deepEqual(result.card.items[0], {
    label: texte('⚠️', 'Avertissement'),
    value: 'Avertissement jaune : pluie',
    ...ic('triangle-alert'),
  });
  assert.equal(
    result.presentation.summary,
    'À West Vancouver, il fait 17 degrés. Aujourd’hui : quelques averses, maximum 16. '.replace(
      '’',
      "'",
    ) +
      'Ce soir et cette nuit : quelques averses, minimum 12. Avertissement jaune : pluie en vigueur.',
  );
  // Après son expiration, l'avertissement n'est plus dit.
  const plusTard = createTestModule(t, addon, {
    config: { ville: 'West Vancouver, BC', periodes: 2 },
    at: '2026-11-12T09:00:00Z',
    routes,
  });
  const expire = await plusTard.read();
  assert.ok(expire.ok && !/Avertissement/u.test(expire.presentation.summary));
});

test('villes, codes d’icône, ressenti et avertissements', () => {
  assert.deepEqual(trouverVille({ ville: 'quebec' }), { id: 'qc-133', nom: 'Québec' });
  assert.deepEqual(trouverVille({ ville: 'Lévis' }), { id: 'qc-78', nom: 'Lévis' });
  assert.equal(trouverVille({ ville: 'Windsor, ON' }).id.startsWith('on-'), true);
  // Pas de Windsor au Québec : sans province, le premier de la liste (Nouvelle-Écosse).
  assert.equal(trouverVille({ ville: 'Windsor' }).id, 'ns-15');
  assert.deepEqual(trouverVille({ ville: 'Lévis', latitude: 46.81, longitude: -71.21 }), {
    id: 'qc-133',
    nom: 'Québec',
  });
  assert.throws(() => trouverVille({ ville: 'Atlantide' }), /Ville introuvable/u);
  assert.throws(() => trouverVille({ ville: 'x', latitude: 48.86, longitude: 2.35 }), /150 km/u);
  assert.equal(iconeDe(14, 'Faible pluie verglaçante'), 'cloud-hail');
  assert.equal(iconeDe(30, 'Dégagé'), 'moon');
  assert.equal(iconeDe(undefined, 'Neige et poudrerie'), 'cloud-snow');
  assert.equal(iconeDe(undefined, null), 'cloud');
  assert.equal(ressentiPlausible(2.3, -6, null), -6);
  assert.equal(ressentiPlausible(16.7, -2, null), null);
  assert.equal(ressentiPlausible(28, null, 34), 34);
  assert.equal(
    avertissement('AVERTISSEMENT DE VERGLAS - PLUIE VERGLAÇANTE'),
    'Avertissement de verglas : pluie verglaçante',
  );
});
