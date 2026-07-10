// views/today.js — tableau de bord du jour : habitudes, tâches, focus, note rapide.
import { h, uid, toast, burst, fmtTime, plur, frDayFull, cap, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, apply, todayK, go } from '../app.js';
import { taskNode } from './tasks.js';
import { hueVar, schedLabel, emojiEl, celebrate, openHabitNoteModal } from './habits.js';
import { jouerCarillon, armerAudio, demanderPermissionNotif, notifierPC } from '../son.js';

function greeting(name, hour) {
  const hello = hour < 5 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  return name ? hello + ', ' + name : hello;
}

export function renderToday(root) {
  const s = getState();
  const tk = todayK();
  const now = Date.now();
  const ws = s.settings.weekStart;

  const dueHabits = s.habits
    .filter((hb) => !hb.archivedAt && L.habitDueToday(s, hb, tk, ws))
    .sort((a, b) => a.order - b.order);
  const doneCount = dueHabits.filter((hb) => L.habitDoneOn(s, hb.id, tk)).length;
  const sec = L.taskSections(s.tasks, tk);

  /* ---------- entête ---------- */
  const bits = [];
  if (dueHabits.length) bits.push(doneCount + '/' + dueHabits.length + ' habitude' + (dueHabits.length > 1 ? 's' : ''));
  const nT = sec.overdue.length + sec.today.length;
  if (nT) bits.push(plur(nT, 'tâche'));
  root.append(h('div', 'view-head',
    h('h1', null, greeting(s.settings.name, new Date().getHours())),
    h('div', 'sub', cap(frDayFull(tk)) + (bits.length ? ' · ' + bits.join(' · ') : '')),
  ));

  /* ---------- tuiles ---------- */
  const weekFrom = L.weekStartOf(tk, ws);
  const act = L.activityByDay(s, weekFrom, tk);
  let weekTasks = 0, weekNotes = 0;
  for (const day of Object.values(act)) { weekTasks += day.tasks; weekNotes += day.notes; }
  const mom = L.momentum(s, tk);
  const focusMs = L.focusToday(s, tk, now);
  root.append(h('div', 'stat-row',
    statTile('flame', 'Élan', mom, mom > 0 ? 'j' : '', 'flame'),
    statTile('tasks', 'Tâches · semaine', weekTasks, ''),
    statTile('clock', 'Focus · aujourd’hui', focusMs > 0 ? L.fmtDurationShort(focusMs) : '0', ''),
    statTile('note', 'Notes · semaine', weekNotes, ''),
  ));

  /* ---------- grille ---------- */
  const left = h('div', 'stack');
  const right = h('div', 'stack');
  root.append(h('div', 'grid-2', left, right));

  /* Habitudes du jour */
  const habitsCard = h('div', 'card');
  habitsCard.append(h('div', 'card-title',
    icon('repeat', 15), 'Habitudes du jour',
    h('span', 'spacer'),
    dueHabits.length ? h('span', 'card-sub tnum', doneCount + ' / ' + dueHabits.length) : null,
  ));
  if (!dueHabits.length) {
    habitsCard.append(emptyState('repeat', 'Aucune habitude pour aujourd’hui', 'Crée ta première habitude pour lancer une série.'),
      h('div', { style: { textAlign: 'center' } },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('habitudes') }, icon('plus', 14), 'Créer une habitude')));
  } else {
    if (doneCount === dueHabits.length) {
      habitsCard.append(h('div', { class: 'all-done', style: { marginBottom: '8px' } }, icon('spark', 15), 'Tout est fait pour aujourd’hui !'));
    }
    for (const hb of dueHabits) habitsCard.append(habitRow(hb, s, tk, ws));
  }
  left.append(habitsCard);

  /* Tâches */
  const tasksCard = h('div', 'card');
  tasksCard.append(h('div', 'card-title',
    icon('tasks', 15), 'Tâches',
    h('span', 'spacer'),
    h('button', { class: 'btn btn-subtle btn-sm', onclick: () => go('taches') }, 'Tout voir')));
  if (sec.overdue.length) {
    tasksCard.append(h('div', { class: 'task-section-title late' }, 'En retard', h('span', 'n', String(sec.overdue.length))));
    for (const t of sec.overdue) tasksCard.append(taskNode(t));
  }
  if (sec.today.length) {
    tasksCard.append(h('div', 'task-section-title', 'Aujourd’hui'));
    for (const t of sec.today) tasksCard.append(taskNode(t));
  }
  if (!sec.overdue.length && !sec.today.length) {
    const next = [...sec.upcoming, ...sec.someday].slice(0, 3);
    if (next.length) {
      tasksCard.append(h('div', 'task-section-title', 'À suivre'));
      for (const t of next) tasksCard.append(taskNode(t));
    } else {
      tasksCard.append(emptyState('spark', 'Rien à faire pour aujourd’hui', 'Profite, ou note ce qui te trotte dans la tête.'));
    }
  }
  const quickInput = h('input', {
    class: 'input', id: 'today-task-input', 'data-keep': '', maxlength: 200,
    placeholder: 'Ajouter une tâche pour aujourd’hui…',
  });
  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const title = quickInput.value.trim();
      if (!title) return;
      quickInput.value = '';
      apply({ type: 'task.create', task: { id: uid('task'), title, createdAt: Date.now(), due: tk } });
    }
  });
  tasksCard.append(h('div', { class: 'quick-add', style: { marginTop: '12px' } }, quickInput));
  left.append(tasksCard);

  /* Focus */
  right.append(focusCard(s, tk));

  /* Note rapide */
  const noteCard = h('div', 'card');
  noteCard.append(h('div', 'card-title', icon('note', 15), 'Note rapide',
    h('span', 'spacer'),
    h('button', { class: 'btn btn-subtle btn-sm', onclick: () => go('journal') }, 'Journal')));
  const noteInput = h('input', {
    class: 'input', id: 'today-note', 'data-keep': '', maxlength: 2000,
    placeholder: 'Qu’es-tu en train de faire ? (#tag)',
  });
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = noteInput.value.trim();
      if (!text) return;
      noteInput.value = '';
      if (apply({ type: 'journal.add', entry: { id: uid('note'), ts: Date.now(), text } })) toast('Note ajoutée', { ico: 'note' });
    }
  });
  noteCard.append(noteInput);
  const todayNotes = s.journal.filter((e) => L.dayOfTs(e.ts) === tk).sort((a, b) => b.ts - a.ts).slice(0, 3);
  if (todayNotes.length) {
    const list = h('div', { style: { marginTop: '10px', display: 'grid', gap: '2px' } });
    for (const e of todayNotes) {
      list.append(h('div', { class: 'event-row', style: { alignItems: 'center' } },
        h('span', { class: 'muted tnum', style: { fontSize: '12px', flex: 'none' } }, fmtTime(e.ts)),
        h('span', { style: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.text)));
    }
    noteCard.append(list);
  }
  right.append(noteCard);
}

function statTile(ico, lbl, val, unit, cls) {
  return h('div', { class: 'stat-tile' + (cls ? ' ' + cls : '') },
    h('div', 'lbl', icon(ico, 13), lbl),
    h('div', 'val', String(val), unit ? h('small', null, unit) : null));
}

function habitRow(hb, s, tk, ws) {
  const entry = L.habitEntry(s, hb.id, tk);
  const okToday = !!entry && entry.ok !== false;
  const partiel = !!entry && !okToday;
  const streak = L.currentStreak(s, hb, tk, ws);
  const aRattraper = !entry && L.rateDernierJourPrevu(s, hb, tk);
  const aPaliers = Array.isArray(hb.paliers) && hb.paliers.length > 0;
  const quota = aPaliers ? (hb.palier ?? 0) + 1 : 1;
  const nivAtteint = entry ? (entry.niv || (okToday ? quota : 0)) : 0;
  const noyau = aPaliers ? hb.paliers[hb.palier ?? 0] : null;

  const check = h('span', { class: 'habit-check', style: { position: 'relative' } }, icon('check', 14));

  /* échelle des niveaux du jour : cliquer un cran = « voilà où je suis allé » */
  let ladder = null;
  if (aPaliers) {
    ladder = h('span', { class: 'habit-ladder', 'aria-label': 'Niveau atteint aujourd’hui' });
    for (let i = 1; i <= hb.paliers.length; i++) {
      ladder.append(h('button', {
        class: 'ladder-dot' + (i <= nivAtteint ? (i > quota ? ' au-dela' : ' fait') : '') + (i === quota ? ' quota' : ''),
        title: 'Niveau ' + i + (i === quota ? ' (quota du jour)' : '') + ' : ' + hb.paliers[i - 1],
        'aria-label': 'Niveau ' + i + ' : ' + hb.paliers[i - 1],
        onclick: (e) => {
          e.stopPropagation();
          const etaitOk = okToday;
          const cible = i === nivAtteint ? 0 : i;
          if (apply({ type: 'habit.niveau', id: hb.id, date: tk, niv: cible, ts: Date.now() })) {
            if (cible >= quota && !etaitOk) celebrate(hb, check);
            else if (cible > quota) toast('Au-delà du quota : niveau ' + cible + '/' + hb.paliers.length + ' ✨', { ico: 'spark' });
          }
        },
      }));
    }
  }

  /* colonne centrale : nom, noyau (quota), échelle, note du jour */
  const main = h('span', 'habit-main',
    h('span', 'habit-name-line',
      h('span', 'habit-name', hb.name),
      streak.n > 0 ? h('span', { class: 'habit-streak' + (streak.n >= 2 ? ' hot' : '') }, icon('flame', 13), streak.n + ' ' + streak.unit) : null,
      partiel ? h('span', { class: 'nudge partiel', title: 'Présence enregistrée, quota pas encore atteint' }, 'partiel ' + nivAtteint + '/' + hb.paliers.length) : null,
      aRattraper ? h('span', { class: 'nudge', title: 'Raté au dernier jour prévu — ne rate jamais deux fois' }, 'à rattraper') : null,
    ),
    noyau ? h('span', 'habit-core', 'Quota · ' + noyau + (nivAtteint > quota ? '  →  atteint : ' + hb.paliers[nivAtteint - 1] + ' ✨' : '')) : null,
    ladder,
    entry && entry.note ? h('span', 'habit-note-line', icon('note', 11), entry.note) : null,
  );

  /* actions du jour : note + bonus, une fois la coche posée */
  const done = !!entry;
  const extras = h('span', 'habit-extras');
  if (done) {
    extras.append(h('button', {
      class: 'habit-extra' + (entry && entry.note ? ' on' : ''),
      title: entry && entry.note ? 'Modifier la note de réalisation' : 'Noter ce que tu as fait',
      'aria-label': 'Note de réalisation',
      onclick: (e) => { e.stopPropagation(); openHabitNoteModal(hb, tk); },
    }, icon('note', 13)));
    if (hb.bonusTexte) {
      extras.append(h('button', {
        class: 'habit-extra' + (entry && entry.bonus ? ' on bonus' : ''),
        title: (entry && entry.bonus ? 'Bonus fait : ' : 'Bonus : ') + hb.bonusTexte,
        'aria-label': 'Bonus',
        onclick: (e) => {
          e.stopPropagation();
          const avait = entry && entry.bonus;
          if (apply({ type: 'habit.bonusToggle', id: hb.id, date: tk }) && !avait) {
            toast('Bonus fait : ' + hb.bonusTexte + ' ✨', { ico: 'spark' });
          }
        },
      }, icon('spark', 13)));
    }
  }

  const row = h('div', {
    class: 'habit-row' + (okToday ? ' done' : '') + (partiel ? ' partiel' : ''),
    style: { '--hc': hueVar(hb.color) },
    role: 'button', tabindex: 0,
    'aria-pressed': String(okToday),
    'aria-label': hb.name + (okToday ? ' : quota atteint' : partiel ? ' : partiel' : ' : à faire'),
  },
    emojiEl(hb),
    main,
    extras,
    check,
  );
  // Clic sur la ligne = raccourci « quota du jour » : partiel → complété, fait → décoché.
  const toggle = () => {
    const e = L.habitEntry(getState(), hb.id, tk);
    const etaitOk = !!e && e.ok !== false;
    if (aPaliers) {
      const cible = etaitOk ? 0 : quota;
      if (apply({ type: 'habit.niveau', id: hb.id, date: tk, niv: cible, ts: Date.now() }) && !etaitOk) celebrate(hb, check);
    } else {
      if (apply({ type: 'habit.toggle', id: hb.id, date: tk, ts: Date.now() }) && !etaitOk) celebrate(hb, check);
    }
  };
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  return row;
}

function focusCard(s, tk) {
  const card = h('div', 'card');
  card.append(h('div', 'card-title', icon('target', 15), 'Focus'));
  const a = s.activeSession;

  /* ---------- session en cours ---------- */
  if (a) {
    const now = Date.now();
    const pomo = a.mode === 'pomodoro' ? L.pomodoroEtat(a, now) : null;

    let affiche, sousTitre = a.label;
    if (pomo) {
      const r = Math.max(0, pomo.restantMs);
      affiche = String(Math.floor(r / 60000)).padStart(2, '0') + ':' + String(Math.floor((r % 60000) / 1000)).padStart(2, '0');
    } else {
      const ms = now - a.start;
      affiche = String(Math.floor(ms / 60000)).padStart(2, '0') + ':' + String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    }

    card.append(h('div', 'focus-live',
      h('span', 'pulse' + (pomo && pomo.phase === 'pause' ? ' pause' : '')),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', 'row',
          h('span', { class: 'focus-time', id: 'focus-time' }, affiche),
          pomo ? h('span', { class: 'phase-chip ' + pomo.phase },
            pomo.phase === 'travail' ? 'Travail' : 'Pause ☕') : null,
          pomo && pomo.cycles > 0 ? h('span', { class: 'pomo-cycles', title: 'Cycles de travail terminés' }, '🍅 ×' + pomo.cycles) : null,
        ),
        h('div', 'focus-label', sousTitre)),
    ));

    const boutons = h('div', { class: 'row', style: { marginTop: '14px', flexWrap: 'wrap' } });
    if (pomo) {
      boutons.append(h('button', {
        class: 'btn btn-ghost', onclick: () => {
          const versPause = getState().activeSession.phase === 'travail';
          if (apply({ type: 'session.phase', ts: Date.now() })) {
            if (getState().settings.pomoSon !== false) jouerCarillon(versPause ? 'pause' : 'travail');
          }
        },
      }, icon(pomo.phase === 'travail' ? 'clock' : 'play', 15), pomo.phase === 'travail' ? 'Pause maintenant' : 'Reprendre le travail'));
    }
    boutons.append(
      h('button', {
        class: 'btn btn-primary', onclick: () => {
          const act = getState().activeSession;
          const travail = act.mode === 'pomodoro'
            ? act.travailMs + (act.phase === 'travail' ? Date.now() - act.phaseStart : 0)
            : Date.now() - act.start;
          if (travail < 20000) {
            apply({ type: 'session.discard' });
            toast('Session trop courte, ignorée', { ico: 'clock' });
          } else if (apply({ type: 'session.stop', id: uid('sess'), ts: Date.now() })) {
            if (getState().settings.pomoSon !== false && act.mode === 'pomodoro') jouerCarillon('fin');
            toast('Session enregistrée · ' + L.fmtDuration(travail) + (act.mode === 'pomodoro' ? ' de travail' : ''), { ico: 'clock' });
          }
        },
      }, icon('stop', 15), 'Terminer'),
      h('button', { class: 'btn btn-subtle', onclick: () => { apply({ type: 'session.discard' }); } }, 'Abandonner'),
    );
    card.append(boutons);
    return card;
  }

  /* ---------- au repos : session libre + pomodoro réglable ---------- */
  const labels = [...new Set(s.sessions.slice(-30).map((x) => x.label))].reverse().slice(0, 6);
  const labelInput = h('input', {
    class: 'input', id: 'focus-label', 'data-keep': '', maxlength: 120,
    placeholder: 'Sur quoi vas-tu te concentrer ?', list: 'focus-recents',
  });
  const start = () => {
    const label = labelInput.value.trim() || 'Session focus';
    apply({ type: 'session.start', label, ts: Date.now() });
  };
  labelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  card.append(
    h('div', 'quick-add', labelInput, h('button', { class: 'btn btn-primary', onclick: start }, icon('play', 15), 'Démarrer')),
    h('datalist', { id: 'focus-recents' }, labels.map((l) => h('option', { value: l }))),
  );

  /* pomodoro : durées modulables + son doux + notification PC */
  const travail = s.settings.pomoTravail || 25;
  const pause = s.settings.pomoPause || 5;
  const stepper = (valeur, unite, onMoins, onPlus) => h('span', 'pomo-stepper',
    h('button', { class: 'btn btn-icon pomo-btn', 'aria-label': 'Moins', onclick: onMoins }, '−'),
    h('b', 'tnum', String(valeur)),
    h('button', { class: 'btn btn-icon pomo-btn', 'aria-label': 'Plus', onclick: onPlus }, '+'),
    h('span', 'muted', unite));

  const pomoBox = h('div', 'pomo-box');
  pomoBox.append(h('div', 'pomo-titre', '🍅 Pomodoro'));
  pomoBox.append(h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px 16px' } },
    stepper(travail, 'min travail',
      () => apply({ type: 'settings.update', patch: { pomoTravail: Math.max(5, travail - 5) } }),
      () => apply({ type: 'settings.update', patch: { pomoTravail: Math.min(120, travail + 5) } })),
    stepper(pause, 'min pause',
      () => apply({ type: 'settings.update', patch: { pomoPause: Math.max(1, pause - 1) } }),
      () => apply({ type: 'settings.update', patch: { pomoPause: Math.min(60, pause + 1) } })),
    h('button', {
      class: 'btn btn-primary btn-sm', onclick: () => {
        armerAudio(); // geste utilisateur : l'audio a le droit de sonner plus tard
        const label = labelInput.value.trim() || 'Pomodoro';
        apply({ type: 'session.start', label, ts: Date.now(), mode: 'pomodoro', travailMin: travail, pauseMin: pause });
      },
    }, icon('play', 14), 'Lancer'),
  ));
  pomoBox.append(h('div', 'chip-row',
    h('button', {
      class: 'chip' + (s.settings.pomoSon !== false ? ' on' : ''),
      onclick: () => {
        const versOn = s.settings.pomoSon === false;
        apply({ type: 'settings.update', patch: { pomoSon: versOn } });
        if (versOn) { armerAudio(); jouerCarillon('fin'); } // aperçu du son doux
      },
    }, '🔔 son doux'),
    h('button', {
      class: 'chip' + (s.settings.pomoNotif ? ' on' : ''),
      onclick: async () => {
        if (s.settings.pomoNotif) { apply({ type: 'settings.update', patch: { pomoNotif: false } }); return; }
        const perm = await demanderPermissionNotif();
        if (perm === 'granted') {
          apply({ type: 'settings.update', patch: { pomoNotif: true } });
          notifierPC('Notifications activées', 'Trace te préviendra en fin de phase, en douceur.');
        } else {
          toast(perm === 'unsupported' ? 'Notifications non disponibles ici' : 'Autorisation refusée par le navigateur', { ico: 'x' });
        }
      },
    }, '🖥 notification PC'),
  ));
  card.append(pomoBox);

  const totalMs = L.focusToday(s, tk, Date.now());
  if (totalMs > 0) card.append(h('div', 'chart-note', L.fmtDuration(totalMs) + ' de focus aujourd’hui'));
  return card;
}
