// The fly's mushroom body.
//
//   board ──► 806 input channels ──► projection neurons (PNs) ──► Kenyon cells (KCs) ──► 1 output neuron (MBON)
//             768 "which piece where"                     claws; a KC fires            "does this feel good?"
//             + 38 "how many"                             on ≥ 2 active claws
//                                                                   ▲
//                                                       dopamine (DANs) = prediction error
//
// Three ways to wire PNs to KCs (the wiring never changes during a fly's life, as in real flies):
//   'flywire'  the real thing: all 285 antennal-lobe PNs and 5,177 KCs of the FlyWire v783 connectome,
//              with every PN→KC connection of ≥ 5 synapses. The 768 board channels converge onto the
//              285 PNs (2–3 each), like many odorant receptors converging onto a few glomeruli.
//   'shuffled' the same KCs with the same number of claws, but each claw re-drawn at random
//              (the classic control for the FlyWire wiring).
//   'random'   the original ChessFly model: one PN per channel, 4,000 KCs, 7 random claws each.
// Learning happens only at the KC→MBON synapses (and a PN→MBON shortcut, see README), driven by a
// dopamine-like temporal-difference error after every game.

import { mulberry32, f32ToB64, b64ToF32 } from './util.js';
import { WHITE } from './chess.js';

// 768 "where" PNs (piece kind × square) + 38 "how many" PNs (thermometer code of piece counts).
export const N_WHERE = 768;
const CAP = [0, 8, 3, 3, 3, 2, 0];                 // count PNs per piece type (king: none)
const CNT_OFF = [0, 0, 8, 11, 14, 17, 19];          // offsets within one side's 19 count PNs
export const N_CNT = 38;
export const N_PN = N_WHERE + N_CNT;
export const BRAIN_FORMAT = 'chessfly-brain';

let ANATOMY = null; // data/mushroom_body.json, needed for 'flywire' and 'shuffled' wiring
export const setAnatomy = (a) => { ANATOMY = a; };
export const getAnatomy = () => ANATOMY;

export class Brain {
  constructor({ nKC = 4000, claws = 7, threshold = 2, seed = 1, name = 'fly', wiring = 'random' } = {}) {
    if (wiring !== 'random') {
      if (!ANATOMY) throw new Error(`the ${wiring} wiring needs data/mushroom_body.json (call setAnatomy first)`);
      nKC = ANATOMY.kc.n; claws = 0;
    }
    this.nKC = nKC; this.claws = claws; this.threshold = threshold; this.seed = seed; this.name = name; this.wiring = wiring;
    this.wire();
    this.wKC = new Float32Array(nKC);
    this.wPN = new Float32Array(N_PN);
    this.bias = 0;
    this.games = 0;             // games lived (learned from)
    this.record = { w: 0, d: 0, l: 0 };
    this.curve = [];            // [{games, elo, ...}] measured strength over its life
    this.born = Date.now();
    this.cacheSize = 1 << 16;
    this.cLo = new Int32Array(this.cacheSize); this.cHi = new Int32Array(this.cacheSize);
    this.cVal = new Float32Array(this.cacheSize); this.cOk = new Uint8Array(this.cacheSize);
    this.counts = new Uint8Array(nKC);
    this.touched = new Int32Array(nKC);
    this.pnBuf = new Int32Array(128);
    this.kcBuf = new Int32Array(nKC);
    this.evals = 0;
  }

  wire() {
    const { nKC } = this;
    const rnd = mulberry32(this.seed * 2654435761);
    // which PN each board channel drives, and the KC → PN claws (CSR: kcStart / kcList)
    if (this.wiring === 'random') {
      const claws = this.claws;
      this.nCell = N_WHERE;
      this.chanPN = Int16Array.from({ length: N_WHERE }, (_, i) => i);
      this.kcStart = Int32Array.from({ length: nKC + 1 }, (_, k) => k * claws);
      this.kcList = new Int32Array(nKC * claws);
      for (let k = 0; k < nKC; k++) {
        for (let c = 0; c < claws; c++) {
          let p, dup;
          do {
            p = Math.floor(rnd() * N_WHERE);
            dup = false;
            for (let j = 0; j < c; j++) if (this.kcList[k * claws + j] === p) dup = true;
          } while (dup);
          this.kcList[k * claws + c] = p;
        }
      }
    } else {
      const A = ANATOMY;
      this.nCell = A.pn.n;
      // board channels → real PNs: a fixed random convergence, 2–3 channels per PN
      const perm = Array.from({ length: N_WHERE }, (_, i) => i);
      for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      this.chanPN = new Int16Array(N_WHERE);
      perm.forEach((ch, i) => { this.chanPN[ch] = i % A.pn.n; });
      this.kcStart = Int32Array.from(A.kc.start);
      this.kcList = Int32Array.from(A.kc.claws);
      if (this.wiring === 'shuffled') {
        // same number of claws per KC and same PN popularity; which PN each claw comes from is random
        const pool = this.kcList.slice();
        const r2 = mulberry32(this.seed * 7777 + 1);
        for (let k = 0; k < nKC; k++) {
          const a = this.kcStart[k], b = this.kcStart[k + 1];
          for (let j = a; j < b; j++) {
            let p, dup, tries = 0;
            do {
              p = pool[Math.floor(r2() * pool.length)];
              dup = false;
              for (let q = a; q < j; q++) if (this.kcList[q] === p) dup = true;
            } while (dup && ++tries < 50);
            this.kcList[j] = p;
          }
        }
      }
    }
    // PN → KC adjacency (CSR)
    const nC = this.nCell, E = this.kcList.length;
    this.pnStart = new Int32Array(nC + 1);
    for (let i = 0; i < E; i++) this.pnStart[this.kcList[i] + 1]++;
    for (let p = 0; p < nC; p++) this.pnStart[p + 1] += this.pnStart[p];
    this.pnList = new Int32Array(E);
    const fill = this.pnStart.slice(0, nC);
    for (let k = 0; k < nKC; k++) for (let j = this.kcStart[k]; j < this.kcStart[k + 1]; j++) this.pnList[fill[this.kcList[j]]++] = k;
    this.pnMark = new Int32Array(nC); this.stamp = 0;
  }

  // Projection neurons from the point of view of the side to move:
  // index = (own ? 0 : 6) * 64 + (type - 1) * 64 + square (board mirrored for Black).
  // Then the count PNs: N_WHERE + (own ? 0 : 19) + CNT_OFF[type] + (k - 1) for "at least k".
  static pns(pos, out) {
    const b = pos.board, us = pos.side, flip = us === WHITE ? 0 : 56;
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let n = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s];
      if (!p) continue;
      const own = (p & 8) === us ? 0 : 6;
      const sq = (((s >> 4) << 3) | (s & 7)) ^ flip;
      out[n++] = (own + (p & 7) - 1) * 64 + sq;
      cnt[own + (p & 7)]++;
    }
    for (let side = 0; side < 2; side++) for (let t = 1; t <= 5; t++) {
      const c = Math.min(cnt[side * 6 + t], CAP[t]);
      for (let k = 1; k <= c; k++) out[n++] = N_WHERE + side * 19 + CNT_OFF[t] + k - 1;
    }
    return n;
  }

  // Active Kenyon cells for a set of active PNs. Returns count; indices in this.kcBuf.
  kcs(pn, nPn, out = this.kcBuf) {
    const counts = this.counts, touched = this.touched, st = this.pnStart, list = this.pnList, th = this.threshold;
    const mark = this.pnMark, chan = this.chanPN, stamp = ++this.stamp;
    let nt = 0, na = 0;
    for (let i = 0; i < nPn; i++) {
      if (pn[i] >= N_WHERE) continue;
      const p = chan[pn[i]];
      if (mark[p] === stamp) continue; // this PN is already on (several channels converge on it)
      mark[p] = stamp;
      for (let j = st[p], e = st[p + 1]; j < e; j++) {
        const k = list[j];
        if (counts[k]++ === 0) touched[nt++] = k;
      }
    }
    for (let i = 0; i < nt; i++) {
      const k = touched[i];
      if (counts[k] >= th) out[na++] = k;
      counts[k] = 0;
    }
    return na;
  }

  drive(pn, nPn) {
    let y = this.bias;
    for (let i = 0; i < nPn; i++) y += this.wPN[pn[i]];
    const na = this.kcs(pn, nPn);
    const kb = this.kcBuf, w = this.wKC;
    for (let i = 0; i < na; i++) y += w[kb[i]];
    return y;
  }

  // Value of the position for the side to move, in (-1, 1).
  value(pos) {
    const h = (pos.hashLo ^ (pos.hashHi >>> 7)) & (this.cacheSize - 1);
    if (this.cOk[h] && this.cLo[h] === pos.hashLo && this.cHi[h] === pos.hashHi) return this.cVal[h];
    const n = Brain.pns(pos, this.pnBuf);
    const v = Math.tanh(this.drive(this.pnBuf, n));
    this.evals++;
    this.cLo[h] = pos.hashLo; this.cHi[h] = pos.hashHi; this.cVal[h] = v; this.cOk[h] = 1;
    return v;
  }

  clearCache() { this.cOk.fill(0); }

  // ---- incremental evaluation for search (two "eyes": White's view and Black's view) ----
  // Like a real brain, only the neurons whose input changed need updating after a move.
  attach(pos) {
    if (!this.cW) {
      this.cW = new Uint8Array(this.nKC); this.cB = new Uint8Array(this.nKC);
      this.aW = new Uint8Array(this.nCell); this.aB = new Uint8Array(this.nCell);
      this.dStack = new Int32Array(4096); this.dTop = 0; this.dMarks = [];
    }
    this.cW.fill(0); this.cB.fill(0); this.aW.fill(0); this.aB.fill(0);
    this.cnt = new Int8Array(16);
    this.yW = 0; this.yB = 0; this.dTop = 0; this.dMarks.length = 0;
    const b = pos.board;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      if (b[s]) this.change(b[s], s, 1);
    }
    this.dTop = 0;
  }

  change(p, s, sign) {
    const i = ((s >> 4) << 3) | (s & 7), t = (p & 7) - 1;
    const white = (p & 8) === 0;
    // count PNs: one thermometer step turns on/off
    const k = sign > 0 ? ++this.cnt[p] : this.cnt[p]--;
    if (k <= CAP[t + 1]) {
      const o = CNT_OFF[t + 1] + k - 1;
      this.yW += sign * this.wPN[N_WHERE + (white ? 0 : 19) + o];
      this.yB += sign * this.wPN[N_WHERE + (white ? 19 : 0) + o];
    }
    this.channel(((white ? 0 : 6) + t) * 64 + i, sign, 0);
    this.channel(((white ? 6 : 0) + t) * 64 + (i ^ 56), sign, 1);
    if (this.dStack) this.dStack[this.dTop++] = (p << 8) | (s << 1) | (sign > 0 ? 1 : 0);
  }

  // a board channel switches on/off: direct synapse, and its PN if it was the first/last channel driving it
  channel(ch, sign, view) {
    const a = view === 0 ? this.aW : this.aB, cell = this.chanPN[ch];
    let dy = sign * this.wPN[ch];
    if (sign > 0 ? ++a[cell] === 1 : --a[cell] === 0) dy += this.touch(view === 0 ? this.cW : this.cB, cell, sign);
    if (view === 0) this.yW += dy; else this.yB += dy;
  }

  touch(c, pn, sign) {
    const st = this.pnStart, list = this.pnList, w = this.wKC, th = this.threshold;
    let dy = 0;
    if (sign > 0) {
      for (let j = st[pn], e = st[pn + 1]; j < e; j++) { const k = list[j]; if (++c[k] === th) dy += w[k]; }
    } else {
      for (let j = st[pn], e = st[pn + 1]; j < e; j++) { const k = list[j]; if (c[k]-- === th) dy -= w[k]; }
    }
    return dy;
  }

  // call right after a successful pos.make(m)
  onMake(pos) {
    this.dMarks.push(this.dTop);
    const st = pos.stack, n = st.length;
    const m = st[n - 7], captured = st[n - 6];
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = (m >> 17) & 15;
    const b = pos.board, mover = pos.side ^ 8;
    const placed = b[to];
    const orig = promo ? (mover | 1) : placed;
    this.change(orig, from, -1);
    if (captured) this.change(captured, flags & 2 ? to + (mover === 0 ? -16 : 16) : to, -1);
    this.change(placed, to, 1);
    if (flags & 4) {
      const rt = to > from ? from + 1 : from - 1, rf = to > from ? from + 3 : from - 4;
      this.change(b[rt], rf, -1);
      this.change(b[rt], rt, 1);
    }
  }

  // call right before pos.unmake()
  onUnmake() {
    const mark = this.dMarks.pop();
    const saveTop = this.dTop;
    const ds = this.dStack;
    this.dStack = null; // don't record the reversal
    for (let i = saveTop - 1; i >= mark; i--) {
      const d = ds[i];
      this.change(d >> 8, (d >> 1) & 127, d & 1 ? -1 : 1);
    }
    this.dStack = ds; this.dTop = mark;
  }

  current(pos) { this.evals++; return Math.tanh(this.bias + (pos.side === 0 ? this.yW : this.yB)); }

  // One dopamine pulse: nudge the value of a position (given as its active PNs) toward target.
  // Returns the prediction error (the "dopamine" signal).
  learn(pn, nPn, target, lr = 1) {
    const v = Math.tanh(this.drive(pn, nPn));
    const err = target - v;
    const na = this.kcs(pn, nPn);
    const aPN = 0.004 * lr * err, aKC = na ? (0.06 * lr * err) / na : 0, aB = 0.0005 * lr * err;
    for (let i = 0; i < nPn; i++) this.wPN[pn[i]] += aPN;
    const kb = this.kcBuf, w = this.wKC;
    for (let i = 0; i < na; i++) w[kb[i]] += aKC;
    this.bias += aB;
    return err;
  }

  toJSON() {
    return {
      format: BRAIN_FORMAT, version: 2, name: this.name, wiring: this.wiring,
      nKC: this.nKC, claws: this.claws, threshold: this.threshold, seed: this.seed,
      games: this.games, record: this.record, curve: this.curve, born: this.born,
      bias: this.bias, wPN: f32ToB64(this.wPN), wKC: f32ToB64(this.wKC),
    };
  }

  static fromJSON(j) {
    if (typeof j === 'string') j = JSON.parse(j);
    if (j.format !== BRAIN_FORMAT && j.format !== 'fly64-brain') throw new Error('not a ChessFly brain file');
    const b = new Brain({ nKC: j.nKC, claws: j.claws, threshold: j.threshold, seed: j.seed, name: j.name, wiring: j.wiring || 'random' });
    b.wPN.set(b64ToF32(j.wPN)); b.wKC.set(b64ToF32(j.wKC));
    b.bias = j.bias; b.games = j.games || 0; b.record = j.record || { w: 0, d: 0, l: 0 };
    b.curve = j.curve || []; b.born = j.born || Date.now();
    return b;
  }

  clone() { return Brain.fromJSON(this.toJSON()); }

}

export function stage(games) {
  if (games < 1) return 'egg';
  if (games < 400) return 'larva';
  if (games < 3000) return 'pupa';
  return 'adult';
}
