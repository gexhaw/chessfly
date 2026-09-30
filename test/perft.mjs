// node test/perft.mjs  — move-generator correctness against published perft counts
import { Position } from '../src/chess.js';

const CASES = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281, 4865609]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890, 3894594]],
];

const quick = process.argv.includes('--quick');
let fail = 0;
const t0 = Date.now();
for (const [fen, counts] of CASES) {
  const pos = new Position(fen);
  const before = pos.fen();
  counts.forEach((want, i) => {
    if (quick && want > 500000) return;
    const got = pos.perft(i + 1);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} depth ${i + 1}: ${got}${ok ? '' : ' (want ' + want + ')'}  ${fen}`);
  });
  if (pos.fen() !== before) { fail++; console.log('FAIL position not restored after perft'); }
}

// incremental hash must equal hash recomputed from scratch, along random games
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
for (let g = 0; g < 200; g++) {
  const pos = new Position();
  for (let ply = 0; ply < 200; ply++) {
    const ms = pos.legal();
    if (!ms.length) break;
    pos.make(ms[Math.floor(rnd() * ms.length)]);
    const lo = pos.hashLo, hi = pos.hashHi;
    pos.computeHash();
    if (lo !== pos.hashLo || hi !== pos.hashHi) { fail++; console.log('FAIL hash mismatch', pos.fen()); break; }
    const round = new Position(pos.fen());
    if (round.hashLo !== lo || round.hashHi !== hi) { fail++; console.log('FAIL FEN round-trip hash', pos.fen()); break; }
  }
}

// draw / result rules
const expect = (fen, want, moves = []) => {
  const p = new Position(fen);
  for (const u of moves) { const m = p.legal().find((x) => p.uci(x) === u); if (!m) throw new Error('bad move ' + u); p.make(m); }
  const st = p.status();
  const got = st ? st.reason : 'ongoing';
  if (got !== want) { fail++; console.log(`FAIL status ${fen} ${moves.join(' ')}: ${got} (want ${want})`); }
  else console.log(`ok   status: ${want}`);
};
expect('rnbqkbnr/ppppp2p/5p2/6p1/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'ongoing');
expect('rnbqkbnr/ppppp2p/5p2/6pQ/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 3', 'checkmate');
expect('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'stalemate');
expect('8/8/4k3/8/8/4K3/8/8 w - - 0 1', 'insufficient material');
expect('8/8/4k3/8/8/4KB2/8/8 w - - 0 1', 'insufficient material');
expect('8/8/4k3/8/8/4KR2/8/8 w - - 99 80', '50-move rule', ['f3f4']);
expect('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'threefold repetition', ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);

// SAN
const sanCheck = (fen, uci, want) => {
  const p = new Position(fen);
  const m = p.legal().find((x) => p.uci(x) === uci);
  const got = m ? p.san(m) : '(illegal)';
  if (got !== want) { fail++; console.log(`FAIL san ${uci}: ${got} (want ${want})`); } else console.log(`ok   san ${want}`);
};
sanCheck('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'e1g1', 'O-O');
sanCheck('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'e5f7', 'Nxf7');
sanCheck('rnbqkbnr/ppppp2p/5p2/6p1/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'd1h5', 'Qh5#');
sanCheck('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1', 'a1d1', 'Rad1');
sanCheck('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7b8q', 'b8=Q+');

console.log(fail ? `\n${fail} FAILURE(S)` : `\nall passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fail ? 1 : 0);
