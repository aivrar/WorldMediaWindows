/**
 * LibriVox adapter.
 * API: https://librivox.org/api/feed/audiobooks
 *
 * v1 strategy: resolve the first chapter MP3 by reading the book's RSS feed
 * lazily on first play, since the audiobooks API only gives us metadata + RSS URL.
 */

import { get } from '../lib/http.js';
import { makeItem, prefixId } from '../lib/item-model.js';

export const id = 'librivox';
export const displayName = 'LibriVox';
export const itemTypes = ['audio'];

const BASE = 'https://librivox.org/api/feed/audiobooks';
const rssCache = new Map();

function languageCode(langName) {
  const map = {
    'english': 'en', 'german': 'de', 'french': 'fr', 'spanish': 'es', 'italian': 'it',
    'russian': 'ru', 'portuguese': 'pt', 'japanese': 'ja', 'chinese': 'zh', 'dutch': 'nl',
    'swedish': 'sv', 'finnish': 'fi', 'polish': 'pl', 'arabic': 'ar', 'hindi': 'hi',
    'czech': 'cs', 'greek': 'el', 'hebrew': 'he', 'korean': 'ko', 'norwegian': 'no',
  };
  return map[(langName || '').toLowerCase()] || '';
}

function toItem(book) {
  if (!book || !book.id) return null;
  return makeItem({
    id: prefixId(id, book.id),
    title: book.title || 'Untitled',
    description: (book.description || '').replace(/<[^>]+>/g, '').trim(),
    source: id,
    type: 'audio',
    stream_url: '', // resolved lazily via RSS
    stream_kind: 'audio',
    thumbnail: '',
    year: book.copyright_year ? parseInt(book.copyright_year, 10) || null : null,
    country: '',
    language: languageCode(book.language || ''),
    tags: (book.genres || []).map((g) => g.name || g).slice(0, 8),
    license: 'Public Domain',
    source_url: book.url_librivox || `https://librivox.org/`,
    _extra: { rssUrl: book.url_rss, zipUrl: book.url_zip_file, needsResolve: true },
  });
}

async function fetchRss(url) {
  if (!url) return '';
  if (!rssCache.has(url)) {
    rssCache.set(url, get(url, { text: true }).catch((err) => {
      rssCache.delete(url);
      throw err;
    }));
  }
  return rssCache.get(url);
}

function findFirstMp3(xml) {
  const m = xml.match(/<enclosure[^>]+url=["']([^"']+\.mp3[^"']*)["']/i);
  if (m) return m[1];
  const m2 = xml.match(/(https?:\/\/[^"'<>\s]+\.mp3)/i);
  return m2 ? m2[1] : '';
}

function findArtwork(xml) {
  const img = xml.match(/<itunes:image[^>]+href=["']([^"']+)["']/i)
    || xml.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i);
  return img ? img[1] : '';
}

/**
 * Lightweight artwork resolver for visible cards. It reads the RSS feed once
 * and extracts only cover art, leaving stream resolution for play time.
 */
export async function resolveArtwork(item) {
  if (!item || item.thumbnail || !item._extra?.rssUrl) return item;
  try {
    const xml = await fetchRss(item._extra.rssUrl);
    const img = findArtwork(xml);
    if (img && !item.thumbnail) item.thumbnail = img;
  } catch (err) {
    console.warn('LibriVox artwork fetch failed:', err);
  }
  return item;
}

/**
 * Lazy resolver — resolve the first-chapter MP3 from the book RSS feed on click.
 * Keeps the search/browse loop fast.
 */
export async function resolveStream(item) {
  if (!item?._extra?.needsResolve || !item._extra.rssUrl) return item;
  try {
    const xml = await fetchRss(item._extra.rssUrl);
    const mp3 = findFirstMp3(xml);
    if (mp3) {
      item.stream_url = mp3;
      item._extra.needsResolve = false;
    }
    const img = findArtwork(xml);
    if (img && !item.thumbnail) item.thumbnail = img;
  } catch (err) {
    console.warn('LibriVox RSS fetch failed:', err);
  }
  return item;
}

export async function search(query, opts = {}) {
  const limit = Math.min(opts.limit || 20, 50);
  const offset = opts.offset || 0;
  const params = new URLSearchParams({
    format: 'json',
    extended: '1',
    limit: String(limit),
    offset: String(offset),
  });
  if (query) params.set('title', query);
  const url = `${BASE}?${params.toString()}`;
  try {
    const data = await get(url);
    const books = data?.books || [];
    return books.map(toItem).filter(Boolean);
  } catch (err) {
    console.warn('LibriVox search failed:', err);
    return [];
  }
}

export async function browse(opts = {}) {
  return search('', opts);
}

export async function random(opts = {}) {
  // No native random endpoint — pull a random page.
  const page = Math.floor(Math.random() * 50);
  return search('', { ...opts, offset: page * (opts.limit || 12) });
}
