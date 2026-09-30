// Real wiring vs shuffled vs random: bigger exams and a head-to-head round robin between adult flies.
//   node tools/compare.mjs 100 brains/adult.json brains/adult-shuffled.json brains/adult-random.json
import { readFileSync } from 'node:fs';
import { Brain, setAnatomy } from '../src/brain.js';
import { FlyPlayer } from '../src/players.js';
import { playGame, match, estimateElo } from '../src/training.js';
import { mulberry32 } from '../src/util.js';

setAnatomy(JSON.parse(readFileSync(new URL('../data/mushroom_body.json', import.meta.url))));
const [, , nArg = '100', ...files] = process.argv;
const N = +nArg;
const brains = files.map((f) => Brain.fromJSON(readFileSync(f, 'utf8')));
const name = (b) => ({ flywire: 'Real (FlyWire)', shuffled: 'Shuffled claws', random: 'Random' })[b.wiring];

console.log(`| Wiring | Games lived | vs Counter | vs Sentinel | Rating (${2 * N} exam games) |\n|---|---:|---:|---:|---:|`);
for (const b of brains) {
  const r = mulberry32(2024);
  const res = ['Counter', 'Sentinel'].map((opp) => ({ opp, ...match(b, opp, N, r) }));
  const f = (x) => `${Math.round(100 * x.score)}% (+${x.w} =${x.d} −${x.l})`;
  console.log(`| ${name(b)} | ${b.games.toLocaleString('en')} | ${f(res[0])} | ${f(res[1])} | **${estimateElo(res)}** |`);
}

console.log(`\nHead to head, ${N} games per pair, colours alternating, both look 1 move ahead:\n`);
const score = brains.map(() => brains.map(() => null));
brains.forEach((a, i) => brains.forEach((b, j) => {
  if (j <= i) return;
  const r = mulberry32(7);
  let s = 0;
  for (let k = 0; k < N; k++) {
    const A = new FlyPlayer(a, { depth: 1, openingTemp: 0.1, openingPlies: 4 }), B = new FlyPlayer(b, { depth: 1, openingTemp: 0.1, openingPlies: 4 });
    const aWhite = k % 2 === 0;
    const g = playGame(aWhite ? A : B, aWhite ? B : A, { rnd: r, maxPlies: 300 });
    s += (aWhite ? g.result : -g.result) / 2 + 0.5;
  }
  score[i][j] = s / N; score[j][i] = 1 - s / N;
}));
console.log(`| row scores against column | ${brains.map(name).join(' | ')} |\n|---|${brains.map(() => '---:').join('|')}|`);
brains.forEach((a, i) => console.log(`| **${name(a)}** | ${brains.map((b, j) => (i === j ? '—' : `${Math.round(100 * score[i][j])}%`)).join(' | ')} |`));
