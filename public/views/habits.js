// views/habits.js — vue Habitudes : cartes (série, taux, mini-heatmap corrigeable),
// paliers progressifs (noyau évolutif + consolidation), notes de réalisation,
// bonus ✨, modale de création/édition, archivage. Exporte hueVar, schedLabel,
// emojiEl, celebrate, openHabitNoteModal.
import { h, uid, toast, burst, confirmDialog, openModal, plur, frDM, cap } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, apply, todayK } from '../app.js';
import { habitMiniHeat, habitEscalier } from '../charts.js';

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

// Tuile d'icône : emoji, ou pastille neutre dans la couleur de l'habitude.
export function emojiEl(hb, cls = 'habit-emoji') {
  if (hb.emoji) return h('span', cls, hb.emoji);
  return h('span', cls + ' neutre', h('span', 'neutral-dot'));
}

const EMOJIS = ['🏃', '💪', '🧘', '🚶', '🚴', '💧', '🥗', '😴', '📖', '✍️', '🎸', '🎹', '🇬🇧', '🧠', '💻', '🎯', '🧹', '🌿', '☀️', '💊', '🦷', '📵', '💰', '🙏'];

let archivesOpen = false;

/* ============================== Célébration ============================== */
// Jalon de série (7/14/30/66/100/200/365) ou record personnel : on le dit fort.

export function celebrate(hb, anchor) {
  const s = getState();
  const tk = todayK();
  const ws = s.settings.weekStart;
  const st = L.currentStreak(s, hb, tk, ws);
  if (anchor) burst(anchor, hueVar(hb.color));
  if (st.unit === 'j' && L.estJalon(st.n)) {
    toast('Jalon : ' + st.n + ' jours d’affilée sur « ' + hb.name + ' » 🔥', { ico: 'flame', ms: 3500 });
    if (anchor) setTimeout(() => burst(anchor, 'var(--flame)'), 180);
    return;
  }
  const best = L.bestStreak(s, hb, tk, ws);
  if (st.n >= 5 && st.n === best.n) {
    toast('Record personnel : ' + st.n + ' ' + st.unit + ' sur « ' + hb.name + ' » 🔥', { ico: 'flame', ms: 3000 });
  }
}

/* ============================== Note de réalisation ============================== */

export function openHabitNoteModal(hb, date) {
  const entry = L.habitEntry(getState(), hb.id, date);
  if (!entry) { toast('Coche d’abord l’habitude', { ico: 'x' }); return; }
  const input = h('input', {
    class: 'input', maxlength: 300,
    placeholder: 'Qu’est-ce que tu as fait ? (20 pompes, 10 pages…)',
    value: entry.note || '',
  });
  const save = () => {
    if (apply({ type: 'habit.note', id: hb.id, date, note: input.value })) {
      toast(input.value.trim() ? 'Réalisation notée' : 'Note effacée', { ico: 'note' });
      close();
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const close = openModal({
    title: 'Réalisation · ' + hb.name,
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('div', 'card-sub', cap(frDM(date)) + ' — visible sur la carte et dans l’Historique'),
      input),
    foot: [
      h('span', 'spacer'),
      h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Annuler'),
      h('button', { class: 'btn btn-primary', onclick: save }, 'Enregistrer'),
    ],
    width: 430,
  });
}

/* ============================== Vue ============================== */

export function renderHabits(root) {
  const s = getState();
  const tk = todayK();
  const ws = s.settings.weekStart;
  const active = s.habits.filter((hb) => !hb.archivedAt).sort((a, b) => a.order - b.order);
  const archived = s.habits.filter((hb) => hb.archivedAt);

  root.append(h('div', 'view-head-row',
    h('div', 'view-head',
      h('h1', null, 'Habitudes'),
      h('div', 'sub', active.length ? plur(active.length, 'habitude active', 'habitudes actives') : 'Commence petit : le noyau d’abord, le reste suivra')),
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
      list.append(h('div', { class: 'task-row', style: { alignItems: 'center' } },
        h('span', 'task-slot'),
        emojiEl({ ...hb }, 'habit-emoji petit'),
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
}

function habitCard(hb, s, tk, ws) {
  const streak = L.currentStreak(s, hb, tk, ws);
  const best = L.bestStreak(s, hb, tk, ws);
  const rate = L.completionRate(s, hb, tk, ws);
  const doneToday = L.habitDoneOn(s, hb.id, tk);
  const scheduledToday = L.isScheduledDay(hb, tk) || hb.schedule.kind === 'weekly';

  const card = h('div', { class: 'card habit-card', style: { '--hc': hueVar(hb.color) } });

  card.append(h('div', 'habit-card-head',
    emojiEl(hb),
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

  /* ---------- paliers : le noyau qui grandit ---------- */
  if (Array.isArray(hb.paliers) && hb.paliers.length) {
    const idx = hb.palier ?? 0;
    const seuil = hb.seuilPalier || 7;
    const reussites = L.reussitesAuPalier(s, hb, tk);
    const pret = L.pretAMonter(s, hb, tk);
    const dernier = idx >= hb.paliers.length - 1;

    const box = h('div', 'palier-box');
    box.append(h('div', 'palier-head',
      h('span', 'badge-palier', 'Palier ' + (idx + 1) + '/' + hb.paliers.length),
      h('span', 'palier-noyau', 'Noyau : ' + hb.paliers[idx]),
    ));
    const dep = L.depassements(s, hb, tk, 14);
    if (!dernier) {
      const pct = Math.min(1, reussites / seuil);
      box.append(h('div', { class: 'row', style: { gap: '10px' } },
        h('div', 'meter conso', h('i', { style: { width: Math.round(pct * 100) + '%' } })),
        h('span', 'palier-conso tnum', Math.min(reussites, seuil) + '/' + seuil)));
      if (pret) {
        box.append(h('div', { class: 'row', style: { marginTop: '2px' } },
          h('button', {
            class: 'btn btn-primary btn-sm', onclick: () => {
              apply({ type: 'habit.palierSet', id: hb.id, palier: idx + 1, today: tk });
              toast('Palier ' + (idx + 2) + ' : « ' + hb.paliers[idx + 1] + ' » — bien joué 💪', { ms: 3200 });
            },
          }, icon('flame', 14), 'Monter : ' + hb.paliers[idx + 1].slice(0, 30)),
        ));
        if (dep) box.append(h('div', 'palier-hint', 'Et tu as déjà dépassé le quota ' + dep + '× ces 14 jours ✨ — la marche est prête.'));
      } else {
        box.append(h('div', 'palier-hint',
          'Encore ' + Math.max(0, seuil - reussites) + ' réussite' + (seuil - reussites > 1 ? 's' : '') + ' pour consolider, prochaine étape : ' + hb.paliers[idx + 1]
          + (dep ? ' · déjà ' + dep + ' dépassement' + (dep > 1 ? 's' : '') + ' ✨' : '')));
      }
    } else {
      box.append(h('div', 'palier-hint complet', icon('spark', 12), 'Habitude complète atteinte — entretiens-la.'));
    }
    if (idx > 0) {
      box.append(h('button', {
        class: 'palier-down', onclick: () => {
          apply({ type: 'habit.palierSet', id: hb.id, palier: idx - 1, today: tk });
          toast('Palier réduit, zéro honte : mieux vaut petit que rien.', { ms: 2800 });
        },
      }, 'Trop dur en ce moment ? Redescendre d’un palier'));
    }
    card.append(box);
  }

  if (hb.bonusTexte) {
    const nb = L.bonus30j(s, hb, tk);
    card.append(h('div', 'bonus-line', icon('spark', 13), 'Bonus : ' + hb.bonusTexte, nb ? h('span', 'muted', ' · ' + nb + '× en 30 j') : null));
  }

  /* ---------- notes récentes ---------- */
  const notes = [];
  for (let i = 0; i < 30 && notes.length < 2; i++) {
    const k = L.addDays(tk, -i);
    const e = L.habitEntry(s, hb.id, k);
    if (e && e.note) notes.push({ k, note: e.note });
  }
  if (notes.length) {
    const list = h('div', 'habit-notes');
    for (const n of notes) {
      list.append(h('div', 'habit-note-row',
        h('span', 'muted tnum', frDM(n.k)),
        h('span', { class: 'habit-note-texte', title: n.note }, n.note)));
    }
    card.append(list);
  }

  /* ---------- escalier des niveaux (14 j) ---------- */
  if (Array.isArray(hb.paliers) && hb.paliers.length) {
    const quota = (hb.palier ?? 0) + 1;
    const esc = h('div');
    habitEscalier(esc, {
      nbPaliers: hb.paliers.length,
      quota,
      todayK: tk,
      getNiv: (k) => {
        const e = L.habitEntry(s, hb.id, k);
        if (!e) return null;
        return { niv: e.niv || quota, ok: e.ok !== false };
      },
    });
    card.append(h('div', 'escalier-box',
      h('div', 'card-sub', 'Niveaux atteints · 14 j (pointillé = quota)'),
      esc));
  }

  const heat = h('div', 'heat-wrap');
  habitMiniHeat(heat, {
    habit: hb,
    doneOn: (k) => L.habitDoneOn(getState(), hb.id, k),
    stateOn: (k) => {
      const e = L.habitEntry(getState(), hb.id, k);
      return e ? (e.ok !== false ? 'ok' : 'partiel') : null;
    },
    todayK: tk,
    weekStart: ws,
    onToggle: (k) => apply({ type: 'habit.toggle', id: hb.id, date: k, ts: Date.now() }),
  });
  card.append(heat);

  if (scheduledToday) {
    const entryToday = L.habitEntry(s, hb.id, tk);
    const okToday = !!entryToday && entryToday.ok !== false;
    const aPaliers = Array.isArray(hb.paliers) && hb.paliers.length;
    const btn = h('button', {
      class: 'habit-done-btn' + (okToday ? ' done' : ''),
      onclick: () => {
        if (aPaliers) {
          const quota = (hb.palier ?? 0) + 1;
          const dejaOk = (() => { const e = L.habitEntry(getState(), hb.id, tk); return !!e && e.ok !== false; })();
          if (apply({ type: 'habit.niveau', id: hb.id, date: tk, niv: dejaOk ? 0 : quota, ts: Date.now() }) && !dejaOk) celebrate(hb, btn);
        } else {
          const was = L.habitDoneOn(getState(), hb.id, tk);
          if (apply({ type: 'habit.toggle', id: hb.id, date: tk, ts: Date.now() }) && !was) celebrate(hb, btn);
        }
      },
    }, icon('check', 14),
      okToday ? 'Fait aujourd’hui'
        : (entryToday && aPaliers ? 'Compléter le quota du jour' : 'Marquer comme fait'));
    card.append(btn);
  }

  return card;
}

/* ============================== Modale habitude ============================== */

export function openHabitModal(habit = null) {
  const tk = todayK();
  let emoji = habit ? habit.emoji : '';
  let color = habit ? habit.color : L.HABIT_COLORS[Math.floor(Math.random() * L.HABIT_COLORS.length)];
  let kind = habit ? habit.schedule.kind : 'daily';
  let days = habit && habit.schedule.kind === 'days' ? [...habit.schedule.days] : [1, 2, 3, 4, 5];
  let target = habit && habit.schedule.kind === 'weekly' ? habit.schedule.target : 3;
  let seuil = habit && habit.seuilPalier ? habit.seuilPalier : 7;

  const nameInput = h('input', { class: 'input', placeholder: 'Lecture, sport, méditation…', value: habit ? habit.name : '', maxlength: 60 });

  /* emoji : première case = pastille neutre */
  const emojiGrid = h('div', 'emoji-grid');
  const paintEmoji = () => emojiGrid.querySelectorAll('.emoji-cell').forEach((c) => c.classList.toggle('on', c.dataset.e === emoji));
  emojiGrid.append(h('button', {
    type: 'button', class: 'emoji-cell', dataset: { e: '' }, title: 'Neutre (pastille de couleur)',
    onclick: () => { emoji = ''; paintEmoji(); },
  }, h('span', { class: 'neutral-dot', style: { '--hc': hueVar(color) } })));
  for (const e of EMOJIS) {
    emojiGrid.append(h('button', { type: 'button', class: 'emoji-cell', dataset: { e }, onclick: () => { emoji = e; paintEmoji(); } }, e));
  }

  /* couleur */
  const swatches = h('div', 'swatches');
  const paintColor = () => {
    swatches.querySelectorAll('.swatch').forEach((c) => c.classList.toggle('on', c.dataset.c === color));
    emojiGrid.querySelectorAll('.neutral-dot').forEach((d) => d.style.setProperty('--hc', hueVar(color)));
  };
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

  /* paliers : le noyau qui grandit */
  const paliersArea = h('textarea', {
    class: 'textarea', maxlength: 800, rows: 4,
    placeholder: 'Un palier par ligne, du plus petit au complet. Ex. :\n5 pompes\n15 pompes\n30 pompes + gainage',
    style: { minHeight: '86px' },
  });
  if (habit && Array.isArray(habit.paliers)) paliersArea.value = habit.paliers.join('\n');
  const seuilLabel = h('b', 'tnum', String(seuil));
  const seuilStepper = h('div', 'stepper',
    h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Moins', onclick: () => { if (seuil > 3) { seuil--; seuilLabel.textContent = String(seuil); } } }, '−'),
    seuilLabel,
    h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Plus', onclick: () => { if (seuil < 30) { seuil++; seuilLabel.textContent = String(seuil); } } }, '+'),
    h('span', 'muted', 'réussites avant de proposer la montée'),
  );
  const bonusInput = h('input', {
    class: 'input', maxlength: 120,
    placeholder: 'Si l’énergie est là… (ex. +10 fentes) — ne casse jamais la série',
    value: habit && habit.bonusTexte ? habit.bonusTexte : '',
  });

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const schedule = kind === 'daily' ? { kind: 'daily' }
      : kind === 'days' ? { kind: 'days', days: [...days].sort() }
      : { kind: 'weekly', target };
    if (kind === 'days' && !days.length) { toast('Choisis au moins un jour', { ico: 'x' }); return; }
    const lignes = paliersArea.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);
    const paliers = lignes.length ? lignes : null;
    let ok;
    if (habit) {
      ok = apply({ type: 'habit.update', id: habit.id, patch: { name, emoji, color, schedule, paliers, seuilPalier: seuil, bonusTexte: bonusInput.value } });
      if (ok) toast('Habitude modifiée');
    } else {
      ok = apply({
        type: 'habit.create',
        habit: { id: uid('habit'), name, emoji, color, schedule, paliers: paliers || undefined, seuilPalier: seuil, bonusTexte: bonusInput.value, createdAt: Date.now(), createdDay: tk },
      });
      if (ok) toast(paliers ? 'Habitude créée — commence par : ' + paliers[0] : 'Habitude créée · première coche aujourd’hui ?', { ms: 3000 });
    }
    if (ok) close();
  };

  const body = h('div', { style: { display: 'grid', gap: '16px' } },
    h('label', 'field', 'Nom', nameInput),
    h('div', 'field', 'Icône', emojiGrid),
    h('div', 'field', 'Couleur', swatches),
    h('div', 'field', 'Fréquence', segEl, daysBox, weeklyBox),
    h('div', 'field', 'Construire par paliers (optionnel)',
      paliersArea, seuilStepper,
      h('div', 'composer-hint', 'Le NOYAU du jour = le palier courant. Le cocher suffit à garder la série ; l’app propose de monter quand c’est consolidé.')),
    h('label', 'field', 'Bonus, si l’énergie est là (optionnel)', bonusInput),
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
    width: 500,
  });
  paintEmoji();
  paintColor();
  paintDays();
}
