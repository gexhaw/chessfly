// Thinking with a clock: how the fly plays when you give it time.
// Iterative deepening + transposition table + principal-variation search + killer/history move
// ordering + check extension + quiescence. All of it is ordinary engine plumbing with no chess
// knowledge: the only judge of a position is still the fly's gut feeling (Brain.value).

import { PAWN, moveFlags, moveTo, moveFrom, movePromo, F_CAPTURE } from './chess.js';

export const MATE = 10;
const MATE_BOUND = MATE - 1;
const INF = 1e9;
const ORDER_VAL = [0, 1, 3, 3, 5, 9, 20];
const EXACT = 1, LOWER = 2, UPPER = 3;
const STOP = { stop: true };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Thinker {
  constructor(evaluator, { ttBits = 19, qDepth = 8 } = {}) {
    this.ev = evaluator;
    this.inc = typeof evaluator.attach === 'function';
    this.qDepth = qDepth;
    const n = 1 << ttBits;
    this.mask = n - 1;
    this.tLo = new Int32Array(n); this.tHi = new Int32Array(n);
    this.tMove = new Int32Array(n); this.tScore = new Float32Array(n);
    this.tDepth = new Int8Array(n); this.tFlag = new Uint8Array(n);
    this.killers = new Int32Array(256);
    this.history = new Int32Array(16 * 128);
    this.nodes = 0;
  }

  // forget everything (call after the brain has learned: old scores are stale)
  clear() { this.tFlag.fill(0); this.history.fill(0); this.killers.fill(0); }

  mk(pos, m) { if (!pos.make(m)) return false; if (this.inc) this.ev.onMake(pos); return true; }
  um(pos) { if (this.inc) this.ev.onUnmake(); pos.unmake(); }
  val(pos) { return this.inc ? this.ev.current(pos) : this.ev.value(pos); }

  drawn(pos) {
    if (pos.half >= 100) return true;
    const h = pos.hashes, lo = pos.hashLo, hi = pos.hashHi;
    const stop = Math.max(0, h.length - 2 - pos.half * 2);
    for (let i = h.length - 6; i >= stop; i -= 4) if (h[i] === lo && h[i + 1] === hi) return true;
    return false;
  }

  clock() { if ((++this.nodes & 255) === 0 && this.deadline && now() > this.deadline) throw STOP; }

  // ---- move ordering ----
  keys(pos, moves, ttMove, ply) {
    const b = pos.board, k = new Float64Array(moves.length);
    const k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      let s;
      if (m === ttMove) s = 1e7;
      else if (moveFlags(m) & F_CAPTURE) s = 1e6 + ORDER_VAL[b[moveTo(m)] & 7 || PAWN] * 10 - ORDER_VAL[b[moveFrom(m)] & 7];
      else if (movePromo(m)) s = 9e5 + movePromo(m);
      else if (m === k1) s = 8e5;
      else if (m === k2) s = 7e5;
      else s = this.history[(b[moveFrom(m)] & 15) * 128 + moveTo(m)];
      k[i] = s;
    }
    return k;
  }
  // selection sort step: bring the best remaining move to index i
  static next(moves, keys, i) {
    let bi = i;
    for (let j = i + 1; j < moves.length; j++) if (keys[j] > keys[bi]) bi = j;
    if (bi !== i) { const t = moves[i]; moves[i] = moves[bi]; moves[bi] = t; const u = keys[i]; keys[i] = keys[bi]; keys[bi] = u; }
    return moves[i];
  }

  // ---- transposition table ----
  probe(pos) {
    const i = pos.hashLo & this.mask;
    return this.tFlag[i] && this.tLo[i] === pos.hashLo && this.tHi[i] === pos.hashHi ? i : -1;
  }
  store(pos, depth, flag, score, move, ply) {
    const i = pos.hashLo & this.mask;
    if (this.tFlag[i] && this.tLo[i] === pos.hashLo && this.tHi[i] === pos.hashHi && this.tDepth[i] > depth && flag !== EXACT) return;
    if (score > MATE_BOUND) score += ply * 0.01; else if (score < -MATE_BOUND) score -= ply * 0.01;
    this.tLo[i] = pos.hashLo; this.tHi[i] = pos.hashHi; this.tMove[i] = move;
    this.tScore[i] = score; this.tDepth[i] = Math.min(127, depth); this.tFlag[i] = flag;
  }
  ttScore(i, ply) {
    let s = this.tScore[i];
    if (s > MATE_BOUND) s -= ply * 0.01; else if (s < -MATE_BOUND) s += ply * 0.01;
    return s;
  }

  qsearch(pos, alpha, beta, ply, qd) {
    this.clock();
    const check = pos.inCheck();
    let best = -INF;
    if (!check) {
      const stand = this.val(pos);
      if (stand >= beta || qd <= 0) return stand;
      if (stand > alpha) alpha = stand;
      best = stand;
    } else if (qd <= -2) return this.val(pos);
    const moves = pos.pseudo([], !check);
    const keys = this.keys(pos, moves, 0, Math.min(ply, 127));
    let any = false;
    for (let i = 0; i < moves.length; i++) {
      const m = Thinker.next(moves, keys, i);
      if (!this.mk(pos, m)) continue;
      any = true;
      let s;
      try { s = -this.qsearch(pos, -beta, -alpha, ply + 1, qd - 1); } finally { this.um(pos); }
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    if (check && !any) return -MATE + ply * 0.01;
    return best;
  }

  search(pos, depth, alpha, beta, ply, ext) {
    if (this.drawn(pos)) return 0;
    const check = pos.inCheck();
    if (check && ext < 6) { depth++; ext++; }
    if (depth <= 0) return this.qsearch(pos, alpha, beta, ply, this.qDepth);
    this.clock();
    const pvNode = beta - alpha > 1e-6;
    const ti = this.probe(pos);
    let ttMove = 0;
    if (ti >= 0) {
      ttMove = this.tMove[ti];
      if (!pvNode && this.tDepth[ti] >= depth) {
        const s = this.ttScore(ti, ply), f = this.tFlag[ti];
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }
    const moves = pos.pseudo([]);
    const pl = Math.min(ply, 127);
    const keys = this.keys(pos, moves, ttMove, pl);
    const a0 = alpha;
    let best = -INF, bestM = 0, n = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = Thinker.next(moves, keys, i);
      if (!this.mk(pos, m)) continue;
      let s;
      try {
        if (n === 0) s = -this.search(pos, depth - 1, -beta, -alpha, ply + 1, ext);
        else {
          s = -this.search(pos, depth - 1, -alpha - 1e-6, -alpha, ply + 1, ext);
          if (s > alpha && s < beta) s = -this.search(pos, depth - 1, -beta, -alpha, ply + 1, ext);
        }
      } finally { this.um(pos); }
      n++;
      if (s > best) { best = s; bestM = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (!(moveFlags(m) & F_CAPTURE) && !movePromo(m)) {
          if (this.killers[pl * 2] !== m) { this.killers[pl * 2 + 1] = this.killers[pl * 2]; this.killers[pl * 2] = m; }
          const h = (pos.board[moveFrom(m)] & 15) * 128 + moveTo(m);
          this.history[h] = Math.min(1e5, this.history[h] + depth * depth);
        }
        break;
      }
    }
    if (!n) return check ? -MATE + ply * 0.01 : 0;
    this.store(pos, depth, best >= beta ? LOWER : best > a0 ? EXACT : UPPER, best, bestM, ply);
    return best;
  }

  // Think about pos for up to timeMs. Returns the move, its score (side to move), how deep it got,
  // and exact scores for the moves within `margin` of the best (drawn as arrows).
  think(pos, { timeMs = 300, maxDepth = 64, margin = 0.03, minDepth = 1, rnd = Math.random } = {}) {
    const t0 = now();
    this.nodes = 0;
    this.killers.fill(0);
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 2;
    if (this.inc) this.ev.attach(pos);
    const moves = pos.legal();
    if (!moves.length) return null;
    for (let i = moves.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = moves[i]; moves[i] = moves[j]; moves[j] = t; }
    let scores = new Float64Array(moves.length).fill(-INF);
    let result = null;
    const stack0 = pos.stack.length;
    for (let d = 1; d <= maxDepth; d++) {
      this.deadline = d <= minDepth ? 0 : t0 + timeMs;
      const sc = new Float64Array(moves.length).fill(-INF);
      let done = 0, best = -INF;
      try {
        for (let i = 0; i < moves.length; i++) {
          const m = moves[i];
          this.mk(pos, m);
          let s;
          try {
            const lo = best - margin;
            if (i === 0) s = -this.search(pos, d - 1, -INF, INF, 1, 0);
            else {
              s = -this.search(pos, d - 1, -lo - 1e-6, -lo, 1, 0);
              if (s > lo) s = -this.search(pos, d - 1, -INF, -lo, 1, 0);
            }
          } finally { this.um(pos); }
          sc[i] = s; done++;
          if (s > best) best = s;
        }
      } catch (e) {
        if (e !== STOP) throw e;
        while (pos.stack.length > stack0) { if (this.inc) this.ev.onUnmake(); pos.unmake(); }
      }
      // a partly finished iteration still counts for the moves it finished (the old best goes first)
      if (done > 0) {
        for (let i = 0; i < done; i++) scores[i] = sc[i];
        if (done < moves.length) for (let i = done; i < moves.length; i++) scores[i] = Math.min(scores[i], scores[0] - margin - 1e-3);
        const idx = Array.from(moves.keys()).sort((a, b) => scores[b] - scores[a]);
        const ms = idx.map((i) => moves[i]), ss = idx.map((i) => scores[i]);
        for (let i = 0; i < moves.length; i++) { moves[i] = ms[i]; scores[i] = ss[i]; }
        const depth = done === moves.length ? d : d - 1 + done / moves.length;
        result = { move: moves[0], score: scores[0], depth, nodes: this.nodes };
      }
      const el = now() - t0;
      if (done < moves.length) break;
      if (Math.abs(scores[0]) > MATE_BOUND && d >= 2) break; // found a forced mate (or is getting mated)
      if (moves.length === 1 && d >= 2) break;
      if (el > timeMs * 0.55) break;
    }
    this.deadline = 0;
    const best = scores[0];
    const top = [];
    for (let i = 0; i < moves.length && top.length < 5; i++) if (scores[i] >= best - margin) top.push([moves[i], scores[i]]);
    return { ...result, top, ms: now() - t0 };
  }
}
