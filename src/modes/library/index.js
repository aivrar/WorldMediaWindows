/**
 * Library mode — public entry point.
 *
 * The mode is split across several files in this directory:
 *   utils.js        — el() DOM helper
 *   state.js        — view singleton + constants + addItems
 *   shell-refs.js   — shared `ui` DOM-element registry
 *   filter.js       — pure functions deciding what to show
 *   thumbnails.js   — lazy artwork hydration
 *   render.js       — cards grid + status row + sentinel status + sidebar counts
 *   detail.js       — right-side detail panel
 *   sidebar.js      — the source-list sidebar + selectSource handler
 *   chain.js        — fetch orchestration (runSearch, loadMore, sentinel hook)
 *   shell.js        — top-level layout (sidebar + search bar + results + sentinel)
 *   index.js        — this file: mount/teardown lifecycle, state subscriptions
 *
 * The chain pulls from EVERY enabled source independent of the active
 * sidebar tab; sidebar / search / filter chips are all display filters
 * applied at render time over the single accumulating pool.
 */

import { subscribe, getState } from '../../lib/state.js';
import { playItem } from '../../lib/player.js';
import { view, renderedIds, thumbHydration } from './state.js';
import { buildShell } from './shell.js';
import { runSearch } from './chain.js';
import {
  renderResults, renderStatus, updateSidebarCounts, updateSentinelStatus,
} from './render.js';
import { openDetail, closeDetail } from './detail.js';
import { filterItems } from './filter.js';
import { ui } from './shell-refs.js';

const subs = [];

function tearDown() {
  while (subs.length) {
    const off = subs.pop();
    try { off(); } catch (_) {}
  }
  if (thumbHydration.observer) {
    try { thumbHydration.observer.disconnect(); } catch (_) {}
  }
  if (view.infiniteObserver) {
    try { view.infiniteObserver.disconnect(); } catch (_) {}
    view.infiniteObserver = null;
  }
  closeDetail();
}

/** Skip to the next item from the current pool. Used by the player's
 *  "Try next" button when a stream fails. */
function tryNext() {
  const pool = view.activeSource === 'favorites' ? getState().favorites : view.items;
  const filtered = filterItems(pool);
  if (filtered.length === 0) return;
  const idx = filtered.findIndex((it) => it.id === view.currentId);
  const nextIdx = idx >= 0 ? (idx + 1) % filtered.length : 0;
  const next = filtered[nextIdx];
  if (!next) return;
  view.currentId = next.id;
  for (const card of ui.resultsHost?.querySelectorAll?.('.card') || []) {
    card.classList.toggle('is-playing', card.dataset.id === view.currentId);
  }
  openDetail(next);
  playItem(next).catch(() => {});
}

// Marker for cache-bust verification (build id changes whenever this string
// changes, so the WebView2 has to fetch a fresh bundle on next launch).
// build-id: 2026-05-16-v0.2.2
export function renderLibrary(host) {
  console.info('[library] build 2026-05-16-v0.2.2 loaded');
  tearDown();
  host.appendChild(buildShell());

  // buildShell() created a fresh resultsHost — so any ids we tracked as
  // "mounted" from a previous visit no longer have a real card in the DOM.
  renderedIds.clear();

  // Only kick off a fresh search if the pool is empty. The view object
  // lives at module scope so it survives setMode() — switching to
  // Tuner/Discovery/About and back should preserve the user's loaded pool.
  if (view.items.length === 0) {
    runSearch();
  } else {
    renderResults();
    renderStatus();
    updateSidebarCounts();
    updateSentinelStatus();
  }

  subs.push(subscribe('current-item', (item) => {
    view.currentId = item?.id || null;
    for (const card of ui.resultsHost?.querySelectorAll?.('.card') || []) {
      card.classList.toggle('is-playing', card.dataset.id === view.currentId);
    }
  }));
  subs.push(subscribe('favorites-change', () => {
    updateSidebarCounts();
    if (view.activeSource === 'favorites') renderResults();
  }));
  subs.push(subscribe('player-broken-next', () => {
    if (getState().mode === 'library') tryNext();
  }));
}
