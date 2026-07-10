// Tests d'intégration du serveur multi-comptes — exécuter : node tests/test-api.mjs
// Vrai serveur sur port jetable : ops, comptes (création/isolation/suppression),
// migration de l'ancien db.json, persistance après kill, corruption, import/export.
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
      if ((await r.json()).app === 'trace') return;
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
async function op(o, profil, expectStatus = 200) {
  const r = await fetch(BASE + '/api/op' + (profil ? '?p=' + profil : ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: o }),
  });
  assert.equal(r.status, expectStatus, 'statut pour ' + o.type);
  return r.json();
}
async function getState(profil) {
  const r = await fetch(BASE + '/api/state' + (profil ? '?p=' + profil : ''));
  return (await r.json()).state;
}
async function profils() {
  return (await (await fetch(BASE + '/api/profils')).json()).profils;
}
const profilsDir = () => path.join(TMP, 'profils');
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

/* ============================== migration de l'ancien format ============================== */

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
// un ancien db.json mono-compte préexistant
fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify({
  version: 1, rev: 5, onboarded: true,
  settings: { name: 'Migré', theme: 'dark', accent: 'violet', weekStart: 1 },
  habits: [], habitLogs: {}, tasks: [], journal: [], sessions: [], activeSession: null,
}));

startServer();
await waitReady();
let liste = await profils();
assert.equal(liste.length, 1);
assert.equal(liste[0].nom, 'Migré');
assert.ok(!fs.existsSync(path.join(TMP, 'db.json')), 'db.json doit avoir été déplacé');
assert.equal(fs.readdirSync(profilsDir()).filter((f) => f.endsWith('.json')).length, 1);
const pMigre = liste[0].id;
let st = await getState(); // sans ?p : résout le plus récent
assert.equal(st.settings.name, 'Migré');
assert.equal(st.rev, 5);
ok('migration : l’ancien db.json devient le premier compte');

/* ============================== comptes ============================== */

const rCreate = await fetch(BASE + '/api/profils', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom: 'Léa' }),
});
const pLea = (await rCreate.json()).id;
liste = await profils();
assert.equal(liste.length, 2);
assert.ok(liste.some((x) => x.nom === 'Léa' && !x.onboarded));
ok('création d’un second compte');

const NOW = Date.now();
const TODAY = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');

await op({ type: 'onboard.complete', name: 'Léa', habits: [] }, pLea);
await op({ type: 'task.create', task: { id: 'task-lea-0001', title: 'Tâche de Léa', createdAt: NOW } }, pLea);
const stLea = await getState(pLea);
const stMigre = await getState(pMigre);
assert.equal(stLea.tasks.length, 1);
assert.equal(stMigre.tasks.length, 0, 'les comptes doivent être isolés');
assert.equal(stMigre.settings.name, 'Migré');
ok('isolation : les ops d’un compte ne touchent pas l’autre');

const r404 = await fetch(BASE + '/api/state?p=p-inexistant99');
assert.equal(r404.status, 404);
ok('?p inconnu → 404 (le client retourne à l’écran des comptes)');

/* ---------- sous-tâches via l'API ---------- */
await op({ type: 'task.create', task: { id: 'task-lea-sub1', title: 'Sous-tâche', parentId: 'task-lea-0001', createdAt: NOW + 1 } }, pLea);
await op({ type: 'task.complete', id: 'task-lea-0001', ts: NOW + 2 }, pLea);
const stCascade = await getState(pLea);
assert.ok(stCascade.tasks.every((t) => t.completedAt), 'cascade parent → sous-tâches');
const badParent = await op({ type: 'task.create', task: { id: 'task-lea-bad1', title: 'x', parentId: 'inexistant', createdAt: 1 } }, pLea, 400);
assert.match(badParent.error, /parente inconnue/);
ok('sous-tâches : cascade et validation côté serveur');

/* ============================== persistance après kill ============================== */

await stopServer();
startServer();
await waitReady();
const stApres = await getState(pLea);
assert.equal(stApres.tasks.length, 2);
assert.equal((await getState(pMigre)).settings.name, 'Migré');
ok('persistance des deux comptes après arrêt brutal');

/* ============================== export / import (par compte) ============================== */

const exp = await fetch(BASE + '/api/export?p=' + pLea);
assert.match(exp.headers.get('content-disposition') || '', /trace-L/);
const exported = await exp.json();
assert.equal(exported.tasks.length, 2);
const modified = { ...exported, journal: [{ id: 'note-imp-001', ts: NOW, text: 'Import ciblé', tags: [] }] };
const impOk = await fetch(BASE + '/api/import?p=' + pLea, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: modified }),
});
assert.equal(impOk.status, 200);
assert.equal((await getState(pLea)).journal.length, 1);
assert.equal((await getState(pMigre)).journal.length, 0, 'l’import ne touche que son compte');
ok('export/import ciblés sur un compte');

/* ============================== corruption + restauration ============================== */

await stopServer();
const fichierLea = path.join(profilsDir(), pLea + '.json');
fs.copyFileSync(fichierLea, path.join(TMP, 'backups', 'db-' + pLea + '-2000-01-01.json'));
fs.writeFileSync(fichierLea, '{"version":1,"co!!!! JSON massacré');
startServer();
await waitReady();
const stRestaure = await getState(pLea);
assert.equal(stRestaure.journal.length, 1, 'restauré depuis la sauvegarde du compte');
assert.equal(fs.readdirSync(profilsDir()).filter((f) => f.includes('.corrompu-')).length, 1);
ok('fichier de compte corrompu → quarantaine + restauration');

/* ============================== suppression de compte ============================== */

const rDel = await fetch(BASE + '/api/profils/' + pLea, { method: 'DELETE' });
assert.equal(rDel.status, 200);
liste = await profils();
assert.equal(liste.length, 1);
assert.ok(fs.readdirSync(path.join(TMP, 'backups')).some((f) => f.startsWith('profil-supprime-' + pLea)),
  'le compte supprimé doit partir en sauvegarde');
const r404b = await fetch(BASE + '/api/state?p=' + pLea);
assert.equal(r404b.status, 404);
ok('suppression : retiré de la liste, données conservées en sauvegarde');

/* ============================== statique ============================== */

const page = await fetch(BASE + '/');
assert.equal(page.status, 200);
assert.match(page.headers.get('content-type'), /text\/html/);
const trav = await fetch(BASE + '/..%2f..%2fserver.js');
assert.ok(trav.status === 403 || trav.status === 404);
ok('page servie + traversée de chemin bloquée');

await stopServer();
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + passed + ' tests API OK');
