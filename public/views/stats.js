// views/stats.js — Bilan : tuiles, heatmap 6 mois, barres hebdo/quotidiennes
// (avec équivalent tableau), taux par habitude.
import { h, frDM, frDayShort, cap, plur } from '../ui.js';
import { icon } from '../icons.js';
import * as L from '../logic.js';
import { getState, todayK } from '../app.js';
import { activityHeatmap, barChart, vizTable, chartWithTable } from '../charts.js';
import { hueVar } from './habits.js';

const WD_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export function renderStats(root) {
  const s = getState();
  const tk = todayK();
  const ws = s.settings.weekStart;
  const now = Date.now();

  root.append(h('div', 'view-head',
    h('h1', null, 'Bilan'),
    h('div', 'sub', 'Ce que racontent tes 30 derniers jours'),
  ));

  /* ---------- tuiles 30 jours ---------- */
  const from30 = L.addDays(tk, -29);
  const act30 = L.activityByDay(s, from30, tk);
  let actions = 0, tasks30 = 0, focus30 = 0;
  for (const day of Object.values(act30)) { actions += day.count; tasks30 += day.tasks; focus30 += day.focusMs; }
  const mom = L.momentum(s, tk);

  root.append(h('div', 'stat-row',
    tile('flame', 'Élan', mom > 0 ? mom + ' j' : '0', 'flame'),
    tile('spark', 'Actions · 30 j', String(actions)),
    tile('tasks', 'Tâches finies · 30 j', String(tasks30)),
    tile('clock', 'Focus · 30 j', focus30 ? L.fmtDurationShort(focus30) : '0'),
  ));

  /* ---------- heatmap 6 mois ---------- */
  const heatCard = h('div', { class: 'card', style: { marginBottom: '16px' } });
  heatCard.append(h('div', 'card-title', icon('calendar', 15), 'Activité', h('span', 'spacer'), h('span', 'card-sub', '6 derniers mois')));
  const heatBox = h('div');
  const actAll = L.activityByDay(s, L.addDays(tk, -7 * 26), tk);
  activityHeatmap(heatBox, { act: actAll, weeks: 26, todayK: tk, weekStart: ws });
  heatCard.append(heatBox);
  root.append(heatCard);

  /* ---------- barres ---------- */
  const weeks = L.tasksPerWeek(s, tk, 10, ws);
  const days = L.focusPerDay(s, tk, 14);
  const grid = h('div', 'grid-2');

  grid.append(chartCard({
    ico: 'tasks',
    title: 'Tâches terminées',
    sub: 'par semaine',
    draw: (box) => barChart(box, {
      series: weeks.map((w) => ({
        label: frDM(w.weekKey),
        value: w.count,
        tipValue: plur(w.count, 'tâche'),
        tipSub: 'Semaine du ' + frDM(w.weekKey),
      })),
      labelEvery: 2,
      fmtVal: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
    }),
    table: vizTable(['Semaine', 'Tâches'], weeks.map((w) => ['Du ' + frDM(w.weekKey), w.count])),
  }));

  grid.append(chartCard({
    ico: 'clock',
    title: 'Temps de focus',
    sub: '14 derniers jours',
    draw: (box) => barChart(box, {
      series: days.map((d) => ({
        label: WD_LETTER[L.weekday(d.dateKey)],
        value: Math.round(d.focusMs / 60000),
        tipValue: d.focusMs ? L.fmtDuration(d.focusMs) : '0 min',
        tipSub: cap(frDayShort(d.dateKey)),
      })),
      fmtVal: (v) => (Number.isInteger(v) ? v + ' min' : v.toFixed(0) + ' min'),
    }),
    table: vizTable(['Jour', 'Focus'], days.map((d) => [cap(frDayShort(d.dateKey)), d.focusMs ? L.fmtDuration(d.focusMs) : '—'])),
  }));
  root.append(grid);

  /* ---------- habitudes ---------- */
  const active = s.habits.filter((hb) => !hb.archivedAt);
  if (active.length) {
    const rows = active
      .map((hb) => ({ hb, rate: L.completionRate(s, hb, tk, ws) || 0, best: L.bestStreak(s, hb, tk, ws) }))
      .sort((a, b) => b.rate - a.rate);
    const card = h('div', { class: 'card', style: { marginTop: '16px' } });
    card.append(h('div', 'card-title', icon('repeat', 15), 'Habitudes', h('span', 'spacer'), h('span', 'card-sub', 'taux sur 30 jours')));
    for (const { hb, rate, best } of rows) {
      const meter = h('div', { class: 'meter', style: { '--hc': hueVar(hb.color) } }, h('i', { style: { width: Math.round(rate * 100) + '%' } }));
      card.append(h('div', { style: { display: 'grid', gridTemplateColumns: '150px 1fr auto auto', gap: '12px', alignItems: 'center', padding: '7px 0' } },
        h('span', { style: { fontSize: '13px', fontWeight: 570, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (hb.emoji ? hb.emoji + ' ' : '') + hb.name),
        meter,
        h('span', { class: 'tnum', style: { fontSize: '12.5px', fontWeight: 640, width: '44px', textAlign: 'right' } }, Math.round(rate * 100) + ' %'),
        h('span', { class: 'muted tnum', style: { fontSize: '12px', width: '86px', textAlign: 'right' } }, 'record ' + best.n + ' ' + best.unit),
      ));
    }
    root.append(card);
  }
}

function tile(ico, lbl, val, cls) {
  return h('div', { class: 'stat-tile' + (cls ? ' ' + cls : '') },
    h('div', 'lbl', icon(ico, 13), lbl),
    h('div', 'val', val));
}

function chartCard({ ico, title, sub, draw, table }) {
  const card = h('div', 'card');
  const toggle = h('button', { class: 'btn btn-icon', title: 'Voir en tableau', 'aria-label': 'Voir en tableau', 'aria-pressed': 'false' }, icon('table', 15));
  card.append(h('div', 'card-title', icon(ico, 15), title, h('span', 'spacer'), h('span', 'card-sub', sub), toggle));
  card.append(chartWithTable((box) => {
    // dessine après insertion pour connaître la largeur réelle
    requestAnimationFrame(() => draw(box));
  }, table, toggle));
  return card;
}
