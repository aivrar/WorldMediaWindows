/**
 * Mutable view-state for the library mode. ONE place where all per-session
 * library state is declared, including the constants the chain and renderer
 * agree on (page size, render-window growth, throttle, etc.).
 *
 * No DOM access here. No fetching here. Only data.
 *
 * Other library/* files import what they need from this module and mutate
 * `view` directly. That isn't ideal encapsulation, but the trade-off is
 * deliberate: this is a refactor for organisation, not a behaviour change.
 * Encapsulating state behind setters/actions is a v0.3 concern.
 */

export const PAGE_SIZE = 30;

// Lazy DOM rendering. View.items grows unbounded as the auto-chain fetches,
// but only the first `view.renderLimit` filtered items are actually mounted
// as cards in the DOM. The rest live in memory only. As the user scrolls
// near the bottom, the sentinel observer bumps renderLimit so the next
// batch of cards mounts. This is what lets us hold tens of thousands of
// items without DOM weight crushing scroll performance.
export const RENDER_LIMIT_INITIAL = 300;
export const RENDER_LIMIT_STEP    = 200;

// Minimum gap between consecutive auto-chained loadMore calls. The chain
// fires "as soon as the previous returned" would be a firehose — six sources
// in parallel × pagination = hundreds of HTTP requests in seconds, which
// trips the local proxy's 60 req/sec ceiling AND Wikimedia's upstream rate
// limit (429s observed in production). 250 ms gives the browser breathing
// room to actually render the new cards and lets upstream pacing settle.
export const AUTO_CHAIN_MIN_GAP_MS = 250;

export const view = {
  query: '',
  activeSource: 'all', // 'all' | adapter id | 'favorites' | 'type:radio' | ...
  filters: { type: '', country: '', language: '', yearMin: null, yearMax: null },
  items: [],
  itemIndex: new Map(),       // id -> item
  currentId: null,
  sourceStatus: new Map(),    // sourceId -> { state, count, error? }
  sourceCounts: new Map(),    // sourceId -> browse pagination offset
  cumulativeCounts: new Map(),     // sourceId -> total seen this session
  cumulativeTypeCounts: new Map(), // type     -> total seen this session
  loading: false,             // initial-batch fetch in flight
  loadingMore: false,         // paginated loadMore in flight
  loadAbort: null,
  sentinel: null,
  infiniteObserver: null,
  searchGen: 0,
  lastQuery: '',
  exhausted: new Set(),
  renderLimit: RENDER_LIMIT_INITIAL,
};

/** Module-level set of currently-mounted card ids. Lives outside `view`
 *  because it's a render-layer artefact, not query state. */
export const renderedIds = new Set();

/** Hydration observer + per-item promise dedupe. Same: render-layer state. */
export const thumbHydration = {
  requests: new Map(), // item id -> in-flight resolveArtwork promise
  observer: null,
};

/** Append items to the pool, tagging each with the query that fetched it.
 *  Re-encountered items adopt the most-recent query tag so the display
 *  filter for the active search still surfaces them. Updates per-source
 *  and per-type cumulative counts.
 *
 *  Returns nothing — caller invokes render after. */
export function addItems(items, queryTag = view.lastQuery) {
  const currentQ = (queryTag || '').trim();
  for (const it of items) {
    if (!it || !it.id) continue;
    const existing = view.itemIndex.get(it.id);
    if (existing) {
      if (currentQ) {
        const tags = new Set(existing.__queries || (existing.__query ? [existing.__query] : []));
        tags.add(currentQ);
        existing.__queries = [...tags];
        existing.__query = currentQ;
      }
      continue;
    }
    it.__query = currentQ;
    it.__queries = currentQ ? [currentQ] : [];
    view.itemIndex.set(it.id, it);
    view.items.push(it);
    const c = view.cumulativeCounts.get(it.source) || 0;
    view.cumulativeCounts.set(it.source, c + 1);
    if (it.type) {
      const tc = view.cumulativeTypeCounts.get(it.type) || 0;
      view.cumulativeTypeCounts.set(it.type, tc + 1);
    }
  }
}
