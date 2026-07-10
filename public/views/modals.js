// views/modals.js — modales partagées : édition/création de tâche, saisie rapide.
import { h, openModal, confirmDialog, uid, toast } from '../ui.js';
import { icon } from '../icons.js';
import { addDays, taskDepth, subtreeIds, subtreeHeight, MAX_TASK_DEPTH } from '../logic.js';
import { getState, apply, todayK } from '../app.js';

const PRIO_OPTS = [[null, 'Aucune'], ['low', 'Basse'], ['med', 'Moyenne'], ['high', 'Haute']];

function seg(options, value, onPick) {
  const el = h('div', 'seg');
  const paint = (v) => {
    el.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', options[i][0] === v));
  };
  for (const [val, label] of options) {
    el.append(h('button', { type: 'button', onclick: () => { onPick(val); paint(val); } }, label));
  }
  paint(value);
  return el;
}

/* ============================== Modale tâche ============================== */

export function openTaskModal({ task = null, defaults = {} } = {}) {
  const s = getState();
  const tk = todayK();
  let prio = task ? task.priority : (defaults.priority || null);
  let due = task ? task.due : (defaults.due !== undefined ? defaults.due : null);

  const titleInput = h('input', { class: 'input', id: 'tm-title', placeholder: 'Que faut-il faire ?', value: task ? task.title : (defaults.title || ''), maxlength: 200 });
  const notesInput = h('textarea', { class: 'textarea', placeholder: 'Notes (facultatif)' });
  if (task && task.notes) notesInput.value = task.notes;

  const projects = [...new Set(s.tasks.map((t) => t.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const projInput = h('input', { class: 'input', list: 'tm-projects', placeholder: 'Projet (facultatif)', value: task ? task.project : (defaults.project || ''), maxlength: 40 });
  const projList = h('datalist', { id: 'tm-projects' }, projects.map((p) => h('option', { value: p })));

  /* tâche parente (sous-tâches en arborescence) */
  const currentParent = task ? task.parentId : (defaults.parentId || null);
  const excluded = task ? new Set([task.id, ...subtreeIds(s.tasks, task.id)]) : new Set();
  const hauteur = task ? subtreeHeight(s.tasks, task.id) : 0;
  const eligibles = s.tasks
    .filter((c) => !c.completedAt && !excluded.has(c.id)
      && taskDepth(s.tasks, c) + 1 + hauteur <= MAX_TASK_DEPTH)
    .sort((a, b) => a.createdAt - b.createdAt);
  const parentSel = h('select', { class: 'input' },
    h('option', { value: '' }, 'Aucune (tâche racine)'),
    eligibles.map((c) => {
      const o = h('option', { value: c.id }, '  '.repeat(taskDepth(s.tasks, c)) + (taskDepth(s.tasks, c) ? '↳ ' : '') + c.title.slice(0, 60));
      if (c.id === currentParent) o.setAttribute('selected', '');
      return o;
    }));

  const dateInput = h('input', { class: 'input', type: 'date', style: { width: '150px' } });
  const dueChips = h('div', 'chip-row');
  const paintDue = () => {
    dueChips.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('on', c.dataset.due === String(due));
    });
    dateInput.value = due || '';
  };
  const mkChip = (val, label) => h('button', {
    type: 'button', class: 'chip', dataset: { due: String(val) },
    onclick: () => { due = val; paintDue(); },
  }, label);
  dueChips.append(
    mkChip(null, 'Sans date'),
    mkChip(tk, 'Aujourd’hui'),
    mkChip(addDays(tk, 1), 'Demain'),
    mkChip(addDays(tk, 7), 'Dans une semaine'),
  );
  dateInput.addEventListener('change', () => { due = dateInput.value || null; paintDue(); });

  const save = () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    const parentId = parentSel.value || null;
    let ok;
    if (task) {
      ok = apply({ type: 'task.update', id: task.id, patch: { title, notes: notesInput.value, project: projInput.value, priority: prio, due, parentId } });
      if (ok) toast('Tâche modifiée');
    } else {
      ok = apply({ type: 'task.create', task: { id: uid('task'), title, notes: notesInput.value, project: projInput.value.trim(), priority: prio, due, parentId, createdAt: Date.now() } });
      if (ok) toast(parentId ? 'Sous-tâche ajoutée' : 'Tâche ajoutée');
    }
    if (ok) close();
  };

  const foot = [];
  if (task) {
    foot.push(h('button', {
      class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await confirmDialog({ title: 'Supprimer cette tâche ?', text: '« ' + task.title + ' » sera supprimée définitivement.' })) {
          apply({ type: 'task.delete', id: task.id });
          toast('Tâche supprimée', { ico: 'trash' });
          close();
        }
      },
    }, icon('trash', 14), 'Supprimer'));
  }
  foot.push(h('span', 'spacer'));
  foot.push(h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Annuler'));
  foot.push(h('button', { class: 'btn btn-primary', onclick: save }, task ? 'Enregistrer' : 'Ajouter'));

  const body = h('div', { style: { display: 'grid', gap: '14px' } },
    h('label', 'field', 'Titre', titleInput),
    h('label', 'field', 'Notes', notesInput),
    h('div', { style: { display: 'grid', gap: '14px', gridTemplateColumns: '1fr 1fr' } },
      h('label', 'field', 'Priorité', seg(PRIO_OPTS, prio, (v) => { prio = v; })),
      h('label', 'field', 'Projet', projInput, projList),
    ),
    h('label', 'field', 'Tâche parente', parentSel),
    h('label', 'field', 'Échéance', dueChips, dateInput),
  );
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.target === titleInput)) { e.preventDefault(); save(); }
  });

  const close = openModal({ title: task ? 'Modifier la tâche' : 'Nouvelle tâche', body, foot, width: 470 });
  paintDue();
}

/* ============================== Saisie rapide (touche N) ============================== */

let lastKind = 'task';

export function openQuickAdd() {
  const tk = todayK();
  let kind = lastKind;
  let due = tk;

  const input = h('input', { class: 'input', placeholder: 'Que faut-il faire ?', maxlength: 200 });
  const noteArea = h('textarea', { class: 'textarea', placeholder: 'Qu’es-tu en train de faire ? (#tag pour étiqueter)', maxlength: 2000 });

  const dueChips = h('div', 'chip-row');
  const paintDue = () => dueChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.due === String(due)));
  for (const [val, label] of [[tk, 'Aujourd’hui'], [addDays(tk, 1), 'Demain'], [null, 'Sans date']]) {
    dueChips.append(h('button', { type: 'button', class: 'chip', dataset: { due: String(val) }, onclick: () => { due = val; paintDue(); } }, label));
  }

  const taskBox = h('div', { style: { display: 'grid', gap: '12px' } }, input, dueChips);
  const noteBox = h('div', null, noteArea);

  const paintKind = () => {
    taskBox.classList.toggle('hidden', kind !== 'task');
    noteBox.classList.toggle('hidden', kind !== 'note');
    (kind === 'task' ? input : noteArea).focus();
  };

  const submit = () => {
    if (kind === 'task') {
      const title = input.value.trim();
      if (!title) { input.focus(); return; }
      if (apply({ type: 'task.create', task: { id: uid('task'), title, createdAt: Date.now(), due } })) {
        toast('Tâche ajoutée');
        close();
      }
    } else {
      const text = noteArea.value.trim();
      if (!text) { noteArea.focus(); return; }
      if (apply({ type: 'journal.add', entry: { id: uid('note'), ts: Date.now(), text } })) {
        toast('Note ajoutée', { ico: 'note' });
        close();
      }
    }
  };

  const body = h('div', { style: { display: 'grid', gap: '14px' } },
    seg([['task', 'Tâche'], ['note', 'Note']], kind, (v) => { kind = v; lastKind = v; paintKind(); }),
    taskBox, noteBox,
  );
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  const close = openModal({
    title: 'Ajout rapide',
    body,
    foot: [h('span', 'spacer'), h('button', { class: 'btn btn-primary', onclick: submit }, 'Ajouter')],
    width: 430,
  });
  paintDue();
  paintKind();
}
