// node test/learning.mjs [games] [wiring] — the headline claim, checked from scratch on every push:
// an egg wired like a real fly (FlyWire mushroom body) that knows nothing learns by self-play alone to value pieces sensibly and to beat
// the random and greedy players.
import { readFileSync } from 'node:fs';
import { Brain, setAnatomy } from '../src/brain.js';
import { selfPlayGame, match } from '../src/training.js';
import { pieceValues } from '../src/insight.js';
import { mulberry32 } from '../src/util.js';

setAnatomy(JSON.parse(readFileSync(new URL('../data/mushroom_body.json', import.meta.url))));
const WIRING = process.argv[3] || 'flywire';
const GAMES = +(process.argv[2] || 1000);
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };

const brain = new Brain({ nKC: 4000, seed: 1, wiring: WIRING });
console.log(`     an egg with ${WIRING} wiring: ${brain.nKC.toLocaleString('en')} Kenyon cells`);
const rnd = mulberry32(42), trnd = mulberry32(7);
const t0 = Date.now();

const before = match(brain, 'Greedy', 20, trnd);
check(pieceValues(brain) === null, 'a newly hatched fly has no idea what pieces are worth');
for (let i = 0; i < GAMES; i++) selfPlayGame(brain, rnd);
console.log(`     ${GAMES} self-play games in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const v = pieceValues(brain);
const f = (x) => x.toFixed(1);
check(!!v, `it now has opinions: N ${v && f(v.n)}, B ${v && f(v.b)}, R ${v && f(v.r)}, Q ${v && f(v.q)} pawns`);
check(v && v.q > v.r && v.r > Math.min(v.n, v.b) && Math.min(v.n, v.b) > 1.5, 'queen > rook > minor piece > pawn');
const vsRandom = match(brain, 'Random', 20, trnd);
check(vsRandom.score >= 0.9, `beats Random (${vsRandom.w}/${vsRandom.d}/${vsRandom.l})`);
const vsGreedy = match(brain, 'Greedy', 20, trnd);
check(vsGreedy.score >= 0.75 && vsGreedy.score > before.score, `beats Greedy (${vsGreedy.w}/${vsGreedy.d}/${vsGreedy.l}; as an egg: ${before.w}/${before.d}/${before.l})`);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed');
process.exit(fail ? 1 : 0);
