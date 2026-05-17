/**
 * Radio Browser adapter.
 * API docs: https://api.radio-browser.info
 *
 * Resolves a working mirror at first call; falls back to de1.api.radio-browser.info.
 * Sends the User-Agent header per their guidelines.
 */

import { get } from '../lib/http.js';
import { makeItem, prefixId } from '../lib/item-model.js';

export const id = 'radio-browser';
export const displayName = 'Radio Browser';
export const itemTypes = ['radio'];

const FALLBACK = 'https://de1.api.radio-browser.info';
let baseUrlPromise = null;
let cachedBase = null;

async function probeBase(base) {
  // Tiny liveness probe — /json/stats is ~150 bytes, returns in <500 ms
  // on a working mirror and times out (or DNS-fails) on a dead one.
  try {
    const r = await get(base + '/json/stats', { timeoutMs: 3000 });
    return r && typeof r === 'object' && r.status === 'OK';
  } catch (_e) {
    return false;
  }
}

async function resolveBase() {
  if (cachedBase) return cachedBase;
  if (baseUrlPromise) return baseUrlPromise;
  baseUrlPromise = (async () => {
    try {
      const servers = await get('https://all.api.radio-browser.info/json/servers', { timeoutMs: 5000 });
      if (Array.isArray(servers) && servers.length > 0) {
        // The servers list is known to include stale entries (Radio Browser's
        // dynamic DNS isn't always purged when a mirror retires). Walk the
        // list in random order and pick the first one that actually answers.
        const order = [...servers].sort(() => Math.random() - 0.5);
        for (const pick of order) {
          const host = pick.name || pick.ip;
          if (!host) continue;
          const candidate = `https://${host}`;
          if (await probeBase(candidate)) {
            cachedBase = candidate;
            return cachedBase;
          }
        }
      }
    } catch (_e) { /* fall through */ }
    // Last resort: the fallback is the de1 anchor; if even that is down,
    // every subsequent call will fail with a clear network error rather
    // than us silently returning empty results.
    cachedBase = FALLBACK;
    return cachedBase;
  })();
  return baseUrlPromise;
}

/** Invalidate the cached mirror so the next call re-resolves. Used when
 *  a request through cachedBase fails — the mirror may have gone down
 *  mid-session. */
function invalidateBase() {
  cachedBase = null;
  baseUrlPromise = null;
}

function normalize(station) {
  if (!station || !station.stationuuid || !station.url_resolved) return null;
  const tags = (station.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  let lang = (station.languagecodes || station.language || '').split(',')[0].trim();
  return makeItem({
    id: prefixId(id, station.stationuuid),
    title: station.name?.trim() || 'Unnamed Station',
    description: tags.join(', '),
    source: id,
    type: 'radio',
    stream_url: station.url_resolved,
    stream_kind: 'audio',
    thumbnail: station.favicon || '',
    year: null,
    country: (station.countrycode || '').toUpperCase(),
    language: lang,
    tags,
    license: 'See source',
    source_url: station.homepage || `https://www.radio-browser.info/`,
    _extra: { stationuuid: station.stationuuid, clickcount: station.clickcount || 0 },
  });
}

async function fetchStations(path) {
  // Try the cached mirror first, then re-resolve once if that fails.
  // Returns the parsed JSON array, or [] if both attempts fail.
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = await resolveBase();
    try {
      const data = await get(base + path);
      if (Array.isArray(data)) return data;
      return [];
    } catch (err) {
      if (attempt === 0) {
        // Mirror probably died mid-session — drop it and re-resolve.
        invalidateBase();
        continue;
      }
      console.warn('Radio Browser fetch failed both attempts:', err);
      return [];
    }
  }
  return [];
}

export async function search(query, opts = {}) {
  const limit = Math.min(opts.limit || 30, 100);
  const offset = opts.offset || 0;
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
  });
  if (query) params.set('name', query);
  if (opts.country) params.set('countrycode', opts.country);
  if (opts.language) params.set('language', opts.language);
  if (opts.tag) params.set('tag', opts.tag);
  const data = await fetchStations(`/json/stations/search?${params.toString()}`);
  return data.map(normalize).filter(Boolean);
}

export async function browse(opts = {}) {
  // Default browse: top-clicked stations, optionally filtered by country.
  return search('', { ...opts, limit: opts.limit || 30 });
}

export async function random(opts = {}) {
  const limit = Math.min(opts.limit || 20, 50);
  const params = new URLSearchParams({
    limit: String(limit),
    order: 'random',
    hidebroken: 'true',
  });
  if (opts.country) params.set('countrycode', opts.country);
  if (opts.language) params.set('language', opts.language);
  if (opts.tag) params.set('tag', opts.tag);
  const data = await fetchStations(`/json/stations/search?${params.toString()}`);
  return data.map(normalize).filter(Boolean);
}

/**
 * Get the URL Radio Browser wants us to POST to when a station plays — so
 * the directory's "click count" ranking stays accurate. Player invokes this.
 */
export async function clickCountUrl(stationuuid) {
  const base = await resolveBase();
  return `${base}/json/url/${encodeURIComponent(stationuuid)}`;
}
