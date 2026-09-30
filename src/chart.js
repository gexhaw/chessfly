// Strength over the fly's life, with the fixed opponents as horizontal reference lines.
import { BENCH_ELO } from './players.js';

export function drawCurve(canvas, curve, theme) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 170;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(canvas);
  const ink = css.getPropertyValue('--ink').trim() || '#221d16';
  const muted = css.getPropertyValue('--muted').trim() || '#8b7f6d';
  const accent = css.getPropertyValue('--accent').trim() || '#c8323b';
  const L = 36, R = 64, T = 10, B = 22;
  const maxG = Math.max(100, ...curve.map((p) => p.games));
  const lo = 200, hi = Math.max(2300, ...curve.map((p) => p.elo + 100));
  const X = (x) => L + (w - L - R) * Math.sqrt(x / maxG);
  const Y = (e) => T + (h - T - B) * (1 - (e - lo) / (hi - lo));
  g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  g.lineWidth = 1;
  for (const [name, e] of Object.entries(BENCH_ELO)) {
    g.strokeStyle = muted; g.globalAlpha = 0.35; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(L, Y(e)); g.lineTo(w - R + 4, Y(e)); g.stroke();
    g.setLineDash([]); g.globalAlpha = 0.9; g.fillStyle = muted;
    g.fillText(name, w - R + 8, Y(e) + 3);
  }
  g.globalAlpha = 1;
  g.fillStyle = muted;
  for (const e of [500, 1000, 1500, 2000]) if (e < hi) g.fillText(String(e), 4, Y(e) + 3);
  const ticks = [0, 100, 1000, 10000, 100000].filter((t) => t <= maxG);
  if (maxG > ticks[ticks.length - 1] * 1.5) ticks.push(maxG);
  for (const t of ticks) g.fillText(t >= 1000 ? `${Math.round(t / 1000)}k` : String(t), X(t) - 6, h - 6);
  if (!curve.length) {
    g.fillText('no exams yet — train your fly', L + 10, T + 30);
    return;
  }
  g.strokeStyle = accent; g.lineWidth = 2;
  g.beginPath();
  curve.forEach((p, i) => (i ? g.lineTo(X(p.games), Y(p.elo)) : g.moveTo(X(p.games), Y(p.elo))));
  g.stroke();
  g.fillStyle = accent;
  for (const p of curve) { g.beginPath(); g.arc(X(p.games), Y(p.elo), 2.6, 0, Math.PI * 2); g.fill(); }
  const last = curve[curve.length - 1];
  g.fillStyle = ink; g.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText(String(last.elo), X(last.games) + 6, Y(last.elo) - 6);
}
