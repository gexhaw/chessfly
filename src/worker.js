// Engine worker: holds the brains, thinks, learns, and trains by self-play off the main thread.
import { Position, START_FEN } from './chess.js';
import { Brain, stage, setAnatomy } from './brain.js';
import { FlyPlayer } from './players.js';
import { learnFromGame, selfPlayGame, match, estimateElo, lifeRate } from './training.js';
import { mulberry32 } from './util.js';
import { pieceValues } from './insight.js';

const brains = new Map();
// the real FlyWire wiring, needed before any 'flywire' or 'shuffled' brain can be built
const ready = fetch(new URL('../data/mushroom_body.json', import.meta.url)).then((r) => r.json()).then(setAnatomy).catch(() => {});
const rnd = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
let training = null; // { id, stop }

const post = (m) => postMessage(m);

function info(id) {
  const b = brains.get(id);
  const last = b.curve[b.curve.length - 1];
  return { id, name: b.name, seed: b.seed, wiring: b.wiring, nCell: b.nCell, games: b.games, stage: stage(b.games), record: b.record, curve: b.curve, elo: last ? last.elo : null, nKC: b.nKC, values: pieceValues(b) };
}

function replay(uciMoves, fen = START_FEN) {
  const pos = new Position(fen);
  for (const u of uciMoves) {
    const m = pos.legal().find((x) => pos.uci(x) === u);
    if (!m) throw new Error('illegal move in replay: ' + u);
    pos.make(m);
  }
  return pos;
}

function activity(b, pos) {
  const pn = new Int32Array(128);
  const n = Brain.pns(pos, pn);
  const nk = b.kcs(pn, n);
  const kc = Array.from(b.kcBuf.subarray(0, nk));
  const y = b.drive(pn, n);
  const kcW = kc.map((k) => b.wKC[k]);
  return { pn: Array.from(pn.subarray(0, n)), kc, kcW, value: Math.tanh(y), side: pos.side };
}

function exam(b, n = 10) {
  const trnd = mulberry32(777 + b.games);
  const res = [];
  for (const opp of ['Random', 'Greedy', 'Counter', 'Sentinel']) res.push({ opp, ...match(b, opp, n, trnd) });
  const pt = { games: b.games, elo: estimateElo(res), vs: Object.fromEntries(res.map((r) => [r.opp, [r.w, r.d, r.l]])) };
  b.curve.push(pt);
  return pt;
}

function trainLoop(id, opts) {
  const b = brains.get(id);
  const token = {};
  training = { id, token };
  let lastPost = 0, lastSnap = 0, dop = 0, n = 0;
  const stats = { w: 0, b: 0, d: 0 };
  const examAt = (g) => g === 50 || g === 150 || g === 300 || g % 500 === 0;
  if (!b.curve.length) { post({ type: 'examining', id }); post({ type: 'exam', id, point: exam(b, opts.examGames || 10), info: info(id) }); }
  const step = () => {
    if (!training || training.token !== token) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 60) {
      const g = selfPlayGame(b, rnd, {
        onMove: opts.live ? (pos, m) => {
          const now = performance.now();
          if (now - lastSnap > 110) { lastSnap = now; post({ type: 'live', id, fen: pos.fen(), move: pos.uci(m) }); }
        } : null,
      });
      dop += g.dopamine; n++;
      if (g.result > 0.3) stats.w++; else if (g.result < -0.3) stats.b++; else stats.d++;
      if (examAt(b.games)) {
        post({ type: 'examining', id });
        const pt = exam(b, opts.examGames || 10);
        post({ type: 'exam', id, point: pt, info: info(id) });
      }
      if (b.games % 25 === 0) post({ type: 'save', id, json: b.toJSON() });
    }
    const now = performance.now();
    if (now - lastPost > 250) {
      lastPost = now;
      post({ type: 'progress', id, info: info(id), dopamine: n ? dop / n : 0, stats });
      dop = 0; n = 0;
    }
    setTimeout(step, 0);
  };
  step();
}

onmessage = async (e) => {
  const m = e.data;
  await ready;
  try {
    switch (m.type) {
      case 'load': {
        const b = m.json ? Brain.fromJSON(m.json) : new Brain({ nKC: m.nKC || 4000, seed: m.seed || ((Math.random() * 1e9) | 0), name: m.name || 'fly', wiring: m.wiring || 'flywire' });
        if (m.name) b.name = m.name;
        brains.set(m.id, b);
        post({ type: 'loaded', id: m.id, info: info(m.id), reqId: m.reqId });
        break;
      }
      case 'think': {
        const b = brains.get(m.id);
        const pos = replay(m.moves, m.fen);
        const fly = new FlyPlayer(b, { depth: m.depth || 1 });
        const { moves, scores } = fly.search.scoreRoot(pos);
        let best = -Infinity;
        for (const s of scores) if (s > best) best = s;
        const ties = [];
        for (let i = 0; i < moves.length; i++) if (scores[i] >= best - 1e-9) ties.push(i);
        let pickI = ties[Math.floor(rnd() * ties.length)];
        if (m.temperature > 0) {
          let sum = 0; const w = scores.map((s) => { const v = Math.exp((s - best) / m.temperature); sum += v; return v; });
          let r = rnd() * sum;
          for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { pickI = i; break; } }
        }
        const order = Array.from(scores.keys()).sort((a, c) => scores[c] - scores[a]).slice(0, 5);
        post({
          type: 'move', reqId: m.reqId, id: m.id, uci: pos.uci(moves[pickI]), score: scores[pickI],
          top: order.map((i) => [pos.uci(moves[i]), scores[i]]), nodes: fly.search.nodes,
        });
        break;
      }
      case 'look': {
        const b = brains.get(m.id);
        const pos = replay(m.moves, m.fen);
        if (m.as) pos.side = m.as === 'w' ? 0 : 8;
        post({ type: 'activity', reqId: m.reqId, id: m.id, ...activity(b, pos) });
        break;
      }
      case 'learn': {
        // a finished game the fly took part in: rebuild every position and let dopamine flow
        const b = brains.get(m.id);
        const pos = new Position(m.fen);
        const plies = [];
        const buf = new Int32Array(128);
        for (const u of m.moves) {
          const n = Brain.pns(pos, buf);
          plies.push({ pn: Int16Array.from(buf.subarray(0, n)), score: null });
          pos.make(pos.legal().find((x) => pos.uci(x) === u));
        }
        const before = b.value(new Position(m.fen));
        // a game against a real opponent counts for as much as four games against itself
        const r = learnFromGame(b, { plies, result: m.result }, { lambda: 0.7, lr: m.lr || 4 * lifeRate(b.games) });
        if (m.flyColor != null) {
          const s = m.flyColor === 'w' ? m.result : -m.result;
          if (s > 0) b.record.w++; else if (s < 0) b.record.l++; else b.record.d++;
        }
        post({ type: 'learned', id: m.id, reqId: m.reqId, info: info(m.id), dopamine: r.dopamine, before, json: b.toJSON() });
        break;
      }
      case 'train': {
        if (m.on) trainLoop(m.id, m);
        else {
          if (training) { const id = training.id; training = null; post({ type: 'save', id, json: brains.get(id).toJSON() }); post({ type: 'progress', id, info: info(id), dopamine: 0 }); }
        }
        break;
      }
      case 'exam': {
        const pt = exam(brains.get(m.id), m.n || 10);
        post({ type: 'exam', id: m.id, point: pt, info: info(m.id), reqId: m.reqId });
        break;
      }
      case 'export': post({ type: 'exported', id: m.id, reqId: m.reqId, json: brains.get(m.id).toJSON() }); break;
      case 'info': post({ type: 'info', id: m.id, reqId: m.reqId, info: info(m.id) }); break;
    }
  } catch (err) {
    post({ type: 'error', reqId: m.reqId, message: String(err && err.message || err) });
  }
};
