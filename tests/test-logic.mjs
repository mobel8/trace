// Tests unitaires de public/logic.js — exécuter : node tests/test-logic.mjs
import assert from 'node:assert/strict';
import {
  dateKey, parseKey, todayKey, addDays, diffDays, weekday, weekStartOf, isValidKey, dayOfTs,
  defaultState, reduce,
  habitDoneOn, isScheduledDay, currentStreak, bestStreak, completionRate, habitDueToday,
  taskSections, projectsOf, parseTags,
  activityByDay, momentum, focusToday, timeline, tasksPerWeek, focusPerDay,
  fmtDuration, fmtDurationShort,
} from '../public/logic.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name); console.error(e); process.exit(1); }
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; assert.equal(e.badOp, true, 'devrait être une erreur badOp: ' + e.message); }
  assert.ok(threw, 'aurait dû lever : ' + msg);
}

const TS = (k, h = 12, m = 0) => { const d = parseKey(k); d.setHours(h, m, 0, 0); return d.getTime(); };
const TODAY = '2026-07-10'; // vendredi

console.log('— dates —');
ok('dateKey/parseKey aller-retour', () => {
  for (const k of ['2026-01-01', '2026-02-28', '2026-12-31', '2024-02-29']) assert.equal(dateKey(parseKey(k)), k);
});
ok('addDays franchit mois et année', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});
ok('addDays traverse les changements d\'heure (DST Europe)', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // passage heure d'été 29/03
  assert.equal(addDays('2026-10-24', 2), '2026-10-26'); // retour heure d'hiver 25/10
  assert.equal(diffDays('2026-03-30', '2026-03-28'), 2);
  assert.equal(diffDays('2026-10-26', '2026-10-24'), 2);
});
ok('weekStartOf lundi et dimanche', () => {
  assert.equal(weekday(TODAY), 5); // vendredi
  assert.equal(weekStartOf(TODAY, 1), '2026-07-06'); // lundi
  assert.equal(weekStartOf(TODAY, 0), '2026-07-05'); // dimanche
  assert.equal(weekStartOf('2026-07-06', 1), '2026-07-06'); // déjà lundi
});
ok('isValidKey rejette les dates impossibles', () => {
  assert.ok(isValidKey('2026-07-10'));
  assert.ok(!isValidKey('2026-02-31'));
  assert.ok(!isValidKey('2026-13-01'));
  assert.ok(!isValidKey('abc'));
  assert.ok(!isValidKey(42));
});
ok('dayOfTs utilise l\'heure locale', () => {
  const d = new Date(2026, 6, 10, 23, 59); // 23h59 locale → même jour
  assert.equal(dayOfTs(d.getTime()), '2026-07-10');
});

console.log('— réducteur —');
const H1 = { id: 'habit-sport-1', name: 'Sport', emoji: '🏃', color: 'vert', schedule: { kind: 'daily' }, createdAt: TS('2026-06-01'), createdDay: '2026-06-01' };
const H2 = { id: 'habit-lecture', name: 'Lecture', emoji: '📖', color: 'bleu', schedule: { kind: 'days', days: [1, 3, 5] }, createdAt: TS('2026-06-01'), createdDay: '2026-06-01' };
const H3 = { id: 'habit-mediter', name: 'Méditation', emoji: '🧘', color: 'violet', schedule: { kind: 'weekly', target: 3 }, createdAt: TS('2026-06-01'), createdDay: '2026-06-01' };

function seed() {
  let s = defaultState();
  s = reduce(s, { type: 'onboard.complete', name: 'Michael', habits: [H1, H2] });
  s = reduce(s, { type: 'habit.create', habit: H3 });
  return s;
}

ok('onboard.complete pose nom + habitudes', () => {
  const s = seed();
  assert.equal(s.onboarded, true);
  assert.equal(s.settings.name, 'Michael');
  assert.equal(s.habits.length, 3);
  assert.equal(s.rev, 2);
});
ok('reduce est immuable', () => {
  const s0 = defaultState();
  const s1 = reduce(s0, { type: 'settings.update', patch: { name: 'A' } });
  assert.equal(s0.settings.name, '');
  assert.equal(s1.settings.name, 'A');
  assert.equal(s0.rev, 0);
  assert.equal(s1.rev, 1);
});
ok('habit.toggle pose puis retire', () => {
  let s = seed();
  s = reduce(s, { type: 'habit.toggle', id: H1.id, date: '2026-07-10', ts: TS('2026-07-10', 9) });
  assert.ok(habitDoneOn(s, H1.id, '2026-07-10'));
  s = reduce(s, { type: 'habit.toggle', id: H1.id, date: '2026-07-10', ts: TS('2026-07-10', 9) });
  assert.ok(!habitDoneOn(s, H1.id, '2026-07-10'));
  assert.ok(!s.habitLogs['2026-07-10'], 'jour vide purgé');
});
ok('habit.toggle avant createdDay étend l\'historique (rattrapage)', () => {
  let s = seed();
  s = reduce(s, { type: 'habit.toggle', id: H1.id, date: '2026-05-28', ts: TS('2026-05-28') });
  const h = s.habits.find((x) => x.id === H1.id);
  assert.equal(h.createdDay, '2026-05-28');
  assert.ok(habitDoneOn(s, H1.id, '2026-05-28'));
  throws(() => reduce(s, { type: 'habit.toggle', id: H1.id, date: '2026-02-31', ts: 1 }), 'date invalide');
  throws(() => reduce(s, { type: 'habit.toggle', id: 'nope', date: '2026-07-10', ts: 1 }), 'habitude inconnue');
});
ok('habit.delete purge les logs', () => {
  let s = seed();
  s = reduce(s, { type: 'habit.toggle', id: H1.id, date: '2026-07-09', ts: TS('2026-07-09') });
  s = reduce(s, { type: 'habit.toggle', id: H2.id, date: '2026-07-08', ts: TS('2026-07-08') });
  s = reduce(s, { type: 'habit.delete', id: H1.id });
  assert.ok(!s.habitLogs['2026-07-09']);
  assert.ok(s.habitLogs['2026-07-08'][H2.id]);
});
ok('cycle de vie tâche', () => {
  let s = seed();
  s = reduce(s, { type: 'task.create', task: { id: 'task-0001', title: '  Payer le loyer  ', due: '2026-07-10', priority: 'high', createdAt: TS('2026-07-01') } });
  assert.equal(s.tasks[0].title, 'Payer le loyer');
  s = reduce(s, { type: 'task.complete', id: 'task-0001', ts: TS('2026-07-10', 15) });
  assert.ok(s.tasks[0].completedAt);
  throws(() => reduce(s, { type: 'task.complete', id: 'task-0001', ts: 1 }), 'déjà terminée');
  s = reduce(s, { type: 'task.uncomplete', id: 'task-0001' });
  assert.equal(s.tasks[0].completedAt, null);
  s = reduce(s, { type: 'task.update', id: 'task-0001', patch: { priority: null, due: null, project: 'Maison' } });
  assert.equal(s.tasks[0].priority, null);
  assert.equal(s.tasks[0].project, 'Maison');
  s = reduce(s, { type: 'task.delete', id: 'task-0001' });
  assert.equal(s.tasks.length, 0);
});
ok('validations tâche', () => {
  const s = seed();
  throws(() => reduce(s, { type: 'task.create', task: { id: 'x', title: 'a', createdAt: 1 } }), 'id trop court');
  throws(() => reduce(s, { type: 'task.create', task: { id: 'task-0002', title: '   ', createdAt: 1 } }), 'titre vide');
  throws(() => reduce(s, { type: 'task.create', task: { id: 'task-0003', title: 'ok', due: '2026-99-01', createdAt: 1 } }), 'due invalide');
  throws(() => reduce(s, { type: 'task.create', task: { id: 'task-0004', title: 'ok', priority: 'urgent', createdAt: 1 } }), 'priorité invalide');
});
ok('journal + tags', () => {
  let s = seed();
  s = reduce(s, { type: 'journal.add', entry: { id: 'note-0001', ts: TS('2026-07-10', 10), text: 'Séance de sport #forme #Forme puis code sur #vibe-term' } });
  assert.deepEqual(s.journal[0].tags, ['forme', 'vibe-term']);
  s = reduce(s, { type: 'journal.update', id: 'note-0001', patch: { text: 'Juste du code #dev' } });
  assert.deepEqual(s.journal[0].tags, ['dev']);
  s = reduce(s, { type: 'journal.delete', id: 'note-0001' });
  assert.equal(s.journal.length, 0);
});
ok('sessions focus', () => {
  let s = seed();
  s = reduce(s, { type: 'session.start', label: 'Deep work', ts: TS('2026-07-10', 9) });
  throws(() => reduce(s, { type: 'session.start', label: 'x', ts: 1 }), 'déjà en cours');
  s = reduce(s, { type: 'session.stop', id: 'sess-0001', ts: TS('2026-07-10', 9, 25) });
  assert.equal(s.activeSession, null);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].end - s.sessions[0].start, 25 * 60000);
  s = reduce(s, { type: 'session.start', label: 'Courte', ts: TS('2026-07-10', 10) });
  s = reduce(s, { type: 'session.discard' });
  assert.equal(s.activeSession, null);
  assert.equal(s.sessions.length, 1);
});
ok('op inconnue rejetée', () => {
  throws(() => reduce(defaultState(), { type: 'nimporte.quoi' }), 'type inconnu');
  throws(() => reduce(defaultState(), null), 'op nulle');
});

console.log('— séries —');
function withChecks(habitId, keys) {
  let s = seed();
  for (const k of keys) s = reduce(s, { type: 'habit.toggle', id: habitId, date: k, ts: TS(k, 20) });
  return s;
}
ok('série quotidienne : aujourd\'hui en attente ne casse pas', () => {
  const s = withChecks(H1.id, ['2026-07-07', '2026-07-08', '2026-07-09']);
  const st = currentStreak(s, s.habits[0], TODAY);
  assert.deepEqual(st, { n: 3, unit: 'j' });
});
ok('série quotidienne : aujourd\'hui fait allonge', () => {
  const s = withChecks(H1.id, ['2026-07-08', '2026-07-09', '2026-07-10']);
  assert.equal(currentStreak(s, s.habits[0], TODAY).n, 3);
});
ok('série quotidienne : trou avant-hier casse', () => {
  const s = withChecks(H1.id, ['2026-07-06', '2026-07-07', '2026-07-09']);
  assert.equal(currentStreak(s, s.habits[0], TODAY).n, 1);
});
ok('série jours précis : les jours non prévus sont sautés', () => {
  // H2 = lun(1)/mer(3)/ven(5). Coché lun 06, mer 08 ; vendredi 10 = aujourd'hui, en attente.
  const s = withChecks(H2.id, ['2026-07-06', '2026-07-08']);
  const h = s.habits.find((h) => h.id === H2.id);
  assert.equal(isScheduledDay(h, '2026-07-07'), false);
  assert.equal(currentStreak(s, h, TODAY).n, 2);
});
ok('série jours précis : jour prévu manqué casse', () => {
  const s = withChecks(H2.id, ['2026-07-06']); // mercredi 08 manqué
  const h = s.habits.find((h) => h.id === H2.id);
  assert.equal(currentStreak(s, h, TODAY).n, 0);
});
ok('série hebdo : semaines consécutives au quota', () => {
  // H3 = 3×/sem. Sem 22-28/06 : 3 ; sem 29/06-05/07 : 3 ; sem courante : 1.
  const s = withChecks(H3.id, ['2026-06-22', '2026-06-24', '2026-06-26', '2026-06-29', '2026-07-01', '2026-07-03', '2026-07-08']);
  const h = s.habits.find((h) => h.id === H3.id);
  assert.deepEqual(currentStreak(s, h, TODAY, 1), { n: 2, unit: 'sem.' });
});
ok('série hebdo : semaine courante au quota compte', () => {
  const s = withChecks(H3.id, ['2026-06-29', '2026-07-01', '2026-07-03', '2026-07-06', '2026-07-07', '2026-07-08']);
  const h = s.habits.find((h) => h.id === H3.id);
  assert.equal(currentStreak(s, h, TODAY, 1).n, 2);
});
ok('meilleure série ≥ série courante', () => {
  const s = withChecks(H1.id, ['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-07-09']);
  const h = s.habits[0];
  assert.equal(bestStreak(s, h, TODAY).n, 4);
  assert.equal(currentStreak(s, h, TODAY).n, 1);
});
ok('série bornée à la création', () => {
  const s = withChecks(H1.id, ['2026-06-01', '2026-06-02']);
  // rien avant le 01/06 : la série historique vaut 2, pas plus
  assert.equal(bestStreak(s, s.habits[0], '2026-06-02').n, 2);
});
ok('completionRate quotidien', () => {
  const s = withChecks(H1.id, ['2026-07-08', '2026-07-09', '2026-07-10']);
  const r = completionRate(s, s.habits[0], TODAY); // 3 faits / 30 exigés
  assert.ok(Math.abs(r - 3 / 30) < 1e-9);
});
ok('completionRate borné à la création', () => {
  let s = defaultState();
  const h = { ...H1, id: 'habit-recent1', createdAt: TS('2026-07-06'), createdDay: '2026-07-06' };
  s = reduce(s, { type: 'habit.create', habit: h });
  s = reduce(s, { type: 'habit.toggle', id: h.id, date: '2026-07-06', ts: TS('2026-07-06') });
  s = reduce(s, { type: 'habit.toggle', id: h.id, date: '2026-07-07', ts: TS('2026-07-07') });
  const r = completionRate(s, s.habits[0], TODAY); // 2 / 5 (06→10)
  assert.ok(Math.abs(r - 2 / 5) < 1e-9);
});
ok('habitDueToday selon la fréquence', () => {
  let s = seed();
  const h1 = s.habits.find((h) => h.id === H1.id);
  const h2 = s.habits.find((h) => h.id === H2.id);
  const h3 = s.habits.find((h) => h.id === H3.id);
  assert.equal(habitDueToday(s, h1, TODAY), true); // daily
  assert.equal(habitDueToday(s, h2, TODAY), true); // vendredi ∈ [lun,mer,ven]
  assert.equal(habitDueToday(s, h2, '2026-07-09'), false); // jeudi
  assert.equal(habitDueToday(s, h3, TODAY), true); // quota 3 non atteint
  s = reduce(s, { type: 'habit.toggle', id: H3.id, date: '2026-07-06', ts: TS('2026-07-06') });
  s = reduce(s, { type: 'habit.toggle', id: H3.id, date: '2026-07-07', ts: TS('2026-07-07') });
  s = reduce(s, { type: 'habit.toggle', id: H3.id, date: '2026-07-08', ts: TS('2026-07-08') });
  assert.equal(habitDueToday(s, h3, TODAY), false); // quota atteint, pas coché aujourd'hui
  s = reduce(s, { type: 'habit.toggle', id: H3.id, date: TODAY, ts: TS(TODAY) });
  assert.equal(habitDueToday(s, h3, TODAY), true); // coché aujourd'hui : reste affiché
});

console.log('— tâches / journal / agrégats —');
ok('taskSections trie et sectionne', () => {
  let s = seed();
  const mk = (id, title, extra) => { s = reduce(s, { type: 'task.create', task: { id, title, createdAt: TS('2026-07-01'), ...extra } }); };
  mk('task-past-01', 'En retard', { due: '2026-07-08' });
  mk('task-today-1', 'Ce jour basse', { due: TODAY, priority: 'low' });
  mk('task-today-2', 'Ce jour haute', { due: TODAY, priority: 'high' });
  mk('task-futur-1', 'Plus tard', { due: '2026-07-20' });
  mk('task-someday', 'Un jour' , {});
  s = reduce(s, { type: 'task.complete', id: 'task-someday', ts: TS(TODAY, 16) });
  const sec = taskSections(s.tasks, TODAY);
  assert.deepEqual(sec.overdue.map((t) => t.id), ['task-past-01']);
  assert.deepEqual(sec.today.map((t) => t.id), ['task-today-2', 'task-today-1']);
  assert.deepEqual(sec.upcoming.map((t) => t.id), ['task-futur-1']);
  assert.deepEqual(sec.someday.map((t) => t.id), []);
  assert.deepEqual(sec.done.map((t) => t.id), ['task-someday']);
});
ok('projectsOf déduplique et trie', () => {
  const tasks = [{ project: 'Perso' }, { project: 'Boulot' }, { project: 'Perso' }, { project: '' }];
  assert.deepEqual(projectsOf(tasks), ['Boulot', 'Perso']);
});
ok('parseTags', () => {
  assert.deepEqual(parseTags('rien ici'), []);
  assert.deepEqual(parseTags('#début et #fin-de_ligne2 mais pas email@#x'), ['début', 'fin-de_ligne2']);
});
ok('activityByDay agrège tout', () => {
  let s = withChecks(H1.id, [TODAY]);
  s = reduce(s, { type: 'task.create', task: { id: 'task-agg-01', title: 'T', createdAt: TS(TODAY, 8) } });
  s = reduce(s, { type: 'task.complete', id: 'task-agg-01', ts: TS(TODAY, 9) });
  s = reduce(s, { type: 'journal.add', entry: { id: 'note-agg-01', ts: TS(TODAY, 10), text: 'note' } });
  s = reduce(s, { type: 'session.start', label: 'F', ts: TS(TODAY, 11) });
  s = reduce(s, { type: 'session.stop', id: 'sess-agg-01', ts: TS(TODAY, 11, 30) });
  const act = activityByDay(s, TODAY, TODAY)[TODAY];
  assert.deepEqual(act, { habits: 1, tasks: 1, notes: 1, sessions: 1, focusMs: 30 * 60000, count: 4 });
  assert.equal(momentum(s, TODAY), 1);
  assert.equal(focusToday(s, TODAY, TS(TODAY, 12)), 30 * 60000);
});
ok('momentum : 2 jours actifs, aujourd\'hui en attente ne casse pas', () => {
  const s = withChecks(H1.id, ['2026-07-08', '2026-07-09']);
  assert.equal(momentum(s, TODAY), 2);
});
ok('focusToday inclut la session en cours', () => {
  let s = seed();
  s = reduce(s, { type: 'session.start', label: 'Live', ts: TS(TODAY, 14) });
  assert.equal(focusToday(s, TODAY, TS(TODAY, 14, 10)), 10 * 60000);
});
ok('timeline groupe, filtre, pagine', () => {
  let s = withChecks(H1.id, ['2026-07-09', TODAY]);
  s = reduce(s, { type: 'task.create', task: { id: 'task-tl-001', title: 'Réviser SQL', project: 'Prépa', createdAt: TS('2026-07-09', 8) } });
  s = reduce(s, { type: 'task.complete', id: 'task-tl-001', ts: TS('2026-07-09', 18) });
  s = reduce(s, { type: 'journal.add', entry: { id: 'note-tl-01', ts: TS(TODAY, 9), text: 'Petit déj #routine' } });
  const all = timeline(s, { todayK: TODAY });
  assert.equal(all.groups.length, 2);
  assert.equal(all.groups[0].dateKey, TODAY);
  assert.equal(all.groups[0].events.length, 2);
  assert.equal(all.groups[1].summary.tasks, 1);
  const onlyTasks = timeline(s, { types: ['task'], todayK: TODAY });
  assert.equal(onlyTasks.groups.length, 1);
  assert.equal(onlyTasks.groups[0].events[0].title, 'Réviser SQL');
  const search = timeline(s, { query: 'sql', todayK: TODAY });
  assert.equal(search.groups[0].events[0].kind, 'task');
  const tagSearch = timeline(s, { query: '#routine', todayK: TODAY });
  assert.equal(tagSearch.groups[0].events[0].kind, 'note');
  const page1 = timeline(s, { todayK: TODAY, days: 1 });
  assert.equal(page1.hasMore, true);
  const page2 = timeline(s, { todayK: TODAY, days: 1, beforeK: page1.nextBefore });
  assert.equal(page2.groups[0].dateKey, '2026-07-09');
  assert.equal(page2.hasMore, false);
});
ok('tasksPerWeek et focusPerDay', () => {
  let s = seed();
  s = reduce(s, { type: 'task.create', task: { id: 'task-wk-001', title: 'A', createdAt: TS('2026-07-01') } });
  s = reduce(s, { type: 'task.complete', id: 'task-wk-001', ts: TS('2026-07-01', 12) }); // semaine du 29/06
  s = reduce(s, { type: 'session.start', label: 'S', ts: TS('2026-07-09', 9) });
  s = reduce(s, { type: 'session.stop', id: 'sess-wk-01', ts: TS('2026-07-09', 10) });
  const weeks = tasksPerWeek(s, TODAY, 3, 1);
  assert.deepEqual(weeks.map((w) => w.weekKey), ['2026-06-22', '2026-06-29', '2026-07-06']);
  assert.deepEqual(weeks.map((w) => w.count), [0, 1, 0]);
  const days = focusPerDay(s, TODAY, 3);
  assert.deepEqual(days.map((d) => d.dateKey), ['2026-07-08', '2026-07-09', TODAY]);
  assert.deepEqual(days.map((d) => d.focusMs), [0, 3600000, 0]);
});
ok('fmtDuration', () => {
  assert.equal(fmtDuration(42000), '42 s');
  assert.equal(fmtDuration(25 * 60000), '25 min');
  assert.equal(fmtDuration(65 * 60000), '1 h 05');
  assert.equal(fmtDuration(120 * 60000), '2 h');
  assert.equal(fmtDurationShort(95 * 60000), '1h35');
});

console.log('\n' + passed + ' tests OK');
