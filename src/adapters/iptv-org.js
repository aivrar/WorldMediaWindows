/**
 * iptv-org adapter.
 * Pulls streams + channel metadata JSONs at startup and joins them into Items.
 * Source: https://github.com/iptv-org/api
 */

import { get } from '../lib/http.js';
import { makeItem, prefixId, detectStreamKind } from '../lib/item-model.js';

export const id = 'iptv-org';
export const displayName = 'iptv-org';
export const itemTypes = ['tv'];

const API = 'https://iptv-org.github.io/api';

let cachedItemsPromise = null;
let cachedItems = null;

function metadataScore(item) {
  return (item.thumbnail ? 100 : 0)
    + (item._extra?.hasChannel ? 40 : 0)
    + (item.country ? 10 : 0)
    + ((item.tags || []).length ? 6 : 0)
    + (item.language ? 3 : 0);
}

function compareItems(a, b) {
  return metadataScore(b) - metadataScore(a);
}

async function ensureLoaded() {
  if (cachedItems) return cachedItems;
  if (cachedItemsPromise) return cachedItemsPromise;
  cachedItemsPromise = (async () => {
    // logos.json lives separately from channels.json — channels.json carries no
    // logo field. We join by channel id and prefer in-use, language-neutral logos.
    const [streams, channels, logos] = await Promise.all([
      get(`${API}/streams.json`),
      get(`${API}/channels.json`),
      get(`${API}/logos.json`).catch(() => []),
    ]);
    const channelMap = new Map();
    for (const c of channels) channelMap.set(c.id, c);

    const logoMap = new Map();
    if (Array.isArray(logos)) {
      // Prefer in_use === true, square or near-square images, no tags (default variant).
      for (const lg of logos) {
        if (!lg?.channel || !lg?.url) continue;
        const existing = logoMap.get(lg.channel);
        const isPref = lg.in_use !== false && (!lg.tags || lg.tags.length === 0);
        if (!existing) { logoMap.set(lg.channel, { url: lg.url, pref: isPref }); continue; }
        if (!existing.pref && isPref) logoMap.set(lg.channel, { url: lg.url, pref: isPref });
      }
    }

    const items = [];
    const seenIds = new Set();
    for (const s of streams) {
      if (!s || !s.url || typeof s.url !== 'string') continue;
      if (!/^https?:/i.test(s.url)) continue;
      const ch = channelMap.get(s.channel);
      const isNsfw = ch?.is_nsfw === true;
      if (isNsfw) continue;
      const url = s.url;
      const kind = detectStreamKind(url, 'video');
      const logo = s.channel ? (logoMap.get(s.channel)?.url || '') : '';
      const rawId = s.channel || `${s.title || 'stream'}:${url}`;
      const item = makeItem({
        id: prefixId(id, rawId),
        title: ch?.name || s.title || s.channel || 'Channel',
        description: (ch?.categories || []).join(', '),
        source: id,
        type: 'tv',
        stream_url: url,
        stream_kind: kind === 'audio' ? 'video' : kind,
        thumbnail: logo,
        year: null,
        country: (ch?.country || '').toUpperCase(),
        language: (ch?.languages?.[0] || '').toLowerCase(),
        tags: (ch?.categories || []).map((c) => String(c).toLowerCase()),
        license: 'See source',
        source_url: ch?.website || (ch?.id ? `https://iptv-org.github.io/?ch=${ch.id}` : 'https://iptv-org.github.io/'),
        _extra: {
          httpReferrer: s.http_referrer || s.referrer || null,
          userAgent: s.user_agent || null,
          hasChannel: !!s.channel,
          quality: s.quality || '',
        },
      });
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      items.push(item);
    }
    // The upstream streams feed starts with thousands of unlinked streams whose
    // channel is null, which means no country/category/logo join is possible.
    // Keep them as fallback inventory, but surface fully joined channels first.
    items.sort(compareItems);
    cachedItems = items;
    return items;
  })();
  return cachedItemsPromise;
}

function filterAndPaginate(items, opts, query) {
  let pool = items;
  if (query) {
    const q = query.toLowerCase();
    pool = pool.filter((it) =>
      (it.title && it.title.toLowerCase().includes(q)) ||
      (it.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }
  if (opts.country) pool = pool.filter((it) => it.country === opts.country.toUpperCase());
  if (opts.language) pool = pool.filter((it) => it.language === opts.language.toLowerCase());
  if (opts.tag) {
    const t = String(opts.tag).toLowerCase();
    pool = pool.filter((it) => (it.tags || []).some((x) => x.includes(t)));
  }
  const offset = opts.offset || 0;
  const limit = Math.min(opts.limit || 30, 240);
  return pool.slice(offset, offset + limit);
}

export async function search(query, opts = {}) {
  const items = await ensureLoaded();
  return filterAndPaginate(items, opts, query || '');
}

export async function browse(opts = {}) {
  const items = await ensureLoaded();
  return filterAndPaginate(items, opts, '');
}

export async function random(opts = {}) {
  const items = await ensureLoaded();
  const filtered = filterAndPaginate(items, { ...opts, limit: items.length, offset: 0 }, '');
  const pool = [...filtered];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(opts.limit || 20, 60));
}
