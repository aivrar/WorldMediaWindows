/**
 * Settings modal. Mounted on demand.
 */

import { getState, saveSettings, setSourceEnabled, clearCache, subscribe } from './state.js';
import { SOURCES } from './sources.js';

const VERSION = '0.1.1-windows';

function buildModal() {
  const state = getState();

  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="modal-header">
        <h2 id="settings-title">Settings</h2>
        <button class="icon-btn" data-act="close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <section>
          <h3>Appearance</h3>
          <div class="row">
            <div>
              <label>Theme</label>
              <span class="description">System follows OS dark/light setting.</span>
            </div>
            <select data-field="theme">
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div class="row">
            <div>
              <label>Default mode on launch</label>
              <span class="description">Which screen World Media opens to.</span>
            </div>
            <select data-field="defaultMode">
              <option value="library">Library</option>
              <option value="tuner">Tuner</option>
              <option value="grid">Grid</option>
              <option value="discovery">Discovery</option>
            </select>
          </div>
        </section>
        <section>
          <h3>Sources</h3>
          ${SOURCES.map((s) => `
            <div class="row">
              <div>
                <label for="src-${s.id}">${s.displayName}</label>
                <span class="description">${s.types.join(' / ')}</span>
              </div>
              <input id="src-${s.id}" type="checkbox" class="switch" data-source="${s.id}" />
            </div>
          `).join('')}
        </section>
        <section>
          <h3>Storage</h3>
          <div class="row">
            <div>
              <label>Clear local cache</label>
              <span class="description">Removes favorites and saved preferences.</span>
            </div>
            <button class="btn btn-danger" data-act="clear-cache">Clear cache</button>
          </div>
        </section>
        <section>
          <h3>About</h3>
          <div style="font-size: 13px; color: var(--text-dim); line-height: 1.55;">
            <p style="margin: 0 0 8px;"><strong style="color: var(--text);">World Media</strong> v${VERSION} — A unified player for free, open media.</p>
            <p style="margin: 0 0 8px;">Built with sincere thanks to the open archives whose data this app surfaces:</p>
            <ul style="margin: 0 0 8px 18px; padding: 0; color: var(--text-dim);">
              <li>Radio Browser — a community directory of internet radio stations.</li>
              <li>iptv-org — public IPTV channel registry.</li>
              <li>Internet Archive — millions of free films, audio, books, and software.</li>
              <li>NASA Image and Video Library — public-domain space imagery & sound.</li>
              <li>Wikimedia Commons — freely licensed media files.</li>
              <li>LibriVox — public-domain audiobooks read by volunteers.</li>
            </ul>
            <p style="margin: 0;">No accounts. No telemetry. No API keys. Source code and license ship with the build (see <code>README.md</code>, <code>BUILD.md</code>, <code>NOTES.md</code>).</p>
          </div>
        </section>
      </div>
    </div>
  `;

  // Initialize current values
  const themeSel = root.querySelector('select[data-field="theme"]');
  themeSel.value = state.settings.theme;
  themeSel.addEventListener('change', () => saveSettings({ theme: themeSel.value }));

  const modeSel = root.querySelector('select[data-field="defaultMode"]');
  modeSel.value = state.settings.defaultMode;
  modeSel.addEventListener('change', () => saveSettings({ defaultMode: modeSel.value }));

  for (const cb of root.querySelectorAll('input[data-source]')) {
    cb.checked = state.settings.enabledSources[cb.dataset.source] !== false;
    cb.addEventListener('change', () => setSourceEnabled(cb.dataset.source, cb.checked));
  }

  root.querySelector('[data-act="clear-cache"]').addEventListener('click', () => {
    if (confirm('Clear all local cache (favorites and settings)?')) {
      clearCache();
      close();
    }
  });

  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    root.remove();
    document.removeEventListener('keydown', onEsc);
  }
  root.querySelector('[data-act="close"]').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  document.addEventListener('keydown', onEsc);

  return root;
}

export function openSettings() {
  const host = document.getElementById('modal-host') || document.body;
  host.appendChild(buildModal());
}

export function initSettings() {
  // Listen for settings-driven changes that affect global UI
  subscribe('settings-change', (settings) => {
    // No-op for now; modes re-read on next render.
  });
}
