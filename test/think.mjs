// node test/think.mjs — the clocked searcher: finds mates, keeps the brain consistent when the
// clock interrupts it mid-search, and respects its time budget.
import { readFileSync } from 'node:fs';
import { Brain, setAnatomy } from '../src/brain.js';
import { Position } from '../src/chess.js';
import { Thinker, MATE } from '../src/think.js';
import { mulberry32 } from '../src/util.js';

setAnatomy(JSON.parse(readFileSync(new URL('../data/mushroom_body.json', import.meta.url))));
const brain = Brain.fromJSON(readFileSync(new URL('../brains/adult.json', import.meta.url), 'utf8'));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const rnd = mulberry32(5);

{
  const pos = new Position('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const r = new Thinker(brain).think(pos, { timeMs: 300, rnd });
  check(pos.uci(r.move) === 'a1a8' && r.score > MATE - 1, `mate in 1: ${pos.uci(r.move)} (${r.score.toFixed(2)})`);
}
{
  const pos = new Position('6k1/8/8/8/8/8/R7/1R4K1 w - - 0 1');
  const r = new Thinker(brain).think(pos, { timeMs: 1500, rnd });
  check(r.score > MATE - 1, `mate in 2 seen: ${pos.uci(r.move)} (${r.score.toFixed(2)}, depth ${r.depth})`);
}
{
  // interrupted many times: the board and the brain's incremental state must come back intact
  const fens = ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'];
  let bad = 0;
  const t = new Thinker(brain);
  for (const fen of fens) for (const ms of [5, 17, 40, 90]) {
    const pos = new Position(fen);
    const before = pos.fen(), h = pos.hashLo;
    t.think(pos, { timeMs: ms, rnd });
    if (pos.fen() !== before || pos.hashLo !== h || pos.stack.length !== 0) bad++;
    if (Math.abs(brain.current(pos) - brain.value(pos)) > 1e-6) bad++;
  }
  check(bad === 0, 'interrupted searches leave the position and the brain untouched');
}
{
  const pos = new Position();
  const t = new Thinker(brain);
  const t0 = performance.now();
  const r = t.think(pos, { timeMs: 400, rnd });
  const ms = performance.now() - t0;
  check(ms < 400 * 1.3 + 60, `400 ms budget: took ${ms.toFixed(0)} ms, depth ${r.depth.toFixed(1)}, ${r.nodes.toLocaleString('en')} nodes`);
  check(r.top.length >= 1 && r.top[0][0] === r.move, `reports its candidate moves (${r.top.length})`);
}
if (fail) { console.log(`${fail} failed`); process.exit(1); }
