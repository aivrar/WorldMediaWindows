/**
 * Right-side detail panel for the currently selected item. Opens when a
 * card is clicked, closes via its own Close button or when the user
 * navigates source/mode. The panel is mounted on demand and removed
 * when closed — no persistent DOM cost when nothing is selected.
 */

import { getState, isFavorite, addFavorite, removeFavorite } from '../../lib/state.js';
import { getSourceLabel } from '../../lib/sources.js';
import { upgradeInsecure } from '../../lib/item-model.js';
import { playItem } from '../../lib/player.js';
import { el } from './utils.js';
import { ui } from './shell-refs.js';
import { resolveItemArtwork } from './thumbnails.js';

export function openDetail(item) {
  if (!ui.detailPanel) {
    ui.detailPanel = el('aside', { className: 'detail-panel' });
    ui.root.appendChild(ui.detailPanel);
    ui.root.classList.add('has-detail');
  }
  ui.detailPanel.innerHTML = '';
  const closeBtn = el('button', {
    className: 'btn detail-close',
    on: { click: closeDetail },
    text: 'Close',
  });
  ui.detailPanel.appendChild(closeBtn);

  const detailThumb = el('img', {
    className: 'detail-thumb',
    attrs: { alt: '', referrerpolicy: 'no-referrer' },
  });
  detailThumb.addEventListener('error', () => { detailThumb.style.display = 'none'; });
  if (item.thumbnail) {
    detailThumb.src = upgradeInsecure(item.thumbnail);
    ui.detailPanel.appendChild(detailThumb);
  } else {
    // Artwork may still be hydrating — append (hidden) and fill in once resolved.
    detailThumb.style.display = 'none';
    ui.detailPanel.appendChild(detailThumb);
    resolveItemArtwork(item).then(() => {
      if (item.thumbnail && detailThumb.isConnected) {
        detailThumb.src = upgradeInsecure(item.thumbnail);
        detailThumb.style.display = '';
      }
    });
  }

  ui.detailPanel.appendChild(el('h2', { className: 'detail-title', text: item.title }));
  const meta = el('div', { className: 'detail-meta' });
  meta.appendChild(el('span', { className: 'source-badge', text: getSourceLabel(item.source) }));
  if (item.year) meta.appendChild(el('span', { text: String(item.year) }));
  if (item.country) meta.appendChild(el('span', { text: item.country }));
  if (item.language) meta.appendChild(el('span', { text: item.language }));
  if (item.license) meta.appendChild(el('span', { text: item.license }));
  ui.detailPanel.appendChild(meta);
  if (item.tags && item.tags.length) {
    const tagsHost = el('div', { className: 'detail-meta' });
    for (const t of item.tags.slice(0, 12)) tagsHost.appendChild(el('span', { className: 'chip', text: t }));
    ui.detailPanel.appendChild(tagsHost);
  }
  ui.detailPanel.appendChild(el('p', { className: 'detail-description', text: item.description || '' }));

  const actions = el('div', { className: 'detail-actions' });
  actions.appendChild(el('button', { className: 'btn btn-primary', text: 'Play', on: { click: () => playItem(item) } }));
  const favBtn = el('button', {
    className: 'btn',
    text: isFavorite(item.id) ? '★ Favorited' : '☆ Favorite',
    on: { click: () => {
      if (isFavorite(item.id)) { removeFavorite(item.id); favBtn.textContent = '☆ Favorite'; }
      else { addFavorite(item); favBtn.textContent = '★ Favorited'; }
    } },
  });
  actions.appendChild(favBtn);
  if (item.source_url) {
    actions.appendChild(el('a', { className: 'btn', attrs: { href: item.source_url, target: '_blank', rel: 'noopener' }, text: 'Source ↗' }));
  }
  ui.detailPanel.appendChild(actions);
}

export function closeDetail() {
  if (ui.detailPanel) {
    ui.detailPanel.remove();
    ui.detailPanel = null;
    ui.root.classList.remove('has-detail');
  }
}
