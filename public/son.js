// son.js — carillon DOUX en WebAudio (aucun fichier, aucun son agressif).
// Deux notes feutrées : descendantes quand le travail se termine (détente),
// montantes quand la pause se termine (reprise). Sinusoïdes, attaque douce,
// longue décroissance, volume bas.

let ctx = null;

// À appeler depuis un geste utilisateur (démarrage du pomodoro) pour armer l'audio.
export function armerAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

function note(freq, tDebut, duree, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // harmonique discrète une octave au-dessus, très faible : timbre « clochette feutrée »
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  gain2.gain.value = 0.18;

  const t = ctx.currentTime + tDebut;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.02);           // attaque douce
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duree);     // longue traîne

  osc.connect(gain);
  osc2.connect(gain2);
  gain2.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t); osc2.start(t);
  osc.stop(t + duree + 0.05); osc2.stop(t + duree + 0.05);
}

// kind : 'pause' (fin du travail → deux notes qui descendent),
//        'travail' (fin de la pause → deux notes qui montent),
//        'fin' (session terminée → une seule note).
export function jouerCarillon(kind) {
  try {
    armerAudio();
    if (!ctx) return;
    const V = 0.11; // volume volontairement bas
    if (kind === 'pause') {
      note(659.25, 0, 1.3, V);        // mi5
      note(493.88, 0.28, 1.6, V);     // si4 — « ding… dong »
    } else if (kind === 'travail') {
      note(493.88, 0, 1.1, V);
      note(659.25, 0.28, 1.6, V);
    } else {
      note(587.33, 0, 1.7, V);        // ré5, seule
    }
    // hook de test (E2E) — sans effet en usage normal
    window.dispatchEvent(new CustomEvent('trace:carillon', { detail: kind }));
  } catch {}
}

/* ============================== Notification PC ============================== */

export async function demanderPermissionNotif() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export function notifierPC(titre, corps) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    // silent : c'est notre carillon doux qui sonne, pas le son système
    new Notification(titre, { body: corps, silent: true, icon: '/icon.svg', tag: 'trace-pomodoro' });
    return true;
  } catch { return false; }
}
