/**
 * Grid Mode — TV-channel-guide tiles. Works for live radio and live TV.
 */

import { browseOne } from '../lib/search.js';
import { playItem } from '../lib/player.js';
import { subscribe, getState } from '../lib/state.js';
import { upgradeInsecure } from '../lib/item-model.js';

const ui = {};
const state = {
  band: 'tv',
  category: '',
  country: '',
  tiles: [],
  currentId: null,
  loading: false,
};

const CATEGORIES = ['', 'news', 'music', 'sports', 'movies', 'documentary', 'kids', 'entertainment', 'education'];

const COUNTRIES = [
  { code: '', label: 'All countries' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'JP', label: 'Japan' },
  { code: 'BR', label: 'Brazil' },
  { code: 'AU', label: 'Australia' },
  { code: 'CA', label: 'Canada' },
  { code: 'IN', label: 'India' },
  { code: 'MX', label: 'Mexico' },
  { code: 'ZA', label: 'South Africa' },
];

function el(tag, opts = {}, ...children) {
  const e = document.createElement(tag);
  if (opts.className) e.className = opts.className;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.style) Object.assign(e.style, opts.style);
  if (opts.text != null) e.textContent = opts.text;
  if (opts.html != null) e.innerHTML = opts.html;
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) e.addEventListener(k, v);
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function buildShell() {
  const root = el('div', { className: 'grid-root' });
  const controls = el('div', { className: 'grid-controls' });

  // Band
  const band = el('div', { className: 'tuner-band-switch' });
  for (const b of [{ id: 'tv', label: 'Live TV' }, { id: 'radio', label: 'Radio' }]) {
    band.appendChild(el('button', {
      className: state.band === b.id ? 'is-active' : '',
      attrs: { 'data-band': b.id },
      on: { click: () => setBand(b.id) },
      text: b.label,
    }));
  }
  controls.appendChild(band);

  // Category
  const catLabel = el('label', { text: 'Category:', style: { color: 'var(--text-dim)', fontSize: '12px' } });
  ui.catSel = el('select');
  for (const c of CATEGORIES) {
    ui.catSel.appendChild(el('option', { attrs: { value: c }, text: c ? c[0].toUpperCase() + c.slice(1) : 'All categories' }));
  }
  ui.catSel.value = state.category;
  ui.catSel.addEventListener('change', () => { state.category = ui.catSel.value; load(); });
  controls.appendChild(catLabel);
  controls.appendChild(ui.catSel);

  // Country
  const cntLabel = el('label', { text: 'Country:', style: { color: 'var(--text-dim)', fontSize: '12px' } });
  ui.countrySel = el('select');
  for (const c of COUNTRIES) ui.countrySel.appendChild(el('option', { attrs: { value: c.code }, text: c.label }));
  ui.countrySel.value = state.country;
  ui.countrySel.addEventListener('change', () => { state.country = ui.countrySel.value; load(); });
  controls.appendChild(cntLabel);
  controls.appendChild(ui.countrySel);

  // Search within grid
  ui.search = el('input', {
    className: 'search-input',
    attrs: { type: 'search', placeholder: 'Filter…', style: 'max-width: 200px; margin-left:auto;' },
    on: { input: () => renderTiles() },
  });
  ui.search.style.maxWidth = '200px';
  ui.search.style.marginLeft = 'auto';
  controls.appendChild(ui.search);

  root.appendChild(controls);

  ui.tilesHost = el('div', { className: 'grid-tiles' });
  root.appendChild(ui.tilesHost);
  return root;
}

function setBand(b) {
  state.band = b;
  for (const btn of document.querySelectorAll('.grid-root .tuner-band-switch button')) {
    btn.classList.toggle('is-active', btn.dataset.band === b);
  }
  load();
}

async function load() {
  state.loading = true;
  state.tiles = [];
  renderTiles();
  try {
    const sourceId = state.band === 'tv' ? 'iptv-org' : 'radio-browser';
    const opts = { limit: 240 };
    if (state.country) opts.country = state.country;
    if (state.category) opts.tag = state.category;
    state.tiles = (await browseOne(sourceId, opts)) || [];
  } catch (err) {
    console.warn('Grid load failed:', err);
    state.tiles = [];
  }
  state.loading = false;
  renderTiles();
}

function renderTiles() {
  ui.tilesHost.innerHTML = '';
  const filter = (ui.search?.value || '').toLowerCase();
  let tiles = state.tiles;
  if (filter) tiles = tiles.filter((t) => (t.title || '').toLowerCase().includes(filter));
  if (state.category && state.band === 'tv') {
    tiles = tiles.filter((t) => (t.tags || []).some((tag) => tag.toLowerCase().includes(state.category)));
  }
  if (tiles.length === 0) {
    ui.tilesHost.appendChild(el('div', { className: 'empty-state', style: { gridColumn: '1 / -1' } },
      el('h3', { text: state.loading ? 'Loading…' : 'No channels' }),
      el('p', { text: state.loading ? 'Fetching from source…' : 'Try changing filters or country.' }),
    ));
    return;
  }
  for (const t of tiles) {
    const tile = el('div', {
      className: 'channel-tile' + (state.currentId === t.id ? ' is-playing' : ''),
      attrs: { 'data-id': t.id, role: 'button', tabindex: '0' },
      on: { click: () => { state.currentId = t.id; renderTiles(); playItem(t).catch(() => {}); } },
    });
    // Placeholder always in place; image fades over it on successful load.
    const logoWrap = el('div', { className: 'channel-logo-wrap', style: { position: 'relative', width: '64px', height: '64px' } });
    const placeholder = el('div', { className: 'channel-logo-placeholder', style: { position: 'absolute', inset: '0', borderRadius: 'var(--radius)', background: 'var(--bg-elev-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)' }, html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8"/></svg>' });
    logoWrap.appendChild(placeholder);
    if (t.thumbnail) {
      const img = el('img', { className: 'channel-logo', attrs: { src: upgradeInsecure(t.thumbnail), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }, style: { position: 'absolute', inset: '0', opacity: '0', transition: 'opacity 0.18s ease' } });
      img.addEventListener('load', () => { if (img.naturalWidth > 0) img.style.opacity = '1'; });
      img.addEventListener('error', () => { img.style.display = 'none'; });
      logoWrap.appendChild(img);
    }
    tile.appendChild(logoWrap);
    tile.appendChild(el('div', { className: 'channel-name', text: t.title || 'Channel' }));
    if (t.country) tile.appendChild(el('div', { className: 'channel-meta', text: t.country }));
    ui.tilesHost.appendChild(tile);
  }
}

function tryNextTile() {
  if (!state.tiles.length) return;
  const idx = state.tiles.findIndex((t) => t.id === state.currentId);
  const next = state.tiles[(idx + 1) % state.tiles.length] || state.tiles[0];
  if (next) {
    state.currentId = next.id;
    renderTiles();
    playItem(next).catch(() => {});
  }
}

const subs = [];
function tearDown() {
  while (subs.length) { try { subs.pop()(); } catch (_) {} }
}

export function renderGrid(host) {
  tearDown();
  host.appendChild(buildShell());
  load();
  subs.push(subscribe('current-item', (item) => { state.currentId = item?.id || null; renderTiles(); }));
  subs.push(subscribe('player-broken-next', () => {
    if (getState().mode === 'grid') tryNextTile();
  }));
}
