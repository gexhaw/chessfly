// Players: the fly, and three fixed benchmark opponents used to measure how strong it has become.

import { Searcher, pick, clampScore } from './search.js';
import { material, moveFlags, moveTo, movePromo, F_CAPTURE, PIECE_VALUE, PAWN } from './chess.js';

export class FlyPlayer {
  // temperature > 0: sample among all root moves by preference (needs every move scored exactly).
  // epsilon: otherwise play the best move, but with this probability try a random one (curiosity).
  constructor(brain, { depth = 1, qDepth = 6, temperature = 0, epsilon = 0, openingTemp = 0, openingPlies = 0 } = {}) {
    this.brain = brain; this.kind = 'fly';
    this.search = new Searcher(brain, { depth, qDepth });
    this.temperature = temperature; this.epsilon = epsilon;
    this.openingTemp = openingTemp; this.openingPlies = openingPlies;
  }
  get name() { return this.brain.name; }
  choose(pos, rnd, ply = 0) {
    const t = ply < this.openingPlies ? this.openingTemp : this.temperature;
    if (t > 0) {
      const { moves, scores } = this.search.scoreRoot(pos);
      const r = pick(moves, scores, t, rnd);
      return { move: r.move, score: clampScore(r.score), moves, scores };
    }
    const r = this.search.best(pos, this.search.depth, rnd);
    if (this.epsilon > 0 && rnd() < this.epsilon) {
      const ms = pos.legal();
      return { move: ms[Math.floor(rnd() * ms.length)], score: clampScore(r.score), explored: true };
    }
    return { move: r.move, score: clampScore(r.score) };
  }
}

export class RandomBot {
  constructor() { this.kind = 'bot'; this.name = 'Random'; }
  choose(pos, rnd) { const ms = pos.legal(); return { move: ms[Math.floor(rnd() * ms.length)] }; }
}

// Grabs the most valuable thing it can; mates in one if it sees it; otherwise random.
export class GreedyBot {
  constructor() { this.kind = 'bot'; this.name = 'Greedy'; }
  choose(pos, rnd) {
    const ms = pos.legal();
    let best = -1, pool = [];
    for (const m of ms) {
      let g = 0;
      if (moveFlags(m) & F_CAPTURE) g += PIECE_VALUE[pos.board[moveTo(m)] & 7 || PAWN];
      if (movePromo(m)) g += PIECE_VALUE[movePromo(m)] - 1;
      pos.make(m);
      if (pos.inCheck() && !pos.hasLegal()) g = 1000;
      pos.unmake();
      if (g > best) { best = g; pool = [m]; } else if (g === best) pool.push(m);
    }
    return { move: pool[Math.floor(rnd() * pool.length)] };
  }
}

// Counts material with a 2-ply search + captures. Knows nothing else.
class MaterialEval {
  constructor() { this.salt = 0; }
  value(pos) {
    const noise = (((pos.hashLo ^ this.salt) >>> 0) % 1000) / 1e6; // tie-breaker
    return Math.tanh(material(pos, pos.side) * 0.15) + noise;
  }
}
export class SentinelBot {
  constructor(depth = 2, name = 'Sentinel') {
    this.kind = 'bot'; this.name = name; this.ev = new MaterialEval(); this.depth = depth;
    this.search = new Searcher(this.ev, { depth, qDepth: 6 });
  }
  choose(pos, rnd) {
    this.ev.salt = (rnd() * 2 ** 31) | 0;
    return this.search.best(pos, this.depth, rnd);
  }
}

export const BENCH = {
  Random: () => new RandomBot(),
  Greedy: () => new GreedyBot(),
  Counter: () => new SentinelBot(1, 'Counter'),
  Sentinel: () => new SentinelBot(2, 'Sentinel'),
};
// Ratings of the fixed opponents on the ChessFly scale (anchored Random = 400),
// measured by tools/calibrate.mjs — see README.
export const BENCH_ELO = { Random: 400, Greedy: 915, Counter: 1570, Sentinel: 2025 };
