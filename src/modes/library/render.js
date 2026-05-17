/**
 * The render layer. Reads state.js + filter.js, writes DOM.
 *
 * All "show something on screen" lives here — the cards grid, the per-source
 * status pills at the top of the results pane, the sentinel-status line at
 * the bottom, the sidebar count badges, and the lazy-DOM render-window logic
 * that decides how many cards are actually mounted at once.
 *
 * Pure outputs: no fetching, no state mutation beyond `view.renderLimit`
 * (which is render-layer state about *how much we've drawn*, not about the
 * data we have).
 */

import { getState, isFavorite, addFavorite, removeFavorite } from '../../lib/state.js';
import { SOURCES, getSourceLabel, getSourceColor } from '../../lib/sources.js';
import { el } from './utils.js';
import {
  view, renderedIds,
  RENDER_LIMIT_INITIAL, RENDER_LIMIT_STEP,
  thumbHydration,
} from './state.js';
import { filterItems } from './filter.js';
import { insertThumbImage, requestThumbnailHydration, resolveItemArtwork } from './thumbnails.js';
import { openDetail } from './detail.js';
import { playItem } from '../../lib/player.js';

// Shared shell refs — set by shell.js once, read here.
import { ui } from './shell-refs.js';

/* ============ Cards grid + render window ============ */

export function renderResults() {
  // Favorites is its own pool (kept in state, persisted to localStorage)
  // and lives outside the regular accumulating view.items. This keeps a
  // visit to Favorites from polluting your browse pool, and means clearing
  // the search box doesn't wipe what you favorited.
  const pool = view.activeSource === 'favorites' ? getState().favorites : view.items;
  const filtered = filterItems(pool);
  if (view.renderLimit == null) view.renderLimit = RENDER_LIMIT_INITIAL;
  const visible = filtered.slice(0, view.renderLimit);
  const visibleIds = new Set();
  for (const it of visible) visibleIds.add(it.id);

  // If any currently-mounted card is no longer in the visible slice (because
  // the user changed source/type filters, or scrolled UP enough that the old
  // cards fell out of the window), full clear-and-rebuild.
  let needClear = false;
  for (const id of renderedIds) {
    if (!visibleIds.has(id)) { needClear = true; break; }
  }
  // ALSO: the DOM order has to match the visible-array order. When a search
  // term filtered the pool to a subset and we rendered those subset cards,
  // they're in the DOM in their pool-insertion order. Clearing the search
  // relaxes the filter — the filtered cards are still part of `visible` but
  // now sit at positions 30+ in the array, while the newly-relaxed cards
  // occupy positions 0-29. Without an order check we'd just APPEND the new
  // cards after the existing filtered ones, leaving the old search hits
  // pinned at the top — looks like "the search is still active". Comparing
  // DOM[i].data-id to visible[i].id catches that and forces a rebuild.
  if (!needClear) {
    const cards = ui.resultsHost.children;
    for (let i = 0; i < cards.length && i < visible.length; i++) {
      if (cards[i].dataset && cards[i].dataset.id !== visible[i].id) {
        needClear = true;
        break;
      }
    }
  }
  if (needClear) {
    if (thumbHydration.observer) thumbHydration.observer.disconnect();
    ui.resultsHost.innerHTML = '';
    renderedIds.clear();
  }

  if (visible.length === 0) {
    if (!view.loading && !view.loadingMore) {
      if (!ui.resultsHost.querySelector('.empty-state')) {
        ui.resultsHost.innerHTML = '';
        renderedIds.clear();
        const empty = el('div', { className: 'empty-state' });
        empty.appendChild(el('h3', { text: view.query ? 'No results' : 'Nothing here yet' }));
        empty.appendChild(el('p', { text: view.query
          ? `Try a different search term, or pick a different source.`
          : `Type a search above, or browse a single source on the left.` }));
        ui.resultsHost.appendChild(empty);
      }
    }
    return;
  }

  const stale = ui.resultsHost.querySelector('.empty-state');
  if (stale) stale.remove();

  // Append only the items we haven't already mounted. Use a document
  // fragment so one reflow handles the whole batch.
  const frag = document.createDocumentFragment();
  for (const it of visible) {
    if (renderedIds.has(it.id)) continue;
    frag.appendChild(renderCard(it));
    renderedIds.add(it.id);
  }
  if (frag.childNodes.length > 0) ui.resultsHost.appendChild(frag);
}

/** Bump the render window so more cards mount. Called from the sentinel
 *  observer when the user scrolls near the current bottom of the list.
 *  Returns true if there were unrendered items to expose; the sentinel
 *  observer uses that to decide whether to also fetch more from upstream. */
export function expandRenderWindow() {
  const pool = view.activeSource === 'favorites' ? getState().favorites : view.items;
  const filteredCount = filterItems(pool).length;
  const current = view.renderLimit ?? RENDER_LIMIT_INITIAL;
  if (filteredCount > current) {
    view.renderLimit = Math.min(filteredCount, current + RENDER_LIMIT_STEP);
    renderResults();
    updateSentinelStatus();
    return true;
  }
  return false;
}

/* ============ Individual card ============ */

function renderCard(item) {
  const card = el('article', {
    className: 'card' + (view.currentId === item.id ? ' is-playing' : ''),
    attrs: { 'data-id': item.id, role: 'button', tabindex: '0' },
    on: { click: () => onCardClick(item) },
  });

  const thumb = el('div', { className: 'card-thumb' });
  const placeholder = el('div', { className: 'placeholder' });
  placeholder.innerHTML = sourceGlyph(item.source);
  placeholder.appendChild(el('div', { className: 'ph-label', text: getSourceLabel(item.source) }));
  thumb.appendChild(placeholder);
  const star = el('button', {
    className: 'card-star' + (isFavorite(item.id) ? ' is-fav' : ''),
    attrs: { title: 'Favorite', 'aria-label': 'Favorite' },
    on: { click: (e) => { e.stopPropagation(); toggleFav(item, star); } },
    html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
  });
  insertThumbImage(thumb, item);
  thumb.appendChild(star);
  requestThumbnailHydration(card, item, thumb, star);
  card.appendChild(thumb);

  const body = el('div', { className: 'card-body' });
  body.appendChild(el('div', { className: 'card-title', text: item.title || 'Untitled' }));
  const meta = el('div', { className: 'card-meta' });
  meta.appendChild(el('span', { className: 'source-badge', text: getSourceLabel(item.source) }));
  if (item.year) meta.appendChild(el('span', { text: String(item.year) }));
  if (item.country) meta.appendChild(el('span', { text: item.country }));
  if (item.license && item.license !== 'Unknown') meta.appendChild(el('span', { text: item.license }));
  body.appendChild(meta);
  card.appendChild(body);
  return card;
}

function onCardClick(item) {
  view.currentId = item.id;
  for (const card of ui.resultsHost.querySelectorAll('.card')) {
    card.classList.toggle('is-playing', card.dataset.id === item.id);
  }
  openDetail(item);
  playItem(item).catch((err) => console.warn('play failed:', err));
}

function toggleFav(item, btn) {
  if (isFavorite(item.id)) {
    removeFavorite(item.id);
    btn.classList.remove('is-fav');
  } else {
    addFavorite(item);
    btn.classList.add('is-fav');
  }
}

function sourceGlyph(id) {
  const map = {
    'radio-browser':    '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 12a7 7 0 0 1 7-7M5 16a3 3 0 0 1 3-3M19 12a7 7 0 0 0-7-7M19 16a3 3 0 0 0-3-3"/><circle cx="12" cy="18" r="2"/></svg>',
    'iptv-org':         '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8"/></svg>',
    'internet-archive': '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 5h16M3 9h18M4 9v10M20 9v10M6 12v5M10 12v5M14 12v5M18 12v5M3 21h18"/></svg>',
    'nasa':             '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M3 14c4 0 6-4 9-4s5 4 9 4"/></svg>',
    'wikimedia':        '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 5l4 14M11 5l-2 14M13 5l4 14M21 5l-4 14"/></svg>',
    'librivox':         '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M4 4v13"/></svg>',
  };
  return map[id] || '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/></svg>';
}

/* ============ Status row (per-source pills) ============ */

/** Which sources show a per-source status pill at the top of the results
 *  area. This DOES respect the sidebar filter so the status row isn't
 *  cluttered with sources the user isn't currently looking at. Note this
 *  is different from `fetchSourcesAllEnabled` in chain.js, which always
 *  returns every enabled source regardless of the sidebar tab. */
function effectiveStatusSources() {
  const all = SOURCES.filter((s) => getState().settings.enabledSources[s.id] !== false);
  if (view.activeSource === 'all') return all.map((s) => s.id);
  if (view.activeSource === 'favorites') return [];
  if (view.activeSource && view.activeSource.startsWith('type:')) {
    const t = view.activeSource.slice('type:'.length);
    return all.filter((s) => s.types.includes(t)).map((s) => s.id);
  }
  return [view.activeSource];
}

export function setSourceStatus(sourceId, status) {
  view.sourceStatus.set(sourceId, status);
  renderStatus();
}

export function renderStatus() {
  ui.statusHost.innerHTML = '';
  if (view.activeSource === 'favorites') return;

  // Per-source FILTERED counts: how many items currently match the active
  // search / type / country / lang / year filters, grouped by source. The
  // sidebar keeps showing the cumulative pool count (the library total);
  // this row shows the visible subtotal so the user can see how many hits
  // each source contributed to the current search.
  const filteredPerSource = new Map();
  const filtered = filterItems(view.items);
  for (const it of filtered) {
    filteredPerSource.set(it.source, (filteredPerSource.get(it.source) || 0) + 1);
  }

  const targets = effectiveStatusSources();
  for (const id of targets) {
    const status = view.sourceStatus.get(id);
    const count = filteredPerSource.get(id) || 0;
    const wrap = el('span', { className: 'source-status' });
    wrap.appendChild(el('span', { className: 'source-dot', style: { background: getSourceColor(id), width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' } }));
    wrap.appendChild(el('span', { text: getSourceLabel(id) }));
    if (count > 0) {
      wrap.appendChild(el('span', { text: ` · ${count}` }));
    }
    if (!status || status.state === 'loading') {
      wrap.appendChild(el('span', { className: 'spinner-inline' }));
    } else if (status.state === 'error') {
      wrap.appendChild(el('span', { text: ' · error', style: { color: 'var(--danger)' } }));
    }
    ui.statusHost.appendChild(wrap);
  }
}

/* ============ Sentinel status (bottom of results) ============ */

export function updateSentinelStatus() {
  if (!ui.sentinelStatus || !ui.sentinelButton) return;
  if (view.activeSource === 'favorites') {
    ui.sentinelStatus.textContent = '';
    ui.sentinelButton.style.display = 'none';
    return;
  }
  const total = view.items.length;
  const sources = view.activeSource === 'all'
    ? SOURCES.filter((s) => getState().settings.enabledSources[s.id] !== false).map((s) => s.id)
    : [view.activeSource];
  const exhausted = view.exhausted || new Set();
  const liveSources = sources.filter((id) => !exhausted.has(id));
  if (view.loadingMore || view.loading) {
    ui.sentinelStatus.innerHTML = '<span class="spinner-inline"></span> Loading more…';
    ui.sentinelButton.style.display = 'none';
  } else if (liveSources.length === 0 && total > 0) {
    ui.sentinelStatus.textContent = `All ${total} items loaded · try a different search for more`;
    ui.sentinelButton.style.display = 'none';
  } else if (total > 0) {
    ui.sentinelStatus.textContent = `${total} items loaded`;
    ui.sentinelButton.style.display = 'none';
  } else {
    ui.sentinelStatus.textContent = '';
    ui.sentinelButton.style.display = 'none';
  }
}

/* ============ Sidebar counts ============ */

export function updateSidebarCounts() {
  const cum = view.cumulativeCounts;
  const cumTypes = view.cumulativeTypeCounts;
  let totalAll = 0;
  for (const v of cum.values()) totalAll += v;

  for (const li of ui.sidebar.querySelectorAll('.source-item')) {
    const id = li.dataset.source;
    const span = li.querySelector('[data-role="count"]');
    if (!span) continue;
    let n = 0;
    if (id === 'all') n = totalAll;
    else if (id === 'favorites') n = getState().favorites.length;
    else if (id.startsWith('type:')) n = cumTypes.get(id.slice('type:'.length)) || 0;
    else n = cum.get(id) || 0;
    span.textContent = n > 0 ? String(n) : '';
  }
}
