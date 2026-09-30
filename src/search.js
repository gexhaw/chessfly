// Tiny look-ahead: negamax alpha-beta + quiescence. The fly's "gut feeling" (Brain.value) is the
// only knowledge in it — no material values, no piece-square tables, no opening book.

import { PAWN, KING, moveFlags, moveTo, moveFrom, movePromo, F_CAPTURE } from './chess.js';

export const MATE = 10;
const ORDER_VAL = [0, 1, 3, 3, 5, 9, 20];

function orderMoves(pos, moves) {
  const b = pos.board;
  const keys = new Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    let k = 0;
    if (moveFlags(m) & F_CAPTURE) {
      const victim = b[moveTo(m)] & 7 || PAWN;
      k = 100 + ORDER_VAL[victim] * 10 - ORDER_VAL[b[moveFrom(m)] & 7];
    }
    if (movePromo(m)) k += 90 + movePromo(m);
    keys[i] = k;
  }
  const idx = moves.map((_, i) => i).sort((a, c) => keys[c] - keys[a]);
  return idx.map((i) => moves[i]);
}

export class Searcher {
  constructor(evaluator, { depth = 1, qDepth = 6 } = {}) {
    this.ev = evaluator; this.depth = depth; this.qDepth = qDepth; this.nodes = 0;
    this.inc = typeof evaluator.attach === 'function';
  }

  mk(pos, m) {
    if (!pos.make(m)) return false;
    if (this.inc) this.ev.onMake(pos);
    return true;
  }
  um(pos) { if (this.inc) this.ev.onUnmake(); pos.unmake(); }
  val(pos) { return this.inc ? this.ev.current(pos) : this.ev.value(pos); }
  begin(pos) { this.nodes = 0; if (this.inc) this.ev.attach(pos); }

  drawn(pos) {
    if (pos.half >= 100) return true;
    // any repetition inside the reversible window counts as a draw during search
    const h = pos.hashes, lo = pos.hashLo, hi = pos.hashHi;
    const stop = Math.max(0, h.length - 2 - pos.half * 2);
    for (let i = h.length - 6; i >= stop; i -= 4) if (h[i] === lo && h[i + 1] === hi) return true;
    return false;
  }

  qsearch(pos, alpha, beta, ply, qd) {
    this.nodes++;
    const check = pos.inCheck();
    let best = -Infinity;
    if (!check) {
      const stand = this.val(pos);
      if (stand >= beta || qd <= 0) return stand;
      if (stand > alpha) alpha = stand;
      best = stand;
    } else if (qd <= -2) return this.val(pos);
    const moves = orderMoves(pos, pos.pseudo([], !check));
    let any = false;
    for (const m of moves) {
      if (!this.mk(pos, m)) continue;
      any = true;
      const s = -this.qsearch(pos, -beta, -alpha, ply + 1, qd - 1);
      this.um(pos);
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    if (check && !any) return -MATE + ply * 0.01;
    return best;
  }

  negamax(pos, depth, alpha, beta, ply) {
    if (ply > 0 && this.drawn(pos)) return 0;
    if (depth <= 0) return this.qsearch(pos, alpha, beta, ply, this.qDepth);
    this.nodes++;
    const moves = orderMoves(pos, pos.pseudo([]));
    let best = -Infinity, any = false;
    for (const m of moves) {
      if (!this.mk(pos, m)) continue;
      any = true;
      const s = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1);
      this.um(pos);
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    if (!any) return pos.inCheck() ? -MATE + ply * 0.01 : 0;
    return best;
  }

  // Scores every legal root move exactly (needed to sample moves by preference).
  scoreRoot(pos, depth = this.depth) {
    this.begin(pos);
    const moves = orderMoves(pos, pos.legal());
    const scores = new Float64Array(moves.length);
    for (let i = 0; i < moves.length; i++) {
      this.mk(pos, moves[i]);
      scores[i] = -this.negamax(pos, depth - 1, -Infinity, Infinity, 1);
      this.um(pos);
    }
    return { moves, scores };
  }

  // Best move only (alpha-beta at the root too).
  best(pos, depth = this.depth, rnd = null) {
    this.begin(pos);
    const legal = pos.legal();
    if (rnd) for (let i = legal.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = legal[i]; legal[i] = legal[j]; legal[j] = t; }
    // no capture-first ordering at the root: equal-looking moves are chosen uniformly
    const moves = rnd ? legal : orderMoves(pos, legal);
    let alpha = -Infinity, bestM = moves[0], bestS = -Infinity;
    for (const m of moves) {
      this.mk(pos, m);
      const s = -this.negamax(pos, depth - 1, -Infinity, -alpha, 1);
      this.um(pos);
      if (s > bestS) { bestS = s; bestM = m; }
      if (s > alpha) alpha = s;
    }
    return { move: bestM, score: bestS };
  }
}

// Softmax pick over root scores. temperature 0 = always the best (ties broken at random).
export function pick(moves, scores, temperature, rnd) {
  let top = -Infinity;
  for (const s of scores) if (s > top) top = s;
  if (!(temperature > 0)) {
    const ties = [];
    for (let i = 0; i < moves.length; i++) if (scores[i] >= top - 1e-9) ties.push(i);
    const i = ties[Math.floor(rnd() * ties.length)];
    return { move: moves[i], score: scores[i] };
  }
  const w = new Float64Array(moves.length);
  let sum = 0;
  for (let i = 0; i < moves.length; i++) { w[i] = Math.exp((scores[i] - top) / temperature); sum += w[i]; }
  let r = rnd() * sum;
  for (let i = 0; i < moves.length; i++) { r -= w[i]; if (r <= 0) return { move: moves[i], score: scores[i] }; }
  return { move: moves[moves.length - 1], score: scores[moves.length - 1] };
}

export const clampScore = (s) => Math.max(-1, Math.min(1, s));
