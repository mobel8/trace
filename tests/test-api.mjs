// Tests d'intégration du serveur — exécuter : node tests/test-api.mjs
// Démarre un vrai serveur sur un port de test avec un dossier de données jetable,
// vérifie les opérations, la persistance après redémarrage, la récupération après
// corruption et l'import/export.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'tests', '.tmp-data');
const PORT = 47999;
const BASE = 'http://127.0.0.1:' + PORT;

let child = null;
let passed = 0;

function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, TRACE_PORT: String(PORT), TRACE_DATA: TMP },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write('[serveur] ' + d));
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/api/ping');
      const j = await r.json();
      if (j.app === 'trace') return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('serveur injoignable');
}

function stopServer() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    child.on('exit', () => resolve());
    child.kill();
    child = null;
  });
}

async function op(o, expectStatus = 200) {
  const r = await fetch(BASE + '/api/op', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: o }) });
  assert.equal(r.status, expectStatus, 'statut pour ' + o.type);
  return r.json();
}
async function getState() {
  const r = await fetch(BASE + '/api/state');
  return (await r.json()).state;
}
function ok(name) { passed++; console.log('  ✓ ' + name); }

/* ============================== Scénario ============================== */

fs.rmSync(TMP, { recursive: true, force: true });

startServer();
await waitReady();
ok('démarrage sur dossier vierge');

let st = await getState();
assert.equal(st.rev, 0);
assert.equal(st.onboarded, false);
ok('état par défaut servi');

const NOW = Date.now();
const TODAY = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');

await op({ type: 'onboard.complete', name: 'Testeur', habits: [
  { id: 'habit-test-0001', name: 'Sport', emoji: '🏃', color: 'vert', schedule: { kind: 'daily' }, createdAt: NOW, createdDay: TODAY },
] });
await op({ type: 'habit.toggle', id: 'habit-test-0001', date: TODAY, ts: NOW });
await op({ type: 'task.create', task: { id: 'task-test-0001', title: 'Tester Trace', priority: 'high', due: TODAY, createdAt: NOW } });
await op({ type: 'task.complete', id: 'task-test-0001', ts: NOW + 1000 });
await op({ type: 'journal.add', entry: { id: 'note-test-0001', ts: NOW, text: 'Première note #test' } });
await op({ type: 'session.start', label: 'Focus test', ts: NOW });
const r1 = await op({ type: 'session.stop', id: 'sess-test-0001', ts: NOW + 60000 });
ok('suite d’opérations acceptée');

st = await getState();
assert.equal(st.settings.name, 'Testeur');
assert.equal(st.habits.length, 1);
assert.ok(st.habitLogs[TODAY]['habit-test-0001']);
assert.ok(st.tasks[0].completedAt);
assert.deepEqual(st.journal[0].tags, ['test']);
assert.equal(st.sessions[0].end - st.sessions[0].start, 60000);
assert.equal(st.rev, r1.rev);
ok('état cohérent après opérations');

const bad = await op({ type: 'habit.toggle', id: 'inexistant', date: TODAY, ts: NOW }, 400);
assert.match(bad.error, /inconnue/);
const bad2 = await op({ type: 'nimporte.quoi' }, 400);
assert.match(bad2.error, /type inconnu/);
ok('ops invalides → 400 sans casser l’état');

const batchBad = await fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [
  { type: 'journal.add', entry: { id: 'note-test-0002', ts: NOW, text: 'ne doit PAS rester' } },
  { type: 'task.complete', id: 'task-test-0001', ts: NOW }, // échoue : déjà terminée
] }) });
assert.equal(batchBad.status, 400);
st = await getState();
assert.equal(st.journal.length, 1, 'le batch invalide doit être tout-ou-rien');
ok('batch /api/ops atomique');

const notFound = await fetch(BASE + '/api/nexiste-pas');
assert.equal(notFound.status, 404);
const trav = await fetch(BASE + '/..%2f..%2fserver.js');
assert.ok(trav.status === 403 || trav.status === 404);
ok('404 API + traversée de chemin bloquée');

/* ---------- persistance après redémarrage ---------- */
const revBefore = st.rev;
await stopServer();
startServer();
await waitReady();
st = await getState();
assert.equal(st.rev, revBefore);
assert.equal(st.settings.name, 'Testeur');
assert.ok(st.habitLogs[TODAY]['habit-test-0001']);
ok('persistance intacte après arrêt brutal + redémarrage');

/* ---------- export / import ---------- */
const exp = await fetch(BASE + '/api/export');
assert.match(exp.headers.get('content-disposition') || '', /attachment; filename="trace-export-/);
const exported = await exp.json();
assert.equal(exported.settings.name, 'Testeur');
ok('export : pièce jointe JSON complète');

const badImport = await fetch(BASE + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { hello: 'world' } }) });
assert.equal(badImport.status, 400);
const modified = { ...exported, journal: [...exported.journal, { id: 'note-import-01', ts: NOW, text: 'Venu d’un import', tags: [] }] };
const impOk = await fetch(BASE + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: modified }) });
assert.equal(impOk.status, 200);
st = await getState();
assert.equal(st.journal.length, 2);
assert.ok(st.rev > revBefore, 'rev doit avancer après import');
const preImportBackups = fs.readdirSync(path.join(TMP, 'backups')).filter((f) => f.startsWith('db-avant-import-'));
assert.equal(preImportBackups.length, 1);
ok('import : validation, remplacement, copie de sécurité');

/* ---------- récupération après corruption ---------- */
await stopServer();
fs.copyFileSync(path.join(TMP, 'db.json'), path.join(TMP, 'backups', 'db-2000-01-01.json'));
fs.writeFileSync(path.join(TMP, 'db.json'), '{"version":1,"co!!!! JSON massacré');
startServer();
await waitReady();
st = await getState();
assert.equal(st.settings.name, 'Testeur', 'doit repartir de la sauvegarde');
assert.equal(st.journal.length, 2);
const quarantined = fs.readdirSync(TMP).filter((f) => f.startsWith('db.json.corrompu-'));
assert.equal(quarantined.length, 1);
ok('db.json corrompu → quarantaine + restauration depuis la sauvegarde');

/* ---------- statique ---------- */
const page = await fetch(BASE + '/');
assert.equal(page.status, 200);
assert.match(page.headers.get('content-type'), /text\/html/);
ok('page d’accueil servie');

await stopServer();
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + passed + ' tests API OK');
