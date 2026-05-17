/**
 * Unified Item Model — every adapter MUST return items conforming to this shape.
 *
 * @typedef {Object} Item
 * @property {string}      id           Adapter-prefixed unique ID, e.g. "internet-archive:prelinger_001"
 * @property {string}      title
 * @property {string}      description  May be empty string, never null
 * @property {string}      source       Adapter id
 * @property {string}      type         "radio" | "tv" | "video" | "audio"
 * @property {string}      stream_url   Direct playable URL (may be empty if resolution is deferred)
 * @property {string}      stream_kind  "audio" | "video" | "hls" | "dash"
 * @property {string}      thumbnail    Image URL or empty string
 * @property {?number}     year
 * @property {string}      country      ISO code or empty string
 * @property {string}      language     ISO code or empty string
 * @property {string[]}    tags
 * @property {string}      license      Human-readable, e.g. "Public Domain", "CC-BY-4.0", "Unknown"
 * @property {string}      source_url   Canonical page on the origin archive
 * @property {?Object}     [_extra]     Adapter-specific lazy-resolve data, NOT part of the public contract.
 */

const STR_FIELDS = [
  'id', 'title', 'description', 'source', 'type',
  'stream_url', 'stream_kind', 'thumbnail',
  'country', 'language', 'license', 'source_url',
];

/**
 * Normalize an in-progress item to the strict shape with sensible defaults.
 * Never returns undefined for required fields.
 *
 * @param {Partial<Item>} p
 * @returns {Item}
 */
export function makeItem(p) {
  const out = {};
  for (const f of STR_FIELDS) out[f] = typeof p[f] === 'string' ? p[f] : '';
  out.year = typeof p.year === 'number' && Number.isFinite(p.year) ? p.year : null;
  out.tags = Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string') : [];
  if (p._extra) out._extra = p._extra;
  return out;
}

/**
 * Validate at runtime — used by the test harness.
 * @returns {string[]} Array of complaints. Empty array = valid.
 */
export function validateItem(item) {
  const errs = [];
  if (!item || typeof item !== 'object') return ['not an object'];
  if (!item.id || typeof item.id !== 'string') errs.push('missing id');
  if (!item.title || typeof item.title !== 'string') errs.push('missing title');
  if (typeof item.description !== 'string') errs.push('description must be string');
  if (!item.source) errs.push('missing source');
  if (!['radio', 'tv', 'video', 'audio'].includes(item.type)) errs.push(`bad type "${item.type}"`);
  if (!['audio', 'video', 'hls', 'dash'].includes(item.stream_kind)) errs.push(`bad stream_kind "${item.stream_kind}"`);
  if (typeof item.tags !== 'object' || !Array.isArray(item.tags)) errs.push('tags must be array');
  if (item.year !== null && typeof item.year !== 'number') errs.push('year must be number or null');
  return errs;
}

/** Build an adapter-prefixed ID. */
export function prefixId(adapterId, raw) {
  return `${adapterId}:${raw}`;
}

/**
 * Upgrade http:// to https:// for thumbnail URLs. The desktop WebView treats
 * the localhost app as a secure context, which can block HTTP image loads.
 * Best-effort: many image hosts also serve over HTTPS at the same path.
 */
export function upgradeInsecure(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('http://')) return 'https://' + url.slice('http://'.length);
  return url;
}

/** Heuristic kind detector for stream URLs. */
export function detectStreamKind(url, hint) {
  const u = (url || '').toLowerCase();
  if (hint === 'audio' && !u.endsWith('.m3u8') && !u.endsWith('.mpd')) return 'audio';
  if (u.endsWith('.m3u8') || u.includes('.m3u8?')) return 'hls';
  if (u.endsWith('.mpd') || u.includes('.mpd?')) return 'dash';
  if (/\.(mp4|webm|ogv|mov|mkv|ts)(\?|$)/.test(u)) return 'video';
  if (/\.(mp3|ogg|oga|wav|flac|m4a|aac)(\?|$)/.test(u)) return 'audio';
  return hint || 'audio';
}
