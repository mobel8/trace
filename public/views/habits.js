// views/habits.js — vue Habitudes : cartes (série, taux, mini-heatmap corrigeable),
// modale de création/édition, archivage. Exporte hueVar + schedLabel.
import { h, uid, toast, burst, confirmDialog, openModal, plur, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, apply, todayK } from '../app.js';
import { habitMiniHeat } from '../charts.js';

export const hueVar = (color) => 'var(--hue-' + color + ')';

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']; // lundi → dimanche
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

export function schedLabel(hb) {
  const sc = hb.schedule;
  if (sc.kind === 'daily') return 'Tous les jours';
  if (sc.kind === 'weekly') return sc.target + '× par semaine';
  const sorted = DAY_VALUES.filter((d) => sc.days.includes(d));
  if (sorted.length === 7) return 'Tous les jours';
  return sorted.map((d) => DAY_NAMES[d]).join(' · ');
}

const EMOJIS = ['🏃', '💪', '🧘', '🚶', '🚴', '💧', '🥗', '😴', '📖', '✍️', '🎸', '🎹', '🇬🇧', '🧠', '💻', '🎯', '🧹', '🌿', '☀️', '💊', '🦷', '📵', '💰', '🙏'];

let archivesOpen = false;

export function renderHabits(root) {
  const s = getState();
  const tk = todayK();
  const ws = s.settings.weekStart;
  const active = s.habits.filter((hb) => !hb.archivedAt).sort((a, b) => a.order - b.order);
  const archived = s.habits.filter((hb) => hb.archivedAt);

  root.append(h('div', 'view-head-row',
    h('div', 'view-head',
      h('h1', null, 'Habitudes'),
      h('div', 'sub', active.length ? plur(active.length, 'habitude active', 'habitudes actives') : 'Chaque série commence par un premier jour')),
    h('button', { class: 'btn btn-primary', onclick: () => openHabitModal() }, icon('plus', 15), 'Nouvelle habitude'),
  ));

  const grid = h('div', 'habit-grid');
  for (const hb of active) grid.append(habitCard(hb, s, tk, ws));
  grid.append(h('button', { class: 'new-habit-card', onclick: () => openHabitModal() },
    icon('plus', 22), 'Nouvelle habitude'));
  root.append(grid);

  if (archived.length) {
    const toggle = h('button', { class: 'done-toggle' + (archivesOpen ? ' open' : '') },
      icon('chevronR', 14), 'Archivées', h('span', 'n', '· ' + archived.length));
    const list = h('div', { class: archivesOpen ? '' : 'hidden' });
    for (const hb of archived) {
      list.append(h('div', { class: 'task-row' },
        h('span', { class: 'habit-emoji', style: { '--hc': hueVar(hb.color), width: '26px', height: '26px', fontSize: '13px' } }, hb.emoji),
        h('span', { class: 'task-title', style: { cursor: 'default' } }, hb.name),
        h('span', 'task-actions',
          h('button', { class: 'btn btn-icon', title: 'Réactiver', 'aria-label': 'Réactiver', onclick: () => { apply({ type: 'habit.unarchive', id: hb.id }); toast('Habitude réactivée'); } }, icon('restore', 14)),
          h('button', {
            class: 'btn btn-icon', title: 'Supprimer', 'aria-label': 'Supprimer', onclick: async () => {
              if (await confirmDialog({ title: 'Supprimer « ' + hb.name + ' » ?', text: 'Tout son historique de coches sera effacé. Pour garder l’historique, laisse-la simplement archivée.' })) {
                apply({ type: 'habit.delete', id: hb.id });
              }
            },
          }, icon('trash', 14)),
        ),
      ));
    }
    toggle.addEventListener('click', () => {
      archivesOpen = !archivesOpen;
      toggle.classList.toggle('open', archivesOpen);
      list.classList.toggle('hidden', !archivesOpen);
    });
    root.append(toggle, list);
  }

  if (!active.length && !archived.length) {
    // la grille contient déjà la carte « nouvelle habitude » ; rien à ajouter
  }
}

function habitCard(hb, s, tk, ws) {
  const streak = L.currentStreak(s, hb, tk, ws);
  const best = L.bestStreak(s, hb, tk, ws);
  const rate = L.completionRate(s, hb, tk, ws);
  const doneToday = L.habitDoneOn(s, hb.id, tk);
  const scheduledToday = L.isScheduledDay(hb, tk) || hb.schedule.kind === 'weekly';

  const card = h('div', { class: 'card habit-card', style: { '--hc': hueVar(hb.color) } });

  card.append(h('div', 'habit-card-head',
    h('span', 'habit-emoji', hb.emoji),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', 'habit-name', hb.name),
      h('div', 'card-sub', schedLabel(hb))),
    h('span', 'actions',
      h('button', { class: 'btn btn-icon', 'aria-label': 'Modifier', onclick: () => openHabitModal(hb) }, icon('pencil', 14)),
      h('button', {
        class: 'btn btn-icon', 'aria-label': 'Archiver', title: 'Archiver', onclick: () => {
          apply({ type: 'habit.archive', id: hb.id, ts: Date.now() });
          toast('« ' + hb.name + ' » archivée', { ico: 'archive' });
        },
      }, icon('archive', 14)),
    ),
  ));

  card.append(h('div', 'habit-meta',
    h('span', { class: 'habit-streak' + (streak.n >= 2 ? ' hot' : ''), style: { fontSize: '12.5px' } },
      icon('flame', 13), h('b', null, String(streak.n)), streak.unit),
    h('span', null, 'record ', h('b', null, best.n + ' ' + best.unit)),
    h('span', 'spacer'),
    rate != null ? h('span', null, h('b', 'tnum', Math.round(rate * 100) + ' %'), ' sur 30 j') : null,
  ));

  if (rate != null) {
    const meter = h('div', 'meter');
    meter.append(h('i', { style: { width: Math.round(rate * 100) + '%' } }));
    card.append(meter);
  }

  const heat = h('div', 'heat-wrap');
  habitMiniHeat(heat, {
    habit: hb,
    doneOn: (k) => L.habitDoneOn(getState(), hb.id, k),
    todayK: tk,
    weekStart: ws,
    onToggle: (k) => apply({ type: 'habit.toggle', id: hb.id, date: k, ts: Date.now() }),
  });
  card.append(heat);

  if (scheduledToday) {
    const btn = h('button', {
      class: 'habit-done-btn' + (doneToday ? ' done' : ''),
      onclick: () => {
        const was = L.habitDoneOn(getState(), hb.id, tk);
        if (apply({ type: 'habit.toggle', id: hb.id, date: tk, ts: Date.now() }) && !was) burst(btn, hueVar(hb.color));
      },
    }, icon('check', 14), doneToday ? 'Fait aujourd’hui' : 'Marquer comme fait');
    card.append(btn);
  }

  return card;
}

/* ============================== Modale habitude ============================== */

export function openHabitModal(habit = null) {
  const tk = todayK();
  let emoji = habit ? habit.emoji : EMOJIS[0];
  let color = habit ? habit.color : L.HABIT_COLORS[Math.floor(Math.random() * L.HABIT_COLORS.length)];
  let kind = habit ? habit.schedule.kind : 'daily';
  let days = habit && habit.schedule.kind === 'days' ? [...habit.schedule.days] : [1, 2, 3, 4, 5];
  let target = habit && habit.schedule.kind === 'weekly' ? habit.schedule.target : 3;

  const nameInput = h('input', { class: 'input', placeholder: 'Lecture, sport, méditation…', value: habit ? habit.name : '', maxlength: 60 });

  /* emoji */
  const emojiGrid = h('div', 'emoji-grid');
  const paintEmoji = () => emojiGrid.querySelectorAll('.emoji-cell').forEach((c) => c.classList.toggle('on', c.dataset.e === emoji));
  for (const e of EMOJIS) {
    emojiGrid.append(h('button', { type: 'button', class: 'emoji-cell', dataset: { e }, onclick: () => { emoji = e; paintEmoji(); } }, e));
  }

  /* couleur */
  const swatches = h('div', 'swatches');
  const paintColor = () => swatches.querySelectorAll('.swatch').forEach((c) => c.classList.toggle('on', c.dataset.c === color));
  for (const c of L.HABIT_COLORS) {
    swatches.append(h('button', { type: 'button', class: 'swatch', dataset: { c }, style: { '--sw': hueVar(c) }, 'aria-label': c, onclick: () => { color = c; paintColor(); } }));
  }

  /* fréquence */
  const dayChips = h('div', 'day-chips');
  const paintDays = () => dayChips.querySelectorAll('.day-chip').forEach((c) => c.classList.toggle('on', days.includes(Number(c.dataset.d))));
  DAY_VALUES.forEach((d, i) => {
    dayChips.append(h('button', {
      type: 'button', class: 'day-chip', dataset: { d: String(d) }, 'aria-label': DAY_NAMES[d],
      onclick: () => {
        days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
        paintDays();
      },
    }, DAY_LABELS[i]));
  });

  const targetLabel = h('b', 'tnum', String(target));
  const stepper = h('div', 'stepper',
    h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Moins', onclick: () => { if (target > 1) { target--; targetLabel.textContent = String(target); } } }, '−'),
    targetLabel,
    h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Plus', onclick: () => { if (target < 7) { target++; targetLabel.textContent = String(target); } } }, '+'),
    h('span', 'muted', 'fois par semaine'),
  );

  const daysBox = h('div', { class: kind === 'days' ? '' : 'hidden' }, dayChips);
  const weeklyBox = h('div', { class: kind === 'weekly' ? '' : 'hidden' }, stepper);
  const segEl = h('div', 'seg');
  const KINDS = [['daily', 'Tous les jours'], ['days', 'Jours précis'], ['weekly', 'Par semaine']];
  const paintKind = () => {
    segEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', KINDS[i][0] === kind));
    daysBox.classList.toggle('hidden', kind !== 'days');
    weeklyBox.classList.toggle('hidden', kind !== 'weekly');
  };
  for (const [val, label] of KINDS) segEl.append(h('button', { type: 'button', onclick: () => { kind = val; paintKind(); } }, label));
  paintKind();

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const schedule = kind === 'daily' ? { kind: 'daily' }
      : kind === 'days' ? { kind: 'days', days: [...days].sort() }
      : { kind: 'weekly', target };
    if (kind === 'days' && !days.length) { toast('Choisis au moins un jour', { ico: 'x' }); return; }
    let ok;
    if (habit) {
      ok = apply({ type: 'habit.update', id: habit.id, patch: { name, emoji, color, schedule } });
      if (ok) toast('Habitude modifiée');
    } else {
      ok = apply({ type: 'habit.create', habit: { id: uid('habit'), name, emoji, color, schedule, createdAt: Date.now(), createdDay: tk } });
      if (ok) toast('Habitude créée · première coche aujourd’hui ?');
    }
    if (ok) close();
  };

  const body = h('div', { style: { display: 'grid', gap: '16px' } },
    h('label', 'field', 'Nom', nameInput),
    h('div', 'field', 'Emoji', emojiGrid),
    h('div', 'field', 'Couleur', swatches),
    h('div', 'field', 'Fréquence', segEl, daysBox, weeklyBox),
  );
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.target === nameInput)) { e.preventDefault(); save(); } });

  const close = openModal({
    title: habit ? 'Modifier l’habitude' : 'Nouvelle habitude',
    body,
    foot: [
      h('span', 'spacer'),
      h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Annuler'),
      h('button', { class: 'btn btn-primary', onclick: save }, habit ? 'Enregistrer' : 'Créer'),
    ],
    width: 470,
  });
  paintEmoji();
  paintColor();
  paintDays();
}
