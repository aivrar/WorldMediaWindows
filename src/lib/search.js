/**
 * Unified search fan-out. Calls all enabled adapters in parallel.
 * Results stream in as each adapter resolves (Promise.allSettled-style).
 */

import { getState } from './state.js';
import { SOURCES, loadAdapter } from './sources.js';

/**
 * @param {string} query
 * @param {{ limit?: number, offset?: number, country?: string, language?: string, tag?: string, onPartial?: (sourceId, items) => void, onError?: (sourceId, err) => void, signal?: AbortSignal }} [opts]
 */
export async function searchAll(query, opts = {}) {
  const state = getState();
  const enabled = SOURCES.filter((s) => state.settings.enabledSources[s.id] !== false);
  const adapterIds = enabled.map((s) => s.id);
  const promises = adapterIds.map((id) => searchOne(id, query, opts));
  const results = await Promise.allSettled(promises);
  const all = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
  });
  return all;
}

export async function searchOne(adapterId, query, opts = {}) {
  try {
    const mod = await loadAdapter(adapterId);
    const items = await mod.search(query, opts);
    if (opts.onPartial) opts.onPartial(adapterId, items || []);
    return items || [];
  } catch (err) {
    console.warn(`[${adapterId}] search failed:`, err);
    if (opts.onError) opts.onError(adapterId, err);
    return [];
  }
}

export async function browseOne(adapterId, opts = {}) {
  try {
    const mod = await loadAdapter(adapterId);
    return (await mod.browse?.(opts)) || (await mod.search?.('', opts)) || [];
  } catch (err) {
    console.warn(`[${adapterId}] browse failed:`, err);
    return [];
  }
}

export async function randomOne(adapterId, opts = {}) {
  try {
    const mod = await loadAdapter(adapterId);
    return (await mod.random?.(opts)) || [];
  } catch (err) {
    console.warn(`[${adapterId}] random failed:`, err);
    return [];
  }
}

export async function randomFromAny(opts = {}) {
  const state = getState();
  const enabled = SOURCES.filter((s) => state.settings.enabledSources[s.id] !== false);
  if (enabled.length === 0) return [];
  // Try in a randomized order until one yields items
  const shuffled = [...enabled].sort(() => Math.random() - 0.5);
  for (const s of shuffled) {
    const items = await randomOne(s.id, opts);
    if (items && items.length) return items;
  }
  return [];
}

/** Debounce helper for the search bar. */
export function debounce(fn, ms = 300) {
  let t = null;
  return function debounced(...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
