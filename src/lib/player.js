/**
 * Global player controller. Single player instance for the whole app —
 * survives mode switches. Supports audio, direct video, HLS (via vendored hls.js).
 */

import { getState, setCurrentItem, setPlaying, emit, subscribe, loadVolume, saveVolume,
         addFavorite, removeFavorite, isFavorite } from './state.js';
import { getSourceLabel, loadAdapter } from './sources.js';
import { postSilent } from './http.js';
import { upgradeInsecure } from './item-model.js';

let Hls = null;
let hlsInstance = null;
let currentEl = null; // 'audio' | 'video'
let currentItem = null;
let bar = null;
let elements = null;
let playToken = 0; // monotonic counter — guards against rapid item switches

function $(id) { return document.getElementById(id); }
function fmtTime(s) {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function bindElements() {
  bar = $('player-bar');
  elements = {
    audio:    $('audio-el'),
    video:    $('video-el'),
    title:    $('player-title'),
    source:   $('player-source'),
    art:      $('player-art'),
    play:     $('player-play'),
    iconPlay: $('icon-play'),
    iconPause:$('icon-pause'),
    stop:     $('player-stop'),
    seek:     $('player-seek'),
    time:     $('player-time'),
    dur:      $('player-dur'),
    vol:      $('player-volume'),
    mute:     $('player-mute'),
    nextBroken: $('player-next-broken'),
    fav:      $('player-fav'),
  };
}

async function loadHlsIfNeeded() {
  if (Hls) return Hls;
  try {
    const mod = await import('../vendor/hls.js');
    Hls = mod.default || mod.Hls || window.Hls;
    return Hls;
  } catch (err) {
    console.warn('hls.js could not be loaded:', err);
    return null;
  }
}

function syncMediaSizing() {
  // Video shows large; audio is hidden but functional.
  const v = elements.video;
  v.style.position = 'absolute';
  v.style.bottom = 'calc(var(--player-h) + 8px)';
  v.style.right = '16px';
  v.style.width = '320px';
  v.style.maxWidth = '32vw';
  v.style.height = 'auto';
  v.style.background = 'black';
  v.style.borderRadius = '10px';
  v.style.border = '1px solid var(--border)';
  v.style.boxShadow = 'var(--shadow-2)';
  v.style.zIndex = '20';
}

function showVideo(show) {
  syncMediaSizing();
  elements.video.hidden = !show;
  // Tell the rest of the UI a video overlay is on-screen, so anything that
  // ends near the bottom-right (the library detail panel, mainly) can
  // reserve some bottom padding so its text doesn't slide under the video.
  const app = document.getElementById('app');
  if (app) app.classList.toggle('has-video', !!show);
}

function getActiveEl() {
  return currentEl === 'video' ? elements.video : elements.audio;
}

function destroyHls() {
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch (_) {}
    hlsInstance = null;
  }
}

function showBrokenState(msg) {
  elements.title.textContent = currentItem?.title || 'Stream unavailable';
  elements.source.textContent = msg || 'This stream could not be played';
  elements.nextBroken.hidden = false;
  elements.play.hidden = true;
  setPlaying(false);
}

function hideBrokenState() {
  elements.nextBroken.hidden = true;
  elements.play.hidden = false;
}

function bindMediaEvents(el) {
  const onTime = () => {
    elements.time.textContent = fmtTime(el.currentTime);
    if (Number.isFinite(el.duration) && el.duration > 0) {
      elements.seek.disabled = false;
      elements.dur.textContent = fmtTime(el.duration);
      elements.seek.max = String(Math.floor(el.duration));
      if (!el.__seeking) elements.seek.value = String(Math.floor(el.currentTime));
    } else {
      elements.seek.disabled = true;
      elements.dur.textContent = '--:--';
      elements.seek.value = '0';
    }
  };
  const onPlay = () => {
    setPlaying(true);
    elements.iconPlay.hidden = true;
    elements.iconPause.hidden = false;
  };
  const onPause = () => {
    setPlaying(false);
    elements.iconPlay.hidden = false;
    elements.iconPause.hidden = true;
  };
  const onError = (_e) => {
    showBrokenState('Playback error');
  };
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('loadedmetadata', onTime);
  el.addEventListener('play', onPlay);
  el.addEventListener('playing', onPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('ended', onPause);
  el.addEventListener('error', onError);
  el.__eventsBound = true;
}

function clearMedia(el) {
  try {
    el.pause();
    el.removeAttribute('src');
    el.load();
  } catch (_) {}
}

function setMeta(item) {
  bar.hidden = false;
  document.getElementById('app')?.classList.add('has-player');
  elements.title.textContent = item.title || 'Untitled';
  elements.source.textContent = [getSourceLabel(item.source), item.country, item.language]
    .filter(Boolean).join(' · ');
  // Same defensive filter as the library cards — drop null/undefined/empty
  // and the literal strings "null"/"undefined", which occasionally show up
  // in upstream feeds and would otherwise produce a `/null` 404.
  const rawThumb = typeof item.thumbnail === 'string' ? item.thumbnail.trim() : '';
  const thumbOk = rawThumb && rawThumb !== 'null' && rawThumb !== 'undefined'
                  && (rawThumb.startsWith('http://') || rawThumb.startsWith('https://') || rawThumb.startsWith('//'));
  if (thumbOk) {
    const src = upgradeInsecure(rawThumb);
    elements.art.referrerPolicy = 'no-referrer';
    elements.art.onload = () => { elements.art.style.opacity = '1'; };
    elements.art.onerror = () => { elements.art.removeAttribute('src'); elements.art.style.opacity = '0.2'; };
    if (elements.art.getAttribute('src') !== src) {
      elements.art.style.opacity = '0';
      elements.art.src = src;
    } else if (elements.art.complete && elements.art.naturalWidth > 0) {
      elements.art.style.opacity = '1';
    }
  } else {
    elements.art.removeAttribute('src');
    elements.art.style.opacity = '0.2';
  }
  syncFavButton();
}

/** Reflect the favorited state of the currently-playing item on the player
 *  bar's star. Called from setMeta() and from the favorites-change subscription
 *  so the star stays in sync even if the user toggles via a Library card. */
function syncFavButton() {
  if (!elements.fav) return;
  if (!currentItem) {
    elements.fav.hidden = true;
    return;
  }
  elements.fav.hidden = false;
  const fav = isFavorite(currentItem.id);
  elements.fav.classList.toggle('is-fav', fav);
  elements.fav.setAttribute('aria-pressed', fav ? 'true' : 'false');
  elements.fav.title = fav ? 'Remove from favorites' : 'Add to favorites';
  elements.fav.setAttribute('aria-label', elements.fav.title);
}

async function attachStream(item, token) {
  destroyHls();
  hideBrokenState();
  const stale = () => token != null && token !== playToken;
  if (stale()) return;
  const kind = item.stream_kind;
  if (kind === 'video' || kind === 'hls' || kind === 'dash') {
    currentEl = 'video';
    showVideo(true);
    if (kind === 'hls') {
      const useNative = elements.video.canPlayType('application/vnd.apple.mpegurl');
      if (useNative) {
        elements.video.src = item.stream_url;
      } else {
        const HlsLib = await loadHlsIfNeeded();
        if (HlsLib && HlsLib.isSupported()) {
          hlsInstance = new HlsLib({ enableWorker: true });
          hlsInstance.loadSource(item.stream_url);
          hlsInstance.attachMedia(elements.video);
          hlsInstance.on(HlsLib.Events.ERROR, (_evt, data) => {
            if (data?.fatal) {
              showBrokenState('HLS fatal: ' + (data.type || 'unknown'));
            }
          });
        } else {
          elements.video.src = item.stream_url;
        }
      }
    } else {
      elements.video.src = item.stream_url;
    }
    if (!elements.video.__eventsBound) bindMediaEvents(elements.video);
    elements.audio.hidden = true;
    clearMedia(elements.audio);
    if (stale()) return;
    try { await elements.video.play(); } catch (e) { console.warn('video play() rejected:', e); }
  } else {
    currentEl = 'audio';
    showVideo(false);
    elements.audio.src = item.stream_url;
    if (!elements.audio.__eventsBound) bindMediaEvents(elements.audio);
    elements.video.hidden = true;
    clearMedia(elements.video);
    if (stale()) return;
    try { await elements.audio.play(); } catch (e) { console.warn('audio play() rejected:', e); }
  }

  // Radio Browser click-tracking: fire-and-forget against the resolved mirror.
  if (item.source === 'radio-browser' && item._extra?.stationuuid) {
    try {
      const mod = await loadAdapter('radio-browser');
      if (typeof mod.clickCountUrl === 'function') {
        const url = await mod.clickCountUrl(item._extra.stationuuid);
        postSilent(url);
      }
    } catch (_e) { /* swallow */ }
  }
}

/**
 * Play the given Item. If the item carries `_extra.needsResolve`, defer to
 * the adapter's `resolveStream()` to populate stream_url just-in-time.
 *
 * Guarded against rapid switches: each call increments `playToken`. Async work
 * checks the token and returns early if the user has since selected something else.
 */
export async function playItem(item) {
  if (!item) {
    showBrokenState('No item');
    return;
  }
  const myToken = ++playToken;
  currentItem = item;
  setCurrentItem(item);
  hideBrokenState();
  setMeta(item);

  if (item._extra?.needsResolve && !item.stream_url) {
    elements.title.textContent = item.title || 'Loading…';
    elements.source.textContent = 'Resolving stream…';
    try {
      const mod = await loadAdapter(item.source);
      if (myToken !== playToken) return; // newer click superseded us
      if (typeof mod.resolveStream === 'function') {
        await mod.resolveStream(item);
      }
    } catch (err) {
      console.warn('Lazy resolve failed:', err);
    }
    if (myToken !== playToken) return;
    setMeta(item);
  }

  if (myToken !== playToken) return;
  if (!item.stream_url) {
    showBrokenState('No stream URL');
    return;
  }
  await attachStream(item, myToken);
}

export function togglePlay() {
  const el = getActiveEl();
  if (!el) return;
  // HLS streams attach via MediaSource so el.src may be empty even when active.
  const hasSource = !!el.src || !!hlsInstance;
  if (!hasSource) return;
  if (el.paused) { el.play().catch(() => {}); }
  else { el.pause(); }
}

export function stop() {
  // Bump the token so any in-flight playItem aborts.
  playToken++;
  const el = getActiveEl();
  if (el) clearMedia(el);
  destroyHls();
  hideBrokenState();
  setPlaying(false);
  bar.hidden = true;
  document.getElementById('app')?.classList.remove('has-player');
  showVideo(false);
  currentItem = null;
  setCurrentItem(null);
}

export function setVolume(pct) {
  const v = Math.max(0, Math.min(1, pct / 100));
  elements.audio.volume = v;
  elements.video.volume = v;
  elements.vol.value = String(Math.round(v * 100));
  saveVolume(v * 100);
}

export function getVolume() {
  return Math.round((elements.audio.volume ?? 1) * 100);
}

export function getCurrentItem() { return currentItem; }

export function isMuted() { return elements.audio.muted; }
export function setMuted(m) { elements.audio.muted = !!m; elements.video.muted = !!m; }

function bindControls() {
  elements.play.addEventListener('click', () => togglePlay());
  elements.stop.addEventListener('click', () => stop());
  elements.mute.addEventListener('click', () => setMuted(!isMuted()));
  elements.vol.addEventListener('input', (e) => setVolume(+e.target.value));
  elements.seek.addEventListener('input', (e) => {
    const el = getActiveEl();
    el.__seeking = true;
    el.currentTime = +e.target.value;
  });
  elements.seek.addEventListener('change', (e) => {
    const el = getActiveEl();
    el.__seeking = false;
  });
  elements.nextBroken.addEventListener('click', () => {
    emit('player-broken-next');
  });
  elements.fav.addEventListener('click', () => {
    if (!currentItem) return;
    if (isFavorite(currentItem.id)) {
      removeFavorite(currentItem.id);
    } else {
      addFavorite(currentItem);
    }
    syncFavButton();
  });

  // Restore persisted volume, or fall back to 80%.
  const persisted = loadVolume();
  const startVol = persisted != null ? persisted : 80;
  elements.audio.volume = startVol / 100;
  elements.video.volume = startVol / 100;
  elements.vol.value = String(startVol);
}

export function initPlayer() {
  bindElements();
  bindControls();
  // Keep the player-bar star in sync if a Library card toggles favorites
  // for the currently-playing item.
  subscribe('favorites-change', () => syncFavButton());
}
