/**
 * HTTP wrapper for adapter fetches in the Windows-native build.
 *
 * The desktop window is just a WebView pointed at localhost. Adapter requests
 * are rewritten through the local Python proxy when window.WORLDMEDIA_PROXY is
 * present, which avoids browser CORS limits while keeping a strict host
 * allowlist server-side.
 */

function rewriteForProxy(url) {
  const prefix = (typeof window !== 'undefined' && window.WORLDMEDIA_PROXY) || '';
  if (!prefix) return null;
  return prefix + encodeURIComponent(url);
}

const DEFAULT_HEADERS = {
  'User-Agent': 'WorldMediaWindows/0.1.0',
  Accept: 'application/json, text/plain, */*',
};

export async function get(url, opts = {}) {
  const headers = { ...DEFAULT_HEADERS, ...(opts.headers || {}) };
  const init = {
    method: 'GET',
    headers,
  };

  const timeoutMs = opts.timeoutMs ?? 8000;
  let controller = null;
  let timeoutHandle = null;
  if (timeoutMs > 0) {
    controller = new AbortController();
    timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  }
  if (opts.signal && controller) {
    if (opts.signal.aborted) {
      controller.abort();
    } else {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  init.signal = controller ? controller.signal : opts.signal;

  const target = rewriteForProxy(url) || url;
  try {
    const res = await globalThis.fetch(target, init);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText || ''} for ${url}`.trim());
    }
    if (opts.text) return await res.text();

    const ct = res.headers && res.headers.get ? res.headers.get('content-type') || '' : '';
    if (ct.includes('json') || ct.includes('javascript') || ct === '') {
      try { return await res.json(); }
      catch (_err) {
        const text = await res.text();
        try { return JSON.parse(text); } catch (_err2) { return text; }
      }
    }
    return await res.text();
  } finally {
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
  }
}

export async function postSilent(url, opts = {}) {
  try {
    const headers = { ...DEFAULT_HEADERS, ...(opts.headers || {}) };
    const init = { method: 'POST', headers };
    if (opts.body !== undefined) init.body = opts.body;
    await globalThis.fetch(rewriteForProxy(url) || url, init);
  } catch (_err) {
    /* ignore fire-and-forget failures */
  }
}

export async function isTauri() {
  return false;
}
