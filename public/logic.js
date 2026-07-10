// logic.js — Trace : logique métier pure, partagée serveur (Node) et client (navigateur).
// Aucune dépendance, aucun accès horloge/fichier : tout reçoit ses entrées en paramètres.

export const APP_VERSION = '1.0.0';
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
    settings: { name: '', theme: 'dark', accent: 'violet', weekStart: 1 },
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
      s.habits = s.habits.map((x) => (x.id === h.id ? next : x));
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
      // de l'habitude s'étend (les séries et taux repartent de cette date).
      if (op.date < h.createdDay) {
        s.habits = s.habits.map((x) => (x.id === h.id ? { ...x, createdDay: op.date } : x));
      }
      const day = { ...(s.habitLogs[op.date] || {}) };
      if (day[h.id]) delete day[h.id];
      else day[h.id] = op.ts;
      const logs = { ...s.habitLogs };
      if (Object.keys(day).length) logs[op.date] = day;
      else delete logs[op.date];
      s.habitLogs = logs;
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
      s.tasks = [...s.tasks, {
        id: t.id,
        title: cleanText(t.title, 200),
        notes: isStr(t.notes) ? t.notes.slice(0, 2000) : '',
        project: isStr(t.project) ? t.project.trim().slice(0, 40) : '',
        priority: t.priority || null,
        due: t.due || null,
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
      s.tasks = s.tasks.map((x) => (x.id === t.id ? next : x));
      return s;
    }
    case 'task.complete': {
      const t = findTask(op.id);
      req(isNum(op.ts), 'ts manquant');
      req(!t.completedAt, 'déjà terminée');
      s.tasks = s.tasks.map((x) => (x.id === t.id ? { ...x, completedAt: op.ts } : x));
      return s;
    }
    case 'task.uncomplete': {
      const t = findTask(op.id);
      req(t.completedAt, 'pas terminée');
      s.tasks = s.tasks.map((x) => (x.id === t.id ? { ...x, completedAt: null } : x));
      return s;
    }
    case 'task.delete': {
      findTask(op.id);
      s.tasks = s.tasks.filter((x) => x.id !== op.id);
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
      s.activeSession = { label, taskId, start: op.ts };
      return s;
    }
    case 'session.stop': {
      req(s.activeSession, 'aucune session en cours');
      req(isStr(op.id) && op.id.length >= 8, 'id invalide');
      req(isNum(op.ts) && op.ts > s.activeSession.start, 'ts invalide');
      s.sessions = [...s.sessions, {
        id: op.id,
        label: s.activeSession.label,
        taskId: s.activeSession.taskId,
        start: s.activeSession.start,
        end: op.ts,
      }];
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

function makeHabit(h, order) {
  req(h && typeof h === 'object', 'habitude manquante');
  req(isStr(h.id) && h.id.length >= 8 && h.id.length <= 64, 'id invalide');
  req(isNum(h.createdAt), 'createdAt manquant');
  req(isValidKey(h.createdDay), 'createdDay manquant');
  req(validSchedule(h.schedule), 'fréquence invalide');
  req(isStr(h.emoji) && h.emoji.length <= 8, 'emoji invalide');
  req(HABIT_COLORS.includes(h.color), 'couleur invalide');
  return {
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
}

/* ============================== Habitudes : séries ============================== */

export function habitDoneOn(state, habitId, k) {
  const day = state.habitLogs[k];
  return !!(day && day[habitId]);
}

export function isScheduledDay(habit, k) {
  const sc = habit.schedule;
  if (sc.kind === 'daily') return true;
  if (sc.kind === 'days') return sc.days.includes(weekday(k));
  return true; // weekly : chaque jour peut contribuer au quota
}

function weekCount(state, habitId, weekStartKey) {
  let c = 0;
  for (let i = 0; i < 7; i++) if (habitDoneOn(state, habitId, addDays(weekStartKey, i))) c++;
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
  if (isScheduledDay(habit, k) && !habitDoneOn(state, habit.id, k)) k = addDays(k, -1);
  for (let i = 0; i < 3700; i++) {
    if (k < habit.createdDay) break;
    if (!isScheduledDay(habit, k)) { k = addDays(k, -1); continue; }
    if (habitDoneOn(state, habit.id, k)) { n++; k = addDays(k, -1); }
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
    if (habitDoneOn(state, habit.id, k)) { run++; if (run > best) best = run; }
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
    if (habitDoneOn(state, habit.id, k)) done++;
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
  return weekCount(state, habit.id, weekStartOf(todayK, weekStart)) < sc.target || habitDoneOn(state, habit.id, todayK);
}

/* ============================== Tâches ============================== */

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

export function taskSections(tasks, todayK) {
  const open = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt).sort((a, b) => b.completedAt - a.completedAt);
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
    if (inRange(k)) { const b = get(k); b.sessions++; b.count++; b.focusMs += ssn.end - ssn.start; }
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
  if (state.activeSession && dayOfTs(state.activeSession.start) === todayK) ms += Math.max(0, now - state.activeSession.start);
  return ms;
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
    for (const t of state.tasks) if (t.completedAt) events.push({ kind: 'task', ts: t.completedAt, title: t.title, project: t.project, task: t });
  }
  if (active.includes('habit')) {
    for (const [k, day] of Object.entries(state.habitLogs)) {
      for (const [hid, ts] of Object.entries(day)) {
        const h = habitById[hid];
        if (h) events.push({ kind: 'habit', ts, dateKey: k, title: h.name, habit: h });
      }
    }
  }
  if (active.includes('note')) {
    for (const e of state.journal) events.push({ kind: 'note', ts: e.ts, title: e.text, tags: e.tags, entry: e });
  }
  if (active.includes('session')) {
    for (const ssn of state.sessions) {
      const t = ssn.taskId ? taskById[ssn.taskId] : null;
      events.push({ kind: 'session', ts: ssn.start, title: ssn.label, durationMs: ssn.end - ssn.start, session: ssn, taskTitle: t ? t.title : null });
    }
  }

  let filtered = events;
  if (q) {
    filtered = events.filter((e) => {
      if (e.title && e.title.toLowerCase().includes(q)) return true;
      if (e.project && e.project.toLowerCase().includes(q)) return true;
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
