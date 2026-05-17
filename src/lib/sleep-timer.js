/**
 * Sleep timer with 10s audio fade-out before pause.
 */

import { getState, emit } from './state.js';

const PRESETS = [
  { label: 'Off',     ms: 0 },
  { label: '1 min',   ms: 1 * 60 * 1000 },
  { label: '15 min',  ms: 15 * 60 * 1000 },
  { label: '30 min',  ms: 30 * 60 * 1000 },
  { label: '1 hour',  ms: 60 * 60 * 1000 },
  { label: '2 hours', ms: 120 * 60 * 1000 },
  { label: 'Custom…', ms: -1 },
];
const FADE_MS = 10000;

let outerTimerId = null;
let fadeTimerId = null;
let fadeIntervalId = null;
let countdownId = null;
let endsAt = null;
let host = null;
let select = null;
let display = null;

function fmt(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function render() {
  if (!host) return;
  if (host.firstChild) return;
  host.innerHTML = `
    <label for="sleep-select" style="display:flex;align-items:center;gap:6px;cursor:pointer;">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <span data-role="display">Sleep</span>
    </label>
    <select id="sleep-select" data-role="select">
      ${PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('')}
    </select>
  `;
  select = host.querySelector('[data-role="select"]');
  display = host.querySelector('[data-role="display"]');
  select.addEventListener('change', () => onPresetChange(+select.value));
}

function onPresetChange(idx) {
  const p = PRESETS[idx];
  if (!p) return;
  if (p.ms === -1) {
    const raw = window.prompt('Set custom sleep timer (minutes):', '45');
    if (raw == null) { select.value = '0'; return; }
    const mins = Math.max(0.1, Math.min(720, parseFloat(raw) || 0));
    if (mins <= 0) { setSleep(0); return; }
    setSleep(mins * 60 * 1000);
    return;
  }
  setSleep(p.ms);
}

function setSleep(ms) {
  cancel();
  if (!ms || ms <= 0) {
    if (display) display.textContent = 'Sleep';
    return;
  }
  endsAt = Date.now() + ms;
  getState().sleepTimer.until = endsAt;
  scheduleFire(ms);
  startCountdown();
}

function scheduleFire(ms) {
  const beforeFade = Math.max(0, ms - FADE_MS);
  outerTimerId = setTimeout(() => {
    outerTimerId = null;
    startFade(FADE_MS);
    fadeTimerId = setTimeout(() => {
      fadeTimerId = null;
      const audio = document.getElementById('audio-el');
      const video = document.getElementById('video-el');
      try { audio?.pause(); } catch (_) {}
      try { video?.pause(); } catch (_) {}
      if (audio?.dataset.preFadeVol) audio.volume = +audio.dataset.preFadeVol;
      if (video?.dataset.preFadeVol) video.volume = +video.dataset.preFadeVol;
      cancel();
      emit('sleep-fired');
    }, FADE_MS);
  }, beforeFade);
}

function startFade(durationMs) {
  if (fadeIntervalId) clearInterval(fadeIntervalId);
  const audio = document.getElementById('audio-el');
  const video = document.getElementById('video-el');
  const els = [audio, video].filter(Boolean);
  for (const el of els) el.dataset.preFadeVol = String(el.volume);
  const startV = Math.max(...els.map((el) => el.volume), 0);
  if (startV <= 0) return;
  const step = 100;
  const steps = Math.max(1, durationMs / step);
  let i = 0;
  fadeIntervalId = setInterval(() => {
    i++;
    const t = Math.min(1, i / steps);
    const v = startV * (1 - t);
    for (const el of els) el.volume = Math.max(0, v);
    if (i >= steps) { clearInterval(fadeIntervalId); fadeIntervalId = null; }
  }, step);
}

function startCountdown() {
  if (countdownId) clearInterval(countdownId);
  const tick = () => {
    if (!endsAt) { if (display) display.textContent = 'Sleep'; return; }
    const remaining = endsAt - Date.now();
    if (remaining <= 0) display.textContent = '…';
    else display.textContent = `Sleep ${fmt(remaining)}`;
  };
  tick();
  countdownId = setInterval(tick, 1000);
}

function cancel() {
  if (outerTimerId) { clearTimeout(outerTimerId); outerTimerId = null; }
  if (fadeTimerId) { clearTimeout(fadeTimerId); fadeTimerId = null; }
  if (fadeIntervalId) { clearInterval(fadeIntervalId); fadeIntervalId = null; }
  if (countdownId) { clearInterval(countdownId); countdownId = null; }
  endsAt = null;
  getState().sleepTimer.until = null;
  // Restore any in-progress faded volume so a future play isn't silent.
  const audio = document.getElementById('audio-el');
  const video = document.getElementById('video-el');
  if (audio?.dataset.preFadeVol) { audio.volume = +audio.dataset.preFadeVol; delete audio.dataset.preFadeVol; }
  if (video?.dataset.preFadeVol) { video.volume = +video.dataset.preFadeVol; delete video.dataset.preFadeVol; }
  if (display) display.textContent = 'Sleep';
  if (select) select.value = '0';
}

export function initSleepTimer() {
  host = document.getElementById('sleep-timer');
  render();
}
