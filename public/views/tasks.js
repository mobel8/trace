// views/tasks.js — vue Tâches : sections (retard / aujourd'hui / à venir / un jour),
// ajout rapide, filtre par projet, terminées repliées. Exporte taskRow (réutilisé).
import { h, uid, toast, confirmDialog, frDM, cap, plur, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, apply, todayK } from '../app.js';
import { openTaskModal } from './modals.js';

let projectFilter = null; // persiste le temps de la session
let doneOpen = false;

const PRIO_LABEL = { high: 'Priorité haute', med: 'Priorité moyenne', low: 'Priorité basse' };

export function taskRow(t) {
  const tk = todayK();
  const done = !!t.completedAt;

  const check = h('button', {
    class: 'task-check' + (done ? ' done' : ''),
    'aria-label': done ? 'Rouvrir la tâche' : 'Terminer la tâche',
    onclick: () => {
      if (done) apply({ type: 'task.uncomplete', id: t.id });
      else if (apply({ type: 'task.complete', id: t.id, ts: Date.now() })) toast('Tâche terminée');
    },
  }, icon('check', 12));

  const chips = h('span', 'task-chips');
  if (t.priority) chips.append(h('span', { class: 'prio-dot prio-' + t.priority, title: PRIO_LABEL[t.priority] }));
  if (t.project) chips.append(h('span', 'task-chip', t.project));
  if (!done && t.due) {
    if (t.due < tk) {
      const late = L.diffDays(tk, t.due);
      chips.append(h('span', { class: 'task-chip late', title: cap(frDM(t.due)) }, '−' + late + ' j'));
    } else if (t.due === tk) {
      chips.append(h('span', 'task-chip today-chip', 'Aujourd’hui'));
    } else {
      chips.append(h('span', 'task-chip', frDM(t.due)));
    }
  }
  if (done) chips.append(h('span', 'task-chip', frDM(L.dayOfTs(t.completedAt))));

  return h('div', { class: 'task-row' + (done ? ' done' : '') },
    check,
    h('span', { class: 'task-title', onclick: () => openTaskModal({ task: t }), title: t.notes || t.title }, t.title),
    chips,
    h('span', 'task-actions',
      h('button', { class: 'btn btn-icon', 'aria-label': 'Modifier', onclick: () => openTaskModal({ task: t }) }, icon('pencil', 14)),
      h('button', {
        class: 'btn btn-icon', 'aria-label': 'Supprimer', onclick: async () => {
          if (await confirmDialog({ title: 'Supprimer cette tâche ?', text: '« ' + t.title + ' » sera supprimée définitivement.' })) {
            apply({ type: 'task.delete', id: t.id });
          }
        },
      }, icon('trash', 14)),
    ),
  );
}

export function renderTasks(root) {
  const s = getState();
  const tk = todayK();
  const projects = L.projectsOf(s.tasks);
  if (projectFilter && !projects.includes(projectFilter)) projectFilter = null;

  const visible = projectFilter ? s.tasks.filter((t) => t.project === projectFilter) : s.tasks;
  const sec = L.taskSections(visible, tk);
  const openCount = sec.overdue.length + sec.today.length + sec.upcoming.length + sec.someday.length;

  root.append(h('div', 'view-head-row',
    h('div', 'view-head',
      h('h1', null, 'Tâches'),
      h('div', 'sub', openCount ? plur(openCount, 'tâche en cours', 'tâches en cours') : 'Tout est fait')),
    h('button', { class: 'btn btn-primary', onclick: () => openTaskModal({ defaults: { project: projectFilter || '' } }) }, icon('plus', 15), 'Nouvelle tâche'),
  ));

  /* ajout rapide */
  const quick = h('input', {
    class: 'input', id: 'task-quick', 'data-keep': '', maxlength: 200,
    placeholder: 'Nouvelle tâche… (Entrée pour ajouter' + (projectFilter ? ', projet « ' + projectFilter + ' »' : '') + ')',
  });
  quick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const title = quick.value.trim();
      if (!title) return;
      quick.value = '';
      apply({ type: 'task.create', task: { id: uid('task'), title, createdAt: Date.now(), project: projectFilter || '' } });
    }
  });
  root.append(h('div', { class: 'quick-add', style: { marginBottom: '14px' } }, quick));

  /* filtre projets */
  if (projects.length) {
    const chipRow = h('div', { class: 'chip-row', style: { marginBottom: '18px' } });
    const mk = (val, label) => h('button', {
      class: 'chip' + ((projectFilter || null) === val ? ' on' : ''),
      onclick: () => { projectFilter = val; rerenderView(root); },
    }, label);
    chipRow.append(mk(null, 'Tous'));
    for (const p of projects) chipRow.append(mk(p, p));
    root.append(chipRow);
  }

  /* sections */
  const list = h('div');
  const section = (title, items, cls) => {
    if (!items.length) return;
    list.append(h('div', { class: 'task-section-title' + (cls ? ' ' + cls : '') }, title, h('span', 'n', String(items.length))));
    for (const t of items) list.append(taskRow(t));
  };
  section('En retard', sec.overdue, 'late');
  section('Aujourd’hui', sec.today);
  section('À venir', sec.upcoming);
  section('Un jour', sec.someday);
  if (!openCount) {
    list.append(emptyState('spark', 'Rien à faire ici', 'Ajoute une tâche, ou savoure le calme.'));
  }
  root.append(list);

  /* terminées */
  if (sec.done.length) {
    const toggle = h('button', { class: 'done-toggle' + (doneOpen ? ' open' : '') },
      icon('chevronR', 14), 'Terminées', h('span', 'n', '· ' + sec.done.length));
    const doneList = h('div', { class: doneOpen ? '' : 'hidden' });
    for (const t of sec.done.slice(0, 30)) doneList.append(taskRow(t));
    if (sec.done.length > 30) doneList.append(h('div', { class: 'chart-note', style: { paddingLeft: '10px' } }, 'Le reste est dans l’Historique.'));
    toggle.addEventListener('click', () => {
      doneOpen = !doneOpen;
      toggle.classList.toggle('open', doneOpen);
      doneList.classList.toggle('hidden', !doneOpen);
    });
    root.append(toggle, doneList);
  }
}

function rerenderView(root) {
  const parent = root.parentNode;
  const fresh = h('div', { class: 'view', 'data-route': 'taches' });
  renderTasks(fresh);
  parent.replaceChild(fresh, root);
}
