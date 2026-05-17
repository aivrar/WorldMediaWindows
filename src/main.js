import { initState, getState } from './lib/state.js';
import { initPlayer } from './lib/player.js';
import { initSettings, openSettings } from './lib/settings.js';
import { initSleepTimer } from './lib/sleep-timer.js';
import { initShutdownButton } from './lib/shutdown.js';
import { renderLibrary } from './modes/library.js';
import { renderTuner } from './modes/tuner.js';
import { renderGrid } from './modes/grid.js';
import { renderDiscovery } from './modes/discovery.js';
import { renderAbout } from './modes/about.js';

const MODES = {
  library: renderLibrary,
  tuner: renderTuner,
  grid: renderGrid,
  discovery: renderDiscovery,
  about: renderAbout,
};

function setMode(mode) {
  const state = getState();
  if (!(mode in MODES)) return;
  state.mode = mode;
  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.classList.toggle('is-active', btn.dataset.mode === mode);
  }
  const host = document.getElementById('view-host');
  host.innerHTML = '';
  host.dataset.mode = mode;
  try {
    MODES[mode](host);
  } catch (err) {
    console.error('Mode render failed:', err);
    host.innerHTML = `<div class="error-pane"><h2>Mode failed to load</h2><pre>${escape(err && err.stack || String(err))}</pre></div>`;
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bindTopBar() {
  document.getElementById('modes-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    setMode(btn.dataset.mode);
  });
  document.getElementById('settings-btn').addEventListener('click', () => openSettings());
}

async function boot() {
  await initState();
  initPlayer();
  initSettings();
  initSleepTimer();
  initShutdownButton();
  bindTopBar();
  const state = getState();
  const startMode = state.settings.defaultMode || 'library';
  setMode(startMode);

  // Pre-warm the iptv-org adapter in the background. Its three JSON files
  // (streams + channels + logos) total ~19 MB and dominate the latency of
  // Grid mode's first open. Kick it off here so by the time the user
  // navigates to Grid (or to a TV-filtered Library view), the cache is
  // already warm. Errors are swallowed; if it can't pre-fetch the user
  // will hit the same load on demand.
  if (state.settings.enabledSources?.['iptv-org'] !== false) {
    import('./lib/sources.js').then(({ loadAdapter }) =>
      loadAdapter('iptv-org').then((m) => m.browse?.({ limit: 1 })).catch(() => {})
    );
  }
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((err) => {
    console.error('Boot failed:', err);
    const host = document.getElementById('view-host');
    if (host) {
      host.innerHTML = `<div class="error-pane"><h2>Failed to start</h2><pre>${escape(err && err.stack || String(err))}</pre></div>`;
    }
  });
});

