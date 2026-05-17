/**
 * Internet Archive adapter.
 * Uses advancedsearch + per-identifier metadata to resolve playable streams.
 */

import { get } from '../lib/http.js';
import { makeItem, prefixId } from '../lib/item-model.js';

export const id = 'internet-archive';
export const displayName = 'Internet Archive';
export const itemTypes = ['video', 'audio'];

const BASE = 'https://archive.org';
const DEFAULT_FILTER = '(mediatype:movies OR mediatype:audio) AND -access-restricted-item:true';

// Curated starter collections used by browse + filtering UI.
export const COLLECTIONS = [
  { id: 'prelinger',     label: 'Prelinger Archives',  type: 'video' },
  { id: 'feature_films', label: 'Feature Films',       type: 'video' },
  { id: 'classic_tv',    label: 'Classic TV',          type: 'video' },
  { id: 'fedflix',       label: 'FedFlix',             type: 'video' },
  { id: 'classic_cartoons', label: 'Classic Cartoons', type: 'video' },
  { id: 'tvnews',        label: 'TV News',             type: 'video' },
  { id: 'librivoxaudio', label: 'LibriVox Audio',      type: 'audio' },
];

const metaCache = new Map(); // identifier -> metadata response

// Token-bucket rate limit — spec §3.2.3 asks for max 5 requests/sec.
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 5;
const rateWindow = [];
async function rateLimit() {
  const now = Date.now();
  while (rateWindow.length && rateWindow[0] < now - RATE_WINDOW_MS) rateWindow.shift();
  if (rateWindow.length >= RATE_MAX) {
    const wait = RATE_WINDOW_MS - (now - rateWindow[0]) + 5;
    await new Promise((r) => setTimeout(r, wait));
  }
  rateWindow.push(Date.now());
}

async function fetchMetadata(identifier) {
  if (metaCache.has(identifier)) return metaCache.get(identifier);
  await rateLimit();
  const data = await get(`${BASE}/metadata/${encodeURIComponent(identifier)}`);
  metaCache.set(identifier, data);
  return data;
}

const VIDEO_EXTS = ['mp4', 'm4v', 'webm', 'ogv', 'mov'];
const AUDIO_EXTS = ['mp3', 'ogg', 'oga', 'm4a', 'flac', 'wav'];

function pickPlayable(metadata, isVideo) {
  if (!metadata || !Array.isArray(metadata.files)) return null;
  const wantExts = isVideo ? VIDEO_EXTS : AUDIO_EXTS;
  // Prefer derivative for quick streaming, then original.
  const candidates = metadata.files.filter((f) => {
    const name = (f.name || '').toLowerCase();
    return wantExts.some((ext) => name.endsWith('.' + ext));
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aDer = a.source === 'derivative' ? 0 : 1;
    const bDer = b.source === 'derivative' ? 0 : 1;
    if (aDer !== bDer) return aDer - bDer;
    // Prefer mp4 over webm over others for compatibility
    const order = ['mp4', 'mp3', 'm4a', 'm4v', 'webm', 'ogg', 'oga', 'ogv', 'flac', 'wav', 'mov'];
    const aExt = (a.name || '').split('.').pop().toLowerCase();
    const bExt = (b.name || '').split('.').pop().toLowerCase();
    return order.indexOf(aExt) - order.indexOf(bExt);
  });
  return candidates[0];
}

function licenseFromUrl(urlOrText, collections = []) {
  if (!urlOrText) {
    if (collections.includes('prelinger') || collections.includes('feature_films')) return 'Public Domain';
    return 'See source';
  }
  const u = String(urlOrText).toLowerCase();
  if (u.includes('publicdomain')) return 'Public Domain';
  if (u.includes('cc0')) return 'CC0';
  if (u.includes('by-sa')) return 'CC BY-SA';
  if (u.includes('by-nc-sa')) return 'CC BY-NC-SA';
  if (u.includes('by-nc')) return 'CC BY-NC';
  if (u.includes('by-nd')) return 'CC BY-ND';
  if (u.includes('by')) return 'CC BY';
  return 'See source';
}

function toItemFromDoc(doc) {
  if (!doc || !doc.identifier) return null;
  const mediatype = String(doc.mediatype || '').toLowerCase();
  const isVideo = mediatype === 'movies';
  const collections = Array.isArray(doc.collection) ? doc.collection.map((c) => String(c).toLowerCase()) : (doc.collection ? [String(doc.collection).toLowerCase()] : []);
  let year = null;
  if (doc.year) {
    const y = parseInt(String(doc.year), 10);
    if (Number.isFinite(y)) year = y;
  }
  return makeItem({
    id: prefixId(id, doc.identifier),
    title: doc.title || doc.identifier,
    description: Array.isArray(doc.description) ? doc.description.join('\n') : (doc.description || ''),
    source: id,
    type: isVideo ? 'video' : 'audio',
    stream_url: '', // resolved lazily via fetchMetadata on play
    stream_kind: isVideo ? 'video' : 'audio',
    thumbnail: `${BASE}/services/img/${encodeURIComponent(doc.identifier)}`,
    year,
    country: '',
    language: Array.isArray(doc.language) ? (doc.language[0] || '') : (doc.language || ''),
    tags: Array.isArray(doc.subject) ? doc.subject.slice(0, 10).map(String) : (doc.subject ? [String(doc.subject)] : []),
    license: licenseFromUrl(doc.licenseurl, collections),
    source_url: `${BASE}/details/${encodeURIComponent(doc.identifier)}`,
    _extra: { identifier: doc.identifier, mediatype, collections, needsResolve: true },
  });
}

/**
 * Lazy resolver — fetches the per-identifier metadata to discover the playable
 * file, then sets stream_url. Spec §3.2.3 prescribes fetching metadata "once"
 * per item; we cache by identifier so concurrent resolves dedupe naturally.
 */
export async function resolveStream(item) {
  if (!item || !item._extra?.needsResolve) return item;
  try {
    const meta = await fetchMetadata(item._extra.identifier);
    const file = pickPlayable(meta, item.type === 'video');
    if (file) {
      item.stream_url = `${BASE}/download/${encodeURIComponent(item._extra.identifier)}/${encodeURIComponent(file.name)}`;
      item._extra.needsResolve = false;
    }
  } catch (err) {
    console.warn('IA resolve failed:', err);
  }
  return item;
}

function buildQuery(query, collection) {
  const parts = [DEFAULT_FILTER];
  if (query) parts.push(`(${query})`);
  if (collection) parts.push(`collection:${collection}`);
  return parts.join(' AND ');
}

async function advancedSearch(query, opts) {
  const rows = Math.min(opts.limit || 20, 50);
  const page = Math.floor((opts.offset || 0) / rows) + 1;
  const fl = ['identifier', 'title', 'description', 'year', 'mediatype', 'licenseurl', 'subject', 'language', 'collection'];
  const params = new URLSearchParams();
  params.set('q', buildQuery(query, opts.collection));
  for (const f of fl) params.append('fl[]', f);
  if (opts.sort === 'random') params.append('sort[]', 'random');
  else params.append('sort[]', '-downloads');
  params.set('output', 'json');
  params.set('rows', String(rows));
  params.set('page', String(page));
  const url = `${BASE}/advancedsearch.php?${params.toString()}`;
  await rateLimit();
  const data = await get(url);
  const docs = data?.response?.docs || [];
  return docs.map(toItemFromDoc).filter(Boolean);
}

export async function search(query, opts = {}) {
  const q = (query || '').trim();
  const collection = opts.collection || (opts.tag && COLLECTIONS.find((c) => c.id === opts.tag)?.id);
  return advancedSearch(q, { ...opts, collection });
}

export async function browse(opts = {}) {
  const collection = opts.collection || COLLECTIONS[Math.floor(Date.now() / 600000) % COLLECTIONS.length].id;
  return advancedSearch('', { ...opts, collection });
}

export async function random(opts = {}) {
  const collection = opts.collection || COLLECTIONS[Math.floor(Math.random() * COLLECTIONS.length)].id;
  return advancedSearch('', { ...opts, collection, sort: 'random', limit: opts.limit || 12 });
}
