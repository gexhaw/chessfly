// A fly's life: play games, then let dopamine rewire the KC→MBON synapses.

import { Position, WHITE, material } from './chess.js';
import { Brain } from './brain.js';
import { FlyPlayer, BENCH, BENCH_ELO } from './players.js';

export const RESULT_SCORE = { '1-0': 1, '0-1': -1, '1/2-1/2': 0 };

// Plays one game. Returns { result: white-perspective score in [-1, 1], reason, moves, plies }.
// plies[i] = { pn: Int16Array (active PNs, mover's view), score: mover's search value or null }
// adjudicate: when the game hits maxPlies, score it by material (used only while training).
export function playGame(white, black, { rnd = Math.random, maxPlies = 300, adjudicate = false, onMove = null, fen } = {}) {
  const pos = new Position(fen);
  const plies = [], moves = [];
  const buf = new Int32Array(128);
  let status = null;
  for (let ply = 0; ; ply++) {
    status = pos.status();
    if (status) break;
    if (ply >= maxPlies) {
      if (adjudicate) {
        const m = material(pos, WHITE);
        return { result: Math.tanh(m / 6), reason: 'move limit (adjudicated on material)', moves, plies, pos };
      }
      status = { result: '1/2-1/2', reason: 'move limit' };
      break;
    }
    const player = pos.side === WHITE ? white : black;
    const n = Brain.pns(pos, buf);
    // "noisy" = mid-exchange or in check: the static feeling there is not worth much
    const noisy = pos.inCheck() || (moves.length > 0 && (moves[moves.length - 1] >> 17) & 1);
    const c = player.choose(pos, rnd, ply);
    plies.push({ pn: Int16Array.from(buf.subarray(0, n)), score: c.score ?? null, noisy: !!noisy });
    moves.push(c.move);
    if (onMove) onMove(pos, c.move, c);
    pos.make(c.move);
  }
  return { result: RESULT_SCORE[status.result], reason: status.reason, resultStr: status.result, moves, plies, pos };
}

// TD(λ) with search-value bootstrap, applied backwards through the game.
// Every position is seen from the side to move, so one brain learns both colours.
export function learnFromGame(brain, game, { lambda = 0.7, lr = 1, noisyW = 1 } = {}) {
  const P = game.plies, T = P.length;
  if (!T) return { dopamine: 0 };
  const pn32 = new Int32Array(128);
  // mover of ply t is White when t is even (games start from the initial position)
  let G = (T - 1) % 2 === 0 ? game.result : -game.result;
  let sumAbs = 0;
  for (let t = T - 1; t >= 0; t--) {
    const p = P[t];
    pn32.set(p.pn);
    const err = brain.learn(pn32, p.pn.length, G, p.noisy ? lr * noisyW : lr);
    sumAbs += Math.abs(err);
    if (t > 0) {
      // bootstrap from what the mover at t thought when it was to move (its search value)
      let b = p.score;
      if (b === null) b = Math.tanh(brain.drive(pn32, p.pn.length));
      G = -((1 - lambda) * b + lambda * G);
    }
  }
  brain.clearCache();
  brain.games++;
  return { dopamine: sumAbs / T };
}

// Young flies act on instinct (1 move of look-ahead); from adulthood they think 2 moves ahead,
// which makes their games, and so their lessons, better.
export const ADULT = 3000;
export const lifeDepth = (games) => (games < ADULT ? 1 : 2);
export const lifeRate = (games) => 0.25 * Math.max(0.12, 1 / Math.sqrt(1 + games / 1500));

// One self-play game: the fly plays both sides, with some curiosity (softmax exploration).
export function selfPlayGame(brain, rnd, opts = {}) {
  const fly = new FlyPlayer(brain, { depth: opts.depth ?? lifeDepth(brain.games), qDepth: opts.qDepth ?? 6, epsilon: opts.epsilon ?? 0.05, openingTemp: 0.25, openingPlies: 6 });
  const g = playGame(fly, fly, { rnd, maxPlies: opts.maxPlies ?? 200, adjudicate: true, onMove: opts.onMove || null });
  // learning rate anneals over the fly's life: bold as a larva, careful as an adult
  const lr = opts.lr ?? lifeRate(brain.games);
  const r = learnFromGame(brain, g, { lambda: opts.lambda ?? 0.7, lr, noisyW: opts.noisyW ?? 1 });
  return { ...g, ...r };
}

// Strength test: n games vs a benchmark bot, colours alternating, no learning, real rules.
export function match(brain, botName, n, rnd, { depth = 1 } = {}) {
  const fly = new FlyPlayer(brain, { depth, temperature: 0, openingTemp: 0.1, openingPlies: 4 });
  let w = 0, d = 0, l = 0;
  for (let i = 0; i < n; i++) {
    const bot = BENCH[botName]();
    const flyWhite = i % 2 === 0;
    const g = playGame(flyWhite ? fly : bot, flyWhite ? bot : fly, { rnd, maxPlies: 300 });
    const s = flyWhite ? g.result : -g.result;
    if (s > 0) w++; else if (s < 0) l++; else d++;
  }
  return { w, d, l, score: (w + d / 2) / n };
}

export const eloDiff = (score) => {
  const s = Math.min(0.99, Math.max(0.01, score));
  return -400 * Math.log10(1 / s - 1);
};

// Elo estimate from results against the anchors (maximum likelihood over a grid).
export function estimateElo(results) {
  let best = 0, bestLL = -Infinity;
  for (let r = 0; r <= 3000; r += 5) {
    let ll = 0;
    for (const { opp, w, d, l } of results) {
      const e = 1 / (1 + 10 ** ((BENCH_ELO[opp] - r) / 400));
      const pe = Math.min(1 - 1e-6, Math.max(1e-6, e));
      ll += (w + d / 2) * Math.log(pe) + (l + d / 2) * Math.log(1 - pe);
    }
    if (ll > bestLL) { bestLL = ll; best = r; }
  }
  return best;
}
