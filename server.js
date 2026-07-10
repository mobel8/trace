// server.js — Trace : serveur local (fichiers statiques + API JSON), zéro dépendance.
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
const DB_FILE = path.join(DATA_DIR, 'db.json');
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

/* ============================== Persistance ============================== */

function ensureDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function loadState() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (state && state.version === 1) return state;
      throw new Error('version inattendue');
    } catch (e) {
      // Fichier corrompu : on le met de côté et on repart de la dernière sauvegarde.
      const quarantine = DB_FILE + '.corrompu-' + Date.now();
      try { fs.renameSync(DB_FILE, quarantine); } catch {}
      console.error('[trace] db.json illisible (' + e.message + '), mis de côté : ' + quarantine);
      // La plus récente d'abord (mtime, pas ordre alphabétique : les fichiers
      // db-avant-import-* ne trient pas comme les db-AAAA-MM-JJ).
      const byRecency = listBackups()
        .map((f) => { try { return { f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
      for (const { f } of byRecency) {
        try {
          const state = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
          if (state && state.version === 1) {
            console.error('[trace] restauré depuis ' + f);
            return state;
          }
        } catch {}
      }
      console.error('[trace] aucune sauvegarde exploitable, nouvel état vide');
    }
  }
  return defaultState();
}

function listBackups() {
  try { return fs.readdirSync(BACKUP_DIR).filter((f) => /^db-.*\.json$/.test(f)).sort(); }
  catch { return []; }
}

let lastBackupDay = null;
function dailyBackup() {
  const day = todayKey();
  if (lastBackupDay === day) return;
  lastBackupDay = day;
  const target = path.join(BACKUP_DIR, 'db-' + day + '.json');
  if (!fs.existsSync(target) && fs.existsSync(DB_FILE)) {
    try { fs.copyFileSync(DB_FILE, target); } catch (e) { console.error('[trace] sauvegarde impossible : ' + e.message); }
  }
  // Élagage : on ne garde que les 40 dernières sauvegardes quotidiennes datées.
  const dated = listBackups().filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  for (const f of dated.slice(0, Math.max(0, dated.length - 40))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
  }
}

function persist(state) {
  ensureDirs();
  dailyBackup(); // avant la première écriture du jour : copie de la veille intacte
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_FILE); // atomique : jamais de db.json à moitié écrit
}

let state = loadState();

/* ============================== Helpers HTTP ============================== */

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
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

/* ============================== Serveur ============================== */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + HOST);
  const p = url.pathname;

  try {
    /* ---------- API ---------- */
    if (p === '/api/ping') return sendJSON(res, 200, { app: 'trace', version: APP_VERSION });

    if (p === '/api/state' && req.method === 'GET') return sendJSON(res, 200, { state });

    if (p === '/api/op' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.op) return sendJSON(res, 400, { error: 'op manquante' });
      try {
        state = reduce(state, body.op);
        persist(state);
        return sendJSON(res, 200, { ok: true, rev: state.rev });
      } catch (e) {
        if (e.badOp) return sendJSON(res, 400, { error: e.message });
        throw e;
      }
    }

    if (p === '/api/ops' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !Array.isArray(body.ops)) return sendJSON(res, 400, { error: 'ops manquantes' });
      try {
        let next = state;
        for (const op of body.ops) next = reduce(next, op); // tout ou rien
        state = next;
        persist(state);
        return sendJSON(res, 200, { ok: true, rev: state.rev });
      } catch (e) {
        if (e.badOp) return sendJSON(res, 400, { error: e.message });
        throw e;
      }
    }

    if (p === '/api/export' && req.method === 'GET') {
      const body = JSON.stringify(state, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="trace-export-' + todayKey() + '.json"',
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }

    if (p === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      const st = body && body.state;
      if (!validImportedState(st)) return sendJSON(res, 400, { error: 'fichier invalide : ce n’est pas un export Trace' });
      // Filet de sécurité : copie de l'état actuel avant remplacement.
      try {
        ensureDirs();
        if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, 'db-avant-import-' + Date.now() + '.json'));
      } catch {}
      st.rev = Math.max(state.rev, Number(st.rev) || 0) + 1;
      state = st;
      persist(state);
      return sendJSON(res, 200, { ok: true, rev: state.rev });
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'inconnu' });

    /* ---------- Statique ---------- */
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
      'Cache-Control': longCache ? 'public, max-age=604800' : 'no-cache',
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
  console.log('[trace] v' + APP_VERSION + ' prêt sur http://' + HOST + ':' + PORT + '  (données : ' + DATA_DIR + ')');
});
