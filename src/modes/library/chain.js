/**
 * Fetch orchestration — the "chain" that pulls items from upstream sources
 * and feeds them into the pool. The render layer reads the pool to draw.
 *
 * Two entry shapes:
 *   - `runSearch()` — called on first mount, when the query changes,
 *     when (re)entering favorites isn't the case but the pool is empty,
 *     when source/type filters change in a way that needs a fresh fetch.
 *     Resets pagination state, fires page 0 of every enabled source, then
 *     kicks the auto-chain.
 *   - `loadMore()` — called by the auto-chain (a self-scheduling setTimeout
 *     in `loadMore` itself) and by the sentinel observer when the user
 *     scrolls near the bottom of the visible list and we've already rendered
 *     everything cached.
 *
 * The chain ALWAYS pulls from every enabled source, independent of the
 * active sidebar tab. The activeSource is purely a render-time filter
 * (see filter.js / render.js). Scoping the chain to the active tab was
 * the cause of "pulling stops when I filter" in earlier releases.
 *
 * Race protection: every entry into runSearch bumps `view.searchGen`.
 * In-flight async fetches capture the gen at start and drop their results
 * if the gen has changed (the user typed a new query, switched mode,
 * triggered favorites, etc.).
 */

import { getState } from '../../lib/state.js';
import { SOURCES } from '../../lib/sources.js';
import { searchOne, browseOne } from '../../lib/search.js';
import {
  view, addItems,
  PAGE_SIZE, RENDER_LIMIT_INITIAL, AUTO_CHAIN_MIN_GAP_MS,
} from './state.js';
import {
  renderResults, renderStatus, updateSidebarCounts,
  updateSentinelStatus, setSourceStatus, expandRenderWindow,
} from './render.js';

/** Every enabled source, every time. The active sidebar tab does NOT
 *  scope the fetch — Favorites is purely a render pool, source/type
 *  filters are display filters only. */
export function fetchSourcesAllEnabled() {
  return SOURCES
    .filter((s) => getState().settings.enabledSources[s.id] !== false)
    .map((s) => s.id);
}

/* ============ Initial fetch ============ */

export async function runSearch() {
  view.searchGen++;
  const gen = view.searchGen;

  // The library is a single accumulating pool that NEVER wipes during a
  // session. The earlier "swap-between-searches wipe" was a mistake: each
  // keystroke that lands more than ~300 ms apart fires a fresh runSearch,
  // so typing "jazz" slowly looked like four distinct searches ('j' ->
  // 'ja' -> 'jaz' -> 'jazz'), each one triggering the wipe. The user saw
  // counters drop to 0 mid-word and never recover. By NOT wiping, all
  // searched items stay in the pool tagged with their respective query
  // (set in `addItems`); the display filter in filter.js shows only the
  // ones tagged with the CURRENT query. Clearing the search relaxes the
  // filter, so everything ever loaded is visible again.
  const q = (view.query || '').trim();
  view.lastQuery = q;
  view.renderLimit = RENDER_LIMIT_INITIAL;
  view.sourceStatus.clear();
  view.sourceCounts.clear();
  view.exhausted = new Set();
  view.loading = true;
  if (view.loadAbort) view.loadAbort.abort();
  view.loadAbort = new AbortController();
  const signal = view.loadAbort.signal;

  renderResults();
  renderStatus();
  updateSidebarCounts();
  updateSentinelStatus();

  const opts = {
    limit: PAGE_SIZE,
    offset: 0,
    signal,
    onPartial: (sourceId, items) => {
      if (signal.aborted) return;
      if (gen !== view.searchGen) return;  // stale fetch
      addItems(items);
      const count = (view.sourceCounts.get(sourceId) || 0) + items.length;
      view.sourceCounts.set(sourceId, count);
      setSourceStatus(sourceId, { state: 'done', count });
      updateSidebarCounts();
      renderResults();
      updateSentinelStatus();
    },
    onError: (sourceId, err) => {
      if (signal.aborted) return;
      setSourceStatus(sourceId, { state: 'error', count: 0, error: String(err.message || err) });
    },
  };

  const toFetch = fetchSourcesAllEnabled();
  for (const id of toFetch) setSourceStatus(id, { state: 'loading', count: 0 });

  const promises = toFetch.map(async (id) => {
    try {
      let items;
      if (view.query.trim()) {
        items = await searchOne(id, view.query.trim(), opts);
      } else {
        items = await browseOne(id, opts);
        if (opts.onPartial) opts.onPartial(id, items);
      }
      return items;
    } catch (err) {
      if (opts.onError) opts.onError(id, err);
      return [];
    }
  });

  await Promise.allSettled(promises);
  if (gen !== view.searchGen) return;
  view.loading = false;
  renderResults();
  updateSentinelStatus();
  // Kick off page 2 in the background. By the time the user finishes
  // skimming the first batch and reaches the bottom, the next page is
  // typically already on screen.
  queueMicrotask(() => {
    if (view.items.length > 0 && gen === view.searchGen) maybeLoadMore();
    updateSentinelStatus();
  });
}

/* ============ Paginated fetch ============ */

export async function loadMore() {
  if (view.loading || view.loadingMore) return;

  // If the user is mid-typing — view.query has been updated by the input
  // event but the debounced runSearch hasn't fired yet to commit it to
  // view.lastQuery — DON'T fetch. Spamming "askdfjlk" into the search box
  // would otherwise cause each background loadMore to fire a gibberish
  // search at every upstream source, all of which return empty and get
  // marked exhausted, killing the chain. Re-check after a short delay so
  // the chain naturally resumes once typing settles + the debounced
  // runSearch commits a new query.
  const liveQ = view.query.trim();
  if (liveQ !== view.lastQuery) {
    setTimeout(() => maybeLoadMore(), AUTO_CHAIN_MIN_GAP_MS);
    return;
  }

  view.loadingMore = true;

  const gen = view.searchGen;
  view.exhausted ||= new Set();
  // Capture the query for this whole batch so per-source promises can't
  // see a different value if the user starts typing mid-flight.
  const q = liveQ;

  const sources = fetchSourcesAllEnabled();
  const promises = sources
    .filter((id) => !view.exhausted.has(id))
    .map(async (id) => {
      try {
        const offset = view.sourceCounts.get(id) || 0;
        const opts = { limit: PAGE_SIZE, offset };
        let items;
        if (q) items = await searchOne(id, q, opts);
        else items = await browseOne(id, opts);
        if (gen !== view.searchGen) return;
        if (items && items.length) {
          addItems(items);
          view.sourceCounts.set(id, offset + items.length);
          setSourceStatus(id, { state: 'done', count: offset + items.length });
          updateSidebarCounts();
          renderResults();
          updateSentinelStatus();
        } else {
          // Empty response -> upstream exhausted for this query.
          view.exhausted.add(id);
        }
      } catch (_) { /* ignore per-page errors */ }
    });
  await Promise.allSettled(promises);
  view.loadingMore = false;
  if (gen !== view.searchGen) {
    renderResults();
    updateSentinelStatus();
    return;
  }
  updateSentinelStatus();

  // Auto-chain: setTimeout (not queueMicrotask) so the browser gets a paint
  // frame between batches; AUTO_CHAIN_MIN_GAP_MS spaces requests out so the
  // proxy rate-limiter never trips.
  const eligibleSources = sources.filter((id) => !view.exhausted.has(id));
  if (eligibleSources.length > 0) {
    setTimeout(() => maybeLoadMore(), AUTO_CHAIN_MIN_GAP_MS);
  }
}

/* ============ Chain entry points ============ */

/** Called by the auto-chain after each loadMore returns. Just fetches more
 *  upstream — it does NOT grow the render window. The chain keeps running
 *  regardless of which sidebar tab the user is on (favorites is a render
 *  pool, not a fetch state). */
export function maybeLoadMore() {
  if (view.loading || view.loadingMore) return;
  if (view.items.length === 0) return;
  loadMore();
}

/** Called when the user scrolls the sentinel into view: first expand the
 *  visible DOM window from cached items, only fetching new upstream pages
 *  if the cache is fully exposed. */
export function onSentinelVisible() {
  if (view.items.length === 0) return;
  if (expandRenderWindow()) return;
  maybeLoadMore();
}
