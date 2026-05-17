/**
 * Central app state. The only place mutable globals live.
 *
 * State shape:
 * {
 *   mode: 'library' | 'tuner' | 'grid' | 'discovery',
 *   currentItem: Item | null,
 *   isPlaying: bool,
 *   favorites: Item[],
 *   settings: {
 *     theme: 'system' | 'light' | 'dark',
 *     defaultMode: string,
 *     enabledSources: Record<adapterId, bool>,
 *   },
 *   sleepTimer: { until: number | null }
 * }
 */

import { SOURCE_IDS } from './sources.js';

const STORAGE_KEYS = {
  favorites: 'worldmedia.favorites.v1',
  settings: 'worldmedia.settings.v1',
  volume:    'worldmedia.volume.v1',
};

export function loadVolume() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.volume);
    if (raw == null) return null;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return null;
    return Math.max(0, Math.min(100, v));
  } catch (_) { return null; }
}

export function saveVolume(pct) {
  try { localStorage.setItem(STORAGE_KEYS.volume, String(Math.round(pct))); } catch (_) {}
}

const state = {
  mode: 'library',
  currentItem: null,
  isPlaying: false,
  favorites: [],
  settings: {
    theme: 'system',
    defaultMode: 'library',
    enabledSources: Object.fromEntries(SOURCE_IDS.map((id) => [id, true])),
  },
  sleepTimer: { until: null },
};

const listeners = {};

/** Subscribe to a named event. Returns an unsubscribe function. */
export function subscribe(event, fn) {
  (listeners[event] ||= new Set()).add(fn);
  return () => listeners[event]?.delete(fn);
}

/** Emit a named event with optional payload. */
export function emit(event, payload) {
  const set = listeners[event];
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (e) { console.error(`listener for ${event} threw:`, e); }
  }
}

export function getState() { return state; }

export function setMode(mode) {
  state.mode = mode;
  emit('mode-change', mode);
}

export function setCurrentItem(item) {
  state.currentItem = item;
  emit('current-item', item);
}

export function setPlaying(playing) {
  state.isPlaying = playing;
  emit('playing-change', playing);
}

/* ============ Favorites ============ */

export function addFavorite(item) {
  if (!item || !item.id) return;
  if (state.favorites.some((f) => f.id === item.id)) return;
  state.favorites.unshift(item);
  persistFavorites();
  emit('favorites-change', state.favorites);
}

export function removeFavorite(itemId) {
  const before = state.favorites.length;
  state.favorites = state.favorites.filter((f) => f.id !== itemId);
  if (state.favorites.length !== before) {
    persistFavorites();
    emit('favorites-change', state.favorites);
  }
}

export function isFavorite(itemId) {
  return state.favorites.some((f) => f.id === itemId);
}

function persistFavorites() {
  try {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(state.favorites));
  } catch (e) { console.warn('Could not persist favorites:', e); }
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.favorites);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) state.favorites = parsed.filter((f) => f && f.id);
  } catch (e) { console.warn('Could not load favorites:', e); }
}

/* ============ Settings ============ */

export function saveSettings(partial) {
  state.settings = { ...state.settings, ...partial };
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  } catch (e) { console.warn('Could not persist settings:', e); }
  emit('settings-change', state.settings);
  applyTheme();
}

export function setSourceEnabled(sourceId, enabled) {
  const next = { ...state.settings.enabledSources, [sourceId]: enabled };
  saveSettings({ enabledSources: next });
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.settings = {
      ...state.settings,
      ...parsed,
      enabledSources: { ...state.settings.enabledSources, ...(parsed.enabledSources || {}) },
    };
  } catch (e) { console.warn('Could not load settings:', e); }
}

function applyTheme() {
  const t = state.settings.theme;
  const root = document.documentElement;
  if (t === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', t);
  }
}

/* ============ Init ============ */

export async function initState() {
  loadFavorites();
  loadSettings();
  applyTheme();
}

export function clearCache() {
  try {
    localStorage.removeItem(STORAGE_KEYS.favorites);
    localStorage.removeItem(STORAGE_KEYS.settings);
  } catch (_) {}
  state.favorites = [];
  emit('favorites-change', []);
  emit('settings-change', state.settings);
}
