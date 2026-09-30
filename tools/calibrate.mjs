// Measure the benchmark bots against each other to put them on one Elo scale (Random = 400).
//   node tools/calibrate.mjs 200
import { BENCH } from '../src/players.js';
import { playGame } from '../src/training.js';
import { mulberry32 } from '../src/util.js';

const N = +(process.argv[2] || 200);
const rnd = mulberry32(99);
const names = Object.keys(BENCH);
const res = [];
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const a = names[j], b = names[i];
  let w = 0, d = 0, l = 0;
  for (let k = 0; k < N; k++) {
    const A = BENCH[a](), B = BENCH[b]();
    const aWhite = k % 2 === 0;
    const g = playGame(aWhite ? A : B, aWhite ? B : A, { rnd, maxPlies: 300 });
    const s = aWhite ? g.result : -g.result;
    if (s > 0) w++; else if (s < 0) l++; else d++;
  }
  res.push({ a, b, w, d, l });
  console.log(`${a} vs ${b}: +${w} =${d} -${l}`);
}
// maximum-likelihood ratings, Random fixed at 400 (coordinate ascent on a grid)
const R = Object.fromEntries(names.map((n) => [n, 400]));
const ll = () => res.reduce((s, { a, b, w, d, l }) => {
  const e = Math.min(1 - 1e-4, Math.max(1e-4, 1 / (1 + 10 ** ((R[b] - R[a]) / 400))));
  return s + (w + d / 2) * Math.log(e) + (l + d / 2) * Math.log(1 - e);
}, 0);
for (let it = 0; it < 30; it++) for (const n of names) {
  if (n === 'Random') continue;
  let best = R[n], bl = -Infinity;
  for (let r = 0; r <= 3000; r += 5) { R[n] = r; const v = ll(); if (v > bl) { bl = v; best = r; } }
  R[n] = best;
}
console.log('BENCH_ELO =', JSON.stringify(R));
