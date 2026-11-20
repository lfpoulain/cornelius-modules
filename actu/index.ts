/** Titres de l'actualité : les premiers titres d'un flux RSS ou Atom choisi. */
import { AddonCollectError, type AddonDefinition, type AddonSearchResult } from '#cornelius/addons';
import { ago, clip, FeedError, parseFeed } from '../_lib/flux.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };
import catalogue from './catalogue.json' with { type: 'json' };

type ActuConfig = { url: string; feedLabel?: string | null; count: number };
type Headline = { title: string; published: string | null; summary: string | null };
type ActuData = { feed: string; items: Headline[] };

/** Nom court du journal : « Le Monde.fr - Actualités et Infos… » devient « Le Monde.fr ». */
function feedName(title: string | null, url: string): string {
  const name = title?.split(/\s+[-–|:]\s+/u)[0]?.trim();
  return (name || new URL(url).hostname.replace(/^www\./u, '')).slice(0, 120);
}

/** À l'oral, un titre finit par un point, sans en doubler un. */
function spoken(title: string): string {
  return /[.!?…»]$/u.test(title) ? title : `${title}.`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Un flux du catalogue : journal, zone (pays, province, région) et niveau. */
export type CatalogueFeed = {
  id: string;
  media: string;
  pays: string;
  province: string | null;
  region: string | null;
  niveau: 'national' | 'régional';
  url: string;
};
const feeds = catalogue as CatalogueFeed[];

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

/** Pays du foyer, d'après son fuseau : ses flux passent en tête de la recherche. */
function countryOf(timeZone: string | undefined): string | null {
  if (!timeZone) return null;
  if (
    /^America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Regina|Halifax|Moncton|St_Johns|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay)$/u.test(
      timeZone,
    )
  )
    return 'Canada';
  if (timeZone === 'Europe/Paris') return 'France';
  if (timeZone === 'Europe/Zurich') return 'Suisse';
  return null;
}

const feedLabel = (feed: CatalogueFeed) => `${feed.media} · ${feed.region ?? 'national'}`;

/** « Région de Québec » se compare à « Québec » ; « Mauricie–Centre-du-Québec » ne lui est pas égale. */
const regionName = (region: string) => plain(region).replace(/^region de /u, '');

/**
 * Recherche d'un flux par zone (« Québec », « Bretagne »), par pays ou par journal, dans le
 * catalogue ; une adresse collée est gardée telle quelle. La région exacte passe d'abord, puis le
 * pays du foyer, puis le national.
 */
export function findFeeds(query: string | undefined, timeZone?: string): AddonSearchResult[] {
  const text = (query ?? '').trim();
  if (/^https?:\/\//iu.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error('Adresse de flux invalide.');
    }
    return [{ id: url.href, label: url.hostname.replace(/^www\./u, ''), detail: 'Adresse saisie' }];
  }
  const words = plain(text).split(' ').filter(Boolean);
  if (!words.length || plain(text).length < 2) return [];
  const country = countryOf(timeZone);
  const asked = plain(text);
  const scored = feeds
    .map((feed) => {
      const haystack = ` ${plain([feed.media, feed.pays, feed.province, feed.region, feed.niveau].filter(Boolean).join(' '))} `;
      if (!words.every((word) => haystack.includes(` ${word}`))) return null;
      const region = feed.region === null ? '' : regionName(feed.region);
      const exactRegion = region === asked || region.startsWith(`${asked} `) ? 0 : 1;
      const home = feed.pays === country ? 0 : 1;
      return { feed, rank: [exactRegion, home, feed.niveau === 'national' ? 0 : 1] };
    })
    .filter((entry): entry is { feed: CatalogueFeed; rank: number[] } => entry !== null)
    .sort((a, b) => a.rank[0]! - b.rank[0]! || a.rank[1]! - b.rank[1]! || a.rank[2]! - b.rank[2]!);
  return scored.slice(0, 20).map(({ feed }) => ({
    id: feed.url,
    label: feedLabel(feed),
    detail: `${[feed.pays, feed.province, feed.region].filter(Boolean).join(' › ')} · ${feed.niveau}`,
  }));
}

const addon: AddonDefinition<ActuConfig, ActuData> = {
  id: 'actu',
  apiVersion: 1,
  version: '1.2.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Titres de l’actualité',
  display: {
    name: 'Titres de l’actualité',
    description:
      'Les premiers titres d’un journal, d’après son flux RSS ou Atom, choisi par pays ou par région.',
    icon: 'newspaper',
    keywords: ['actualité', 'actu', 'nouvelles', 'titres', 'journal', 'rss', 'infos'],
    example: { label: 'Les titres', ref: 'titres' },
    spoken: { head: 'les titres', repeats: ['titres', 'actu', 'actualite', 'infos'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: {
    url: 'https://www.franceinfo.fr/titres.rss',
    feedLabel: 'franceinfo · France',
    count: 3,
  },
  search: {
    fields: [
      {
        kind: 'flux',
        label: 'Journal et zone',
        target: 'url',
        labelTarget: 'feedLabel',
        placeholder: 'Pays, région ou journal (« Québec », « Bretagne »), ou adresse d’un flux',
      },
    ],
    async find(input, context) {
      return input.kind === 'flux' ? findFeeds(input.query, context.timeZone) : [];
    },
  },
  dataVersion: 1,
  dataSchema,
  freshMs: 15 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les premiers titres de l’actualité du journal configuré et afficher leur carte. ' +
        'Utiliser pour « quelles sont les nouvelles ? » ou « les titres du jour ». ' +
        'Ne donne que les titres : pour approfondir un sujet, utiliser la recherche web.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const { url, count } = context.config;
    const response = await context.http.fetch({
      url,
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: context.signal,
      timeoutMs: 6000,
      maxBytes: 512 * 1024,
    });
    if (response.status === 404 || response.status === 410)
      throw new AddonCollectError('not_found', 'Flux introuvable : vérifier son adresse.');
    if (response.status === 401 || response.status === 403)
      throw new AddonCollectError('forbidden', 'Le journal refuse l’accès à ce flux.');
    if (response.status === 429)
      throw new AddonCollectError(
        'quota',
        'Le journal limite les demandes, réessayer plus tard.',
        true,
      );
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'Le journal ne répond pas.', true);
    if (response.status !== 200)
      throw new AddonCollectError('upstream', `Flux : réponse HTTP ${response.status} inattendue.`);
    let feed;
    try {
      feed = parseFeed(response.text());
    } catch (error) {
      if (error instanceof FeedError)
        throw new AddonCollectError('malformed', 'Cette adresse ne donne pas un flux RSS ou Atom.');
      throw error;
    }
    const items: Headline[] = feed.items.slice(0, count).map((item) => ({
      title: clip(item.title, 200),
      published: item.published === null ? null : new Date(item.published).toISOString(),
      summary: item.summary ? clip(item.summary, 300) : null,
    }));
    return {
      data: { feed: feedName(feed.title, url), items },
      empty: items.length === 0,
      source: { provider: new URL(url).hostname, sourceId: url.slice(0, 128) },
    };
  },
  ambient: {
    present(snapshot) {
      const data = snapshot.data;
      if (!data?.items.length) throw new Error('Aucun titre à afficher.');
      return {
        layout: 'list',
        title: clip(data.feed, 80),
        value: null,
        subtitle: null,
        items: data.items.slice(0, 3).map((item, index) => ({
          label: String(index + 1),
          value: clip(item.title, 160),
        })),
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    const first = data?.items[0];
    if (!data || !first) throw new Error('Aucun titre à présenter.');
    const now = context.now();
    const stale = snapshot.status === 'stale';
    return {
      title: clip(`Actu · ${data.feed}`, 80),
      primaryValue: clip(first.title, 120),
      subtitle: first.published ? capitalize(ago(Date.parse(first.published), now)) : null,
      description: stale ? 'Derniers titres connus : le journal ne répond pas.' : first.summary,
      items: data.items.slice(1, 5).map((item) => ({
        label: item.published ? capitalize(ago(Date.parse(item.published), now)) : 'À la une',
        value: clip(item.title, 160),
      })),
      summary:
        (stale ? 'Derniers titres connus, le journal ne répond pas. ' : '') +
        `Les titres de ${data.feed} : ${data.items.map((item) => spoken(item.title)).join(' ')}`,
      sources: ['actu'],
    };
  },
};

export default addon;
