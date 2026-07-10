// app.js — Trace : store optimiste + routeur + coquille. Point d'entrée du client.
import * as L from './logic.js';
import { h, clear, toast, isModalOpen } from './ui.js';
import { icon, logo } from './icons.js';
import { renderToday } from './views/today.js';
import { renderTasks } from './views/tasks.js';
import { renderHabits } from './views/habits.js';
import { renderJournal } from './views/journal.js';
import { renderHistory } from './views/history.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';
import { renderOnboarding } from './views/onboarding.js';
import { openQuickAdd } from './views/modals.js';

/* ============================== État & synchro ============================== */

let state = null;
let sendQueue = Promise.resolve();

export const getState = () => state;
export const todayK = () => L.todayKey();

async function fetchState() {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error('état illisible');
  state = (await r.json()).state;
}

async function resync() {
  try { await fetchState(); scheduleRender(); } catch {}
}

// Application optimiste : l'op passe par le MÊME réducteur que le serveur.
// La file garantit l'ordre d'envoi ; toute divergence déclenche une resynchro.
export function apply(op) {
  try {
    state = L.reduce(state, op);
  } catch (e) {
    toast(e.message || 'Action impossible', { ico: 'x' });
    return false;
  }
  const localRev = state.rev;
  scheduleRender();
  sendQueue = sendQueue.then(async () => {
    const r = await fetch('/api/op', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op }),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast(res.error || 'Modification refusée', { ico: 'x' });
      await resync();
    } else if (res.rev !== localRev) {
      await resync(); // une autre fenêtre a écrit entre-temps
    }
  }).catch(async () => {
    toast('Serveur injoignable, modification annulée', { ico: 'x' });
    await resync();
  });
  return true;
}

/* ============================== Routeur ============================== */

export const ROUTES = {
  aujourdhui: { label: 'Aujourd’hui', ico: 'sun', render: renderToday },
  taches: { label: 'Tâches', ico: 'tasks', render: renderTasks },
  habitudes: { label: 'Habitudes', ico: 'repeat', render: renderHabits },
  journal: { label: 'Journal', ico: 'book', render: renderJournal },
  historique: { label: 'Historique', ico: 'history', render: renderHistory },
  bilan: { label: 'Bilan', ico: 'chart', render: renderStats },
  reglages: { label: 'Réglages', ico: 'sliders', render: renderSettings },
};
const ROUTE_KEYS = Object.keys(ROUTES);

export function route() {
  const m = /^#\/([a-z]+)/.exec(location.hash);
  return m && ROUTES[m[1]] ? m[1] : 'aujourdhui';
}
export function go(r) { location.hash = '#/' + r; }

/* ============================== Rendu ============================== */

let appEl = null, sidebarEl = null, mainEl = null;
let renderQueued = false;
let lastRenderedDay = null;

export function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function applyTheme() {
  const s = state.settings;
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = s.accent || 'violet';
}

function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.id || !el.hasAttribute('data-keep')) return null;
  return {
    id: el.id,
    value: el.value,
    selStart: el.selectionStart,
    selEnd: el.selectionEnd,
  };
}
function restoreFocus(snap) {
  if (!snap) return;
  const el = document.getElementById(snap.id);
  if (!el) return;
  el.value = snap.value;
  el.focus();
  try { el.setSelectionRange(snap.selStart, snap.selEnd); } catch {}
}

function render() {
  if (!state) return;
  applyTheme();
  lastRenderedDay = L.todayKey();

  if (!state.onboarded) {
    clear(appEl);
    appEl.className = '';
    renderOnboarding(appEl);
    return;
  }

  if (!sidebarEl || !appEl.contains(sidebarEl)) {
    clear(appEl);
    appEl.className = '';
    appEl.style.display = 'flex';
    sidebarEl = h('aside', 'sidebar');
    mainEl = h('main', { id: 'main' });
    appEl.append(sidebarEl, mainEl);
  }

  renderSidebar();
  const snap = captureFocus();
  const r = route();
  clear(mainEl);
  const view = h('div', { class: 'view', 'data-route': r });
  ROUTES[r].render(view);
  mainEl.append(view);
  restoreFocus(snap);
}

function renderSidebar() {
  const tk = todayK();
  const sec = L.taskSections(state.tasks, tk);
  const openToday = sec.overdue.length + sec.today.length;
  const mom = L.momentum(state, tk);
  const focusMs = L.focusToday(state, tk, Date.now());

  clear(sidebarEl).append(
    h('div', 'brand', logo(26), 'Trace'),
    ...ROUTE_KEYS.map((key) => {
      const r = ROUTES[key];
      return h('button', {
        class: 'nav-item' + (route() === key ? ' active' : ''),
        onclick: () => go(key),
      },
        icon(r.ico, 17),
        r.label,
        key === 'taches' && openToday > 0 ? h('span', 'nav-count', String(openToday)) : null,
      );
    }),
    h('div', 'side-foot',
      mom > 0 ? h('div', 'side-stat', icon('flame', 14), h('span', null, 'Élan · ', h('b', null, mom + ' j'))) : null,
      focusMs > 0 || state.activeSession ? h('div', 'side-stat', icon('clock', 14), h('span', null, 'Focus · ', h('b', { id: 'side-focus' }, L.fmtDuration(focusMs)))) : null,
      h('div', 'side-hint', h('span', 'kbd', 'N'), ' nouvelle entrée'),
    ),
  );
}

/* ============================== Horloges ============================== */

// Minuteur focus : met à jour l'affichage et le titre d'onglet sans re-render.
setInterval(() => {
  if (!state) return;
  const a = state.activeSession;
  if (a) {
    const ms = Date.now() - a.start;
    const mm = Math.floor(ms / 60000), ss = Math.floor((ms % 60000) / 1000);
    const txt = (mm < 100 ? String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
    const node = document.getElementById('focus-time');
    if (node) node.textContent = txt;
    document.title = '▶ ' + txt + ' · Trace';
    const side = document.getElementById('side-focus');
    if (side) side.textContent = L.fmtDuration(L.focusToday(state, L.todayKey(), Date.now()));
  } else if (document.title !== 'Trace') {
    document.title = 'Trace';
  }
}, 1000);

// Passage de minuit / retour de veille : re-rendre si le jour a changé.
setInterval(() => {
  if (state && lastRenderedDay && L.todayKey() !== lastRenderedDay) scheduleRender();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state) {
    if (lastRenderedDay && L.todayKey() !== lastRenderedDay) scheduleRender();
    resync();
  }
});
// Retour sur la fenêtre (mode app sans onglets) : on se remet au niveau du serveur.
window.addEventListener('focus', () => { if (state) resync(); });

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state && state.settings.theme === 'auto') scheduleRender();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => scheduleRender(), 160);
});
window.addEventListener('hashchange', scheduleRender);

/* ============================== Raccourcis clavier ============================== */

document.addEventListener('keydown', (e) => {
  if (!state || !state.onboarded || isModalOpen()) return;
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    const focusTarget = { taches: 'task-quick', journal: 'journal-composer', aujourdhui: null }[route()];
    if (route() === 'taches' || route() === 'journal') {
      const el = document.getElementById(focusTarget);
      if (el) { el.focus(); return; }
    }
    openQuickAdd();
  } else if (e.key === '/' && route() === 'historique') {
    const el = document.getElementById('history-search');
    if (el) { e.preventDefault(); el.focus(); }
  } else if (/^[1-7]$/.test(e.key)) {
    go(ROUTE_KEYS[Number(e.key) - 1]);
  }
});

/* ============================== Démarrage ============================== */

async function boot() {
  appEl = document.getElementById('app');
  appEl.hidden = false;
  try {
    await fetchState();
  } catch {
    clear(appEl).append(h('div', 'boot-error',
      h('div', null,
        h('h2', { style: { marginBottom: '8px' } }, 'Trace ne répond pas'),
        h('p', { class: 'muted', style: { marginBottom: '16px' } }, 'Le serveur local semble arrêté. Relance-le puis réessaie.'),
        h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Réessayer'),
      )));
    return;
  }
  render();
}

boot();
