// views/history.js — historique unifié : tout ce qui a été fait, filtrable et cherchable.
import { h, fmtTime, relDay, plur, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, todayK, scheduleRender } from '../app.js';
import { hueVar } from './habits.js';
import { highlightTags } from './journal.js';

let typeFilter = null; // null = tout
let query = '';
let daysShown = 14;
let debounceTimer = null;

const TYPES = [
  [null, 'Tout'],
  ['task', 'Tâches'],
  ['habit', 'Habitudes'],
  ['note', 'Notes'],
  ['session', 'Sessions'],
];

export function renderHistory(root) {
  const s = getState();
  const tk = todayK();

  root.append(h('div', 'view-head',
    h('h1', null, 'Historique'),
    h('div', 'sub', 'Tout ce que tu as fait, jour par jour'),
  ));

  /* filtres : une seule rangée au-dessus du contenu */
  const chipRow = h('div', { class: 'chip-row', style: { marginBottom: '16px', alignItems: 'center' } });
  for (const [val, label] of TYPES) {
    chipRow.append(h('button', {
      class: 'chip' + (typeFilter === val ? ' on' : ''),
      onclick: () => { typeFilter = val; daysShown = 14; scheduleRender(); },
    }, label));
  }
  const search = h('input', {
    class: 'input', id: 'history-search', 'data-keep': '',
    placeholder: 'Rechercher…', value: query,
    style: { width: '190px', height: '30px', marginLeft: 'auto' },
  });
  search.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { query = search.value; daysShown = 14; scheduleRender(); }, 140);
  });
  chipRow.append(search);
  root.append(chipRow);

  const tl = L.timeline(s, {
    types: typeFilter ? [typeFilter] : null,
    query,
    todayK: tk,
    days: daysShown,
  });

  if (!tl.groups.length) {
    root.append(emptyState('history',
      query ? 'Rien ne correspond à « ' + query + ' »' : 'Ton historique se remplira tout seul',
      query ? 'Essaie une autre recherche.' : 'Termine une tâche, coche une habitude ou note quelque chose.'));
    return;
  }

  for (const g of tl.groups) {
    const parts = [];
    if (g.summary.tasks) parts.push(plur(g.summary.tasks, 'tâche'));
    if (g.summary.habits) parts.push(plur(g.summary.habits, 'habitude'));
    if (g.summary.notes) parts.push(plur(g.summary.notes, 'note'));
    if (g.summary.focusMs) parts.push(L.fmtDuration(g.summary.focusMs) + ' de focus');

    const group = h('div', 'day-group');
    group.append(h('div', 'day-head',
      h('h3', null, relDay(g.dateKey, tk)),
      h('span', 'day-sum', parts.join(' · ')),
    ));
    for (const ev of g.events) group.append(eventRow(ev));
    root.append(group);
  }
  if (tl.hasMore) {
    root.append(h('div', { style: { textAlign: 'center', marginTop: '4px' } },
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { daysShown += 14; scheduleRender(); } }, 'Charger plus')));
  }
}

function eventRow(ev) {
  let ico, ec, body;
  if (ev.kind === 'task') {
    ico = 'check'; ec = 'var(--accent)';
    body = h('div', 'event-body',
      h('div', 'txt', ev.title),
      h('div', 'meta',
        (ev.parentTitle ? 'dans « ' + ev.parentTitle + ' » · ' : '')
        + (ev.project ? ev.project + ' · ' : '') + 'tâche terminée'));
  } else if (ev.kind === 'habit') {
    ico = 'repeat'; ec = hueVar(ev.habit.color);
    body = h('div', 'event-body',
      h('div', 'txt', ev.habit.emoji + ' ' + ev.title),
      h('div', 'meta', 'habitude cochée'));
  } else if (ev.kind === 'note') {
    ico = 'note'; ec = 'var(--text-3)';
    body = h('div', 'event-body', h('div', 'txt', highlightTags(ev.title)));
  } else {
    ico = 'play'; ec = 'var(--hue-cyan)';
    body = h('div', 'event-body',
      h('div', 'txt', ev.title),
      h('div', 'meta', L.fmtDuration(ev.durationMs) + ' de focus' + (ev.taskTitle ? ' · ' + ev.taskTitle : '')));
  }
  return h('div', { class: 'event-row', style: { '--ec': ec } },
    h('span', 'event-ico', icon(ico, 13)),
    body,
    h('span', 'event-time tnum', fmtTime(ev.ts)),
  );
}
