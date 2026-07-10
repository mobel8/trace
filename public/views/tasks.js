// views/tasks.js — vue Tâches : sections (retard / aujourd'hui / à venir / un jour),
// sous-tâches en arborescence (pliables), notes affichées, ajout rapide, filtre
// par projet, terminées repliées. Exporte taskNode/taskRow (réutilisés par Aujourd'hui).
import { h, uid, toast, confirmDialog, frDM, cap, plur, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, apply, todayK, scheduleRender } from '../app.js';
import { openTaskModal } from './modals.js';

let projectFilter = null; // persiste le temps de la session
let doneOpen = false;
const collapsedTasks = new Set(); // dossiers repliés (session)

const PRIO_LABEL = { high: 'Priorité haute', med: 'Priorité moyenne', low: 'Priorité basse' };

/* ============================== Arborescence ============================== */

// Une tâche + ses sous-tâches, récursivement (modèle « dossier »).
export function taskNode(t) {
  const s = getState();
  const kids = L.taskChildren(s.tasks, t.id);
  const node = h('div', 'task-node');
  node.append(taskRow(t, kids));
  if (kids.length && !collapsedTasks.has(t.id)) {
    const box = h('div', 'task-children');
    for (const k of kids) box.append(taskNode(k));
    node.append(box);
  }
  return node;
}

export function taskRow(t, kids) {
  const s = getState();
  const tk = todayK();
  if (!kids) kids = L.taskChildren(s.tasks, t.id);
  const done = !!t.completedAt;
  const depth = L.taskDepth(s.tasks, t);
  const progress = kids.length ? L.taskProgress(s.tasks, t.id) : null;

  const check = h('button', {
    class: 'task-check' + (done ? ' done' : ''),
    'aria-label': done ? 'Rouvrir la tâche' : 'Terminer la tâche',
    onclick: () => {
      if (done) apply({ type: 'task.uncomplete', id: t.id });
      else {
        const openKids = L.subtreeIds(s.tasks, t.id).filter((id) => {
          const st = s.tasks.find((x) => x.id === id);
          return st && !st.completedAt;
        }).length;
        if (apply({ type: 'task.complete', id: t.id, ts: Date.now() })) {
          toast(openKids ? 'Tâche terminée avec ses ' + plur(openKids, 'sous-tâche') : 'Tâche terminée');
        }
      }
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

  const actions = h('span', 'task-actions');
  if (!done && depth < L.MAX_TASK_DEPTH) {
    actions.append(h('button', {
      class: 'btn btn-icon', 'aria-label': 'Ajouter une sous-tâche', title: 'Ajouter une sous-tâche',
      onclick: () => openTaskModal({ defaults: { parentId: t.id, project: t.project } }),
    }, icon('plus', 14)));
  }
  actions.append(
    h('button', { class: 'btn btn-icon', 'aria-label': 'Modifier', onclick: () => openTaskModal({ task: t }) }, icon('pencil', 14)),
    h('button', {
      class: 'btn btn-icon', 'aria-label': 'Supprimer', onclick: async () => {
        const nb = L.subtreeIds(getState().tasks, t.id).length;
        if (await confirmDialog({
          title: 'Supprimer cette tâche ?',
          text: '« ' + t.title + ' » sera supprimée définitivement' + (nb ? ', ainsi que ses ' + plur(nb, 'sous-tâche') : '') + '.',
        })) {
          apply({ type: 'task.delete', id: t.id });
        }
      },
    }, icon('trash', 14)),
  );

  const main = h('span', 'task-main',
    h('span', 'task-title-line',
      h('span', { class: 'task-title', onclick: () => openTaskModal({ task: t }), title: 'Modifier' }, t.title),
      progress ? h('span', { class: 'task-progress' + (progress.done === progress.total ? ' full' : '') },
        progress.done + '/' + progress.total) : null,
    ),
    t.notes ? h('span', { class: 'task-note', onclick: () => openTaskModal({ task: t }) }, t.notes) : null,
  );

  // Emplacement fixe du chevron : présent sur toutes les lignes (vide sur les
  // feuilles) pour un alignement constant, jamais superposé à la case.
  const slot = h('span', 'task-slot');
  if (kids.length) {
    const open = !collapsedTasks.has(t.id);
    slot.append(h('button', {
      class: 'task-collapse' + (open ? ' open' : ''),
      'aria-label': open ? 'Replier les sous-tâches' : 'Déplier les sous-tâches',
      'aria-expanded': String(open),
      onclick: (e) => {
        e.stopPropagation();
        if (collapsedTasks.has(t.id)) collapsedTasks.delete(t.id);
        else collapsedTasks.add(t.id);
        scheduleRender();
      },
    }, icon('chevronR', 12)));
  }

  return h('div', { class: 'task-row' + (done ? ' done' : '') }, slot, check, main, chips, actions);
}

/* ============================== Vue ============================== */

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
      onclick: () => { projectFilter = val; scheduleRender(); },
    }, label);
    chipRow.append(mk(null, 'Tous'));
    for (const p of projects) chipRow.append(mk(p, p));
    root.append(chipRow);
  }

  /* sections (racines ; les sous-tâches suivent leur parente) */
  const list = h('div');
  const section = (title, items, cls) => {
    if (!items.length) return;
    list.append(h('div', { class: 'task-section-title' + (cls ? ' ' + cls : '') }, title, h('span', 'n', String(items.length))));
    for (const t of items) list.append(taskNode(t));
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
    for (const t of sec.done.slice(0, 30)) doneList.append(taskNode(t));
    if (sec.done.length > 30) doneList.append(h('div', { class: 'chart-note', style: { paddingLeft: '10px' } }, 'Le reste est dans l’Historique.'));
    toggle.addEventListener('click', () => {
      doneOpen = !doneOpen;
      toggle.classList.toggle('open', doneOpen);
      doneList.classList.toggle('hidden', !doneOpen);
    });
    root.append(toggle, doneList);
  }
}
