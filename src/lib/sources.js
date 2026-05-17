/**
 * Source registry. Single source of truth for what adapters exist.
 */

export const SOURCES = [
  { id: 'radio-browser',    displayName: 'Radio Browser',         types: ['radio'],          color: '#42a5f5' },
  { id: 'iptv-org',         displayName: 'iptv-org',              types: ['tv'],             color: '#ef5350' },
  { id: 'internet-archive', displayName: 'Internet Archive',      types: ['video', 'audio'], color: '#f5a524' },
  { id: 'nasa',             displayName: 'NASA',                  types: ['video', 'audio'], color: '#9c27b0' },
  { id: 'wikimedia',        displayName: 'Wikimedia Commons',     types: ['video', 'audio'], color: '#26a69a' },
  { id: 'librivox',         displayName: 'LibriVox',              types: ['audio'],          color: '#7e57c2' },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);

export function getSource(id) {
  return SOURCES.find((s) => s.id === id);
}

export function getSourceLabel(id) {
  const s = getSource(id);
  return s ? s.displayName : id;
}

export function getSourceColor(id) {
  const s = getSource(id);
  return s ? s.color : '#888';
}

/** Lazy adapter loader so each adapter is only fetched/parsed when needed. */
const ADAPTER_LOADERS = {
  'radio-browser':    () => import('../adapters/radio-browser.js'),
  'iptv-org':         () => import('../adapters/iptv-org.js'),
  'internet-archive': () => import('../adapters/internet-archive.js'),
  'nasa':             () => import('../adapters/nasa.js'),
  'wikimedia':        () => import('../adapters/wikimedia.js'),
  'librivox':         () => import('../adapters/librivox.js'),
};

const adapterCache = new Map();

export async function loadAdapter(id) {
  if (adapterCache.has(id)) return adapterCache.get(id);
  const loader = ADAPTER_LOADERS[id];
  if (!loader) throw new Error(`Unknown adapter: ${id}`);
  const mod = await loader();
  adapterCache.set(id, mod);
  return mod;
}
