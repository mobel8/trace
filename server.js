// server.js — Trace : serveur local (fichiers statiques + API JSON), zéro dépendance.
// Multi-comptes : un fichier data/profils/<id>.json par compte, sauvegardes par compte.
// Lancement : node server.js   (env : TRACE_PORT, TRACE_DATA)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduce, defaultState, todayKey, APP_VERSION } from './public/logic.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.TRACE_DATA ? path.resolve(process.env.TRACE_DATA) : path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PROFILS_DIR = path.join(DATA_DIR, 'profils');
const LEGACY_DB = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.TRACE_PORT) || 47621;
const HOST = '127.0.0.1';
const MAX_BODY = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/* ============================== Profils ============================== */

const ID_RE = /^p-[a-z0-9]{4,40}$/;
const states = new Map(); // id → état en mémoire

function ensureDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(PROFILS_DIR, { recursive: true });
}

function profilFile(id) { return path.join(PROFILS_DIR, id + '.json'); }

function listProfilIds() {
  try {
    return fs.readdirSync(PROFILS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter((id) => ID_RE.test(id));
  } catch { return []; }
}

function newProfilId() { return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Migration : l'ancien db.json unique devient le premier compte.
function migrateLegacy() {
  ensureDirs();
  if (fs.existsSync(LEGACY_DB) && listProfilIds().length === 0) {
    const id = newProfilId();
    fs.renameSync(LEGACY_DB, profilFile(id));
    console.log('[trace] ancien db.json migré vers le compte ' + id);
  }
}

function listBackups(id) {
  try { return fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-' + id + '-') && f.endsWith('.json')); }
  catch { return []; }
}

function loadProfil(id) {
  ensureDirs();
  const file = profilFile(id);
  if (fs.existsSync(file)) {
    try {
      const st = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (st && st.version === 1) return st;
      throw new Error('version inattendue');
    } catch (e) {
      const quarantine = file + '.corrompu-' + Date.now();
      try { fs.renameSync(file, quarantine); } catch {}
      console.error('[trace] ' + id + '.json illisible (' + e.message + '), mis de côté : ' + quarantine);
      const byRecency = listBackups(id)
        .map((f) => { try { return { f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
      for (const { f } of byRecency) {
        try {
          const st = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
          if (st && st.version === 1) {
            console.error('[trace] restauré depuis ' + f);
            writeProfilFile(id, st); // le fichier du compte doit exister à nouveau
            return st;
          }
        } catch {}
      }
      console.error('[trace] aucune sauvegarde exploitable pour ' + id + ', état vide');
      const vide = defaultState();
      writeProfilFile(id, vide);
      return vide;
    }
  }
  return defaultState();
}

function writeProfilFile(id, state) {
  try {
    const file = profilFile(id);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch (e) { console.error('[trace] écriture ' + id + ' impossible : ' + e.message); }
}

function getProfilState(id) {
  if (!states.has(id)) states.set(id, loadProfil(id));
  return states.get(id);
}

const lastBackupDay = new Map();
function dailyBackup(id) {
  const day = todayKey();
  if (lastBackupDay.get(id) === day) return;
  lastBackupDay.set(id, day);
  const target = path.join(BACKUP_DIR, 'db-' + id + '-' + day + '.json');
  const file = profilFile(id);
  if (!fs.existsSync(target) && fs.existsSync(file)) {
    try { fs.copyFileSync(file, target); } catch (e) { console.error('[trace] sauvegarde impossible : ' + e.message); }
  }
  const dated = listBackups(id).filter((f) => new RegExp('^db-' + id + '-\\d{4}-\\d{2}-\\d{2}\\.json$').test(f)).sort();
  for (const f of dated.slice(0, Math.max(0, dated.length - 40))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
  }
}

function persist(id, state) {
  ensureDirs();
  dailyBackup(id);
  const file = profilFile(id);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

// Résolution du compte visé : ?p=<id> explicite (404 si inconnu), sinon le plus
// récemment utilisé (compat anciens clients), sinon création d'un compte vide.
function resolveProfil(url) {
  const p = url.searchParams.get('p');
  if (p) {
    if (!ID_RE.test(p) || !fs.existsSync(profilFile(p))) return { error: 'profil inconnu' };
    return { id: p };
  }
  const ids = listProfilIds();
  if (ids.length) {
    const newest = ids
      .map((id) => ({ id, mtime: fs.statSync(profilFile(id)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0].id;
    return { id: newest };
  }
  const id = newProfilId();
  persist(id, defaultState());
  return { id };
}

migrateLegacy();

/* ============================== Helpers HTTP ============================== */

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('corps trop volumineux')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function validImportedState(st) {
  return st && typeof st === 'object' && st.version === 1
    && Array.isArray(st.habits) && Array.isArray(st.tasks) && Array.isArray(st.journal)
    && Array.isArray(st.sessions) && st.habitLogs && typeof st.habitLogs === 'object'
    && st.settings && typeof st.settings === 'object';
}

const safeName = (s) => String(s || '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24) || 'compte';

/* ============================== Serveur ============================== */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + HOST);
  const p = url.pathname;

  try {
    if (p === '/api/ping') return sendJSON(res, 200, { app: 'trace', version: APP_VERSION, dataDir: DATA_DIR, port: PORT, profils: listProfilIds().length });

    /* ---------- comptes ---------- */
    if (p === '/api/profils' && req.method === 'GET') {
      const out = listProfilIds().map((id) => {
        const st = getProfilState(id);
        let mtime = 0;
        try { mtime = fs.statSync(profilFile(id)).mtimeMs; } catch {}
        return {
          id,
          nom: (st.settings && st.settings.name) || '',
          accent: (st.settings && st.settings.accent) || 'violet',
          onboarded: !!st.onboarded,
          lastUsed: mtime,
          nbHabitudes: (st.habits || []).filter((h) => !h.archivedAt).length,
          nbTaches: (st.tasks || []).filter((t) => !t.completedAt).length,
        };
      }).sort((a, b) => b.lastUsed - a.lastUsed);
      return sendJSON(res, 200, { profils: out });
    }

    if (p === '/api/profils' && req.method === 'POST') {
      const body = await readBody(req);
      const nom = body && typeof body.nom === 'string' ? body.nom.trim().slice(0, 40) : '';
      const id = newProfilId();
      const st = defaultState();
      st.settings.name = nom;
      states.set(id, st);
      persist(id, st);
      return sendJSON(res, 200, { ok: true, id });
    }

    const delMatch = p.match(/^\/api\/profils\/(p-[a-z0-9]+)$/);
    if (delMatch && req.method === 'DELETE') {
      const id = delMatch[1];
      if (!fs.existsSync(profilFile(id))) return sendJSON(res, 404, { error: 'profil inconnu' });
      // On ne détruit rien : le fichier part dans les sauvegardes.
      ensureDirs();
      fs.renameSync(profilFile(id), path.join(BACKUP_DIR, 'profil-supprime-' + id + '-' + Date.now() + '.json'));
      states.delete(id);
      return sendJSON(res, 200, { ok: true });
    }

    /* ---------- état & ops (par compte) ---------- */
    if (p === '/api/state' && req.method === 'GET') {
      const r = resolveProfil(url);
      if (r.error) return sendJSON(res, 404, { error: r.error });
      return sendJSON(res, 200, { state: getProfilState(r.id), profil: r.id });
    }

    if (p === '/api/op' && req.method === 'POST') {
      const r = resolveProfil(url);
      if (r.error) return sendJSON(res, 404, { error: r.error });
      const body = await readBody(req);
      if (!body || !body.op) return sendJSON(res, 400, { error: 'op manquante' });
      try {
        const next = reduce(getProfilState(r.id), body.op);
        states.set(r.id, next);
        persist(r.id, next);
        return sendJSON(res, 200, { ok: true, rev: next.rev });
      } catch (e) {
        if (e.badOp) return sendJSON(res, 400, { error: e.message });
        throw e;
      }
    }

    if (p === '/api/export' && req.method === 'GET') {
      const r = resolveProfil(url);
      if (r.error) return sendJSON(res, 404, { error: r.error });
      const st = getProfilState(r.id);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="trace-' + safeName(st.settings.name) + '-' + todayKey() + '.json"',
        'Cache-Control': 'no-store',
      });
      return res.end(JSON.stringify(st, null, 2));
    }

    if (p === '/api/import' && req.method === 'POST') {
      const r = resolveProfil(url);
      if (r.error) return sendJSON(res, 404, { error: r.error });
      const body = await readBody(req);
      const st = body && body.state;
      if (!validImportedState(st)) return sendJSON(res, 400, { error: 'fichier invalide : ce n’est pas un export Trace' });
      try {
        ensureDirs();
        if (fs.existsSync(profilFile(r.id))) {
          fs.copyFileSync(profilFile(r.id), path.join(BACKUP_DIR, 'db-' + r.id + '-avant-import-' + Date.now() + '.json'));
        }
      } catch {}
      st.rev = Math.max(getProfilState(r.id).rev, Number(st.rev) || 0) + 1;
      states.set(r.id, st);
      persist(r.id, st);
      return sendJSON(res, 200, { ok: true, rev: st.rev });
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'inconnu' });

    /* ---------- statique ---------- */
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel = decodeURIComponent(p);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('introuvable'); }
    const ext = path.extname(file).toLowerCase();
    const longCache = ext === '.woff2' || ext === '.png' || ext === '.ico';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=604800' : 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error('[trace] erreur : ' + (e && e.stack || e));
    if (!res.headersSent) sendJSON(res, 500, { error: 'erreur serveur' });
    else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('[trace] le port ' + PORT + ' est déjà pris (Trace tourne sans doute déjà).');
    process.exit(2);
  }
  console.error('[trace] ' + e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('[trace] v' + APP_VERSION + ' prêt sur http://' + HOST + ':' + PORT + '  (données : ' + DATA_DIR + ', ' + listProfilIds().length + ' compte(s))');
});
