import { AddonCollectError, type AddonDefinition, type AddonHttpClient } from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

export type ImmichConfig = {
  serverUrl: string;
  userName?: string;
  defaultCount?: number;
};

export type ImmichItem = {
  id: string;
  date: string;
  description: string;
  city: string | null;
  country: string | null;
};

export type ImmichMode = 'memories' | 'random' | 'search' | 'recent';

export type ImmichData = {
  timestamp: number;
  ownerName: string;
  mode: ImmichMode;
  totalCount: number;
  title: string;
  query: string | null;
  items: ImmichItem[];
};

type ImmichAssetRaw = {
  id?: unknown;
  originalFileName?: unknown;
  fileCreatedAt?: unknown;
  localDateTime?: unknown;
  createdAt?: unknown;
  exifInfo?: {
    city?: unknown;
    country?: unknown;
  } | null;
};

type HttpResponse = Awaited<ReturnType<AddonHttpClient['fetch']>>;

const MAX_BYTES = 2 * 1024 * 1024;

function readJson(res: HttpResponse): unknown {
  if (res.status === 401) throw new AddonCollectError('auth', 'Clé API Immich refusée.');
  if (res.status === 403) throw new AddonCollectError('forbidden', 'Accès refusé par Immich.');
  if (res.status === 404) throw new AddonCollectError('not_found', 'Ressource Immich introuvable.');
  if (res.status === 429) throw new AddonCollectError('quota', 'Quota Immich atteint.', true);
  if (res.status >= 500) {
    throw new AddonCollectError('unavailable', 'Serveur Immich indisponible.', true);
  }
  if (res.status !== 200) {
    throw new AddonCollectError('upstream', `Réponse HTTP ${res.status} inattendue d’Immich.`);
  }
  if (res.truncated) {
    throw new AddonCollectError('malformed', 'Réponse d’Immich tronquée.');
  }
  try {
    return res.json();
  } catch {
    throw new AddonCollectError('malformed', 'Réponse d’Immich illisible.');
  }
}

function formatAssetDate(asset: ImmichAssetRaw, timeZone: string, fallback: string): string {
  const utcRaw = asset.fileCreatedAt || asset.createdAt;
  if (typeof utcRaw === 'string' && utcRaw) {
    const parsed = new Date(utcRaw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone,
      });
    }
  }
  if (typeof asset.localDateTime === 'string' && asset.localDateTime) {
    const parsed = new Date(asset.localDateTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone,
      });
    }
  }
  return fallback;
}

function toImmichItem(
  asset: ImmichAssetRaw,
  timeZone: string,
  fallbackLabel: string,
): ImmichItem | null {
  if (typeof asset.id !== 'string' || !asset.id) return null;
  return {
    id: asset.id,
    date: formatAssetDate(asset, timeZone, fallbackLabel),
    description:
      typeof asset.originalFileName === 'string' && asset.originalFileName.trim()
        ? asset.originalFileName.trim()
        : fallbackLabel,
    city: typeof asset.exifInfo?.city === 'string' ? asset.exifInfo.city : null,
    country: typeof asset.exifInfo?.country === 'string' ? asset.exifInfo.country : null,
  };
}

const addon: AddonDefinition<ImmichConfig, ImmichData> = {
  id: 'immich',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Immich (photothèque)',
  display: {
    name: 'Immich',
    description:
      'Souvenirs du jour, dernières photos et recherche dans la photothèque Immich (par profil ou partagée).',
    icon: 'history',
    keywords: [
      'immich',
      'photo',
      'photos',
      'souvenir',
      'souvenirs',
      'récentes',
      'dernière',
      'vacances',
      'album',
    ],
    example: { label: 'Photothèque du foyer', ref: 'foyer' },
    spoken: { head: 'les souvenirs Immich', repeats: ['immich', 'souvenirs', 'photos'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: {
    serverUrl: 'http://immich.local:2283',
    defaultCount: 5,
  },
  dataVersion: 1,
  dataSchema,
  freshMs: 60_000,
  secrets: [
    {
      name: 'IMMICH_API_KEY',
      env: 'CORNELIUS_IMMICH_API_KEY',
      label: 'une clé API Immich',
      note: 'lecture des médias et souvenirs',
      perSource: true,
    } as AddonDefinition['secrets'] extends (infer T)[] | undefined ? T : never,
  ],
  tools: [
    {
      name: 'memories',
      description:
        'Consulter les souvenirs du jour (« ce jour-là ») dans la photothèque Immich configurée. ' +
        'Utiliser pour « montre nos souvenirs », « souvenirs d’aujourd’hui », « photos du jour ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: {
          instanceRef: { type: ['string', 'null'] },
        },
      },
      arguments: {
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Nombre de clichés à retourner (défaut : 5).',
        },
      },
    },
    {
      name: 'search',
      description:
        'Rechercher des photos par mots-clés dans la photothèque Immich configurée ou afficher les plus récentes (query : « récentes »). ' +
        'Utiliser pour « photos de vacances », « cherche des photos à la plage », « affiche la dernière photo », « mes dernières photos ».',
      query: { maxLength: 100 },
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef', 'query'],
        properties: {
          instanceRef: { type: ['string', 'null'] },
          query: { type: 'string', description: 'Mots-clés de recherche.' },
        },
      },
      arguments: {
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Nombre de photos à retourner (défaut : 5).',
        },
      },
    },
  ],
  async collect(context) {
    const serverUrl = (context.config.serverUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/i.test(serverUrl)) {
      throw new AddonCollectError(
        'config_invalid',
        'Adresse du serveur Immich invalide (http:// ou https:// attendu).',
      );
    }

    const apiKey = context.secret('IMMICH_API_KEY');
    if (!apiKey) {
      throw new AddonCollectError('config_invalid', 'Clé API Immich absente.');
    }

    const count =
      typeof context.args?.count === 'number'
        ? context.args.count
        : (context.config.defaultCount ?? 5);
    const query =
      typeof context.query === 'string' && context.query.trim() ? context.query.trim() : null;
    const ownerName = context.config.userName?.trim() || 'Foyer';

    const items: ImmichItem[] = [];
    let title = 'Souvenirs Immich';
    let mode: ImmichMode = 'memories';

    if (query) {
      const isRecentOnly =
        /^(?:ma\s+|mes\s+|les\s+|la\s+|notre\s+|nos\s+)?(?:derni[eè]res?|r[eé]centes?|plus\s+r[eé]centes?|nouvelles?|latest|recent)(?:\s+photos?)?$/iu.test(
          query,
        );
      const isSingularRecent =
        isRecentOnly &&
        typeof context.args?.count !== 'number' &&
        /^(?:ma\s+|la\s+|notre\s+)?(?:derni[eè]re|r[eé]cente|plus\s+r[eé]cente|nouvelle|latest|recent)(?:\s+photo)?$/iu.test(
          query,
        ) &&
        !/^(?:latest|recent)$/iu.test(query);
      const requestCount = isSingularRecent ? 1 : count;
      mode = isRecentOnly ? 'recent' : 'search';
      title = isRecentOnly
        ? requestCount === 1
          ? 'Dernière photo'
          : 'Dernières photos'
        : `Photos : ${query}`;
      const res = await context.http.fetch({
        url: isRecentOnly ? `${serverUrl}/api/search/metadata` : `${serverUrl}/api/search/smart`,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          isRecentOnly
            ? { type: 'IMAGE', order: 'desc', size: requestCount }
            : { query, type: 'IMAGE', size: requestCount },
        ),
        signal: context.signal,
        timeoutMs: 4500,
        maxBytes: MAX_BYTES,
      });
      const payload = readJson(res) as { assets?: { items?: unknown } } | null;
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.assets?.items)) {
        throw new AddonCollectError('malformed', 'Résultats de recherche Immich invalides.');
      }
      for (const asset of payload.assets.items.slice(0, requestCount) as ImmichAssetRaw[]) {
        const item = toImmichItem(asset, context.timeZone, 'Photo');
        if (item) items.push(item);
      }
    } else {
      const memRes = await context.http.fetch({
        url: `${serverUrl}/api/memories`,
        method: 'GET',
        headers: { 'x-api-key': apiKey },
        signal: context.signal,
        timeoutMs: 4500,
        maxBytes: MAX_BYTES,
      });
      const memoriesPayload = readJson(memRes);
      if (!Array.isArray(memoriesPayload)) {
        throw new AddonCollectError('malformed', 'Liste de souvenirs Immich invalide.');
      }
      for (const mem of memoriesPayload as Array<{
        data?: { year?: number };
        assets?: ImmichAssetRaw[];
      }>) {
        const fallback = mem.data?.year ? `En ${mem.data.year}` : 'Ce jour-là';
        if (Array.isArray(mem.assets)) {
          for (const asset of mem.assets) {
            if (items.length >= count) break;
            const item = toImmichItem(asset, context.timeZone, fallback);
            if (item) items.push(item);
          }
        }
      }

      if (items.length === 0) {
        const randRes = await context.http.fetch({
          url: `${serverUrl}/api/search/random`,
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ size: count, type: 'IMAGE', withExif: true }),
          signal: context.signal,
          timeoutMs: 4500,
          maxBytes: MAX_BYTES,
        });
        const randomPayload = readJson(randRes);
        if (!Array.isArray(randomPayload)) {
          throw new AddonCollectError('malformed', 'Sélection aléatoire Immich invalide.');
        }
        mode = 'random';
        title = 'Sélection Immich';
        for (const asset of randomPayload.slice(0, count) as ImmichAssetRaw[]) {
          const item = toImmichItem(asset, context.timeZone, 'Photo');
          if (item) items.push(item);
        }
      }
    }

    if (items.length === 0) {
      return {
        data: {
          timestamp: context.now(),
          ownerName,
          mode,
          totalCount: 0,
          title,
          query,
          items: [],
        },
        source: { provider: 'immich', sourceId: 'phototheque' },
        empty: true,
      };
    }

    return {
      data: {
        timestamp: context.now(),
        ownerName,
        mode,
        totalCount: items.length,
        title,
        query,
        items,
      },
      source: { provider: 'immich', sourceId: 'phototheque' },
    };
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune donnée Immich à présenter.');

    if (data.items.length === 0) {
      return {
        title: data.title.slice(0, 80),
        primaryValue:
          data.mode === 'search' ? 'Aucune photo trouvée' : 'Aucun souvenir aujourd’hui',
        subtitle: data.ownerName.slice(0, 120),
        description: null,
        items: [],
        summary:
          data.mode === 'search' && data.query
            ? `Aucune photo trouvée pour « ${data.query} » dans la photothèque Immich.`
            : 'Aucun souvenir ni photo disponible aujourd’hui dans la photothèque Immich.',
        sources: ['immich'],
      };
    }

    const first = data.items[0]!;
    const primaryValue =
      data.mode === 'search'
        ? `${data.totalCount} photo${data.totalCount > 1 ? 's' : ''} trouvée${data.totalCount > 1 ? 's' : ''}`
        : data.mode === 'recent'
          ? `Dernières photos · ${data.ownerName}`
          : data.mode === 'random'
            ? `Sélection aléatoire · ${data.ownerName}`
            : `Souvenirs · ${data.ownerName}`;
    const subtitle = `${data.items.length} cliché${data.items.length > 1 ? 's' : ''} · ${first.date}`;

    const cardItems = data.items.slice(0, 5).map((item) => {
      const location = [item.city, item.country].filter(Boolean).join(', ');
      return {
        label: item.date.slice(0, 80),
        value: (location ? `${item.description} (${location})` : item.description).slice(0, 160),
      };
    });

    const summary =
      data.mode === 'search'
        ? `J’ai trouvé ${data.totalCount} photo${data.totalCount > 1 ? 's' : ''} pour « ${data.query} » dans la photothèque Immich.`
        : data.mode === 'recent'
          ? `Voici ${data.totalCount > 1 ? `les ${data.totalCount} dernières photos` : 'la dernière photo'} dans la photothèque Immich (${data.ownerName}), la plus récente du ${first.date}.`
          : data.mode === 'random'
            ? `Aucun souvenir daté d’aujourd’hui ; voici une sélection aléatoire de ${data.totalCount} cliché${data.totalCount > 1 ? 's' : ''} dans la photothèque Immich (${data.ownerName}), notamment du ${first.date}.`
            : `Voici les souvenirs du jour dans la photothèque Immich (${data.ownerName}) : ${data.totalCount} cliché${data.totalCount > 1 ? 's' : ''}, notamment du ${first.date}.`;

    return {
      title: data.title.slice(0, 80),
      primaryValue: primaryValue.slice(0, 120),
      subtitle: subtitle.slice(0, 120),
      description: `Photothèque Immich (${data.ownerName}).`,
      items: cardItems,
      summary,
      sources: ['immich'],
    };
  },
};

export default addon;
