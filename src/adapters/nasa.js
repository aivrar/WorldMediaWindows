/**
 * NASA Image & Video Library adapter.
 * API: https://images-api.nasa.gov
 */

import { get } from '../lib/http.js';
import { makeItem, prefixId } from '../lib/item-model.js';

export const id = 'nasa';
export const displayName = 'NASA';
export const itemTypes = ['video', 'audio'];

const BASE = 'https://images-api.nasa.gov';

function toItem(entry) {
  const data = entry?.data?.[0];
  if (!data || !data.nasa_id) return null;
  const links = entry.links || [];
  const thumb = (links.find((l) => l.render === 'image' || /\.jpg$|\.png$|\.jpeg$/i.test(l.href || '')) || {}).href || '';
  const isVideo = data.media_type === 'video';
  return makeItem({
    id: prefixId(id, data.nasa_id),
    title: data.title || 'NASA media',
    description: data.description || data.description_508 || '',
    source: id,
    type: isVideo ? 'video' : 'audio',
    stream_url: '', // resolved lazily via entry.href manifest
    stream_kind: isVideo ? 'video' : 'audio',
    thumbnail: thumb,
    year: data.date_created ? parseInt(String(data.date_created).slice(0, 4), 10) || null : null,
    country: 'US',
    language: 'en',
    tags: Array.isArray(data.keywords) ? data.keywords.slice(0, 12) : [],
    license: 'Public Domain (NASA)',
    source_url: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
    _extra: { manifestUrl: entry.href, mediaType: data.media_type, needsResolve: true },
  });
}

const VIDEO_RANK = ['mp4', 'webm', 'mov'];
const AUDIO_RANK = ['mp3', 'm4a', 'wav', 'oga', 'ogg'];

function pickBest(urls, isVideo) {
  if (!urls || urls.length === 0) return null;
  const ranks = isVideo ? VIDEO_RANK : AUDIO_RANK;
  const playable = urls.filter((u) => {
    const lower = u.toLowerCase();
    return ranks.some((ext) => lower.includes(`.${ext}`));
  });
  if (playable.length === 0) return null;
  playable.sort((a, b) => {
    // Prefer "orig" or highest-quality match first
    const ai = ranks.findIndex((ext) => a.toLowerCase().includes('.' + ext));
    const bi = ranks.findIndex((ext) => b.toLowerCase().includes('.' + ext));
    if (ai !== bi) return ai - bi;
    // Larger size hint in filename ("orig", "large") preferred
    const score = (s) => /orig|large|hd|1080|720/i.test(s) ? -1 : 0;
    return score(a) - score(b);
  });
  return playable[0];
}

/**
 * Lazy resolver — spec §3.2.4: "Implement this resolution on item-click,
 * not in the initial search loop (saves bandwidth)." Exported so the player
 * can call it just before play.
 */
export async function resolveStream(item) {
  if (!item?._extra?.needsResolve || !item._extra.manifestUrl) return item;
  try {
    const files = await get(item._extra.manifestUrl);
    if (Array.isArray(files)) {
      const best = pickBest(files, item.type === 'video');
      if (best) {
        item.stream_url = best.startsWith('http://') ? best.replace('http://', 'https://') : best;
        item._extra.needsResolve = false;
      }
    }
  } catch (err) {
    console.warn('NASA resolve failed:', err);
  }
  return item;
}

export async function search(query, opts = {}) {
  const page = Math.floor((opts.offset || 0) / (opts.limit || 20)) + 1;
  const params = new URLSearchParams({
    media_type: 'video,audio',
    page: String(page),
    page_size: String(Math.min(opts.limit || 20, 100)),
  });
  if (query) params.set('q', query);
  else params.set('q', 'apollo'); // browse fallback
  const url = `${BASE}/search?${params.toString()}`;
  try {
    const data = await get(url);
    return (data?.collection?.items || []).map(toItem).filter(Boolean);
  } catch (err) {
    console.warn('NASA search failed:', err);
    return [];
  }
}

export async function browse(opts = {}) {
  // Pick a topical seed each call so browse feels alive.
  const seeds = ['apollo', 'mars', 'hubble', 'ISS', 'shuttle', 'voyager', 'orion', 'jupiter', 'saturn', 'lunar'];
  const seed = seeds[Math.floor(Math.random() * seeds.length)];
  return search(seed, opts);
}

export async function random(opts = {}) {
  const items = await browse({ ...opts, limit: opts.limit || 12 });
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
