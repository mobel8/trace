// ui.js — utilitaires d'interface : créateur DOM, modales, toasts, tooltip, confettis, formats.
import { icon } from './icons.js';
import { parseKey } from './logic.js';

/* ============================== DOM ============================== */

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (typeof props === 'string') el.className = props;
  else if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') {
        // Object.assign(el.style, …) ignore les propriétés custom (--var) : setProperty obligatoire.
        for (const [sk, sval] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sval);
          else el.style[sk] = sval;
        }
      }
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(k));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// Élément SVG (espace de noms) — pour les graphiques construits dynamiquement.
const SVG_NS = 'http://www.w3.org/2000/svg';
export function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.setAttribute('class', v);
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

export function uid(prefix) {
  const raw = (crypto.randomUUID && crypto.randomUUID()) ||
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return prefix + '-' + raw;
}

/* ============================== Formats (fr) ============================== */

const FMT_FULL = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const FMT_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const FMT_DM = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const FMT_TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const frDayFull = (k) => FMT_FULL.format(parseKey(k));
export const frDayShort = (k) => FMT_SHORT.format(parseKey(k));
export const frDM = (k) => FMT_DM.format(parseKey(k));
export const fmtTime = (ts) => FMT_TIME.format(new Date(ts));
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function relDay(k, todayK) {
  if (k === todayK) return 'Aujourd’hui';
  const t = parseKey(todayK).getTime();
  const d = parseKey(k).getTime();
  const diff = Math.round((d - t) / 86400000);
  if (diff === -1) return 'Hier';
  if (diff === 1) return 'Demain';
  return cap(frDayFull(k));
}

export function plur(n, one, many) { return n + ' ' + (n > 1 ? (many || one + 's') : one); }

/* ============================== Modales ============================== */

let openModals = 0;
export const isModalOpen = () => openModals > 0;

export function openModal({ title, body, foot, width, onClose }) {
  const backdrop = h('div', 'modal-backdrop');
  const panel = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  if (width) panel.style.maxWidth = width + 'px';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openModals--;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };

  panel.append(
    h('div', 'modal-head',
      h('h2', null, title),
      h('button', { class: 'btn-icon btn', 'aria-label': 'Fermer', onclick: close }, icon('x', 16))),
    h('div', 'modal-body', body),
    foot ? h('div', 'modal-foot', foot) : null,
  );
  backdrop.append(panel);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  document.getElementById('modal-root').append(backdrop);
  openModals++;

  const first = panel.querySelector('input, textarea, select, button.btn-primary');
  if (first) requestAnimationFrame(() => first.focus());
  return close;
}

export function confirmDialog({ title, text, confirmLabel = 'Supprimer', danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } close(); };
    const close = openModal({
      title,
      body: h('p', { style: { fontSize: '13.5px', color: 'var(--text-2)' } }, text),
      foot: [
        h('span', 'spacer'),
        h('button', { class: 'btn btn-ghost', onclick: () => finish(false) }, 'Annuler'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => finish(true) }, confirmLabel),
      ],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
  });
}

/* ============================== Toasts ============================== */

export function toast(msg, { ico = 'check', ms = 2400 } = {}) {
  const root = document.getElementById('toast-root');
  while (root.children.length >= 3) root.firstChild.remove();
  const el = h('div', 'toast', icon(ico, 15), msg);
  root.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ============================== Tooltip graphique ============================== */

let tipEl = null;
export function showTip({ value, label, sub }, x, y) {
  if (!tipEl) {
    tipEl = h('div', 'tip');
    document.getElementById('tooltip-root').append(tipEl);
  }
  clear(tipEl);
  tipEl.append(h('div', null, h('b', null, value), label ? ' ' + label : ''));
  if (sub) tipEl.append(h('div', 'tip-sub', sub));
  tipEl.classList.add('show');
  const r = tipEl.getBoundingClientRect();
  let left = x - r.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
  let top = y - r.height - 10;
  if (top < 8) top = y + 14;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}
export function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

/* ============================== Confettis ============================== */

const BURST_COLORS = ['var(--accent)', 'var(--flame)', 'var(--hue-vert)', 'var(--hue-rose)'];
export function burst(el, mainColor) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const wrap = h('div', 'burst-wrap');
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
    const dist = 26 + Math.random() * 26;
    wrap.append(h('span', {
      class: 'burst',
      style: {
        '--dx': Math.cos(angle) * dist + 'px',
        '--dy': Math.sin(angle) * dist + 'px',
        '--bc': i % 3 === 0 && mainColor ? mainColor : BURST_COLORS[i % BURST_COLORS.length],
        width: (4 + Math.random() * 4) + 'px',
        height: (4 + Math.random() * 4) + 'px',
      },
    }));
  }
  el.append(wrap);
  setTimeout(() => wrap.remove(), 700);
}

/* ============================== Divers ============================== */

export function emptyState(ico, title, sub) {
  return h('div', 'empty',
    h('div', 'empty-ico', icon(ico, 20)),
    h('h4', null, title),
    sub ? h('p', null, sub) : null);
}
