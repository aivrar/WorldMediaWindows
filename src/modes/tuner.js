/**
 * Tuner Mode — skeuomorphic dial for live radio + live TV.
 *
 * v1 simplification: dial rotation maps linearly to a 1D index into the current
 * station array. Mouse-drag rotates the dial. Arrow keys also work. Each station
 * is given a cosmetic frequency: 87.5 + (index * 0.1) MHz.
 */

import { browseOne } from '../lib/search.js';
import { playItem } from '../lib/player.js';
import { subscribe, getState } from '../lib/state.js';

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

const state = {
  band: 'radio',
  country: '',
  stations: [],
  index: 0,
  loading: false,
  rotationDeg: 0,
};

const ui = {};

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
  const root = el('div', { className: 'tuner-root', attrs: { tabindex: '0' } });
  // Controls
  const controls = el('div', { className: 'tuner-controls' });
  const band = el('div', { className: 'tuner-band-switch' });
  for (const b of [{ id: 'radio', label: 'Radio' }, { id: 'tv', label: 'TV' }]) {
    const btn = el('button', {
      className: state.band === b.id ? 'is-active' : '',
      attrs: { 'data-band': b.id },
      on: { click: () => setBand(b.id) },
      text: b.label,
    });
    band.appendChild(btn);
  }
  controls.appendChild(band);
  const filter = el('div', { className: 'tuner-filter' });
  filter.appendChild(el('label', { text: 'Country:', style: { color: 'var(--text-dim)', fontSize: '12px' } }));
  ui.countrySel = el('select');
  for (const c of COUNTRIES) {
    const opt = el('option', { attrs: { value: c.code }, text: c.label });
    ui.countrySel.appendChild(opt);
  }
  ui.countrySel.value = state.country;
  ui.countrySel.addEventListener('change', () => { state.country = ui.countrySel.value; loadStations(); });
  filter.appendChild(ui.countrySel);
  controls.appendChild(filter);
  root.appendChild(controls);

  // Stage with dial
  const stage = el('div', { className: 'tuner-stage' });
  const dialWrap = el('div', { className: 'tuner-dial' });
  ui.dialWrap = dialWrap;
  dialWrap.innerHTML = buildDialSvg();
  ui.dialSvg = dialWrap.querySelector('svg');
  ui.dialPointer = dialWrap.querySelector('.tuner-pointer');
  ui.dialBody = dialWrap.querySelector('.dial-body');
  ui.unbindDial = bindDialEvents(dialWrap);

  const freq = el('div', { className: 'tuner-frequency' });
  ui.freqNum = el('div', { className: 'freq-num', text: '—' });
  ui.freqUnit = el('div', { className: 'freq-unit', text: 'MHz' });
  ui.stationName = el('div', { className: 'station-name', text: state.loading ? 'Loading…' : 'No station' });
  freq.appendChild(ui.freqNum);
  freq.appendChild(ui.freqUnit);
  freq.appendChild(ui.stationName);
  dialWrap.appendChild(freq);

  stage.appendChild(dialWrap);
  root.appendChild(stage);

  // Bottom strip of nearby stations
  ui.strip = el('div', { className: 'tuner-strip' });
  root.appendChild(ui.strip);

  // Keyboard
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tuneCurrent(); }
  });

  return root;
}

function buildDialSvg() {
  // Outer bezel + radial ticks + rotating inner disc with pointer.
  const ticks = [];
  for (let i = 0; i <= 100; i++) {
    const major = i % 10 === 0;
    const angle = (i / 100) * 360 - 90;
    const r1 = 158;
    const r2 = major ? 138 : 146;
    const x1 = 200 + r1 * Math.cos(angle * Math.PI / 180);
    const y1 = 200 + r1 * Math.sin(angle * Math.PI / 180);
    const x2 = 200 + r2 * Math.cos(angle * Math.PI / 180);
    const y2 = 200 + r2 * Math.sin(angle * Math.PI / 180);
    ticks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${major ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)'}" stroke-width="${major ? 2 : 1}" />`);
  }
  return `
    <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bezelGrad" cx="0.35" cy="0.35" r="0.8">
          <stop offset="0%" stop-color="#3a3f4d"/>
          <stop offset="55%" stop-color="#1a1c22"/>
          <stop offset="100%" stop-color="#0a0b0e"/>
        </radialGradient>
        <radialGradient id="bodyGrad" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0%" stop-color="#262a33"/>
          <stop offset="80%" stop-color="#101216"/>
        </radialGradient>
        <radialGradient id="knobGrad" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0%" stop-color="#24464b"/>
          <stop offset="62%" stop-color="#14232a"/>
          <stop offset="100%" stop-color="#080d12"/>
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="190" class="tuner-bezel"/>
      <circle cx="200" cy="200" r="172" fill="url(#bodyGrad)" stroke="rgba(255,255,255,0.05)"/>
      ${ticks.join('')}
      <g class="dial-body" transform="rotate(0 200 200)">
        <circle cx="200" cy="200" r="100" fill="url(#knobGrad)" stroke="rgba(255,255,255,0.05)"/>
        <circle cx="200" cy="200" r="100" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="2"/>
        <line x1="200" y1="110" x2="200" y2="150" stroke="#5eead4" stroke-width="3" stroke-linecap="round"/>
        <circle cx="200" cy="200" r="6" fill="rgba(255,255,255,0.2)"/>
      </g>
      <polygon class="tuner-pointer" points="200,16 196,32 204,32" />
    </svg>
  `;
}

function bindDialEvents(wrap) {
  let dragging = false;
  let startAngle = 0;
  let baseRotation = 0;

  function angleFromEvent(e) {
    const rect = wrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX ?? e.touches?.[0]?.clientX) - cx;
    const dy = (e.clientY ?? e.touches?.[0]?.clientY) - cy;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  function onDown(e) {
    if (state.stations.length === 0) return;
    dragging = true;
    wrap.classList.add('dragging');
    startAngle = angleFromEvent(e);
    baseRotation = state.rotationDeg;
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const a = angleFromEvent(e);
    let delta = a - startAngle;
    state.rotationDeg = baseRotation + delta;
    applyRotation();
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('dragging');
    tuneCurrent();
  }

  wrap.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  wrap.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);

  // Return cleanup so the mode tear-down can detach.
  return () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
  };
}

function applyRotation() {
  if (!ui.dialBody) return;
  ui.dialBody.setAttribute('transform', `rotate(${state.rotationDeg} 200 200)`);
  if (state.stations.length === 0) return;
  const degPerStation = 12;
  let idx = Math.round(state.rotationDeg / degPerStation) % state.stations.length;
  if (idx < 0) idx += state.stations.length;
  state.index = idx;
  updateFrequencyDisplay();
  renderStrip();
}

function updateFrequencyDisplay() {
  const s = state.stations[state.index];
  if (!s) {
    ui.freqNum.textContent = '—';
    ui.stationName.textContent = state.loading ? 'Loading…' : 'No station';
    return;
  }
  if (state.band === 'radio') {
    ui.freqNum.textContent = (87.5 + state.index * 0.1).toFixed(1);
    ui.freqUnit.textContent = 'MHz';
  } else {
    ui.freqNum.textContent = String(state.index + 1);
    ui.freqUnit.textContent = 'CH';
  }
  ui.stationName.textContent = s.title;
}

function step(dir) {
  if (state.stations.length === 0) return;
  state.rotationDeg += dir * 12;
  applyRotation();
  tuneCurrent();
}

function tuneCurrent() {
  const s = state.stations[state.index];
  if (!s) return;
  playItem(s).catch((err) => console.warn('play failed:', err));
}

async function loadStations() {
  state.loading = true;
  state.stations = [];
  state.index = 0;
  state.rotationDeg = 0;
  applyRotation();
  ui.stationName.textContent = 'Loading…';
  renderStrip();
  try {
    const opts = { limit: 80 };
    if (state.country) opts.country = state.country;
    const sourceId = state.band === 'radio' ? 'radio-browser' : 'iptv-org';
    const items = await browseOne(sourceId, opts);
    state.stations = items || [];
  } catch (err) {
    console.warn('Tuner load failed:', err);
    state.stations = [];
  }
  state.loading = false;
  updateFrequencyDisplay();
  renderStrip();
}

function setBand(b) {
  state.band = b;
  for (const btn of document.querySelectorAll('.tuner-band-switch button')) {
    btn.classList.toggle('is-active', btn.dataset.band === b);
  }
  loadStations();
}

function renderStrip() {
  if (!ui.strip) return;
  ui.strip.innerHTML = '';
  if (state.stations.length === 0) {
    ui.strip.appendChild(el('div', { className: 'tuner-empty', text: state.loading ? 'Loading stations…' : 'No stations found for this country.' }));
    return;
  }
  // Window of ~30 stations centered on current
  const span = 15;
  const start = Math.max(0, state.index - span);
  const end = Math.min(state.stations.length, state.index + span + 1);
  for (let i = start; i < end; i++) {
    const s = state.stations[i];
    const pill = el('button', {
      className: 'station-pill' + (i === state.index ? ' is-active' : ''),
      text: s.title,
      on: { click: () => { state.index = i; state.rotationDeg = i * 12; applyRotation(); tuneCurrent(); } },
    });
    ui.strip.appendChild(pill);
  }
}

const subs = [];
function tearDown() {
  while (subs.length) { try { subs.pop()(); } catch (_) {} }
  if (ui.unbindDial) { try { ui.unbindDial(); } catch (_) {} ui.unbindDial = null; }
}

export function renderTuner(host) {
  tearDown();
  const root = buildShell();
  host.appendChild(root);
  loadStations();
  root.focus();
  subs.push(subscribe('player-broken-next', () => {
    if (getState().mode === 'tuner') step(1);
  }));
}
