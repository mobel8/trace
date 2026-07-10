// views/onboarding.js — premier lancement : prénom + habitudes de départ.
import { h, uid } from '../ui.js';
import { logo } from '../icons.js';
import { apply, todayK, getState } from '../app.js';

const STARTERS = [
  { emoji: '🏃', name: 'Sport', color: 'vert' },
  { emoji: '📖', name: 'Lecture', color: 'bleu' },
  { emoji: '💧', name: 'Boire de l’eau', color: 'cyan' },
  { emoji: '😴', name: 'Coucher avant minuit', color: 'violet' },
  { emoji: '🧘', name: 'Méditation', color: 'rose' },
  { emoji: '✍️', name: 'Écrire', color: 'jaune' },
  { emoji: '🚶', name: 'Marche', color: 'orange' },
  { emoji: '📵', name: 'Moins d’écrans', color: 'rouge' },
  { emoji: '🇬🇧', name: 'Anglais', color: 'bleu' },
];

export function renderOnboarding(root) {
  const selected = new Set();

  const nameInput = h('input', { class: 'input', placeholder: 'Ton prénom', maxlength: 40, style: { height: '40px' } });
  // Compte créé depuis l'écran de sélection : le prénom est déjà connu.
  const dejaConnu = (getState().settings.name || '').trim();
  if (dejaConnu) nameInput.value = dejaConnu;

  const chipRow = h('div', 'chip-row');
  for (const [i, st] of STARTERS.entries()) {
    const chip = h('button', {
      type: 'button', class: 'chip', style: { height: '30px' },
      onclick: () => {
        if (selected.has(i)) selected.delete(i); else selected.add(i);
        chip.classList.toggle('on', selected.has(i));
      },
    }, st.emoji + ' ' + st.name);
    chipRow.append(chip);
  }

  const start = () => {
    const now = Date.now();
    const tk = todayK();
    apply({
      type: 'onboard.complete',
      name: nameInput.value.trim(),
      habits: [...selected].map((i) => ({
        id: uid('habit'),
        name: STARTERS[i].name,
        emoji: STARTERS[i].emoji,
        color: STARTERS[i].color,
        schedule: { kind: 'daily' },
        createdAt: now,
        createdDay: tk,
      })),
    });
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

  root.append(h('div', 'onboard',
    h('div', 'onboard-card',
      h('div', null,
        h('span', 'logo', logo(56)),
        h('h1', { style: { marginTop: '14px' } }, 'Bienvenue dans Trace'),
        h('p', 'lead', 'Habitudes, tâches, journal : chaque jour laisse une trace.')),
      h('div', 'onboard-form',
        h('label', 'field', 'Comment tu t’appelles ?', nameInput),
        h('div', null,
          h('h3', { style: { marginBottom: '10px' } }, 'Des habitudes pour commencer ? (optionnel)'),
          chipRow),
        h('button', { class: 'btn btn-primary', style: { height: '40px', fontSize: '14px' }, onclick: start }, 'C’est parti'),
      ),
    ),
  ));
}
