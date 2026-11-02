/**
 * Dépenses OpenAI du mois (API Costs de l'organisation, clé Admin en lecture).
 * Les montants arrivent chez OpenAI avec du retard, par jour UTC. Le mois et le jour sont ceux
 * du foyer (context.timeZone) ; ils sont rapprochés des jours UTC de même date, faute de mieux.
 * Format vérifié le 2026-10-31 contre la vraie API (fixtures/costs.json : réponse anonymisée).
 */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { dayIn, dayMs, nextMidnight } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type DepensesConfig = { projet: string | null; budgetMensuel: number | null };

type DepensesData = {
  currency: string;
  month: number;
  today: number | null;
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

const budgetLevel = (data: DepensesData) =>
  data.budget === null
    ? 'none'
    : data.month >= data.budget
      ? 'over'
      : data.month >= data.budget * 0.8
        ? 'near'
        : 'ok';

/** Un jour sans montant publié n'est pas un jour à 0 $ : les coûts arrivent avec retard. */
const todayText = (data: DepensesData) =>
  data.today === null ? 'pas encore publié' : money(data.today, data.currency);

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
    // Jour et mois du foyer, puis compartiments UTC de même date (l'API ne compte qu'en UTC).
    const todayDay = dayIn(context.now(), context.timeZone);
    const today0 = new Date(todayDay * dayMs);
    const monthStartS = Date.UTC(today0.getUTCFullYear(), today0.getUTCMonth(), 1) / 1000;
    const todayS = todayDay * DAY_S;
    const weekS = todayS - 6 * DAY_S;
    // Du 1er au 6 du mois, les 7 derniers jours commencent le mois précédent.
    const params = new URLSearchParams({
      start_time: String(Math.min(monthStartS, weekS)),
      bucket_width: '1d',
      limit: '31',
      group_by: 'line_item',
    });
    if (context.config.projet) params.set('project_ids', context.config.projet);

    let month = 0;
    let today = 0;
    let todayPublished = false;
    let week = 0;
    let currency: string | null = null;
    const lines = new Map<string, number>();
    let page: string | null = null;
    let partial = false;
    for (let n = 0; n < MAX_PAGES; n++) {
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
          // Les avoirs (montants négatifs) sont déduits.
          const value = result.amount.value;
          const resultCurrency = result.amount.currency.toLowerCase();
          if (currency !== null && resultCurrency !== currency)
            throw new AddonCollectError('malformed', 'Coûts OpenAI en plusieurs devises.');
          currency = resultCurrency;
          if (bucket.start_time >= weekS) week += value;
          if (bucket.start_time >= todayS) {
            today += value;
            todayPublished = true;
          }
          if (bucket.start_time < monthStartS) continue;
          month += value;
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
        currency: currency ?? 'usd',
        month: round2(month),
        // null : OpenAI n'a encore rien publié pour aujourd'hui.
        today: todayPublished ? round2(today) : null,
        week: round2(week),
        byLine,
        budget: context.config.budgetMensuel,
        monthStart: new Date(monthStartS * 1000).toISOString().slice(0, 10),
        partial,
      },
      source: { provider: 'openai-costs', sourceId: context.config.projet ?? 'organisation' },
      // Une heure au plus, et jamais au-delà de minuit chez le foyer : « aujourd'hui » change.
      freshMs: Math.min(60 * 60_000, nextMidnight(context.now(), context.timeZone) - context.now()),
    };
  },
  ambient: {
    present(snapshot) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucune dépense à afficher.');
      const level = budgetLevel(data);
      const budget = data.budget === null ? '' : money(data.budget, data.currency);
      return {
        layout: 'metric',
        title: 'Dépenses OpenAI',
        value: money(data.month, data.currency),
        subtitle:
          level === 'over'
            ? `budget de ${budget} dépassé`
            : level === 'near'
              ? `plus de 80 % du budget de ${budget}`
              : level === 'ok'
                ? `sur ${budget} ce mois-ci`
                : 'ce mois-ci',
        items: [{ label: 'Aujourd’hui', value: todayText(data) }],
      };
    },
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune dépense à présenter.');
    const stale = snapshot.status === 'stale';
    const level = budgetLevel(data);
    const budget = data.budget === null ? '' : money(data.budget, data.currency);
    const budgetText =
      level === 'none'
        ? null
        : level === 'over'
          ? `Budget de ${budget} dépassé.`
          : level === 'near'
            ? `Plus de 80 % du budget de ${budget}.`
            : `Budget : ${budget}.`;
    const items = [
      { label: 'Aujourd’hui', value: todayText(data) },
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
        data.today === null
          ? `${money(data.month, data.currency)} dépensés chez OpenAI depuis le début du mois ;` +
            ' rien n’est encore publié pour aujourd’hui.'
          : `${money(data.month, data.currency)} dépensés chez OpenAI depuis le début du mois,` +
            ` dont ${money(data.today, data.currency)} aujourd’hui.`,
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
