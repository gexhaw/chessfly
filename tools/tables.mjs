// Turns a training log into the README tables.
//   node tools/tables.mjs brains/adult.json
import { readFileSync } from 'node:fs';
import { stage } from '../src/brain.js';

const brain = JSON.parse(readFileSync(process.argv[2] || 'brains/adult.json', 'utf8'));
const pct = ([w, d, l]) => `${Math.round((100 * (w + d / 2)) / (w + d + l))}%`;
let life = '| Games lived | Stage | Rating | vs Random | vs Greedy | vs Counter | vs Sentinel |\n|---:|---|---:|---:|---:|---:|---:|\n';
for (const p of brain.curve) {
  const v = p.vs;
  life += `| ${p.games.toLocaleString('en')} | ${stage(p.games)} | **${p.elo}** | ${pct(v.Random)} | ${pct(v.Greedy)} | ${pct(v.Counter)} | ${pct(v.Sentinel)} |\n`;
}
let vals = '| Games lived | ♞ Knight | ♝ Bishop | ♜ Rook | ♛ Queen |\n|---:|---:|---:|---:|---:|\n';
for (const p of brain.curve) if (p.values) vals += `| ${p.games.toLocaleString('en')} | ${p.values.n.toFixed(1)} | ${p.values.b.toFixed(1)} | ${p.values.r.toFixed(1)} | ${p.values.q.toFixed(1)} |\n`;
vals += '| *textbook* | *3* | *3* | *5* | *9* |\n';
console.log(life);
console.log(vals);
