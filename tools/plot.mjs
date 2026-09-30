// Draws flies' lives (the exam results stored in their brain files) as an SVG chart for the README.
//   node tools/plot.mjs docs/life.svg brains/adult.json
//   node tools/plot.mjs docs/wiring.svg brains/adult.json brains/adult-shuffled.json brains/adult-random.json
import { readFileSync, writeFileSync } from 'node:fs';
import { BENCH_ELO } from '../src/players.js';

const [, , out = 'docs/life.svg', ...files] = process.argv;
const LABEL = { flywire: 'real FlyWire wiring', shuffled: 'FlyWire, claws shuffled', random: 'random wiring' };
const COLORS = ['#cf2531', '#d6a03c', '#4f7d9c'];
const series = (files.length ? files : ['brains/adult.json']).map((f, k) => {
  const b = JSON.parse(readFileSync(f, 'utf8'));
  return { curve: b.curve, label: LABEL[b.wiring || 'random'], color: COLORS[k % COLORS.length] };
});
const W = 860, H = 380, L = 64, R = 110, T = 30, B = 52;
const maxG = Math.max(...series.flatMap((s) => s.curve.map((p) => p.games)));
const lo = 300, hi = 2200;
const X = (g) => L + (W - L - R) * Math.sqrt(g / maxG);
const Y = (e) => T + (H - T - B) * (1 - (e - lo) / (hi - lo));
const ink = '#16302b', muted = '#5d716b', food = '#d6a03c';
const title = series.length > 1 ? 'Same training, different wiring (depth-1 exams, 160 games each)' : 'Strength of one fly over its life (depth-1 exams, 160 games each)';
let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">
<rect width="${W}" height="${H}" rx="14" fill="#f3f6f3"/>
<text x="${L}" y="21" font-size="14" font-weight="700" fill="${ink}">${title}</text>`;
for (const [name, e] of Object.entries(BENCH_ELO)) {
  s += `<line x1="${L}" x2="${W - R + 6}" y1="${Y(e)}" y2="${Y(e)}" stroke="${muted}" stroke-dasharray="4 5" opacity=".5"/>`;
  s += `<text x="${W - R + 12}" y="${Y(e) + 4}" font-size="13" fill="${muted}">${name} ${e}</text>`;
}
for (const e of [500, 1000, 1500, 2000]) s += `<text x="${L - 10}" y="${Y(e) + 4}" font-size="12" fill="${muted}" text-anchor="end">${e}</text>`;
for (const g of [0, 100, 500, 1000, 3000, 5000, 10000, 20000].filter((g) => g <= maxG))
  s += `<line x1="${X(g)}" x2="${X(g)}" y1="${H - B}" y2="${H - B + 5}" stroke="${muted}"/><text x="${X(g)}" y="${H - B + 19}" font-size="12" fill="${muted}" text-anchor="middle">${g >= 1000 ? g / 1000 + 'k' : g}</text>`;
s += `<text x="${(L + W - R) / 2}" y="${H - 10}" font-size="12" fill="${muted}" text-anchor="middle">games lived (square-root scale)</text>`;
if (3000 <= maxG) s += `<line x1="${X(3000)}" x2="${X(3000)}" y1="${T + 8}" y2="${H - B}" stroke="${food}" stroke-width="2" opacity=".5"/><text x="${X(3000) + 6}" y="${H - B - 8}" font-size="12" fill="${ink}">adult: practises 2 moves ahead</text>`;
series.forEach((sr, k) => {
  s += `<polyline fill="none" stroke="${sr.color}" stroke-width="3" stroke-linejoin="round" opacity=".9" points="${sr.curve.map((p) => `${X(p.games).toFixed(1)},${Y(p.elo).toFixed(1)}`).join(' ')}"/>`;
  for (const p of sr.curve) s += `<circle cx="${X(p.games).toFixed(1)}" cy="${Y(p.elo).toFixed(1)}" r="3.6" fill="${sr.color}"/>`;
  if (series.length > 1) s += `<rect x="${L + 12}" y="${T + 14 + k * 20}" width="14" height="4" rx="2" fill="${sr.color}"/><text x="${L + 32}" y="${T + 19 + k * 20}" font-size="13" fill="${ink}">${sr.label}: ${sr.curve[sr.curve.length - 1].elo}</text>`;
});
if (series.length === 1) {
  const c = series[0].curve, first = c[0], last = c[c.length - 1];
  s += `<text x="${X(first.games) + 8}" y="${Y(first.elo) + 18}" font-size="13" fill="${ink}">egg ${first.elo}</text>`;
  s += `<text x="${X(last.games) - 6}" y="${Y(last.elo) - 12}" font-size="13" font-weight="700" fill="${ink}" text-anchor="end">${last.elo}</text>`;
}
s += '</svg>\n';
writeFileSync(out, s);
console.log('wrote', out);
