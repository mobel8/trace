// charts.js — graphiques SVG faits main (specs dataviz : marques fines, grille
// discrète en trait plein, séquentiel mono-teinte, tooltips valeur d'abord,
// étiquettes directes parcimonieuses, équivalent tableau).
import { h, sv, clear, showTip, hideTip, frDayShort, frDM, cap, plur } from './ui.js';
import { addDays, weekStartOf, diffDays, weekday } from './logic.js';

/* ============================== Heatmap d'activité ============================== */
// Séquentiel = une seule teinte (accent) mélangée vers la surface ; le zéro recule
// vers la surface dans les deux thèmes. Paliers absolus lisibles : 1 / 2-3 / 4-6 / 7+.

const HEAT_LEVELS = [
  'var(--surface-3)',
  'color-mix(in oklab, var(--accent) 28%, var(--surface))',
  'color-mix(in oklab, var(--accent) 50%, var(--surface))',
  'color-mix(in oklab, var(--accent) 74%, var(--surface))',
  'var(--accent)',
];
const levelOf = (v) => (v <= 0 ? 0 : v === 1 ? 1 : v <= 3 ? 2 : v <= 6 ? 3 : 4);

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function activityHeatmap(container, { act, weeks = 26, todayK, weekStart = 1, label = 'action', vide = 'Aucune activité enregistrée pour le moment.' }) {
  const CELL = 11, GAP = 3, STEP = CELL + GAP;
  const LEFT = 26, TOP = 18;
  const firstWeek = addDays(weekStartOf(todayK, weekStart), -7 * (weeks - 1));
  const W = LEFT + weeks * STEP - GAP;
  const HGT = TOP + 7 * STEP - GAP;
  const svg = sv('svg', { width: W, height: HGT, viewBox: '0 0 ' + W + ' ' + HGT, role: 'img', 'aria-label': 'Carte d’activité des ' + weeks + ' dernières semaines' });

  // Étiquettes des jours (lun / mer / ven)
  for (const wd of [1, 3, 5]) {
    const row = (wd - weekStart + 7) % 7;
    svg.append(sv('text', { x: 0, y: TOP + row * STEP + CELL - 2, class: 'axis-txt' }, ['lun', 'mer', 'ven'][(wd - 1) / 2]));
  }

  let lastMonth = -1;
  let total = 0, best = { v: 0, k: null }, activeDays = 0;
  for (let w = 0; w < weeks; w++) {
    const wkK = addDays(firstWeek, w * 7);
    const m = Number(wkK.slice(5, 7)) - 1;
    if (m !== lastMonth && Number(wkK.slice(8, 10)) <= 10) {
      svg.append(sv('text', { x: LEFT + w * STEP, y: 10, class: 'axis-txt' }, MONTHS_FR[m]));
      lastMonth = m;
    }
    for (let d = 0; d < 7; d++) {
      const k = addDays(wkK, d);
      if (k > todayK) continue;
      const v = (act[k] && act[k].count) || 0;
      total += v;
      if (v > 0) activeDays++;
      if (v > best.v) best = { v, k };
      const rect = sv('rect', {
        x: LEFT + w * STEP, y: TOP + d * STEP, width: CELL, height: CELL, rx: 3,
        fill: HEAT_LEVELS[levelOf(v)],
        class: 'heat-cell',
        tabindex: -1,
      });
      const tipData = { value: plur(v, label), sub: cap(frDayShort(k)) };
      rect.addEventListener('pointermove', (e) => showTip(tipData, e.clientX, e.clientY));
      rect.addEventListener('pointerleave', hideTip);
      svg.append(rect);
    }
  }

  const wrap = h('div', 'heat-wrap');
  wrap.append(svg);
  clear(container).append(
    wrap,
    h('div', 'heat-legend',
      'Moins',
      ...HEAT_LEVELS.map((c) => h('span', { class: 'sq', style: { background: c } })),
      'Plus'),
    h('div', 'chart-note',
      total === 0
        ? vide
        : plur(total, label) + ' · ' + plur(activeDays, 'jour actif', 'jours actifs')
          + (best.k ? ' · record ' + best.v + ' le ' + frDayShort(best.k) : '')),
  );
}

/* ============================== Mini-heatmap d'une habitude ============================== */
// Binaire (fait / pas fait) dans la couleur de l'habitude ; clic = corriger un jour.

// stateOn(k) optionnel : 'ok' (quota atteint) | 'partiel' (présence sous quota) | null.
export function habitMiniHeat(container, { habit, doneOn, stateOn, todayK, weekStart = 1, weeks = 13, onToggle }) {
  const CELL = 11, GAP = 3, STEP = CELL + GAP;
  const firstWeek = addDays(weekStartOf(todayK, weekStart), -7 * (weeks - 1));
  const W = weeks * STEP - GAP;
  const HGT = 7 * STEP - GAP;
  const svg = sv('svg', { width: W, height: HGT, viewBox: '0 0 ' + W + ' ' + HGT, role: 'img', 'aria-label': 'Historique de « ' + habit.name + ' » sur ' + weeks + ' semaines' });

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const k = addDays(firstWeek, w * 7 + d);
      if (k > todayK) continue;
      const before = k < habit.createdDay;
      const etat = stateOn ? stateOn(k) : (doneOn(k) ? 'ok' : null);
      const rect = sv('rect', {
        x: w * STEP, y: d * STEP, width: CELL, height: CELL, rx: 3,
        fill: etat === 'ok' ? 'var(--hc)'
          : etat === 'partiel' ? 'color-mix(in oklab, var(--hc) 42%, var(--surface))'
          : 'var(--surface-3)',
        opacity: before ? 0.28 : 1,
        class: 'heat-cell clickable',
      });
      const tipData = {
        value: etat === 'ok' ? 'Quota atteint' : etat === 'partiel' ? 'Partiel (sous le quota)' : 'Pas fait',
        sub: cap(frDayShort(k)) + ' · cliquer pour corriger',
      };
      rect.addEventListener('pointermove', (e) => showTip(tipData, e.clientX, e.clientY));
      rect.addEventListener('pointerleave', hideTip);
      rect.addEventListener('click', () => { hideTip(); onToggle(k); });
      svg.append(rect);
    }
  }
  clear(container).append(svg);
}

/* ============================== Escalier d'une habitude à paliers ============================== */
// Les 14 derniers jours : hauteur = niveau atteint / nb de paliers ; ligne de
// quota (palier courant) en référence. ok = couleur pleine, partiel = atténué.

export function habitEscalier(container, { getNiv, nbPaliers, quota, todayK, jours = 14 }) {
  const W = 176, H = 56, PAD_B = 4, PAD_T = 8;
  const step = W / jours;
  const barW = Math.min(9, step - 3);
  const plotH = H - PAD_B - PAD_T;
  const yFor = (niv) => PAD_T + plotH * (1 - niv / nbPaliers);
  const svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Niveaux atteints sur ' + jours + ' jours' });

  // ligne de quota (référence, trait plein discret)
  const yQuota = yFor(quota);
  svg.append(sv('line', { x1: 0, y1: yQuota, x2: W, y2: yQuota, stroke: 'color-mix(in oklab, var(--hc) 55%, transparent)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  // base
  svg.append(sv('line', { x1: 0, y1: H - PAD_B, x2: W, y2: H - PAD_B, stroke: 'var(--border-strong)', 'stroke-width': 1 }));

  for (let i = 0; i < jours; i++) {
    const k = addDays(todayK, -(jours - 1 - i));
    const info = getNiv(k); // { niv, ok } | null
    const cx = step * i + step / 2;
    if (info && info.niv > 0) {
      const yTop = yFor(info.niv);
      svg.append(sv('rect', {
        x: cx - barW / 2, y: yTop, width: barW, height: H - PAD_B - yTop, rx: 2,
        fill: info.ok ? 'var(--hc)' : 'color-mix(in oklab, var(--hc) 42%, var(--surface))',
        class: 'heat-cell',
      }));
    } else {
      svg.append(sv('circle', { cx, cy: H - PAD_B - 2.5, r: 1.5, fill: 'var(--surface-3)' }));
    }
    const tipData = {
      value: info && info.niv ? 'Niveau ' + info.niv + '/' + nbPaliers + (info.ok ? (info.niv > quota ? ' · au-delà du quota ✨' : ' · quota atteint') : ' · sous le quota') : 'Rien ce jour-là',
      sub: cap(frDayShort(k)),
    };
    const hit = sv('rect', { x: step * i, y: 0, width: step, height: H, fill: 'transparent' });
    hit.addEventListener('pointermove', (e) => showTip(tipData, e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hideTip);
    svg.append(hit);
  }
  clear(container).append(svg);
}

/* ============================== Barres (colonnes) ============================== */
// Une seule série → une seule couleur (accent), pas de légende (le titre nomme).
// Barres ≤ 24px, sommet arrondi 4px, base carrée ; grille hairline pleine ;
// étiquette directe seulement sur le max et la dernière ; tooltip + focus clavier
// par colonne ; bascule tableau fournie par vizTable.

function niceMax(v) {
  // maxima « propres » dont la moitié reste lisible (graduations top et top/2)
  if (v <= 10) return Math.max(2, Math.ceil(v / 2) * 2);
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [2, 4, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

export function barChart(container, { series, width, height = 150, fmtVal = String, labelEvery = 1 }) {
  clear(container);
  if (!series.length) return;
  const maxV = Math.max(1, ...series.map((s) => s.value));
  const top = niceMax(maxV);
  // marge gauche dimensionnée sur la plus longue étiquette de graduation
  const tickLen = Math.max(fmtVal(top).length, fmtVal(top / 2).length);
  const PAD_L = 12 + tickLen * 6.4, PAD_R = 6, PAD_T = 16, PAD_B = 20;
  const W = width || Math.max(280, container.clientWidth || 480);
  const plotW = W - PAD_L - PAD_R, plotH = height - PAD_T - PAD_B;
  const y = (v) => PAD_T + plotH * (1 - v / top);
  const step = plotW / series.length;
  const barW = Math.min(24, Math.max(6, step * 0.58));

  const svg = sv('svg', { width: W, height, viewBox: '0 0 ' + W + ' ' + height, role: 'img' });

  // Grille : 2 hairlines pleines + base
  for (const tv of [top / 2, top]) {
    svg.append(sv('line', { x1: PAD_L, y1: y(tv), x2: W - PAD_R, y2: y(tv), class: 'grid-line' }));
    svg.append(sv('text', { x: PAD_L - 6, y: y(tv) + 3.5, 'text-anchor': 'end', class: 'axis-txt' }, fmtVal(tv)));
  }
  svg.append(sv('line', { x1: PAD_L, y1: y(0), x2: W - PAD_R, y2: y(0), stroke: 'var(--border-strong)', 'stroke-width': 1 }));

  const maxIdx = series.reduce((mi, s, i) => (s.value > series[mi].value ? i : mi), 0);
  series.forEach((s, i) => {
    const cx = PAD_L + step * i + step / 2;
    const x0 = cx - barW / 2;
    let bar = null;
    if (s.value > 0) {
      const yTop = Math.min(y(s.value), y(0) - 2);
      const r = Math.min(4, barW / 2, (y(0) - yTop));
      const d = 'M' + x0 + ',' + y(0)
        + ' L' + x0 + ',' + (yTop + r)
        + ' Q' + x0 + ',' + yTop + ' ' + (x0 + r) + ',' + yTop
        + ' L' + (x0 + barW - r) + ',' + yTop
        + ' Q' + (x0 + barW) + ',' + yTop + ' ' + (x0 + barW) + ',' + (yTop + r)
        + ' L' + (x0 + barW) + ',' + y(0) + ' Z';
      bar = sv('path', { d, fill: s.color || 'var(--accent)', class: 'bar-rect' });
      svg.append(bar);
    }
    // Étiquette directe : max + dernière colonne non nulle uniquement, bornée au cadre
    if (s.value > 0 && (i === maxIdx || i === series.length - 1)) {
      const txt = fmtVal(s.value);
      const half = txt.length * 3.2;
      const lx = Math.max(PAD_L + half, Math.min(cx, W - PAD_R - half));
      svg.append(sv('text', { x: lx, y: y(s.value) - 5, 'text-anchor': 'middle', class: 'bar-lbl' }, txt));
    }
    // Étiquettes X ancrées sur la dernière colonne (la période courante est toujours nommée)
    if ((series.length - 1 - i) % labelEvery === 0) {
      svg.append(sv('text', { x: cx, y: height - 6, 'text-anchor': 'middle', class: 'axis-txt' }, s.label));
    }
    // Cible de survol : toute la colonne (≥ 24px de large), focusable clavier
    const hit = sv('rect', {
      x: PAD_L + step * i, y: PAD_T - 8, width: step, height: plotH + 8 + 8,
      fill: 'transparent', tabindex: 0,
      'aria-label': s.tipSub + ' : ' + (s.tipValue || fmtVal(s.value)),
    });
    const tipData = { value: s.tipValue || fmtVal(s.value), sub: s.tipSub };
    const lift = (on) => { if (bar) bar.style.filter = on ? 'brightness(1.18)' : ''; };
    hit.addEventListener('pointermove', (e) => { lift(true); showTip(tipData, e.clientX, e.clientY); });
    hit.addEventListener('pointerleave', () => { lift(false); hideTip(); });
    hit.addEventListener('focus', () => {
      lift(true);
      const r = hit.getBoundingClientRect();
      showTip(tipData, r.left + r.width / 2, r.top + 10);
    });
    hit.addEventListener('blur', () => { lift(false); hideTip(); });
    svg.append(hit);
  });

  container.append(svg);
}

/* ============================== Tableau équivalent ============================== */

export function vizTable(headers, rows) {
  return h('table', 'viz-table',
    h('thead', null, h('tr', null, headers.map((hd) => h('th', null, hd)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i > 0 ? 'num' : '' }, String(c)))))),
  );
}

// Bascule graphique ↔ tableau pour une carte de Bilan.
export function chartWithTable(drawChart, tableEl, toggleBtn) {
  const chartBox = h('div');
  const tableBox = h('div', { class: 'hidden' });
  tableBox.append(tableEl);
  let showingTable = false;
  toggleBtn.addEventListener('click', () => {
    showingTable = !showingTable;
    chartBox.classList.toggle('hidden', showingTable);
    tableBox.classList.toggle('hidden', !showingTable);
    toggleBtn.setAttribute('aria-pressed', showingTable);
  });
  drawChart(chartBox);
  return h('div', null, chartBox, tableBox);
}
