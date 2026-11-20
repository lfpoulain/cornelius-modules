import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
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

export type ImmichData = {
  timestamp: number;
  ownerName: string;
  totalCount: number;
  title: string;
  query: string | null;
  items: ImmichItem[];
};

interface ImmichAssetRaw {
  id?: unknown;
  originalFileName?: unknown;
  fileCreatedAt?: unknown;
  localDateTime?: unknown;
  createdAt?: unknown;
  exifInfo?: {
    city?: unknown;
    country?: unknown;
  } | null;
}

function formatAssetDate(asset: ImmichAssetRaw, fallback: string): string {
  const raw = asset.fileCreatedAt || asset.localDateTime || asset.createdAt;
  if (typeof raw !== 'string' || !raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function toImmichItem(asset: ImmichAssetRaw, fallbackLabel: string): ImmichItem | null {
  if (typeof asset.id !== 'string' || !asset.id) return null;
  return {
    id: asset.id,
    date: formatAssetDate(asset, fallbackLabel),
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
  version: '1.0.0',
  sourceLabel: 'Immich Souvenirs & Photos',
  display: {
    name: 'Immich',
    description: 'Souvenirs et recherche intelligente dans votre photothèque personnelle Immich.',
    icon: 'history',
    keywords: ['immich', 'photo', 'photos', 'souvenir', 'souvenirs', 'vacances', 'album'],
    example: { label: 'Mes souvenirs Immich', ref: 'immich-perso' },
    spoken: { head: 'mes souvenirs Immich', repeats: ['immich', 'souvenirs', 'photos'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: {
    serverUrl: 'http://localhost:2283',
    defaultCount: 5,
  },
  dataVersion: 1,
  dataSchema,
  freshMs: 60_000,
  secrets: [
    {
      name: 'IMMICH_API_KEY',
      env: 'CORNELIUS_IMMICH_API_KEY',
      label: 'Clé API Immich',
      note: 'Paramètres du compte Immich.',
    },
  ],
  tools: [
    {
      name: 'memories',
      description:
        'Consulter les souvenirs du jour (« ce jour-là ») dans la photothèque Immich du profil reconnu devant le miroir. ' +
        'Utiliser pour « montre mes souvenirs », « souvenirs d’aujourd’hui », « mes photos du jour ».',
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
        'Rechercher des photos par mots-clés dans la photothèque Immich du profil reconnu devant le miroir. ' +
        'Utiliser pour « photos de vacances », « cherche mes photos à la plage », « photos de montagne ».',
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
    if (!serverUrl) {
      throw new AddonCollectError('config_invalid', 'URL du serveur Immich manquante.');
    }

    const apiKey = context.secret('IMMICH_API_KEY');
    if (!apiKey) {
      throw new AddonCollectError('auth', 'Clé API Immich manquante.');
    }

    const count =
      typeof context.args?.count === 'number'
        ? context.args.count
        : (context.config.defaultCount ?? 5);
    const query =
      typeof context.query === 'string' && context.query.trim() ? context.query.trim() : null;
    const ownerName = context.config.userName?.trim() || 'votre compte';

    const items: ImmichItem[] = [];
    let title = 'Souvenirs Immich';

    if (query) {
      title = `Photos : ${query}`;
      const res = await context.http.fetch({
        url: `${serverUrl}/api/search/smart`,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, type: 'IMAGE', size: count }),
        signal: context.signal,
        timeoutMs: 4500,
      });
      if (res.status === 401 || res.status === 403) {
        throw new AddonCollectError('auth', 'Clé API Immich refusée.');
      }
      if (res.status !== 200) {
        throw new AddonCollectError(
          'unavailable',
          `Immich a répondu avec le statut ${res.status}.`,
        );
      }
      const json = res.json() as { assets?: { items?: ImmichAssetRaw[] } } | null;
      const assets = Array.isArray(json?.assets?.items) ? json.assets.items : [];
      for (const asset of assets.slice(0, count)) {
        const item = toImmichItem(asset, 'Photo');
        if (item) items.push(item);
      }
    } else {
      const memRes = await context.http.fetch({
        url: `${serverUrl}/api/memories`,
        method: 'GET',
        headers: { 'x-api-key': apiKey },
        signal: context.signal,
        timeoutMs: 4500,
      });
      if (memRes.status === 401 || memRes.status === 403) {
        throw new AddonCollectError('auth', 'Clé API Immich refusée.');
      }
      if (memRes.status === 200) {
        const memories =
          (memRes.json() as Array<{
            data?: { year?: number };
            assets?: ImmichAssetRaw[];
          }>) ?? [];
        for (const mem of memories) {
          const fallback = mem.data?.year ? `En ${mem.data.year}` : 'Ce jour-là';
          if (Array.isArray(mem.assets)) {
            for (const asset of mem.assets) {
              if (items.length >= count) break;
              const item = toImmichItem(asset, fallback);
              if (item) items.push(item);
            }
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
          body: JSON.stringify({ count }),
          signal: context.signal,
          timeoutMs: 4500,
        });
        if (randRes.status === 200) {
          const randomAssets = (randRes.json() as ImmichAssetRaw[]) ?? [];
          title = 'Sélection Immich';
          for (const asset of randomAssets.slice(0, count)) {
            const item = toImmichItem(asset, 'Photo');
            if (item) items.push(item);
          }
        }
      }
    }

    if (items.length === 0) {
      return {
        data: {
          timestamp: context.now(),
          ownerName,
          totalCount: 0,
          title,
          query,
          items: [],
        },
        source: { provider: 'immich', sourceId: serverUrl },
        empty: true,
      };
    }

    return {
      data: {
        timestamp: context.now(),
        ownerName,
        totalCount: items.length,
        title,
        query,
        items,
      },
      source: { provider: 'immich', sourceId: serverUrl },
    };
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data || data.items.length === 0) {
      throw new Error('Aucune photo disponible.');
    }

    const first = data.items[0]!;
    const primaryValue = data.query
      ? `${data.totalCount} photo${data.totalCount > 1 ? 's' : ''} trouvée${data.totalCount > 1 ? 's' : ''}`
      : `Souvenirs · ${data.ownerName}`;
    const subtitle = `${data.items.length} cliché${data.items.length > 1 ? 's' : ''} · ${first.date}`;

    const cardItems = data.items.slice(0, 5).map((item) => {
      const location = [item.city, item.country].filter(Boolean).join(', ');
      return {
        label: item.date.slice(0, 80),
        value: (location ? `${item.description} (${location})` : item.description).slice(0, 160),
      };
    });

    const summary = data.query
      ? `J’ai trouvé ${data.totalCount} photo${data.totalCount > 1 ? 's' : ''} pour « ${data.query} » dans la photothèque Immich.`
      : `Voici les souvenirs Immich pour ${data.ownerName} : ${data.totalCount} cliché${data.totalCount > 1 ? 's' : ''}, notamment du ${first.date}.`;

    return {
      title: data.title.slice(0, 80),
      primaryValue: primaryValue.slice(0, 120),
      subtitle: subtitle.slice(0, 120),
      description: `Photothèque Immich de ${data.ownerName}.`,
      items: cardItems,
      summary,
      sources: ['immich'],
    };
  },
};

export default addon;
