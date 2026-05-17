/**
 * Discovery Mode — random item from random enabled source.
 */

import { randomFromAny, randomOne } from '../lib/search.js';
import { SOURCES } from '../lib/sources.js';
import { playItem } from '../lib/player.js';
import { getState, subscribe } from '../lib/state.js';
import { upgradeInsecure } from '../lib/item-model.js';

const ui = {};
const state = {
  current: null,
  filter: { type: '', country: '', tag: '' },
  loading: false,
};

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
  const root = el('div', { className: 'discovery-root' });

  const filters = el('div', { className: 'discovery-filters' });
  const TYPES = [
    { v: '', label: 'Any type' },
    { v: 'radio', label: 'Radio only' },
    { v: 'tv', label: 'TV only' },
    { v: 'video', label: 'Video only' },
    { v: 'audio', label: 'Audio only' },
  ];
  for (const t of TYPES) {
    const c = el('button', {
      className: 'chip' + (state.filter.type === t.v ? ' is-active' : ''),
      attrs: { 'data-type': t.v },
      on: { click: () => {
        state.filter.type = t.v;
        for (const x of filters.querySelectorAll('.chip[data-type]')) x.classList.toggle('is-active', x.dataset.type === t.v);
      } },
      text: t.label,
    });
    filters.appendChild(c);
  }
  // Country and tag — spec §4.4 calls these out explicitly.
  const country = el('input', {
    className: 'chip',
    attrs: { type: 'text', placeholder: 'Country (e.g. US)', maxlength: '2', size: '6', value: state.filter.country || '' },
    style: { width: '130px', padding: '4px 10px' },
    on: { input: (e) => { state.filter.country = e.target.value.trim().toUpperCase(); } },
  });
  const tag = el('input', {
    className: 'chip',
    attrs: { type: 'text', placeholder: 'Tagged (e.g. jazz)', size: '10', value: state.filter.tag || '' },
    style: { width: '140px', padding: '4px 10px' },
    on: { input: (e) => { state.filter.tag = e.target.value.trim().toLowerCase(); } },
  });
  filters.appendChild(country);
  filters.appendChild(tag);
  root.appendChild(filters);

  const stage = el('div', { className: 'discovery-stage' });
  ui.btn = el('button', { className: 'surprise-btn', text: 'Surprise Me', on: { click: () => surprise() } });
  stage.appendChild(ui.btn);
  ui.now = el('div', { className: 'discovery-now', attrs: { hidden: '' } });
  stage.appendChild(ui.now);

  const actions = el('div', { className: 'discovery-actions' });
  ui.nextBtn = el('button', { className: 'btn', text: 'Next', on: { click: () => surprise() } });
  ui.nextBtn.style.display = 'none';
  actions.appendChild(ui.nextBtn);
  stage.appendChild(actions);

  root.appendChild(stage);
  return root;
}

function renderNow(item) {
  ui.now.innerHTML = '';
  ui.now.removeAttribute('hidden');
  if (item.thumbnail) {
    const img = el('img', { attrs: { src: upgradeInsecure(item.thumbnail), alt: '', referrerpolicy: 'no-referrer' } });
    img.addEventListener('error', () => img.remove());
    ui.now.appendChild(img);
  }

  const text = el('div', { className: 'now-text' });
  text.appendChild(el('div', { className: 'now-source', text: item.source.replace(/-/g, ' ') }));
  text.appendChild(el('h2', { text: item.title }));
  text.appendChild(el('p', { text: item.description || '' }));
  ui.now.appendChild(text);
}

async function surprise() {
  if (state.loading) return;
  state.loading = true;
  ui.btn.textContent = 'Searching…';
  ui.btn.disabled = true;

  try {
    const enabled = SOURCES.filter((s) => getState().settings.enabledSources[s.id] !== false);
    const filterType = state.filter.type;
    const filterCountry = state.filter.country;
    const filterTag = state.filter.tag;
    let candidatePool = enabled;
    if (filterType) {
      candidatePool = enabled.filter((s) => s.types.includes(filterType));
      if (candidatePool.length === 0) candidatePool = enabled;
    }
    const shuffled = [...candidatePool].sort(() => Math.random() - 0.5);

    const passes = (i) => {
      if (filterType && i.type !== filterType) return false;
      if (filterCountry && (!i.country || i.country.toUpperCase() !== filterCountry)) return false;
      if (filterTag && !(i.tags || []).some((t) => String(t).toLowerCase().includes(filterTag))) return false;
      return true;
    };

    let chosen = null;
    for (const s of shuffled) {
      const opts = { limit: 20 };
      if (filterCountry) opts.country = filterCountry;
      if (filterTag) opts.tag = filterTag;
      const items = await randomOne(s.id, opts);
      const pool = items.filter(passes);
      if (pool.length > 0) {
        chosen = pool[Math.floor(Math.random() * pool.length)];
        break;
      }
    }
    if (!chosen) {
      const fallback = await randomFromAny({ limit: 10 });
      const pool = fallback.filter(passes);
      chosen = pool[Math.floor(Math.random() * pool.length)] || fallback[Math.floor(Math.random() * fallback.length)] || null;
    }
    if (chosen) {
      state.current = chosen;
      renderNow(chosen);
      playItem(chosen).catch(() => {});
      ui.btn.textContent = 'Surprise Me Again';
      ui.nextBtn.style.display = 'inline-flex';
    } else {
      ui.btn.textContent = 'No results — try again';
    }
  } catch (err) {
    console.warn('Discovery failed:', err);
    ui.btn.textContent = 'Surprise Me';
  } finally {
    state.loading = false;
    ui.btn.disabled = false;
  }
}

const subs = [];
function tearDown() {
  while (subs.length) { try { subs.pop()(); } catch (_) {} }
}

export function renderDiscovery(host) {
  tearDown();
  host.appendChild(buildShell());
  subs.push(subscribe('player-broken-next', () => {
    if (getState().mode === 'discovery') surprise();
  }));
}
