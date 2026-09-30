// node test/brain.mjs — mushroom-body model: incremental evaluation, file format, learning rule.
import { readFileSync } from 'node:fs';
import { Brain, N_PN, setAnatomy } from '../src/brain.js';
import { Position, material } from '../src/chess.js';
import { mulberry32 } from '../src/util.js';

setAnatomy(JSON.parse(readFileSync(new URL('../data/mushroom_body.json', import.meta.url))));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };

// 1. incremental "two-eyed" evaluation during search == evaluation from scratch, for every wiring
for (const wiring of ['random', 'flywire', 'shuffled']) {
  const b = new Brain({ nKC: 4000, seed: 3, wiring });
  const r = mulberry32(1);
  for (let i = 0; i < b.nKC; i++) b.wKC[i] = r() - 0.5;
  for (let i = 0; i < N_PN; i++) b.wPN[i] = r() - 0.5;
  let bad = 0, n = 0;
  const fens = [undefined, 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'];
  for (const fen of fens) {
    const pos = new Position(fen);
    b.attach(pos);
    const walk = (d) => {
      const full = Math.tanh(b.drive(b.pnBuf, Brain.pns(pos, b.pnBuf)));
      if (Math.abs(full - b.current(pos)) > 1e-6) bad++;
      n++;
      if (!d) return;
      for (const m of pos.pseudo([])) { if (!pos.make(m)) continue; b.onMake(pos); walk(d - 1); b.onUnmake(); pos.unmake(); }
    };
    walk(3);
  }
  check(bad === 0, `${wiring} wiring: incremental evaluation matches full evaluation at ${n.toLocaleString('en')} nodes`);
}

// 1b. the FlyWire wiring is the real one; the shuffled control keeps each KC's claw count
{
  const A = JSON.parse(readFileSync(new URL('../data/mushroom_body.json', import.meta.url)));
  const real = new Brain({ wiring: 'flywire', seed: 1 }), shuf = new Brain({ wiring: 'shuffled', seed: 1 });
  check(real.nKC === 5177 && real.nCell === A.pn.n && real.kcList.length === A.kc.claws.length, `FlyWire wiring: ${real.nCell} PNs, ${real.nKC} KCs, ${real.kcList.length} claws`);
  let same = 0, sameDeg = 0;
  for (let k = 0; k < real.nKC; k++) {
    if (real.kcStart[k + 1] - real.kcStart[k] === shuf.kcStart[k + 1] - shuf.kcStart[k]) sameDeg++;
    for (let j = real.kcStart[k]; j < real.kcStart[k + 1]; j++) if (real.kcList[j] === shuf.kcList[j]) same++;
  }
  check(sameDeg === real.nKC && same < 0.05 * real.kcList.length, `shuffled control keeps every KC's claw count, changes ${((100 * (1 - same / real.kcList.length))).toFixed(0)}% of claws`);
  const pos = new Position('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  const na = real.kcs(real.pnBuf, Brain.pns(pos, real.pnBuf));
  check(na > 0.01 * real.nKC && na < 0.15 * real.nKC, `real Kenyon cells fire sparsely (${((100 * na) / real.nKC).toFixed(1)}% active)`);
}

// 2. brain files round-trip exactly
{
  const b = new Brain({ nKC: 2000, seed: 9 });
  const r = mulberry32(2);
  for (let i = 0; i < b.nKC; i++) b.wKC[i] = r() - 0.5;
  const c = Brain.fromJSON(JSON.stringify(b.toJSON()));
  const pos = new Position('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  check(b.value(pos) === c.value(pos), 'brain survives save and load');
  const kcs = b.kcs(b.pnBuf, Brain.pns(pos, b.pnBuf));
  check(kcs > 0.01 * b.nKC && kcs < 0.08 * b.nKC, `Kenyon cells fire sparsely (${((100 * kcs) / b.nKC).toFixed(1)}% active)`);
}

// 3. the plasticity rule can learn material from examples (supervised sanity check)
{
  const b = new Brain({ nKC: 4000, seed: 1 });
  const rnd = mulberry32(2);
  const pn = new Int32Array(128);
  let errs = 0, n = 0;
  for (let g = 0; g < 700; g++) {
    const pos = new Position();
    for (let ply = 0; ply < 150; ply++) {
      const ms = pos.legal(); if (!ms.length) break;
      pos.make(ms[Math.floor(rnd() * ms.length)]);
      const k = Brain.pns(pos, pn);
      const e = b.learn(pn, k, Math.tanh(material(pos, pos.side) / 6), 1);
      if (g >= 600) { errs += e * e; n++; }
    }
  }
  const rmse = Math.sqrt(errs / n);
  check(rmse < 0.06, `learns to predict material from examples (rmse ${rmse.toFixed(3)})`);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed');
process.exit(fail ? 1 : 0);
