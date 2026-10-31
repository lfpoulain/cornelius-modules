/**
 * Dépenses OpenAI du mois (API Costs de l'organisation, clé Admin en lecture).
 * Les montants arrivent chez OpenAI avec du retard, par jour UTC. Le mois et le jour sont ceux
 * du foyer (context.timeZone) ; ils sont rapprochés des jours UTC de même date, faute de mieux.
 * Format vérifié le 2026-10-31 contre la vraie API (fixtures/costs.json : réponse anonymisée).
 */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { dayIn, dayMs } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type DepensesConfig = { projet: string | null; budgetMensuel: number | null };

type DepensesData = {
  currency: string;
  month: number;
  today: number;
  week: number;
  byLine: { label: string; amount: number }[];
  budget: number | null;
  monthStart: string;
  partial: boolean;
};

type CostsPage = {
  data: {
    start_time: number;
    results: { amount: { value: number; currency: string }; line_item?: string | null }[];
  }[];
  has_more: boolean;
  next_page?: string | null;
};

const validatePage = compile<CostsPage>({
  type: 'object',
  required: ['data', 'has_more'],
  properties: {
    data: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['start_time', 'results'],
        properties: {
          start_time: { type: 'integer', minimum: 0 },
          results: {
            type: 'array',
            maxItems: 500,
            items: {
              type: 'object',
              required: ['amount'],
              properties: {
                amount: {
                  type: 'object',
                  required: ['value', 'currency'],
                  properties: {
                    value: { type: 'number' },
                    currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
                  },
                },
                line_item: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
    has_more: { type: 'boolean' },
    next_page: { type: ['string', 'null'] },
  },
});

const BASE = 'https://api.openai.com/v1/organization/costs';
const DAY_S = 86_400;
const MAX_PAGES = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, currency: string) =>
  `${n.toFixed(2).replace('.', ',')} ${currency === 'usd' ? '$' : currency.toUpperCase()}`;

/** « gpt-live-1, input » -> « gpt-live-1 » : regroupe entrées et sorties d'un même modèle. */
const lineLabel = (item: string | null | undefined) =>
  item ? (item.split(',')[0] ?? item).trim().slice(0, 80) || 'Autre' : 'Autre';

const addon: AddonDefinition<DepensesConfig, DepensesData> = {
  id: 'depenses_openai',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'OpenAI (coûts de l’organisation)',
  display: {
    name: 'Dépenses OpenAI',
    description: 'Ce que coûte Cornelius chez OpenAI : jour, semaine, mois, et alerte de budget.',
    icon: 'zap',
    group: 'home',
    keywords: ['openai', 'dépenses', 'coût', 'budget', 'facture', 'consommation'],
    example: { label: 'Cornelius', ref: 'cornelius' },
    spoken: { head: 'les dépenses OpenAI', repeats: ['depenses', 'openai'] },
  },
  secrets: [
    {
      name: 'adminKey',
      env: 'CORNELIUS_OPENAI_ADMIN_KEY',
      label: 'une clé Admin OpenAI (lecture des coûts)',
      url: 'https://platform.openai.com/settings/organization/admin-keys',
      note: 'compte personnel',
    },
  ],
  configVersion: 1,
  configSchema,
  configDefaults: { projet: null, budgetMensuel: 10 },
  dataVersion: 1,
  dataSchema,
  // Les coûts sont publiés avec retard : une lecture par heure suffit.
  freshMs: 60 * 60_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les dépenses OpenAI de Cornelius (mois en cours, 7 derniers jours, aujourd’hui) ' +
        'et afficher leur carte. Utiliser pour « combien a coûté Cornelius ce mois-ci ? », ' +
        '« où en est le budget OpenAI ? ». Montants en dollars, publiés avec du retard.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const key = context.secret('adminKey');
    if (!key) throw new AddonCollectError('config_invalid', 'Clé Admin OpenAI absente.');
    const nowS = Math.floor(context.now() / 1000);
    // Jour et mois du foyer, puis compartiments UTC de même date (l'API ne compte qu'en UTC).
    const todayDay = dayIn(context.now(), context.timeZone);
    const today0 = new Date(todayDay * dayMs);
    const monthStartS = Date.UTC(today0.getUTCFullYear(), today0.getUTCMonth(), 1) / 1000;
    const todayS = todayDay * DAY_S;
    const weekS = todayS - 6 * DAY_S;
    const params = new URLSearchParams({
      start_time: String(monthStartS),
      bucket_width: '1d',
      limit: '31',
      group_by: 'line_item',
    });
    if (context.config.projet) params.set('project_ids', context.config.projet);

    let month = 0;
    let today = 0;
    let week = 0;
    let currency = 'usd';
    const lines = new Map<string, number>();
    let page: string | null = null;
    let partial = false;
    // Premières heures du mois chez le foyer : le premier jour UTC n'a pas commencé, rien à lire.
    for (let n = 0; monthStartS <= nowS && n < MAX_PAGES; n++) {
      if (page) params.set('page', page);
      const response = await context.http.fetch({
        url: `${BASE}?${params.toString()}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: context.signal,
        timeoutMs: 8000,
        maxBytes: 512 * 1024,
      });
      if (response.status === 401) throw new AddonCollectError('auth', 'Clé Admin OpenAI refusée.');
      if (response.status === 403)
        throw new AddonCollectError(
          'forbidden',
          'Cette clé ne peut pas lire les coûts de l’organisation.',
        );
      if (response.status === 429)
        throw new AddonCollectError(
          'quota',
          'OpenAI limite les lectures des coûts pour le moment.',
          true,
        );
      if (response.status >= 500)
        throw new AddonCollectError('unavailable', 'L’API des coûts d’OpenAI ne répond pas.', true);
      if (response.status !== 200)
        throw new AddonCollectError(
          'upstream',
          `Réponse HTTP ${response.status} inattendue d’OpenAI.`,
        );
      let payload: unknown;
      try {
        payload = response.json();
      } catch {
        throw new AddonCollectError('malformed', 'Réponse des coûts OpenAI illisible.');
      }
      if (response.truncated || !validatePage(payload))
        throw new AddonCollectError('malformed', 'Réponse des coûts OpenAI inattendue.');
      for (const bucket of payload.data) {
        // Jour UTC déjà commencé mais pas encore chez le foyer (fuseau en retard) : ignoré.
        if (bucket.start_time > todayS) continue;
        for (const result of bucket.results) {
          const value = Math.max(0, result.amount.value);
          currency = result.amount.currency.toLowerCase();
          month += value;
          if (bucket.start_time >= weekS) week += value;
          if (bucket.start_time >= todayS) today += value;
          const label = lineLabel(result.line_item);
          lines.set(label, (lines.get(label) ?? 0) + value);
        }
      }
      page = payload.has_more ? (payload.next_page ?? null) : null;
      if (!page) break;
      if (n === MAX_PAGES - 1) partial = true;
    }
    const byLine = [...lines.entries()]
      .map(([label, amount]) => ({ label, amount: round2(amount) }))
      .filter((line) => line.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    return {
      data: {
        currency,
        month: round2(month),
        today: round2(today),
        week: round2(week),
        byLine,
        budget: context.config.budgetMensuel,
        monthStart: new Date(monthStartS * 1000).toISOString().slice(0, 10),
        partial,
      },
      source: { provider: 'openai-costs', sourceId: context.config.projet ?? 'organisation' },
    };
  },
  ambient: {
    present(snapshot) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucune dépense à afficher.');
      return {
        layout: 'metric',
        title: 'Dépenses OpenAI',
        value: money(data.month, data.currency),
        subtitle:
          data.budget !== null
            ? `sur ${money(data.budget, data.currency)} ce mois-ci`
            : 'ce mois-ci',
        items: [{ label: 'Aujourd’hui', value: money(data.today, data.currency) }],
      };
    },
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune dépense à présenter.');
    const stale = snapshot.status === 'stale';
    const over = data.budget !== null && data.month >= data.budget;
    const near = data.budget !== null && !over && data.month >= data.budget * 0.8;
    const budgetText =
      data.budget === null
        ? null
        : over
          ? `Budget de ${money(data.budget, data.currency)} dépassé.`
          : near
            ? `Plus de 80 % du budget de ${money(data.budget, data.currency)}.`
            : `Budget : ${money(data.budget, data.currency)}.`;
    const items = [
      { label: 'Aujourd’hui', value: money(data.today, data.currency) },
      { label: '7 derniers jours', value: money(data.week, data.currency) },
      ...data.byLine
        .slice(0, 3)
        .map((line) => ({ label: line.label, value: money(line.amount, data.currency) })),
    ];
    const notes = [
      stale ? 'Dernier relevé connu.' : null,
      data.partial ? 'Relevé incomplet.' : null,
      'Montants publiés par OpenAI avec du retard, par journée UTC.',
    ].filter((note): note is string => note !== null);
    return {
      title: 'Dépenses OpenAI',
      primaryValue: `${money(data.month, data.currency)} ce mois-ci`,
      subtitle: budgetText,
      description: notes.join(' '),
      items,
      summary: [
        stale ? 'Dernier relevé connu :' : null,
        `${money(data.month, data.currency)} dépensés chez OpenAI depuis le début du mois,`,
        `dont ${money(data.today, data.currency)} aujourd’hui.`,
        budgetText,
        'Les montants arrivent avec du retard et suivent les journées UTC d’OpenAI.',
      ]
        .filter((part): part is string => part !== null)
        .join(' '),
      sources: ['depenses_openai'],
    };
  },
};

export default addon;
