// Head-to-head matches between any two players, colours alternating, real rules, no learning.
//   node tools/arena.mjs <A> <B> [games] [seed]
// Players:
//   fly:<brain>:t<ms>   the fly thinking with a clock (think.js), e.g. fly:adult:t300
//   fly:<brain>:d<n>    the fly with the old fixed look-ahead (search.js), e.g. fly:adult:d1
//   bench:<name>        Random, Greedy, Counter, Sentinel
//   sf:<elo>[:<ms>]     Stockfish 19 lite (npm "stockfish") limited with UCI_Elo (1320–3190), default 100 ms
// Prints one JSON line: { a, b, w, d, l } from A's point of view.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Brain, setAnatomy } from '../src/brain.js';
import { Position, WHITE } from '../src/chess.js';
import { FlyPlayer, ThinkingFly, BENCH } from '../src/players.js';
import { mulberry32 } from '../src/util.js';

setAnatomy(JSON.parse(readFileSync(new URL('../data/mushroom_body.json', import.meta.url))));
const [A, B] = [process.argv[2], process.argv[3]];
const N = +(process.argv[4] || 20);
const SEED = +(process.argv[5] || 1);
const rnd = mulberry32(SEED);

function stockfish(elo, ms) {
  const require = createRequire(import.meta.url);
  let waiter = null;
  const engine = require('stockfish')('lite-single', (line) => { if (waiter) waiter(line); });
  const send = (c) => engine.processCommand(c);
  const until = (re) => new Promise((res) => { waiter = (l) => { if (re.test(l)) { waiter = null; res(l); } }; });
  const ready = (async () => {
    const ok = until(/uciok/);
    const poke = setInterval(() => send('uci'), 250); // the WASM engine ignores commands until it has loaded
    await ok; clearInterval(poke);
    send('setoption name UCI_LimitStrength value true');
    send(`setoption name UCI_Elo value ${elo}`);
    const rd = until(/readyok/); send('isready'); await rd;
  })();
  return {
    name: `Stockfish ${elo}`, async: true,
    async choose(pos, _rnd, _ply, uciMoves, fen0) {
      await ready;
      send(`position fen ${fen0} moves ${uciMoves.join(' ')}`);
      const done = until(/^bestmove/); // set the listener first: the engine may answer synchronously
      send(`go movetime ${ms}`);
      const line = await done;
      const u = line.split(' ')[1];
      return { move: pos.legal().find((m) => pos.uci(m) === u) };
    },
    quit() { try { send('quit'); engine.terminate?.(); } catch { /* ignore */ } },
  };
}

const brains = {};
function make(spec) {
  const p = spec.split(':');
  if (p[0] === 'bench') return BENCH[p[1]]();
  if (p[0] === 'sf') return stockfish(+p[1], +(p[2] || 100));
  const b = brains[p[1]] ||= Brain.fromJSON(readFileSync(new URL(`../brains/${p[1]}.json`, import.meta.url), 'utf8'));
  if (p[2][0] === 't') return new ThinkingFly(b, { timeMs: +p[2].slice(1) });
  return new FlyPlayer(b, { depth: +p[2].slice(1), temperature: 0, openingTemp: 0.1, openingPlies: 4 });
}

async function game(white, black) {
  const pos = new Position();
  const fen0 = pos.fen(), uci = [];
  for (let ply = 0; ply < 300; ply++) {
    const st = pos.status();
    if (st) return st.result === '1-0' ? 1 : st.result === '0-1' ? -1 : 0;
    const p = pos.side === WHITE ? white : black;
    const c = p.async ? await p.choose(pos, rnd, ply, uci, fen0) : p.choose(pos, rnd, ply);
    uci.push(pos.uci(c.move));
    pos.make(c.move);
  }
  return 0;
}

const pa = make(A), pb = make(B);
let w = 0, d = 0, l = 0;
for (let i = 0; i < N; i++) {
  const aWhite = (i + SEED) % 2 === 0;
  if (pa.thinker) pa.thinker.clear();
  if (pb.thinker) pb.thinker.clear();
  const r = await game(aWhite ? pa : pb, aWhite ? pb : pa);
  const s = aWhite ? r : -r;
  if (s > 0) w++; else if (s < 0) l++; else d++;
}
console.log(JSON.stringify({ a: A, b: B, w, d, l }));
for (const p of [pa, pb]) p.quit?.();
process.exit(0);
