// views/journal.js — journal de bord : notes horodatées avec #tags, sessions focus
// intercalées, filtre par tag.
import { h, uid, toast, confirmDialog, openModal, fmtTime, relDay, plur, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, apply, todayK, scheduleRender } from '../app.js';

let selectedTag = null;
let daysShown = 14;

// Texte avec #tags mis en évidence — construit en textContent, jamais innerHTML.
export function highlightTags(text) {
  const frag = document.createDocumentFragment();
  const re = /(^|\s)#([\p{L}\p{N}_-]{1,30})/gu;
  let last = 0, m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (start > last) frag.append(text.slice(last, start));
    frag.append(h('span', 'tag', '#' + m[2]));
    last = start + m[2].length + 1;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export function renderJournal(root) {
  const s = getState();
  const tk = todayK();

  root.append(h('div', 'view-head',
    h('h1', null, 'Journal'),
    h('div', 'sub', s.journal.length ? plur(s.journal.length, 'note') : 'Note ce que tu fais, ça prend deux secondes'),
  ));

  /* composeur */
  const area = h('textarea', {
    class: 'textarea', id: 'journal-composer', 'data-keep': '', maxlength: 2000,
    placeholder: 'Qu’es-tu en train de faire ?',
  });
  const submit = () => {
    const text = area.value.trim();
    if (!text) { area.focus(); return; }
    area.value = '';
    if (apply({ type: 'journal.add', entry: { id: uid('note'), ts: Date.now(), text } })) {
      toast('Note ajoutée', { ico: 'note' });
    }
  };
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  root.append(
    h('div', 'composer', area, h('button', { class: 'btn btn-primary btn-sm', onclick: submit }, 'Ajouter')),
    h('div', { class: 'composer-hint', style: { marginTop: '-12px', marginBottom: '16px' } },
      'Entrée pour ajouter · Maj+Entrée pour une nouvelle ligne · #tag pour étiqueter'),
  );

  /* tags */
  const counts = {};
  for (const e of s.journal) for (const t of e.tags) counts[t] = (counts[t] || 0) + 1;
  const topTags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (selectedTag && !counts[selectedTag]) selectedTag = null;
  if (topTags.length) {
    const row = h('div', { class: 'chip-row', style: { marginBottom: '18px' } });
    for (const [t, n] of topTags) {
      row.append(h('button', {
        class: 'chip' + (selectedTag === t ? ' on' : ''),
        onclick: () => { selectedTag = selectedTag === t ? null : t; daysShown = 14; scheduleRender(); },
      }, '#' + t, h('span', 'muted', String(n))));
    }
    root.append(row);
  }

  /* fil */
  const tl = L.timeline(s, {
    types: ['note', 'session'],
    query: selectedTag ? '#' + selectedTag : '',
    todayK: tk,
    days: daysShown,
  });
  if (!tl.groups.length) {
    root.append(emptyState('book', selectedTag ? 'Rien avec #' + selectedTag : 'Journal vide', selectedTag ? 'Essaie un autre tag.' : 'Ta première note apparaîtra ici.'));
    return;
  }
  for (const g of tl.groups) {
    const group = h('div', 'day-group');
    group.append(h('div', 'day-head',
      h('h3', null, relDay(g.dateKey, tk)),
      h('span', 'day-sum', [
        g.summary.notes ? plur(g.summary.notes, 'note') : null,
        g.summary.focusMs ? L.fmtDuration(g.summary.focusMs) + ' de focus' : null,
      ].filter(Boolean).join(' · ')),
    ));
    for (const ev of g.events) group.append(ev.kind === 'note' ? noteRow(ev.entry) : sessionRow(ev));
    root.append(group);
  }
  if (tl.hasMore) {
    root.append(h('div', { style: { textAlign: 'center', marginTop: '4px' } },
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { daysShown += 14; scheduleRender(); } }, 'Charger plus')));
  }
}

function noteRow(e) {
  return h('div', { class: 'event-row', style: { '--ec': 'var(--text-3)' } },
    h('span', 'event-ico', icon('note', 13)),
    h('div', 'event-body', h('div', 'txt', highlightTags(e.text))),
    h('span', 'event-time tnum', fmtTime(e.ts)),
    h('span', 'event-actions',
      h('button', { class: 'btn btn-icon', 'aria-label': 'Modifier', onclick: () => editNote(e) }, icon('pencil', 14)),
      h('button', {
        class: 'btn btn-icon', 'aria-label': 'Supprimer', onclick: async () => {
          if (await confirmDialog({ title: 'Supprimer cette note ?', text: e.text.slice(0, 120) })) {
            apply({ type: 'journal.delete', id: e.id });
          }
        },
      }, icon('trash', 14)),
    ),
  );
}

function sessionRow(ev) {
  const ssn = ev.session;
  return h('div', { class: 'event-row', style: { '--ec': 'var(--hue-cyan)' } },
    h('span', 'event-ico', icon('play', 13)),
    h('div', 'event-body',
      h('div', 'txt', ssn.label),
      h('div', 'meta', L.fmtDuration(ssn.end - ssn.start) + ' de focus')),
    h('span', 'event-time tnum', fmtTime(ssn.start)),
    h('span', 'event-actions',
      h('button', {
        class: 'btn btn-icon', 'aria-label': 'Supprimer', onclick: async () => {
          if (await confirmDialog({ title: 'Supprimer cette session ?', text: ssn.label + ' · ' + L.fmtDuration(ssn.end - ssn.start) })) {
            apply({ type: 'session.delete', id: ssn.id });
          }
        },
      }, icon('trash', 14)),
    ),
  );
}

function editNote(e) {
  const area = h('textarea', { class: 'textarea', maxlength: 2000 });
  area.value = e.text;
  const save = () => {
    const text = area.value.trim();
    if (!text) { area.focus(); return; }
    if (apply({ type: 'journal.update', id: e.id, patch: { text } })) {
      toast('Note modifiée', { ico: 'note' });
      close();
    }
  };
  area.addEventListener('keydown', (ev2) => { if (ev2.key === 'Enter' && !ev2.shiftKey) { ev2.preventDefault(); save(); } });
  const close = openModal({
    title: 'Modifier la note',
    body: area,
    foot: [
      h('span', 'spacer'),
      h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Annuler'),
      h('button', { class: 'btn btn-primary', onclick: save }, 'Enregistrer'),
    ],
  });
}
