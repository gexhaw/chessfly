// What has the fly figured out? Estimates the worth it has come to assign to each piece:
// remove one piece from a few reference positions and see how much its "gut feeling" drops.
import { Position } from './chess.js';
import { Brain } from './brain.js';

const REF = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  'rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 4 5',
  'r2q1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 10',
];

export function pieceValues(brain) {
  const buf = new Int32Array(128);
  const y = (pos) => brain.drive(buf, Brain.pns(pos, buf));
  const sum = [0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0];
  for (const fen of REF) {
    const pos = new Position(fen);
    const y0 = y(pos);
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = pos.board[s], t = p & 7;
      if (!p || t === 6) continue;
      pos.board[s] = 0;
      const d = y(pos) - y0;
      pos.board[s] = p;
      sum[t] += (p & 8) === pos.side ? -d : d;
      cnt[t]++;
    }
  }
  const raw = sum.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
  const pawn = raw[1];
  if (!(pawn > 0.004)) return null;
  return { p: 1, n: raw[2] / pawn, b: raw[3] / pawn, r: raw[4] / pawn, q: raw[5] / pawn, unit: pawn };
}
