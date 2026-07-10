// views/settings.js — réglages : profil, apparence, semaine, données, à propos.
import { h, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { ACCENTS, defaultState } from '../logic.js';
import { getState, apply, api, profilId, changerDeCompte } from '../app.js';

export function renderSettings(root) {
  const s = getState();

  root.append(h('div', 'view-head',
    h('h1', null, 'Réglages'),
    h('div', 'sub', 'Trace, à ta façon'),
  ));

  /* ---------- profil & apparence ---------- */
  const nameInput = h('input', { class: 'input', value: s.settings.name, maxlength: 40, placeholder: 'Ton prénom' });
  const saveName = () => {
    if (nameInput.value.trim() !== s.settings.name) {
      apply({ type: 'settings.update', patch: { name: nameInput.value } });
      toast('C’est noté');
    }
  };
  nameInput.addEventListener('blur', saveName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

  const themeSeg = seg([['dark', 'Sombre'], ['light', 'Clair'], ['auto', 'Auto']], s.settings.theme,
    (v) => apply({ type: 'settings.update', patch: { theme: v } }));

  const accentRow = h('div', 'swatches');
  for (const a of ACCENTS) {
    accentRow.append(h('button', {
      class: 'swatch' + (s.settings.accent === a ? ' on' : ''),
      style: { '--sw': 'var(--hue-' + (a === 'ambre' ? 'jaune' : a) + ')' },
      'aria-label': 'Accent ' + a,
      onclick: () => apply({ type: 'settings.update', patch: { accent: a } }),
    }));
  }

  const weekSeg = seg([[1, 'Lundi'], [0, 'Dimanche']], s.settings.weekStart,
    (v) => apply({ type: 'settings.update', patch: { weekStart: v } }));

  root.append(card('Apparence', [
    row('Prénom', 'Pour le bonjour du matin', nameInput),
    row('Thème', 'Sombre, clair, ou selon le système', themeSeg),
    row('Couleur d’accent', 'Boutons, graphiques, carte d’activité', accentRow),
    row('Début de semaine', 'Pour les séries et le bilan', weekSeg),
  ]));

  /* ---------- compte ---------- */
  root.append(card('Compte', [
    row('Changer de compte', 'Retourner à l’écran de sélection des comptes',
      h('button', { class: 'btn btn-ghost', onclick: () => changerDeCompte() }, icon('restore', 15), 'Changer')),
    row('Supprimer ce compte', 'Il disparaît de l’écran de sélection (ses données restent en sauvegarde)',
      h('button', {
        class: 'btn btn-danger', onclick: async () => {
          const sure = await confirmDialog({
            title: 'Supprimer ce compte ?',
            text: 'Le compte « ' + (s.settings.name || 'Sans nom') + ' » sera retiré. Ses données partent dans data/backups, rien n’est détruit.',
            confirmLabel: 'Supprimer',
          });
          if (!sure) return;
          await fetch('/api/profils/' + profilId(), { method: 'DELETE' });
          changerDeCompte();
        },
      }, icon('trash', 15), 'Supprimer')),
  ]));

  /* ---------- données ---------- */
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    let parsed;
    try { parsed = JSON.parse(await f.text()); }
    catch { toast('Fichier illisible', { ico: 'x' }); return; }
    const okGo = await confirmDialog({
      title: 'Importer ces données ?',
      text: 'Le contenu actuel de Trace sera remplacé par le fichier « ' + f.name + ' ». Une copie de sécurité de l’état actuel est conservée.',
      confirmLabel: 'Importer', danger: false,
    });
    if (!okGo) { fileInput.value = ''; return; }
    const r = await fetch(api('/api/import'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: parsed }) });
    if (r.ok) location.reload();
    else {
      const err = await r.json().catch(() => ({}));
      toast(err.error || 'Import refusé', { ico: 'x' });
      fileInput.value = '';
    }
  });

  root.append(card('Données', [
    row('Exporter', 'Toutes tes données dans un fichier JSON',
      h('a', { class: 'btn btn-ghost', href: api('/api/export'), download: '' }, icon('download', 15), 'Exporter')),
    row('Importer', 'Restaurer un export Trace',
      h('button', { class: 'btn btn-ghost', onclick: () => fileInput.click() }, icon('upload', 15), 'Importer', fileInput)),
    row('Tout effacer', 'Repartir de zéro (une sauvegarde est gardée côté serveur)',
      h('button', {
        class: 'btn btn-danger', onclick: async () => {
          const sure = await confirmDialog({
            title: 'Tout effacer ?',
            text: 'Habitudes, tâches, journal, sessions : tout sera effacé et Trace repartira de zéro. La dernière sauvegarde quotidienne reste dans le dossier data/backups.',
            confirmLabel: 'Tout effacer',
          });
          if (!sure) return;
          const r = await fetch(api('/api/import'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: defaultState() }) });
          if (r.ok) location.reload();
        },
      }, icon('trash', 15), 'Effacer')),
  ]));

  /* ---------- à propos ---------- */
  const aboutBox = h('div', { class: 'muted', style: { fontSize: '12.5px', lineHeight: 1.7 } }, 'Trace');
  fetch('/api/ping').then((r) => r.json()).then((p) => {
    aboutBox.textContent = '';
    aboutBox.append(
      'Trace v' + p.version, h('br'),
      'Données : ' + p.dataDir, h('br'),
      'Serveur local : http://127.0.0.1:' + p.port + ' · tout reste sur cette machine.',
    );
  }).catch(() => {});
  root.append(card('À propos', [aboutBox]));
}

function card(title, children) {
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('div', 'card-title', title),
    ...children);
}
function row(lbl, desc, ctl) {
  return h('div', 'settings-row',
    h('div', null, h('div', 'lbl', lbl), h('div', 'desc', desc)),
    h('div', 'ctl', ctl));
}
function seg(options, value, onPick) {
  const el = h('div', 'seg');
  for (const [val, label] of options) {
    el.append(h('button', { class: val === value ? 'on' : '', onclick: () => onPick(val) }, label));
  }
  return el;
}
