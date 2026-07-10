// views/comptes.js — écran de sélection des comptes : « qui se connecte ? ».
import { h, clear, confirmDialog, plur } from '../ui.js';
import { icon, logo } from '../icons.js';

const HUES = { violet: 'var(--hue-violet)', bleu: 'var(--hue-bleu)', cyan: 'var(--hue-cyan)', vert: 'var(--hue-vert)', ambre: 'var(--hue-jaune)', rose: 'var(--hue-rose)' };

function vuIlYa(ms) {
  if (!ms) return '';
  const jours = Math.floor((Date.now() - ms) / 86400000);
  if (jours <= 0) return 'aujourd’hui';
  if (jours === 1) return 'hier';
  return 'il y a ' + jours + ' j';
}

function choisir(id) {
  localStorage.setItem('trace-profil', id);
  location.reload();
}

export function renderComptes(root) {
  clear(root);
  const box = h('div', 'onboard');
  const card = h('div', { class: 'onboard-card', style: { maxWidth: '560px' } });
  card.append(h('div', null,
    h('span', 'logo', logo(56)),
    h('h1', { style: { marginTop: '14px' } }, 'Qui se connecte ?'),
    h('p', 'lead', 'Chaque compte garde ses habitudes, tâches et journal, sauvegardés séparément.')));

  const grid = h('div', 'comptes-grid');
  card.append(grid);
  box.append(card);
  root.append(box);

  charger(grid);
}

async function charger(grid) {
  let profils = [];
  try {
    const r = await fetch('/api/profils');
    profils = (await r.json()).profils || [];
  } catch {
    grid.append(h('p', 'muted', 'Serveur injoignable. Relance Trace puis réessaie.'));
    return;
  }

  clear(grid);
  for (const p of profils) {
    const hue = HUES[p.accent] || HUES.violet;
    const initiale = (p.nom || '?').trim().charAt(0).toUpperCase() || '?';
    const carte = h('button', { class: 'compte-card', onclick: () => choisir(p.id) },
      h('span', { class: 'compte-avatar', style: { '--ca': hue } }, initiale),
      h('span', 'compte-nom', p.nom || 'Sans nom'),
      h('span', 'compte-meta',
        p.onboarded
          ? plur(p.nbHabitudes, 'habitude') + ' · ' + plur(p.nbTaches, 'tâche ouverte', 'tâches ouvertes')
          : 'nouveau compte'),
      h('span', 'compte-meta', vuIlYa(p.lastUsed)),
    );
    carte.append(h('button', {
      class: 'compte-suppr btn btn-icon',
      'aria-label': 'Supprimer ce compte',
      title: 'Supprimer ce compte',
      onclick: async (e) => {
        e.stopPropagation();
        const sur = await confirmDialog({
          title: 'Supprimer le compte « ' + (p.nom || 'Sans nom') + ' » ?',
          text: 'Ses données partent dans data/backups (rien n’est détruit), mais le compte disparaît de cet écran.',
          confirmLabel: 'Supprimer',
        });
        if (!sur) return;
        await fetch('/api/profils/' + p.id, { method: 'DELETE' });
        charger(grid);
      },
    }, icon('trash', 13)));
    grid.append(carte);
  }

  /* nouveau compte */
  const nouveau = h('button', { class: 'compte-card compte-nouveau' },
    h('span', { class: 'compte-avatar', style: { '--ca': 'var(--text-3)' } }, icon('plus', 22)),
    h('span', 'compte-nom', 'Nouveau compte'));
  nouveau.addEventListener('click', () => {
    const input = h('input', { class: 'input', placeholder: 'Prénom', maxlength: 40, style: { height: '36px' } });
    const creer = async () => {
      const nom = input.value.trim();
      if (!nom) { input.focus(); return; }
      const r = await fetch('/api/profils', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom }),
      });
      if (r.ok) choisir((await r.json()).id);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') creer(); });
    const form = h('div', { class: 'compte-card compte-form' },
      input,
      h('button', { class: 'btn btn-primary btn-sm', onclick: creer }, 'Créer'));
    nouveau.replaceWith(form);
    input.focus();
  });
  grid.append(nouveau);
}
