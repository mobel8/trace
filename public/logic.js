// logic.js — Trace : logique métier pure, partagée serveur (Node) et client (navigateur).
// Aucune dépendance, aucun accès horloge/fichier : tout reçoit ses entrées en paramètres.

export const APP_VERSION = '1.4.0';
export const DAY_MS = 86400000;

/* ============================== Dates (heure LOCALE) ============================== */
// Les clés de jour sont des chaînes 'YYYY-MM-DD' construites en heure locale.
// Jamais toISOString() ici : il convertit en UTC et décale le jour en soirée.

export function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function todayKey(now = new Date()) { return dateKey(now); }
export function dayOfTs(ts) { return dateKey(new Date(ts)); }
export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export function diffDays(a, b) { return Math.round((parseKey(a) - parseKey(b)) / DAY_MS); }
export function weekday(k) { return parseKey(k).getDay(); } // 0 = dimanche
export function weekStartOf(k, weekStart = 1) {
  const delta = (weekday(k) - weekStart + 7) % 7;
  return addDays(k, -delta);
}
export function isValidKey(k) {
  if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  const d = parseKey(k);
  return dateKey(d) === k; // rejette 2026-02-31 etc.
}

/* ============================== État par défaut ============================== */

export function defaultState() {
  return {
    version: 1,
    rev: 0,
    onboarded: false,
    settings: { name: '', theme: 'dark', accent: 'violet', weekStart: 1, pomoTravail: 25, pomoPause: 5, pomoSon: true, pomoNotif: false },
    habits: [],            // { id, name, emoji, color, schedule, createdAt, createdDay, archivedAt, order }
    habitLogs: {},         // { 'YYYY-MM-DD': { habitId: ts } }
    tasks: [],             // { id, title, notes, project, priority, due, createdAt, completedAt }
    journal: [],           // { id, ts, text, tags }
    sessions: [],          // { id, label, taskId, start, end }
    activeSession: null,   // { label, taskId, start }
  };
}

export const ACCENTS = ['violet', 'bleu', 'cyan', 'vert', 'ambre', 'rose'];
export const HABIT_COLORS = ['violet', 'bleu', 'cyan', 'vert', 'jaune', 'orange', 'rose', 'rouge'];
export const PRIORITIES = ['high', 'med', 'low'];

/* ============================== Validation ============================== */

function bad(msg) { const e = new Error('op invalide : ' + msg); e.badOp = true; return e; }
function req(cond, msg) { if (!cond) throw bad(msg); }
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function cleanText(v, max) {
  req(isStr(v), 'texte manquant');
  const t = v.trim();
  req(t.length > 0, 'texte vide');
  req(t.length <= max, 'texte trop long');
  return t;
}

function validSchedule(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.kind === 'daily') return true;
  if (s.kind === 'days') return Array.isArray(s.days) && s.days.length > 0 && s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (s.kind === 'weekly') return Number.isInteger(s.target) && s.target >= 1 && s.target <= 7;
  return false;
}

/* ============================== Réducteur ============================== */
// reduce(state, op) → nouvel état (immutabilité par copie des chemins modifiés).
// Le serveur et le client appliquent EXACTEMENT la même fonction ; les id et
// timestamps voyagent dans l'op pour rester déterministe.

export function reduce(state, op) {
  req(op && typeof op === 'object' && isStr(op.type), 'op sans type');
  const s = { ...state, rev: state.rev + 1 };

  const findHabit = (id) => {
    const h = s.habits.find((h) => h.id === id);
    req(h, 'habitude inconnue');
    return h;
  };
  const findTask = (id) => {
    const t = s.tasks.find((t) => t.id === id);
    req(t, 'tâche inconnue');
    return t;
  };

  switch (op.type) {
    /* ---------- réglages / onboarding ---------- */
    case 'settings.update': {
      const p = op.patch || {};
      const next = { ...s.settings };
      if ('name' in p) { req(isStr(p.name) && p.name.length <= 40, 'nom invalide'); next.name = p.name.trim(); }
      if ('theme' in p) { req(['dark', 'light', 'auto'].includes(p.theme), 'thème invalide'); next.theme = p.theme; }
      if ('accent' in p) { req(ACCENTS.includes(p.accent), 'accent invalide'); next.accent = p.accent; }
      if ('weekStart' in p) { req(p.weekStart === 0 || p.weekStart === 1, 'weekStart invalide'); next.weekStart = p.weekStart; }
      if ('pomoTravail' in p) { req(Number.isInteger(p.pomoTravail) && p.pomoTravail >= 5 && p.pomoTravail <= 120, 'durée de travail invalide'); next.pomoTravail = p.pomoTravail; }
      if ('pomoPause' in p) { req(Number.isInteger(p.pomoPause) && p.pomoPause >= 1 && p.pomoPause <= 60, 'durée de pause invalide'); next.pomoPause = p.pomoPause; }
      if ('pomoSon' in p) { req(typeof p.pomoSon === 'boolean', 'réglage son invalide'); next.pomoSon = p.pomoSon; }
      if ('pomoNotif' in p) { req(typeof p.pomoNotif === 'boolean', 'réglage notification invalide'); next.pomoNotif = p.pomoNotif; }
      s.settings = next;
      return s;
    }
    case 'onboard.complete': {
      req(isStr(op.name) && op.name.length <= 40, 'nom invalide');
      s.settings = { ...s.settings, name: op.name.trim() };
      s.onboarded = true;
      let habits = s.habits;
      if (Array.isArray(op.habits)) {
        req(op.habits.length <= 12, 'trop d’habitudes');
        habits = habits.slice();
        for (const h of op.habits) habits.push(makeHabit(h, habits.length));
      }
      s.habits = habits;
      return s;
    }

    /* ---------- habitudes ---------- */
    case 'habit.create': {
      req(s.habits.filter((h) => !h.archivedAt).length < 30, 'limite d’habitudes atteinte');
      s.habits = [...s.habits, makeHabit(op.habit, s.habits.length)];
      return s;
    }
    case 'habit.update': {
      const h = findHabit(op.id);
      const p = op.patch || {};
      const next = { ...h };
      if ('name' in p) next.name = cleanText(p.name, 60);
      if ('emoji' in p) { req(isStr(p.emoji) && p.emoji.length <= 8, 'emoji invalide'); next.emoji = p.emoji; }
      if ('color' in p) { req(HABIT_COLORS.includes(p.color), 'couleur invalide'); next.color = p.color; }
      if ('schedule' in p) { req(validSchedule(p.schedule), 'fréquence invalide'); next.schedule = p.schedule; }
      if ('paliers' in p) {
        next.paliers = validPaliers(p.paliers);
        if (next.paliers) {
          const idx = Math.min(next.palier ?? 0, next.paliers.length - 1);
          next.palier = Math.max(0, idx);
          if (!next.palierDepuis) next.palierDepuis = h.createdDay;
        } else {
          delete next.palier; delete next.palierDepuis;
        }
      }
      if ('seuilPalier' in p) { req(Number.isInteger(p.seuilPalier) && p.seuilPalier >= 3 && p.seuilPalier <= 30, 'seuil invalide'); next.seuilPalier = p.seuilPalier; }
      if ('bonusTexte' in p) { req(isStr(p.bonusTexte), 'bonus invalide'); next.bonusTexte = p.bonusTexte.trim().slice(0, 120); }
      s.habits = s.habits.map((x) => (x.id === h.id ? next : x));
      return s;
    }
    case 'habit.palierSet': {
      const h = findHabit(op.id);
      req(Array.isArray(h.paliers) && h.paliers.length, 'habitude sans paliers');
      req(Number.isInteger(op.palier) && op.palier >= 0 && op.palier < h.paliers.length, 'palier hors bornes');
      req(isValidKey(op.today), 'jour manquant');
      s.habits = s.habits.map((x) => (x.id === h.id ? { ...x, palier: op.palier, palierDepuis: op.today } : x));
      return s;
    }
    case 'habit.note': {
      const h = findHabit(op.id);
      req(isValidKey(op.date), 'date invalide');
      req(isStr(op.note) && op.note.length <= 300, 'note invalide');
      const entry = habitEntry(s, h.id, op.date);
      req(entry, 'rien de coché ce jour-là');
      const note = op.note.trim();
      const nextEntry = { ...entry };
      if (note) nextEntry.note = note;
      else delete nextEntry.note;
      s.habitLogs = { ...s.habitLogs, [op.date]: { ...s.habitLogs[op.date], [h.id]: nextEntry } };
      return s;
    }
    case 'habit.bonusToggle': {
      const h = findHabit(op.id);
      req(isValidKey(op.date), 'date invalide');
      const entry = habitEntry(s, h.id, op.date);
      req(entry, 'rien de coché ce jour-là');
      const nextEntry = { ...entry };
      if (nextEntry.bonus) delete nextEntry.bonus;
      else nextEntry.bonus = true;
      s.habitLogs = { ...s.habitLogs, [op.date]: { ...s.habitLogs[op.date], [h.id]: nextEntry } };
      return s;
    }
    case 'habit.archive': {
      const h = findHabit(op.id);
      req(isNum(op.ts), 'ts manquant');
      s.habits = s.habits.map((x) => (x.id === h.id ? { ...x, archivedAt: op.ts } : x));
      return s;
    }
    case 'habit.unarchive': {
      const h = findHabit(op.id);
      s.habits = s.habits.map((x) => (x.id === h.id ? { ...x, archivedAt: null } : x));
      return s;
    }
    case 'habit.delete': {
      findHabit(op.id);
      s.habits = s.habits.filter((x) => x.id !== op.id);
      const logs = {};
      for (const [k, m] of Object.entries(s.habitLogs)) {
        if (!m[op.id]) { logs[k] = m; continue; }
        const rest = { ...m };
        delete rest[op.id];
        if (Object.keys(rest).length) logs[k] = rest;
      }
      s.habitLogs = logs;
      return s;
    }
    case 'habit.toggle': {
      const h = findHabit(op.id);
      req(isValidKey(op.date), 'date invalide');
      req(isNum(op.ts), 'ts manquant');
      // Cocher avant la date de création = rattraper le passé : l'historique
      // de l'habitude s'étend (les séries, taux ET la consolidation du palier
      // courant repartent de cette date).
      if (op.date < h.createdDay || (h.palierDepuis && op.date < h.palierDepuis)) {
        s.habits = s.habits.map((x) => (x.id === h.id ? {
          ...x,
          createdDay: op.date < x.createdDay ? op.date : x.createdDay,
          ...(x.palierDepuis && op.date < x.palierDepuis ? { palierDepuis: op.date } : {}),
        } : x));
      }
      const day = { ...(s.habitLogs[op.date] || {}) };
      if (day[h.id]) delete day[h.id];
      else {
        // Habitude à paliers : la coche simple vaut « quota du jour atteint ».
        const entry = { t: op.ts };
        if (Array.isArray(h.paliers) && h.paliers.length) {
          entry.niv = (h.palier ?? 0) + 1;
          entry.ok = true;
        }
        day[h.id] = entry;
      }
      const logs = { ...s.habitLogs };
      if (Object.keys(day).length) logs[op.date] = day;
      else delete logs[op.date];
      s.habitLogs = logs;
      return s;
    }
    case 'habit.niveau': {
      // Niveau réellement atteint ce jour-là (peut être sous ou au-delà du quota).
      const h = findHabit(op.id);
      req(Array.isArray(h.paliers) && h.paliers.length, 'habitude sans paliers');
      req(isValidKey(op.date), 'date invalide');
      req(Number.isInteger(op.niv) && op.niv >= 0 && op.niv <= h.paliers.length, 'niveau hors bornes');
      req(isNum(op.ts), 'ts manquant');
      if (op.niv > 0 && (op.date < h.createdDay || (h.palierDepuis && op.date < h.palierDepuis))) {
        s.habits = s.habits.map((x) => (x.id === h.id ? {
          ...x,
          createdDay: op.date < x.createdDay ? op.date : x.createdDay,
          ...(x.palierDepuis && op.date < x.palierDepuis ? { palierDepuis: op.date } : {}),
        } : x));
      }
      const jour = { ...(s.habitLogs[op.date] || {}) };
      if (op.niv === 0) {
        delete jour[h.id];
      } else {
        const prev = habitEntry(s, h.id, op.date) || {};
        const entry = { t: prev.t || op.ts, niv: op.niv, ok: op.niv >= (h.palier ?? 0) + 1 };
        if (prev.note) entry.note = prev.note;
        if (prev.bonus) entry.bonus = true;
        jour[h.id] = entry;
      }
      const logs2 = { ...s.habitLogs };
      if (Object.keys(jour).length) logs2[op.date] = jour;
      else delete logs2[op.date];
      s.habitLogs = logs2;
      return s;
    }

    /* ---------- tâches ---------- */
    case 'task.create': {
      const t = op.task || {};
      req(isStr(t.id) && t.id.length >= 8 && t.id.length <= 64, 'id invalide');
      req(!s.tasks.some((x) => x.id === t.id), 'id déjà utilisé');
      req(isNum(t.createdAt), 'createdAt manquant');
      req(t.due == null || isValidKey(t.due), 'échéance invalide');
      req(t.priority == null || PRIORITIES.includes(t.priority), 'priorité invalide');
      let parentId = null;
      if (t.parentId != null) {
        const parent = s.tasks.find((x) => x.id === t.parentId);
        req(parent, 'tâche parente inconnue');
        req(!parent.completedAt, 'la tâche parente est terminée');
        req(taskDepth(s.tasks, parent) < MAX_TASK_DEPTH, 'profondeur maximale atteinte (' + (MAX_TASK_DEPTH + 1) + ' niveaux)');
        parentId = t.parentId;
      }
      s.tasks = [...s.tasks, {
        id: t.id,
        title: cleanText(t.title, 200),
        notes: isStr(t.notes) ? t.notes.slice(0, 2000) : '',
        project: isStr(t.project) ? t.project.trim().slice(0, 40) : '',
        priority: t.priority || null,
        due: t.due || null,
        parentId,
        createdAt: t.createdAt,
        completedAt: null,
      }];
      return s;
    }
    case 'task.update': {
      const t = findTask(op.id);
      const p = op.patch || {};
      const next = { ...t };
      if ('title' in p) next.title = cleanText(p.title, 200);
      if ('notes' in p) { req(isStr(p.notes), 'notes invalides'); next.notes = p.notes.slice(0, 2000); }
      if ('project' in p) { req(isStr(p.project), 'projet invalide'); next.project = p.project.trim().slice(0, 40); }
      if ('priority' in p) { req(p.priority == null || PRIORITIES.includes(p.priority), 'priorité invalide'); next.priority = p.priority || null; }
      if ('due' in p) { req(p.due == null || isValidKey(p.due), 'échéance invalide'); next.due = p.due || null; }
      if ('parentId' in p) {
        if (p.parentId == null) next.parentId = null;
        else {
          req(p.parentId !== t.id, 'une tâche ne peut pas être sa propre parente');
          const parent = s.tasks.find((x) => x.id === p.parentId);
          req(parent, 'tâche parente inconnue');
          req(!parent.completedAt, 'la tâche parente est terminée');
          req(!subtreeIds(s.tasks, t.id).includes(p.parentId), 'impossible : la cible est une sous-tâche de celle-ci');
          req(taskDepth(s.tasks, parent) + 1 + subtreeHeight(s.tasks, t.id) <= MAX_TASK_DEPTH,
            'profondeur maximale atteinte (' + (MAX_TASK_DEPTH + 1) + ' niveaux)');
          next.parentId = p.parentId;
        }
      }
      s.tasks = s.tasks.map((x) => (x.id === t.id ? next : x));
      return s;
    }
    case 'task.complete': {
      const t = findTask(op.id);
      req(isNum(op.ts), 'ts manquant');
      req(!t.completedAt, 'déjà terminée');
      // Terminer un « dossier » termine tout son contenu encore ouvert.
      const ids = new Set([t.id, ...subtreeIds(s.tasks, t.id)]);
      s.tasks = s.tasks.map((x) => (ids.has(x.id) && !x.completedAt ? { ...x, completedAt: op.ts } : x));
      return s;
    }
    case 'task.uncomplete': {
      const t = findTask(op.id);
      req(t.completedAt, 'pas terminée');
      // Rouvrir une sous-tâche rouvre ses parents terminés (sinon elle serait invisible).
      const revive = new Set([t.id]);
      let cur = t;
      for (let i = 0; i < 8 && cur.parentId; i++) {
        const parent = s.tasks.find((x) => x.id === cur.parentId);
        if (!parent) break;
        if (parent.completedAt) revive.add(parent.id);
        cur = parent;
      }
      s.tasks = s.tasks.map((x) => (revive.has(x.id) ? { ...x, completedAt: null } : x));
      return s;
    }
    case 'task.delete': {
      findTask(op.id);
      // Suppression en cascade : le dossier part avec son contenu.
      const ids = new Set([op.id, ...subtreeIds(s.tasks, op.id)]);
      s.tasks = s.tasks.filter((x) => !ids.has(x.id));
      return s;
    }

    /* ---------- journal ---------- */
    case 'journal.add': {
      const e = op.entry || {};
      req(isStr(e.id) && e.id.length >= 8, 'id invalide');
      req(!s.journal.some((x) => x.id === e.id), 'id déjà utilisé');
      req(isNum(e.ts), 'ts manquant');
      const text = cleanText(e.text, 2000);
      s.journal = [...s.journal, { id: e.id, ts: e.ts, text, tags: parseTags(text) }];
      return s;
    }
    case 'journal.update': {
      const e = s.journal.find((x) => x.id === op.id);
      req(e, 'note inconnue');
      const text = cleanText((op.patch || {}).text, 2000);
      s.journal = s.journal.map((x) => (x.id === e.id ? { ...x, text, tags: parseTags(text) } : x));
      return s;
    }
    case 'journal.delete': {
      req(s.journal.some((x) => x.id === op.id), 'note inconnue');
      s.journal = s.journal.filter((x) => x.id !== op.id);
      return s;
    }

    /* ---------- sessions focus ---------- */
    case 'session.start': {
      req(!s.activeSession, 'session déjà en cours');
      req(isNum(op.ts), 'ts manquant');
      const label = cleanText(op.label, 120);
      const taskId = op.taskId && s.tasks.some((t) => t.id === op.taskId) ? op.taskId : null;
      const session = { label, taskId, start: op.ts };
      if (op.mode === 'pomodoro') {
        req(Number.isInteger(op.travailMin) && op.travailMin >= 5 && op.travailMin <= 120, 'durée de travail invalide');
        req(Number.isInteger(op.pauseMin) && op.pauseMin >= 1 && op.pauseMin <= 60, 'durée de pause invalide');
        session.mode = 'pomodoro';
        session.travailMin = op.travailMin;
        session.pauseMin = op.pauseMin;
        session.phase = 'travail';
        session.phaseStart = op.ts;
        session.travailMs = 0;   // temps de TRAVAIL accumulé (les pauses ne comptent pas)
        session.cycles = 0;      // 🍅 phases de travail terminées
      }
      s.activeSession = session;
      return s;
    }
    case 'session.phase': {
      // Bascule travail ⇄ pause (auto en fin de phase, ou manuelle).
      const a = s.activeSession;
      req(a && a.mode === 'pomodoro', 'aucun pomodoro en cours');
      req(isNum(op.ts) && op.ts >= a.phaseStart, 'ts invalide');
      if (a.phase === 'travail') {
        s.activeSession = { ...a, phase: 'pause', phaseStart: op.ts, travailMs: a.travailMs + (op.ts - a.phaseStart), cycles: a.cycles + 1 };
      } else {
        s.activeSession = { ...a, phase: 'travail', phaseStart: op.ts };
      }
      return s;
    }
    case 'session.stop': {
      req(s.activeSession, 'aucune session en cours');
      req(isStr(op.id) && op.id.length >= 8, 'id invalide');
      req(isNum(op.ts) && op.ts > s.activeSession.start, 'ts invalide');
      const a = s.activeSession;
      const entry = { id: op.id, label: a.label, taskId: a.taskId, start: a.start, end: op.ts };
      if (a.mode === 'pomodoro') {
        entry.travailMs = a.travailMs + (a.phase === 'travail' ? Math.max(0, op.ts - a.phaseStart) : 0);
        // 🍅 = phase de travail COMPLÈTE : la tranche finale ne compte que si elle atteint la durée prévue.
        entry.cycles = a.cycles + (a.phase === 'travail' && op.ts - a.phaseStart >= a.travailMin * 60000 ? 1 : 0);
      }
      s.sessions = [...s.sessions, entry];
      s.activeSession = null;
      return s;
    }
    case 'session.discard': {
      req(s.activeSession, 'aucune session en cours');
      s.activeSession = null;
      return s;
    }
    case 'session.delete': {
      req(s.sessions.some((x) => x.id === op.id), 'session inconnue');
      s.sessions = s.sessions.filter((x) => x.id !== op.id);
      return s;
    }

    default:
      throw bad('type inconnu « ' + op.type + ' »');
  }
}

// Paliers : le « noyau » de l'habitude à chaque étape (du plus petit au complet).
function validPaliers(v) {
  if (v == null) return null;
  req(Array.isArray(v) && v.length >= 1 && v.length <= 6, 'paliers : 1 à 6 étapes');
  const out = v.map((x) => { req(isStr(x), 'palier invalide'); return x.trim().slice(0, 120); }).filter(Boolean);
  req(out.length >= 1, 'paliers vides');
  return out;
}

function makeHabit(h, order) {
  req(h && typeof h === 'object', 'habitude manquante');
  req(isStr(h.id) && h.id.length >= 8 && h.id.length <= 64, 'id invalide');
  req(isNum(h.createdAt), 'createdAt manquant');
  req(isValidKey(h.createdDay), 'createdDay manquant');
  req(validSchedule(h.schedule), 'fréquence invalide');
  req(isStr(h.emoji) && h.emoji.length <= 8, 'emoji invalide'); // '' = pastille neutre
  req(HABIT_COLORS.includes(h.color), 'couleur invalide');
  const paliers = validPaliers(h.paliers);
  const out = {
    id: h.id,
    name: cleanText(h.name, 60),
    emoji: h.emoji,
    color: h.color,
    schedule: h.schedule,
    createdAt: h.createdAt,
    createdDay: h.createdDay,
    archivedAt: null,
    order,
  };
  if (paliers) {
    out.paliers = paliers;
    out.palier = 0;
    out.palierDepuis = h.createdDay;
    out.seuilPalier = Number.isInteger(h.seuilPalier) && h.seuilPalier >= 3 && h.seuilPalier <= 30 ? h.seuilPalier : 7;
  }
  if (isStr(h.bonusTexte) && h.bonusTexte.trim()) out.bonusTexte = h.bonusTexte.trim().slice(0, 120);
  return out;
}

/* ============================== Habitudes : séries ============================== */

// Entrée normalisée d'une coche : les anciennes données stockaient un simple ts,
// les nouvelles un objet { t, note?, bonus? }. On lit les deux.
export function habitEntry(state, habitId, k) {
  const day = state.habitLogs[k];
  if (!day) return null;
  const v = day[habitId];
  if (!v) return null;
  return typeof v === 'object' ? v : { t: v };
}

// Présence : quelque chose a été fait ce jour-là (même en dessous du quota).
export function habitDoneOn(state, habitId, k) {
  return !!habitEntry(state, habitId, k);
}

// Quota atteint : la coche « compte » pour la série et les taux.
// entry.ok est figé AU MOMENT de la coche (pas de révision quand le palier bouge) ;
// absent (anciennes données ou habitude sans paliers) = quota atteint.
export function habitOkOn(state, habitId, k) {
  const e = habitEntry(state, habitId, k);
  return !!e && e.ok !== false;
}

// Niveau atteint ce jour-là (1-based), pour les habitudes à paliers.
export function habitNivOn(state, habitId, k) {
  const e = habitEntry(state, habitId, k);
  return e ? (e.niv || null) : null;
}

// Dépassements récents : jours où le niveau atteint excède le quota courant.
export function depassements(state, habit, todayK, jours = 14) {
  if (!Array.isArray(habit.paliers)) return 0;
  const quota = (habit.palier ?? 0) + 1;
  let n = 0;
  for (let k = addDays(todayK, -(jours - 1)); k <= todayK; k = addDays(k, 1)) {
    const niv = habitNivOn(state, habit.id, k);
    if (niv && niv > quota) n++;
  }
  return n;
}

// Nombre de coches depuis le début du palier courant (consolidation).
export function reussitesAuPalier(state, habit, todayK) {
  if (!Array.isArray(habit.paliers) || !habit.paliers.length) return null;
  const from = habit.palierDepuis || habit.createdDay;
  let n = 0;
  for (let k = from; k <= todayK; k = addDays(k, 1)) {
    if (habitOkOn(state, habit.id, k)) n++;
  }
  return n;
}

export function pretAMonter(state, habit, todayK) {
  if (!Array.isArray(habit.paliers)) return false;
  if ((habit.palier ?? 0) >= habit.paliers.length - 1) return false;
  return reussitesAuPalier(state, habit, todayK) >= (habit.seuilPalier || 7);
}

// Jalons de série à célébrer (66 j = médiane d'automatisation, Lally et al. 2010).
export const JALONS = [7, 14, 30, 66, 100, 200, 365];
export const estJalon = (n) => JALONS.includes(n);

// « Ne rate jamais deux fois » : le dernier jour PRÉVU avant aujourd'hui a été raté.
export function rateDernierJourPrevu(state, habit, todayK) {
  if (habit.schedule.kind === 'weekly') return false;
  for (let i = 1; i <= 7; i++) {
    const k = addDays(todayK, -i);
    if (k < habit.createdDay) return false;
    if (!isScheduledDay(habit, k)) continue;
    return !habitOkOn(state, habit.id, k);
  }
  return false;
}

// Nombre de bonus (✨) sur les 30 derniers jours.
export function bonus30j(state, habit, todayK) {
  let n = 0;
  for (let k = addDays(todayK, -29); k <= todayK; k = addDays(k, 1)) {
    const e = habitEntry(state, habit.id, k);
    if (e && e.bonus) n++;
  }
  return n;
}

export function isScheduledDay(habit, k) {
  const sc = habit.schedule;
  if (sc.kind === 'daily') return true;
  if (sc.kind === 'days') return sc.days.includes(weekday(k));
  return true; // weekly : chaque jour peut contribuer au quota
}

function weekCount(state, habitId, weekStartKey) {
  let c = 0;
  for (let i = 0; i < 7; i++) if (habitOkOn(state, habitId, addDays(weekStartKey, i))) c++;
  return c;
}

// Série en cours. Convention : le jour (ou la semaine) courant encore « en attente »
// ne casse pas la série ; il l'allonge seulement une fois fait.
export function currentStreak(state, habit, todayK, weekStart = 1) {
  if (habit.schedule.kind === 'weekly') {
    const target = habit.schedule.target;
    let n = 0;
    let wk = weekStartOf(todayK, weekStart);
    if (weekCount(state, habit.id, wk) >= target) n++;
    wk = addDays(wk, -7);
    for (let i = 0; i < 530; i++) {
      if (addDays(wk, 6) < habit.createdDay) break;
      if (weekCount(state, habit.id, wk) >= target) { n++; wk = addDays(wk, -7); }
      else break;
    }
    return { n, unit: 'sem.' };
  }
  let n = 0;
  let k = todayK;
  if (isScheduledDay(habit, k) && !habitOkOn(state, habit.id, k)) k = addDays(k, -1);
  for (let i = 0; i < 3700; i++) {
    if (k < habit.createdDay) break;
    if (!isScheduledDay(habit, k)) { k = addDays(k, -1); continue; }
    if (habitOkOn(state, habit.id, k)) { n++; k = addDays(k, -1); }
    else break;
  }
  return { n, unit: 'j' };
}

export function bestStreak(state, habit, todayK, weekStart = 1) {
  if (habit.schedule.kind === 'weekly') {
    const target = habit.schedule.target;
    let best = 0, run = 0;
    const lastWk = weekStartOf(todayK, weekStart);
    for (let wk = weekStartOf(habit.createdDay, weekStart); wk <= lastWk; wk = addDays(wk, 7)) {
      if (weekCount(state, habit.id, wk) >= target) { run++; if (run > best) best = run; }
      else if (wk !== lastWk) run = 0; // semaine courante incomplète : n'annule pas
    }
    return { n: best, unit: 'sem.' };
  }
  let best = 0, run = 0;
  for (let k = habit.createdDay; k <= todayK; k = addDays(k, 1)) {
    if (!isScheduledDay(habit, k)) continue;
    if (habitOkOn(state, habit.id, k)) { run++; if (run > best) best = run; }
    else if (k !== todayK) run = 0; // aujourd'hui pas encore fait : pas un échec
  }
  return { n: best, unit: habit.schedule.kind === 'weekly' ? 'sem.' : 'j' };
}

// Taux de complétion sur ~30 jours, borné à la date de création. null si rien d'exigible.
export function completionRate(state, habit, todayK, weekStart = 1) {
  if (habit.schedule.kind === 'weekly') {
    const target = habit.schedule.target;
    let done = 0, expected = 0;
    let wk = weekStartOf(todayK, weekStart);
    for (let i = 0; i < 4; i++) {
      if (addDays(wk, 6) < habit.createdDay) break;
      done += Math.min(weekCount(state, habit.id, wk), target);
      expected += target;
      wk = addDays(wk, -7);
    }
    return expected ? done / expected : null;
  }
  let done = 0, expected = 0;
  const from = addDays(todayK, -29);
  for (let k = from < habit.createdDay ? habit.createdDay : from; k <= todayK; k = addDays(k, 1)) {
    if (!isScheduledDay(habit, k)) continue;
    expected++;
    if (habitOkOn(state, habit.id, k)) done++;
  }
  return expected ? done / expected : null;
}

// « À faire aujourd'hui ? » — pour la carte du jour.
// weekly : proposé tant que le quota de la semaine n'est pas atteint.
export function habitDueToday(state, habit, todayK, weekStart = 1) {
  if (habit.archivedAt) return false;
  const sc = habit.schedule;
  if (sc.kind === 'daily') return true;
  if (sc.kind === 'days') return sc.days.includes(weekday(todayK));
  return weekCount(state, habit.id, weekStartOf(todayK, weekStart)) < sc.target || habitOkOn(state, habit.id, todayK);
}

/* ============================== Tâches ============================== */

// Profondeur maximale d'imbrication (0 = racine) : 4 niveaux au total.
export const MAX_TASK_DEPTH = 3;

export function taskChildren(tasks, id) {
  return tasks.filter((t) => t.parentId === id).sort((a, b) => a.createdAt - b.createdAt);
}

export function taskDepth(tasks, t) {
  let d = 0, cur = t;
  for (let i = 0; i < 8 && cur && cur.parentId; i++) {
    cur = tasks.find((x) => x.id === cur.parentId);
    if (cur) d++;
  }
  return d;
}

// Tous les descendants (la tâche elle-même exclue).
export function subtreeIds(tasks, id) {
  const out = [];
  const stack = [id];
  while (stack.length && out.length < 500) {
    const cur = stack.pop();
    for (const t of tasks) if (t.parentId === cur) { out.push(t.id); stack.push(t.id); }
  }
  return out;
}

// Hauteur du sous-arbre (0 = feuille).
export function subtreeHeight(tasks, id) {
  const kids = tasks.filter((t) => t.parentId === id);
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(tasks, k.id)));
}

// Avancement des enfants DIRECTS d'une tâche.
export function taskProgress(tasks, id) {
  const kids = tasks.filter((t) => t.parentId === id);
  return { done: kids.filter((k) => k.completedAt).length, total: kids.length };
}

const PRIO_RANK = { high: 0, med: 1, low: 2 };
function taskSort(a, b) {
  const pa = a.priority ? PRIO_RANK[a.priority] : 3;
  const pb = b.priority ? PRIO_RANK[b.priority] : 3;
  if (pa !== pb) return pa - pb;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return a.createdAt - b.createdAt;
}

// Les sections ne classent que les tâches RACINES : les sous-tâches vivent
// sous leur parente, où qu'elle soit affichée (modèle « dossier »).
export function taskSections(tasks, todayK) {
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const isRoot = (t) => !t.parentId || !byId[t.parentId];
  const open = tasks.filter((t) => !t.completedAt && isRoot(t));
  const done = tasks.filter((t) => t.completedAt && isRoot(t)).sort((a, b) => b.completedAt - a.completedAt);
  const overdue = open.filter((t) => t.due && t.due < todayK).sort(taskSort);
  const today = open.filter((t) => t.due === todayK).sort(taskSort);
  const upcoming = open.filter((t) => t.due && t.due > todayK).sort(taskSort);
  const someday = open.filter((t) => !t.due).sort(taskSort);
  return { overdue, today, upcoming, someday, done };
}

export function projectsOf(tasks) {
  const set = new Set();
  for (const t of tasks) if (t.project) set.add(t.project);
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/* ============================== Journal ============================== */

export function parseTags(text) {
  const out = [];
  const re = /(^|\s)#([\p{L}\p{N}_-]{1,30})/gu;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[2].toLowerCase();
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/* ============================== Agrégats / historique ============================== */

// Carte d'activité par jour sur [fromK..toK] : compte habitudes cochées, tâches
// terminées, notes, sessions + temps focus. Sert au heatmap et à l'élan global.
export function activityByDay(state, fromK, toK) {
  const map = {};
  const get = (k) => (map[k] || (map[k] = { habits: 0, tasks: 0, notes: 0, sessions: 0, focusMs: 0, count: 0 }));
  const inRange = (k) => k >= fromK && k <= toK;

  for (const [k, day] of Object.entries(state.habitLogs)) {
    if (!inRange(k)) continue;
    const n = Object.keys(day).length;
    if (n) { const b = get(k); b.habits += n; b.count += n; }
  }
  for (const t of state.tasks) {
    if (!t.completedAt) continue;
    const k = dayOfTs(t.completedAt);
    if (inRange(k)) { const b = get(k); b.tasks++; b.count++; }
  }
  for (const e of state.journal) {
    const k = dayOfTs(e.ts);
    if (inRange(k)) { const b = get(k); b.notes++; b.count++; }
  }
  for (const ssn of state.sessions) {
    const k = dayOfTs(ssn.start);
    // pomodoro : seules les phases de TRAVAIL comptent comme focus
    if (inRange(k)) { const b = get(k); b.sessions++; b.count++; b.focusMs += ssn.travailMs ?? (ssn.end - ssn.start); }
  }
  return map;
}

// Élan : jours consécutifs avec au moins une activité (aujourd'hui en attente ne casse pas).
export function momentum(state, todayK) {
  const from = addDays(todayK, -400);
  const act = activityByDay(state, from, todayK);
  let n = 0;
  let k = todayK;
  if (!act[k]) k = addDays(k, -1);
  while (k >= from && act[k]) { n++; k = addDays(k, -1); }
  return n;
}

export function focusToday(state, todayK, now) {
  const act = activityByDay(state, todayK, todayK);
  let ms = (act[todayK] && act[todayK].focusMs) || 0;
  const a = state.activeSession;
  if (a && dayOfTs(a.start) === todayK) {
    if (a.mode === 'pomodoro') ms += a.travailMs + (a.phase === 'travail' ? Math.max(0, now - a.phaseStart) : 0);
    else ms += Math.max(0, now - a.start);
  }
  return ms;
}

// État courant d'un pomodoro actif : durée de la phase, restant, dépassement.
export function pomodoroEtat(a, now) {
  if (!a || a.mode !== 'pomodoro') return null;
  const durMs = (a.phase === 'travail' ? a.travailMin : a.pauseMin) * 60000;
  const ecoule = Math.max(0, now - a.phaseStart);
  return { phase: a.phase, durMs, ecouleMs: ecoule, restantMs: durMs - ecoule, cycles: a.cycles };
}

// Fil unifié pour l'Historique : événements par jour, du plus récent au plus ancien.
// types : sous-ensemble de ['task','habit','note','session'] ; query : recherche plein texte.
export function timeline(state, { types, query, todayK, days = 14, beforeK = null } = {}) {
  const active = types && types.length ? types : ['task', 'habit', 'note', 'session'];
  const q = (query || '').trim().toLowerCase();
  const habitById = Object.fromEntries(state.habits.map((h) => [h.id, h]));
  const taskById = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
  const events = [];

  if (active.includes('task')) {
    for (const t of state.tasks) {
      if (!t.completedAt) continue;
      const parent = t.parentId ? taskById[t.parentId] : null;
      events.push({ kind: 'task', ts: t.completedAt, title: t.title, project: t.project, parentTitle: parent ? parent.title : null, task: t });
    }
  }
  if (active.includes('habit')) {
    for (const [k, day] of Object.entries(state.habitLogs)) {
      for (const [hid, v] of Object.entries(day)) {
        const h = habitById[hid];
        if (!h) continue;
        const e = typeof v === 'object' ? v : { t: v };
        events.push({ kind: 'habit', ts: e.t, dateKey: k, title: h.name, habit: h, note: e.note || null, bonus: !!e.bonus, niv: e.niv || null, ok: e.ok !== false });
      }
    }
  }
  if (active.includes('note')) {
    for (const e of state.journal) events.push({ kind: 'note', ts: e.ts, title: e.text, tags: e.tags, entry: e });
  }
  if (active.includes('session')) {
    for (const ssn of state.sessions) {
      const t = ssn.taskId ? taskById[ssn.taskId] : null;
      events.push({
        kind: 'session', ts: ssn.start, title: ssn.label,
        durationMs: ssn.travailMs ?? (ssn.end - ssn.start),
        cycles: ssn.cycles || 0,
        session: ssn, taskTitle: t ? t.title : null,
      });
    }
  }

  let filtered = events;
  if (q) {
    filtered = events.filter((e) => {
      if (e.title && e.title.toLowerCase().includes(q)) return true;
      if (e.project && e.project.toLowerCase().includes(q)) return true;
      if (e.note && e.note.toLowerCase().includes(q)) return true;
      if (e.tags && e.tags.some((t) => ('#' + t).includes(q) || t.includes(q))) return true;
      return false;
    });
  }

  const byDay = {};
  for (const e of filtered) {
    const k = e.kind === 'habit' ? e.dateKey : dayOfTs(e.ts);
    (byDay[k] || (byDay[k] = [])).push(e);
  }
  let keys = Object.keys(byDay).sort().reverse();
  if (beforeK) keys = keys.filter((k) => k < beforeK);
  const pageKeys = keys.slice(0, days);
  const hasMore = keys.length > days;

  const groups = pageKeys.map((k) => {
    const list = byDay[k].sort((a, b) => b.ts - a.ts);
    const sum = { tasks: 0, habits: 0, notes: 0, focusMs: 0 };
    for (const e of list) {
      if (e.kind === 'task') sum.tasks++;
      else if (e.kind === 'habit') sum.habits++;
      else if (e.kind === 'note') sum.notes++;
      else if (e.kind === 'session') sum.focusMs += e.durationMs;
    }
    return { dateKey: k, events: list, summary: sum };
  });

  return { groups, hasMore, nextBefore: pageKeys.length ? pageKeys[pageKeys.length - 1] : null };
}

/* ============================== Bilan (stats) ============================== */

// Tâches terminées par semaine, sur nWeeks semaines finissant la semaine courante.
export function tasksPerWeek(state, todayK, nWeeks = 10, weekStart = 1) {
  const out = [];
  let wk = weekStartOf(todayK, weekStart);
  for (let i = 0; i < nWeeks; i++) { out.unshift({ weekKey: wk, count: 0 }); wk = addDays(wk, -7); }
  const idx = Object.fromEntries(out.map((o, i) => [o.weekKey, i]));
  for (const t of state.tasks) {
    if (!t.completedAt) continue;
    const wkK = weekStartOf(dayOfTs(t.completedAt), weekStart);
    if (wkK in idx) out[idx[wkK]].count++;
  }
  return out;
}

// Minutes de focus par jour sur nDays jours finissant aujourd'hui.
export function focusPerDay(state, todayK, nDays = 14) {
  const from = addDays(todayK, -(nDays - 1));
  const act = activityByDay(state, from, todayK);
  const out = [];
  for (let k = from; k <= todayK; k = addDays(k, 1)) {
    out.push({ dateKey: k, focusMs: (act[k] && act[k].focusMs) || 0 });
  }
  return out;
}

/* ============================== Formatage ============================== */

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? h + ' h ' + String(rm).padStart(2, '0') : h + ' h';
}

export function fmtDurationShort(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? h + 'h' + String(rm).padStart(2, '0') : h + 'h';
}
