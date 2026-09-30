// Train a fly by self-play in Node and save life-stage snapshots.
//   node tools/train.mjs --wiring flywire --games 10000 --seed 1 --out brains --every 500 --test 40
//   (--wiring flywire | shuffled | random; --kc sets the number of Kenyon cells for random wiring)
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { Brain, stage, setAnatomy } from '../src/brain.js';
import { selfPlayGame, match, estimateElo } from '../src/training.js';
import { mulberry32 } from '../src/util.js';
import { pieceValues } from '../src/insight.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GAMES = +arg('games', 2000), KC = +arg('kc', 4000), SEED = +arg('seed', 1);
const EVERY = +arg('every', 500), TEST = +arg('test', 40), OUT = arg('out', 'brains');
const SNAPS = (arg('snaps', '0,100,400,3000') || '').split(',').filter(Boolean).map(Number);
const LAMBDA = +arg('lambda', 0.7), EPS = +arg('eps', 0.05), LR = arg('lr', null) === null ? undefined : +arg('lr');
const TAG = arg('tag', 'fly');
const EXAMS = arg('exams', '') ? arg('exams').split(',').map(Number) : null;
const isExam = (g) => (EXAMS ? EXAMS.includes(g) : g % EVERY === 0);
const RESUME = arg('resume', '');

const WIRING = arg('wiring', 'random');
setAnatomy(JSON.parse(readFileSync(new URL('../data/mushroom_body.json', import.meta.url))));
mkdirSync(OUT, { recursive: true });
const brain = RESUME ? Brain.fromJSON(readFileSync(RESUME, 'utf8')) : new Brain({ nKC: KC, seed: SEED, name: TAG, wiring: WIRING });
const rnd = mulberry32(SEED * 7919 + brain.games);
const trnd = mulberry32(12345);

function test() {
  const res = [];
  for (const opp of (arg('opps', 'Random,Greedy,Counter,Sentinel')).split(',')) res.push({ opp, ...match(brain, opp, TEST, trnd) });
  const elo = estimateElo(res);
  const v = pieceValues(brain);
  const pt = { games: brain.games, elo, vs: Object.fromEntries(res.map((r) => [r.opp, [r.w, r.d, r.l]])) };
  if (v) pt.values = Object.fromEntries(['n', 'b', 'r', 'q'].map((k) => [k, +v[k].toFixed(2)]));
  brain.curve.push(pt);
  return pt;
}

const save = (file) => writeFileSync(`${OUT}/${file}`, JSON.stringify(brain.toJSON()));
const t0 = Date.now();
let dop = 0, plies = 0, n = 0;
const lines = [];
const log = (s) => { console.log(s); lines.push(s); writeFileSync(`${OUT}/${TAG}.log`, lines.join('\n') + '\n'); };
if (!RESUME && isExam(0)) { const p = test(); log(`games ${p.games}  elo ${p.elo}  ${JSON.stringify(p.vs)}`); }
if (SNAPS.includes(brain.games)) save(`${TAG}-${brain.games}.json`);
while (brain.games < GAMES) {
  const g = selfPlayGame(brain, rnd, { lambda: LAMBDA, epsilon: EPS, lr: LR, noisyW: +arg('noisy', 1), depth: arg('depth', null) === null ? undefined : +arg('depth') });
  dop += g.dopamine; plies += g.plies.length; n++;
  if (SNAPS.includes(brain.games)) save(`${TAG}-${brain.games}.json`);
  if (isExam(brain.games)) {
    const p = test();
    const sec = (Date.now() - t0) / 1000;
    log(`games ${p.games}  elo ${p.elo}  ${JSON.stringify(p.vs)}  values ${JSON.stringify(p.values || null)}  dopamine ${(dop / n).toFixed(3)}  plies ${(plies / n).toFixed(0)}  ${sec.toFixed(0)}s  (${stage(brain.games)})`);
    dop = 0; plies = 0; n = 0;
    save(`${TAG}-latest.json`);
  }
}
save(`${TAG}-latest.json`);
