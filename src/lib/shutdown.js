/**
 * Clean shutdown for the Windows-native app.
 *
 * POST /api/shutdown asks the local Python process to exit. The WebView closes
 * with that process; window.close() is only a final browser-preview fallback.
 */

let shuttingDown = false;

async function postShutdown() {
  try {
    const res = await fetch('/api/shutdown', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
    });
    return res.ok || res.status === 202;
  } catch (_err) {
    return false;
  }
}

function closeWindow() {
  if (typeof window.closeApp === 'function') {
    try { window.closeApp(); return true; } catch (_) {}
  }
  try { window.close(); } catch (_) {}
  return false;
}

function renderGoodbye() {
  const host = document.getElementById('view-host');
  if (host) {
    host.innerHTML = `
      <div class="boot-state" style="gap:18px;">
        <div class="boot-spinner" aria-hidden="true"></div>
        <p style="font-size:14px;">Shutting down World Media...</p>
        <p style="font-size:12px;color:var(--text-mute);max-width:340px;text-align:center;">
          If this window stays open, close it from the title bar. The local
          server has already been asked to stop.
        </p>
      </div>
    `;
  }
  for (const id of ['audio-el', 'video-el']) {
    const el = document.getElementById(id);
    if (el) {
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch (_) {}
    }
  }
  for (const el of document.querySelectorAll('.topbar button, .topbar select')) {
    el.disabled = true;
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.5';
  }
}

export async function requestShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  renderGoodbye();
  await postShutdown();
  await new Promise((resolve) => setTimeout(resolve, 250));
  closeWindow();
}

export function initShutdownButton() {
  const btn = document.getElementById('shutdown-btn');
  if (!btn) return;
  btn.addEventListener('click', () => requestShutdown());
  document.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && (e.key === 'q' || e.key === 'Q')) {
      e.preventDefault();
      requestShutdown();
    }
  });
}
