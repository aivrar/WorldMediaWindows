/**
 * Thumbnail rendering + lazy artwork hydration.
 *
 *  - `insertThumbImage` is called eagerly when a card is built; if the
 *    item already has a usable thumbnail URL, we mount an <img> right away.
 *  - For items that don't (LibriVox audiobooks, NASA collection items
 *    needing a metadata roundtrip), the card mounts with just a glyph
 *    placeholder and registers itself with the IntersectionObserver. When
 *    the card enters the viewport, we ask the adapter's `resolveArtwork`
 *    for a URL and slot the <img> in.
 *
 * The `__query` filtering on items lives in filter.js — we don't touch it
 * here; we only act on items that the renderer has already decided to mount.
 */

import { loadAdapter } from '../../lib/sources.js';
import { upgradeInsecure } from '../../lib/item-model.js';
import { el } from './utils.js';
import { thumbHydration } from './state.js';

/** Treat anything that isn't an http(s) URL as a missing thumbnail.
 *  Filters out null, undefined, '', the literal string "null", and any
 *  other garbage that occasionally slips through from upstream feeds. */
export function isValidThumbnailUrl(u) {
  if (!u || typeof u !== 'string') return false;
  const s = u.trim();
  if (!s || s === 'null' || s === 'undefined') return false;
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('//');
}

export function createThumbImage(item) {
  if (!isValidThumbnailUrl(item.thumbnail)) return null;
  const src = upgradeInsecure(item.thumbnail);
  const img = el('img', { attrs: { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
  if (item.type === 'tv' || item.type === 'radio') img.classList.add('logo-art');
  img.addEventListener('load', () => { if (img.naturalWidth > 0) img.classList.add('loaded'); });
  img.addEventListener('error', () => { img.classList.add('errored'); });
  return img;
}

export function insertThumbImage(thumb, item, beforeNode = null) {
  if (!isValidThumbnailUrl(item.thumbnail) || thumb.querySelector('img')) return;
  const img = createThumbImage(item);
  if (!img) return;
  if (beforeNode?.parentNode === thumb) thumb.insertBefore(img, beforeNode);
  else thumb.appendChild(img);
}

/** Resolve missing artwork via the adapter's `resolveArtwork` (if exported).
 *  Promises are deduped by item id so concurrent callers share one request. */
export async function resolveItemArtwork(item) {
  if (!item || item.thumbnail) return item;
  let request = thumbHydration.requests.get(item.id);
  if (!request) {
    request = (async () => {
      const mod = await loadAdapter(item.source);
      if (typeof mod.resolveArtwork === 'function') await mod.resolveArtwork(item);
      return item;
    })().catch((err) => {
      console.warn('thumbnail hydrate failed:', err);
      return item;
    });
    thumbHydration.requests.set(item.id, request);
  }
  return request;
}

async function hydrateCardThumbnail(item, thumb, beforeNode) {
  if (!item) return;
  if (!item.thumbnail) await resolveItemArtwork(item);
  if (thumb && thumb.isConnected) insertThumbImage(thumb, item, beforeNode);
}

export function requestThumbnailHydration(card, item, thumb, beforeNode) {
  if (item.thumbnail) return;
  if (!('IntersectionObserver' in window)) {
    hydrateCardThumbnail(item, thumb, beforeNode);
    return;
  }
  if (!thumbHydration.observer) {
    thumbHydration.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbHydration.observer.unobserve(entry.target);
        const cfg = entry.target.__thumbHydration;
        delete entry.target.__thumbHydration;
        if (cfg) hydrateCardThumbnail(cfg.item, cfg.thumb, cfg.beforeNode);
      }
    }, { rootMargin: '360px 0px' });
  }
  card.__thumbHydration = { item, thumb, beforeNode };
  thumbHydration.observer.observe(card);
}
