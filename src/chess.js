// ChessFly chess core: 0x88 board, legal move generation, draw rules, FEN, SAN.
// Pure ES module, no dependencies. Runs in the browser, in workers and in Node.

export const WHITE = 0, BLACK = 8;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;

export const F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;

export const moveFrom = (m) => m & 127;
export const moveTo = (m) => (m >> 7) & 127;
export const movePromo = (m) => (m >> 14) & 7;
export const moveFlags = (m) => (m >> 17) & 15;
const mkMove = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);

const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_D = [1, -1, 16, -16, 15, 17, -15, -17];
const BISHOP_D = [15, 17, -15, -17];
const ROOK_D = [1, -1, 16, -16];

// sq (0x88) <-> index 0..63 (a1 = 0, h8 = 63)
export const sq64 = (s) => (s >> 4) * 8 + (s & 7);
export const sq88 = (i) => ((i >> 3) << 4) | (i & 7);
export const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
export const parseSq = (n) => (n.charCodeAt(1) - 49) * 16 + (n.charCodeAt(0) - 97);

// Deterministic Zobrist keys (two 32-bit halves).
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}
const R = rng32(0xF1064);
const Z_PIECE_LO = new Int32Array(16 * 128), Z_PIECE_HI = new Int32Array(16 * 128);
for (let i = 0; i < 16 * 128; i++) { Z_PIECE_LO[i] = R(); Z_PIECE_HI[i] = R(); }
const Z_SIDE_LO = R(), Z_SIDE_HI = R();
const Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16);
for (let i = 0; i < 16; i++) { Z_CASTLE_LO[i] = R(); Z_CASTLE_HI[i] = R(); }
const Z_EP_LO = new Int32Array(8), Z_EP_HI = new Int32Array(8);
for (let i = 0; i < 8; i++) { Z_EP_LO[i] = R(); Z_EP_HI[i] = R(); }

const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[7] = 15 & ~1; CASTLE_MASK[4] = 15 & ~3;
CASTLE_MASK[112] = 15 & ~8; CASTLE_MASK[119] = 15 & ~4; CASTLE_MASK[116] = 15 & ~12;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PIECE_CH = ' pnbrqk';

export class Position {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(128);
    this.stack = [];          // undo records
    this.hashes = [];         // hash history (lo, hi pairs) for repetition
    this.load(fen);
  }

  load(fen) {
    const [placement, side, castle, ep, half, full] = fen.trim().split(/\s+/);
    this.board.fill(0);
    let r = 7, f = 0;
    for (const ch of placement) {
      if (ch === '/') { r--; f = 0; continue; }
      if (ch >= '1' && ch <= '8') { f += +ch; continue; }
      const lower = ch.toLowerCase();
      const type = PIECE_CH.indexOf(lower);
      const color = ch === lower ? BLACK : WHITE;
      this.board[r * 16 + f] = color | type;
      if (type === KING) this.kings[color >> 3] = r * 16 + f;
      f++;
    }
    this.side = side === 'b' ? BLACK : WHITE;
    this.castle = 0;
    if (castle && castle !== '-') {
      if (castle.includes('K')) this.castle |= 1;
      if (castle.includes('Q')) this.castle |= 2;
      if (castle.includes('k')) this.castle |= 4;
      if (castle.includes('q')) this.castle |= 8;
    }
    this.ep = ep && ep !== '-' ? parseSq(ep) : -1;
    this.half = half ? +half : 0;
    this.full = full ? +full : 1;
    this.stack.length = 0;
    this.hashes.length = 0;
    this.computeHash();
    this.hashes.push(this.hashLo, this.hashHi);
    return this;
  }

  get kings() { return this._k || (this._k = [0, 0]); }

  clone() {
    const p = Object.create(Position.prototype);
    p.board = this.board.slice();
    p._k = this.kings.slice();
    p.side = this.side; p.castle = this.castle; p.ep = this.ep;
    p.half = this.half; p.full = this.full;
    p.hashLo = this.hashLo; p.hashHi = this.hashHi;
    p.stack = [];
    p.hashes = this.hashes.slice();
    return p;
  }

  epKey() {
    // en-passant only matters for hashing if a capture is geometrically possible
    if (this.ep < 0) return -1;
    const pawn = this.side | PAWN, s = this.ep - (this.side === WHITE ? 16 : -16);
    if ((((s - 1) & 0x88) === 0 && this.board[s - 1] === pawn) || (((s + 1) & 0x88) === 0 && this.board[s + 1] === pawn)) return this.ep & 7;
    return -1;
  }

  computeHash() {
    let lo = 0, hi = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.board[s];
      if (p) { lo ^= Z_PIECE_LO[p * 128 + s]; hi ^= Z_PIECE_HI[p * 128 + s]; }
    }
    if (this.side === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    lo ^= Z_CASTLE_LO[this.castle]; hi ^= Z_CASTLE_HI[this.castle];
    const e = this.epKey();
    if (e >= 0) { lo ^= Z_EP_LO[e]; hi ^= Z_EP_HI[e]; }
    this.hashLo = lo; this.hashHi = hi;
  }

  attacked(sq, by) {
    const b = this.board;
    if (by === WHITE) {
      if (((sq - 15) & 0x88) === 0 && b[sq - 15] === (WHITE | PAWN)) return true;
      if (((sq - 17) & 0x88) === 0 && b[sq - 17] === (WHITE | PAWN)) return true;
    } else {
      if (((sq + 15) & 0x88) === 0 && b[sq + 15] === (BLACK | PAWN)) return true;
      if (((sq + 17) & 0x88) === 0 && b[sq + 17] === (BLACK | PAWN)) return true;
    }
    const kn = by | KNIGHT, kg = by | KING;
    for (let i = 0; i < 8; i++) {
      let t = sq + KNIGHT_D[i];
      if ((t & 0x88) === 0 && b[t] === kn) return true;
      t = sq + KING_D[i];
      if ((t & 0x88) === 0 && b[t] === kg) return true;
    }
    const bi = by | BISHOP, ro = by | ROOK, qu = by | QUEEN;
    for (let i = 0; i < 4; i++) {
      let d = BISHOP_D[i], t = sq + d;
      while ((t & 0x88) === 0) {
        const p = b[t];
        if (p) { if (p === bi || p === qu) return true; break; }
        t += d;
      }
      d = ROOK_D[i]; t = sq + d;
      while ((t & 0x88) === 0) {
        const p = b[t];
        if (p) { if (p === ro || p === qu) return true; break; }
        t += d;
      }
    }
    return false;
  }

  inCheck(color = this.side) { return this.attacked(this.kings[color >> 3], color ^ 8); }

  // Pseudo-legal moves. capturesOnly also includes promotions.
  pseudo(out, capturesOnly = false) {
    const b = this.board, us = this.side, them = us ^ 8;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s];
      if (!p || (p & 8) !== us) continue;
      const type = p & 7;
      if (type === PAWN) {
        const fwd = us === WHITE ? 16 : -16;
        const startRank = us === WHITE ? 1 : 6, promoRank = us === WHITE ? 6 : 1;
        const rank = s >> 4, t = s + fwd;
        if (!b[t]) {
          if (rank === promoRank) {
            for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(mkMove(s, t, pr, 0));
          } else if (!capturesOnly) {
            out.push(mkMove(s, t, 0, 0));
            if (rank === startRank && !b[t + fwd]) out.push(mkMove(s, t + fwd, 0, F_DOUBLE));
          }
        }
        for (const c of [t - 1, t + 1]) {
          if (c & 0x88) continue;
          const q = b[c];
          if (q && (q & 8) === them) {
            if (rank === promoRank) for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(mkMove(s, c, pr, F_CAPTURE));
            else out.push(mkMove(s, c, 0, F_CAPTURE));
          } else if (c === this.ep) out.push(mkMove(s, c, 0, F_CAPTURE | F_EP));
        }
      } else if (type === KNIGHT || type === KING) {
        const D = type === KNIGHT ? KNIGHT_D : KING_D;
        for (let i = 0; i < 8; i++) {
          const t = s + D[i];
          if (t & 0x88) continue;
          const q = b[t];
          if (!q) { if (!capturesOnly) out.push(mkMove(s, t, 0, 0)); }
          else if ((q & 8) === them) out.push(mkMove(s, t, 0, F_CAPTURE));
        }
        if (type === KING && !capturesOnly) this.castles(out, s);
      } else {
        const D = type === BISHOP ? BISHOP_D : type === ROOK ? ROOK_D : KING_D;
        for (let i = 0; i < D.length; i++) {
          const d = D[i];
          let t = s + d;
          while ((t & 0x88) === 0) {
            const q = b[t];
            if (!q) { if (!capturesOnly) out.push(mkMove(s, t, 0, 0)); }
            else { if ((q & 8) === them) out.push(mkMove(s, t, 0, F_CAPTURE)); break; }
            t += d;
          }
        }
      }
    }
    return out;
  }

  castles(out, k) {
    const b = this.board, us = this.side, them = us ^ 8;
    if (us === WHITE && k === 4) {
      if ((this.castle & 1) && !b[5] && !b[6] && b[7] === (WHITE | ROOK) &&
          !this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them)) out.push(mkMove(4, 6, 0, F_CASTLE));
      if ((this.castle & 2) && !b[3] && !b[2] && !b[1] && b[0] === (WHITE | ROOK) &&
          !this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them)) out.push(mkMove(4, 2, 0, F_CASTLE));
    } else if (us === BLACK && k === 116) {
      if ((this.castle & 4) && !b[117] && !b[118] && b[119] === (BLACK | ROOK) &&
          !this.attacked(116, them) && !this.attacked(117, them) && !this.attacked(118, them)) out.push(mkMove(116, 118, 0, F_CASTLE));
      if ((this.castle & 8) && !b[115] && !b[114] && !b[113] && b[112] === (BLACK | ROOK) &&
          !this.attacked(116, them) && !this.attacked(115, them) && !this.attacked(114, them)) out.push(mkMove(116, 114, 0, F_CASTLE));
    }
  }

  xorPiece(p, s) { this.hashLo ^= Z_PIECE_LO[p * 128 + s]; this.hashHi ^= Z_PIECE_HI[p * 128 + s]; }

  // Makes the move; returns false (and restores) if it leaves our king in check.
  make(m) {
    const b = this.board, from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = (m >> 17) & 15;
    const us = this.side, them = us ^ 8;
    const piece = b[from];
    let captured = 0, capSq = to;
    if (flags & F_EP) { capSq = to + (us === WHITE ? -16 : 16); }
    captured = b[capSq];
    this.stack.push(m, captured, this.castle, this.ep, this.half, this.hashLo, this.hashHi);

    // hash out old castle / ep
    let e = this.epKey();
    if (e >= 0) { this.hashLo ^= Z_EP_LO[e]; this.hashHi ^= Z_EP_HI[e]; }
    this.hashLo ^= Z_CASTLE_LO[this.castle]; this.hashHi ^= Z_CASTLE_HI[this.castle];

    if (captured) { b[capSq] = 0; this.xorPiece(captured, capSq); }
    b[from] = 0; this.xorPiece(piece, from);
    const placed = promo ? (us | promo) : piece;
    b[to] = placed; this.xorPiece(placed, to);
    if ((piece & 7) === KING) {
      this.kings[us >> 3] = to;
      if (flags & F_CASTLE) {
        let rf, rt;
        if (to === from + 2) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
        const rook = b[rf];
        b[rf] = 0; this.xorPiece(rook, rf);
        b[rt] = rook; this.xorPiece(rook, rt);
      }
    }
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = flags & F_DOUBLE ? from + (us === WHITE ? 16 : -16) : -1;
    this.half = (captured || (piece & 7) === PAWN) ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.side = them;
    this.hashLo ^= Z_SIDE_LO; this.hashHi ^= Z_SIDE_HI;
    this.hashLo ^= Z_CASTLE_LO[this.castle]; this.hashHi ^= Z_CASTLE_HI[this.castle];
    e = this.epKey();
    if (e >= 0) { this.hashLo ^= Z_EP_LO[e]; this.hashHi ^= Z_EP_HI[e]; }
    this.hashes.push(this.hashLo, this.hashHi);

    if (this.attacked(this.kings[us >> 3], them)) { this.unmake(); return false; }
    return true;
  }

  unmake() {
    const st = this.stack, b = this.board;
    const hashHi = st.pop(), hashLo = st.pop(), half = st.pop(), ep = st.pop(), castle = st.pop(), captured = st.pop(), m = st.pop();
    this.hashes.length -= 2;
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = (m >> 17) & 15;
    const them = this.side, us = them ^ 8;
    this.side = us;
    let piece = b[to];
    if (promo) piece = us | PAWN;
    b[from] = piece;
    b[to] = 0;
    if (flags & F_EP) b[to + (us === WHITE ? -16 : 16)] = captured;
    else b[to] = captured;
    if ((piece & 7) === KING) {
      this.kings[us >> 3] = from;
      if (flags & F_CASTLE) {
        let rf, rt;
        if (to === from + 2) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
        b[rf] = b[rt]; b[rt] = 0;
      }
    }
    if (us === BLACK) this.full--;
    this.castle = castle; this.ep = ep; this.half = half; this.hashLo = hashLo; this.hashHi = hashHi;
    return m;
  }

  legal() {
    const ps = this.pseudo([]), out = [];
    for (const m of ps) if (this.make(m)) { out.push(m); this.unmake(); }
    return out;
  }

  hasLegal() {
    const ps = this.pseudo([]);
    for (const m of ps) if (this.make(m)) { this.unmake(); return true; }
    return false;
  }

  repetitions() {
    const h = this.hashes, lo = this.hashLo, hi = this.hashHi;
    let n = 0;
    // only positions with the same side to move, within the reversible window
    const stop = Math.max(0, h.length - 2 - this.half * 2);
    for (let i = h.length - 2; i >= stop; i -= 4) if (h[i] === lo && h[i + 1] === hi) n++;
    return n;
  }

  insufficient() {
    const b = this.board;
    let minors = 0, bishopsColor = [0, 0], knights = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const t = b[s] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === KNIGHT) knights++;
      else bishopsColor[((s >> 4) + (s & 7)) & 1]++;
    }
    if (minors <= 1) return true;
    if (knights === 0 && (bishopsColor[0] === 0 || bishopsColor[1] === 0)) return true;
    return false;
  }

  // null = game goes on; otherwise {result: '1-0'|'0-1'|'1/2-1/2', reason}
  status() {
    if (!this.hasLegal()) {
      if (this.inCheck()) return { result: this.side === WHITE ? '0-1' : '1-0', reason: 'checkmate' };
      return { result: '1/2-1/2', reason: 'stalemate' };
    }
    if (this.half >= 100) return { result: '1/2-1/2', reason: '50-move rule' };
    if (this.repetitions() >= 3) return { result: '1/2-1/2', reason: 'threefold repetition' };
    if (this.insufficient()) return { result: '1/2-1/2', reason: 'insufficient material' };
    return null;
  }

  fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        const ch = PIECE_CH[p & 7];
        s += (p & 8) ? ch : ch.toUpperCase();
      }
      if (empty) s += empty;
      if (r) s += '/';
    }
    let c = '';
    if (this.castle & 1) c += 'K';
    if (this.castle & 2) c += 'Q';
    if (this.castle & 4) c += 'k';
    if (this.castle & 8) c += 'q';
    return `${s} ${this.side === WHITE ? 'w' : 'b'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
  }

  // Standard Algebraic Notation for a legal move in the current position.
  san(m, legalList = null) {
    const from = moveFrom(m), to = moveTo(m), promo = movePromo(m), flags = moveFlags(m);
    const piece = this.board[from], type = piece & 7;
    let s;
    if (flags & F_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
    else {
      const cap = flags & F_CAPTURE;
      if (type === PAWN) {
        s = (cap ? 'abcdefgh'[from & 7] + 'x' : '') + sqName(to);
        if (promo) s += '=' + 'NBRQ'[promo - 2];
      } else {
        s = '  NBRQK'[type];
        const legal = legalList || this.legal();
        const rivals = legal.filter((o) => o !== m && moveTo(o) === to && this.board[moveFrom(o)] === piece);
        if (rivals.length) {
          const sameFile = rivals.some((o) => (moveFrom(o) & 7) === (from & 7));
          const sameRank = rivals.some((o) => (moveFrom(o) >> 4) === (from >> 4));
          if (!sameFile) s += 'abcdefgh'[from & 7];
          else if (!sameRank) s += (from >> 4) + 1;
          else s += sqName(from);
        }
        if (cap) s += 'x';
        s += sqName(to);
      }
    }
    this.make(m);
    if (this.inCheck()) s += this.hasLegal() ? '+' : '#';
    this.unmake();
    return s;
  }

  uci(m) { return sqName(moveFrom(m)) + sqName(moveTo(m)) + (movePromo(m) ? 'nbrq'[movePromo(m) - 2] : ''); }

  findMove(from, to, promo = 0) {
    for (const m of this.legal()) if (moveFrom(m) === from && moveTo(m) === to && (!promo || movePromo(m) === promo) && (promo || !movePromo(m) || movePromo(m) === QUEEN)) return m;
    return 0;
  }

  perft(depth) {
    if (depth === 0) return 1;
    const moves = this.pseudo([]);
    let n = 0;
    for (const m of moves) {
      if (!this.make(m)) continue;
      n += depth === 1 ? 1 : this.perft(depth - 1);
      this.unmake();
    }
    return n;
  }
}

export const PIECE_VALUE = [0, 1, 3, 3, 5, 9, 0];

export function material(pos, color) {
  let v = 0;
  const b = pos.board;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = b[s];
    if (p) v += ((p & 8) === color ? 1 : -1) * PIECE_VALUE[p & 7];
  }
  return v;
}
