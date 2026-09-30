import { Position, START_FEN, WHITE, BLACK, sq64, moveFrom, moveTo, movePromo, moveFlags, F_CASTLE, F_EP, F_CAPTURE, KING, parseSq } from './chess.js';
import { Board } from './board.js';
import { BrainView } from './brainview.js';
import { setAnatomy } from './brain.js';
import { drawCurve } from './chart.js';
import { flyMarkup } from './fly.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MINE_KEY = 'chessfly.mine';

// ---------- worker RPC ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqSeq = 0;
const pending = new Map();
const listeners = {};
worker.onmessage = (e) => {
  const m = e.data;
  if (m.reqId != null && pending.has(m.reqId)) {
    const { res, rej } = pending.get(m.reqId);
    pending.delete(m.reqId);
    if (m.type === 'error') rej(new Error(m.message)); else res(m);
    return;
  }
  (listeners[m.type] || []).forEach((f) => f(m));
};
const rpc = (msg) => new Promise((res, rej) => { const reqId = ++reqSeq; pending.set(reqId, { res, rej }); worker.postMessage({ ...msg, reqId }); });
const on = (type, f) => (listeners[type] ||= []).push(f);

// ---------- flies ----------
const FLIES = {
  mine: { label: 'Your fly', learns: true },
  hatchling: { label: 'Hatchling', file: null, seed: 64 },
  larva: { label: 'Larva', file: 'brains/larva.json' },
  pupa: { label: 'Pupa', file: 'brains/pupa.json' },
  adult: { label: 'Adult', file: 'brains/adult.json' },
  adultRandom: { label: 'Adult, random wiring', file: 'brains/adult-random.json' },
};
const infos = {};
const optLabel = (id) => {
  const i = infos[id];
  if (!i) return FLIES[id].label;
  const g = `${i.games.toLocaleString('en')} game${i.games === 1 ? '' : 's'}`;
  return id === 'mine' ? `Your fly (${i.stage}, ${g}, learns)` : `${FLIES[id].label} (${g})`;
};
const eloText = (i) => (i && i.elo != null ? `strength ${i.elo}` : 'strength not measured yet');

function saveMine(json) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(json)); } catch { /* storage full or blocked: keep going */ }
}

// ---------- ui objects ----------
const board2d = new Board($('#board'));
let board = board2d, board3d = null, view = '2d';
const scope2d = new BrainView($('#brain'));
let scope3d = null, lastAct = null;
const scope = {
  setBrain(meta) { scope2d.setBrain(meta); if (scope3d) scope3d.setBrain(meta); this.meta = meta; },
  show(a, label) {
    lastAct = a; scope2d.show(a, label);
    if (scope3d) scope3d.show(a);
    const v = a.value;
    $('#scope-readout').textContent = `${a.kc.length} of ${infos[focusId]?.nKC.toLocaleString('en')} Kenyon cells firing. Gut feeling ${v >= 0 ? '+' : ''}${v.toFixed(2)}: ${v > 0.05 ? 'it likes this position' : v < -0.05 ? 'it dislikes this position' : 'unsure'}. Drag to turn the brain.`;
  },
  dopamine(e) { scope2d.dopamine(e); },
};
$('#logo-fly').innerHTML = flyMarkup('logo', 'red').replace(/<ellipse class="shadow"[^>]*\/>/, '');

let mode = 'play';
let game = null;
let token = 0;
let training = false;
let focusId = 'mine';

const settings = {
  playOpp: 'mine', playColor: 'w', depth: 1, arrows: true,
  watchW: 'adult', watchB: 'adultRandom', speed: 1, loop: true,
};

function seg(id, key, cast = (v) => v, after = null) {
  const root = $(id);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of root.children) x.setAttribute('aria-pressed', String(x === b));
    settings[key] = cast(b.dataset.v);
    if (after) after();
  });
}
seg('#play-color', 'playColor');
seg('#play-depth', 'depth', Number, () => { if (mode === 'play' && game) for (const p of [game.white, game.black]) if (p.type === 'fly') p.depth = settings.depth; });
seg('#watch-speed', 'speed', Number);
$('#show-arrows').addEventListener('change', (e) => { settings.arrows = e.target.checked; if (!e.target.checked) board.arrows([]); });
$('#watch-loop').addEventListener('change', (e) => { settings.loop = e.target.checked; });

function fillSelects() {
  for (const [sel, key] of [['#play-opp', 'playOpp'], ['#watch-w', 'watchW'], ['#watch-b', 'watchB']]) {
    const s = $(sel);
    s.innerHTML = Object.keys(FLIES).filter((id) => infos[id]).map((id) => `<option value="${id}">${optLabel(id)}</option>`).join('');
    s.value = settings[key];
    s.onchange = () => { settings[key] = s.value; if (key === 'playOpp' && mode === 'play') startPlay(); };
  }
}

// ---------- seats, status, moves ----------
function seatHTML(p, color) {
  if (!p) return '';
  const eye = color === 'w' ? 'white' : 'red';
  if (p.type === 'human') return `<svg viewBox="0 0 45 45"><use href="#piece-${color}k"/></svg><span class="who">You</span><span class="meta">${color === 'w' ? 'White' : 'Black'}</span>`;
  const i = infos[p.id];
  return `<svg viewBox="-34 -40 68 80">${flyMarkup('seat' + color, eye).replace(/<ellipse class="shadow"[^>]*\/>/, '')}</svg>
    <span class="who">${FLIES[p.id].label}</span><span class="meta">${i ? `${p.id === 'mine' ? i.stage + ', ' : ''}${i.games.toLocaleString('en')} games, ${eloText(i)}` : ''}</span>`;
}
function renderSeats() {
  if (!game) return;
  const flipped = board.flipped;
  const top = flipped ? ['w', game.white] : ['b', game.black];
  const bot = flipped ? ['b', game.black] : ['w', game.white];
  $('#seat-top').innerHTML = seatHTML(top[1], top[0]);
  $('#seat-bottom').innerHTML = seatHTML(bot[1], bot[0]);
  const stm = game.pos.side === WHITE ? 'w' : 'b';
  $('#seat-top').classList.toggle('to-move', !game.over && top[0] === stm);
  $('#seat-bottom').classList.toggle('to-move', !game.over && bot[0] === stm);
}
const status = (t) => { $('#status').textContent = t; };
function renderMoves() {
  const s = game.sans;
  let h = '';
  for (let i = 0; i < s.length; i += 2) h += `<li>${s[i]}${s[i + 1] ? ' ' + s[i + 1] : ''}</li>`;
  const el = $('#moves');
  el.innerHTML = h;
  el.scrollTop = el.scrollHeight;
}
$('#banner').addEventListener('click', () => { $('#banner').hidden = true; });
function banner(title, sub) {
  const b = $('#banner');
  if (!title) { b.hidden = true; return; }
  b.innerHTML = `<b>${title}</b><span>${sub || ''}</span>`;
  b.hidden = false;
}

function checkSq(pos) {
  if (!pos.inCheck()) return -1;
  return sq64(pos.kings[pos.side >> 3]);
}
function drawGame() {
  const last = game.lastMove ? [sq64(moveFrom(game.lastMove)), sq64(moveTo(game.lastMove))] : null;
  board.draw(game.pos, last, checkSq(game.pos));
  renderSeats();
  renderMoves();
}

// ---------- brain scope ----------
const CAP_2D = $('#scope-cap').textContent;
function captionScope() {
  const i = infos[focusId];
  if (view === '3d' && scope3d) {
    $('#scope-cap').textContent = i && i.wiring !== 'random'
      ? `Each faint dot is one of the ${i.nKC.toLocaleString('en')} Kenyon cells of the FlyWire brain, at the position where its cell body really is; blue dots are the projection neurons that feed them. Lit cells are firing for the position on the board (green ones push the output up, pink ones down), and the lines are the real connections that switched them on.`
      : 'This fly has random wiring, so its Kenyon cells are drawn at positions borrowed from the real brain. Lit cells are firing for the position on the board (green ones push the output up, pink ones down).';
  } else $('#scope-cap').textContent = CAP_2D;
}
function updateFocus(id) {
  focusId = id;
  const i = infos[id];
  if (i) scope.setBrain({ nKC: i.nKC, seed: i.seed, wiring: i.wiring });
  $('#learned-who').textContent = id === 'mine' ? 'your fly' : `the ${FLIES[id].label.split(',')[0].toLowerCase()}`;
  renderLearned(id);
  captionScope();
  look();
}
let lookBusy = false, lookAgain = false;
async function look(fen = null, moves = null) {
  if (lookBusy) { lookAgain = true; return; }
  const i = infos[focusId];
  if (!i) return;
  lookBusy = true;
  try {
    let as = null;
    if (game && !fen) {
      if (game.white.id === focusId && game.black.id !== focusId) as = 'w';
      else if (game.black.id === focusId && game.white.id !== focusId) as = 'b';
    }
    const a = await rpc({ type: 'look', id: focusId, fen: fen || (game ? game.fen0 : START_FEN), moves: fen ? [] : moves || (game ? game.moves : []), as });
    const side = a.side === WHITE ? 'White' : 'Black';
    scope.show(a, `${FLIES[focusId].label}, looking at the board as ${side}`);
    $('#scope-who').textContent = `${FLIES[focusId].label}: ${i.nKC.toLocaleString('en')} Kenyon cells, ${i.wiring === 'random' ? 'random wiring' : 'wired like a real fly (FlyWire)'}`;
  } catch { /* position changed under us; next look will catch up */ }
  lookBusy = false;
  if (lookAgain) { lookAgain = false; look(); }
}

function renderLearned(id) {
  const i = infos[id];
  const v = i && i.values;
  const book = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const el = $('#prices');
  if (!v) el.innerHTML = `<p class="none">Nothing yet. A newly hatched fly thinks every position is the same.</p>`;
  else el.innerHTML = ['p', 'n', 'b', 'r', 'q'].map((t) => `<div><svg viewBox="0 0 45 45"><use href="#piece-w${t}"/></svg><b>${v[t] < 9.95 ? v[t].toFixed(1) : Math.round(v[t])}</b><s>${book[t]}</s></div>`).join('');
  const ck = `${id}:${i ? i.curve.length : 0}:${$('#curve').clientWidth}`;
  if (ck !== renderLearned.key) { renderLearned.key = ck; drawCurve($('#curve'), i ? i.curve : []); }
}

// ---------- the game loop ----------
function newGame(white, black, fen = START_FEN) {
  token++;
  banner(null);
  board.arrows([]);
  const pos = new Position(fen);
  game = { fen0: fen, pos, moves: [], sans: [], white, black, over: null, lastMove: 0 };
  board.removeFlies();
  for (const [p, c] of [[white, 'w'], [black, 'b']]) if (p.type === 'fly') board.perch(board.addFly(c, c === 'w' ? 'white' : 'red'), c);
  drawGame();
  look();
  tick(token);
}

function legalMap(pos) {
  const map = new Map();
  for (const m of pos.legal()) {
    const f = sq64(moveFrom(m));
    if (!map.has(f)) map.set(f, []);
    map.get(f).push({ to: sq64(moveTo(m)), promo: movePromo(m), m });
  }
  return map;
}

async function tick(t) {
  if (t !== token || !game || game.over || game.idle) return;
  const st = game.pos.status();
  if (st) return endGame(st);
  const color = game.pos.side === WHITE ? 'w' : 'b';
  const p = color === 'w' ? game.white : game.black;
  renderSeats();
  if (p.type === 'human') {
    status(game.pos.inCheck() ? 'Check. Your move.' : 'Your move.');
    const legal = legalMap(game.pos);
    board.setInput(legal, (from, to, promo) => {
      const opt = legal.get(from).find((x) => x.to === to && (!promo || x.promo === promo));
      play(opt.m, null).then(() => tick(t));
    });
    return;
  }
  status(`${FLIES[p.id].label} is thinking…`);
  const started = performance.now();
  const r = await rpc({ type: 'think', id: p.id, fen: game.fen0, moves: game.moves, depth: p.depth || 1, temperature: 0 });
  if (t !== token) return;
  const minWait = mode === 'watch' ? (settings.speed ? 240 / settings.speed : 30) : 380;
  const wait = minWait - (performance.now() - started);
  if (wait > 0) await sleep(wait);
  if (t !== token) return;
  const m = game.pos.legal().find((x) => game.pos.uci(x) === r.uci);
  if (settings.arrows && mode === 'play' || mode === 'watch' && settings.speed > 0 && settings.arrows) {
    const best = r.top[0][1];
    board.arrows(r.top.slice(0, 4).map(([u, s], k) => ({
      from: sq64(parseSq(u.slice(0, 2))), to: sq64(parseSq(u.slice(2, 4))),
      w: Math.exp((s - best) / 0.08), best: u === r.uci,
    })));
  }
  const speed = mode === 'watch' ? settings.speed : 1;
  await play(m, color, speed);
  if (t !== token) return;
  tick(t);
}

async function play(m, flyColor, speed = 1) {
  const pos = game.pos;
  const san = pos.san(m);
  if (flyColor && speed > 0) {
    const from = sq64(moveFrom(m)), to = sq64(moveTo(m)), fl = moveFlags(m);
    const info = { from, to, side: flyColor, capture: fl & F_CAPTURE ? (fl & F_EP ? to + (flyColor === 'w' ? -8 : 8) : to) : -1, rook: null };
    if (fl & F_CASTLE) info.rook = to > from ? [from + 3, from + 1] : [from - 4, from - 1];
    const t = token;
    await board.flyMove(flyColor, info, speed);
    if (t !== token) return;
  }
  game.moves.push(pos.uci(m));
  game.sans.push(san);
  pos.make(m);
  game.lastMove = m;
  if (!flyColor) board.arrows([]);
  drawGame();
  look();
}

const RESULT_TEXT = { '1-0': 1, '0-1': -1, '1/2-1/2': 0 };

async function endGame(st, resigned = null) {
  game.over = st;
  board.setInput(null, null);
  renderSeats();
  const score = RESULT_TEXT[st.result];
  const winner = score > 0 ? game.white : score < 0 ? game.black : null;
  const winColor = score > 0 ? 'w' : 'b';
  let title, sub = st.reason;
  if (!winner) title = 'Draw';
  else if (winner.type === 'human') title = resigned ? 'You win' : 'You win!';
  else title = `${FLIES[winner.id].label} wins`;
  if (resigned) sub = 'by resignation';
  status(`${title} (${st.result}), ${sub}.`);
  const t = token;
  if (winner && winner.type === 'fly' && st.reason === 'checkmate') board.celebrate(winColor);
  const loser = score > 0 ? game.black : score < 0 ? game.white : null;
  if (loser && loser.type === 'fly') board.sulk(score > 0 ? 'b' : 'w');
  // learning: every game "your fly" took part in
  const learners = [];
  if (game.white.type === 'fly' && FLIES[game.white.id].learns) learners.push(['w', game.white.id]);
  if (game.black.type === 'fly' && FLIES[game.black.id].learns && game.black.id !== game.white.id) learners.push(['b', game.black.id]);
  let learnNote = '';
  for (const [c, id] of learners) {
    const r = await rpc({ type: 'learn', id, fen: game.fen0, moves: game.moves, result: score, flyColor: c });
    infos[id] = r.info;
    saveMine(r.json);
    const s = c === 'w' ? score : -score;
    scope.dopamine(s === 0 ? -0.05 : s);
    learnNote = s > 0 ? 'Dopamine: it will like positions like these a little more.' : s < 0 ? 'Dopamine dip: it will like positions like these a little less.' : 'A draw teaches it a little too.';
    fillSelects();
    renderLearned(focusId);
  }
  if (t !== token) return;
  banner(title, `${sub}${learnNote ? '. ' + learnNote : ''}`);
  if (mode === 'watch') {
    series[score > 0 ? 'w' : score < 0 ? 'b' : 'd']++;
    renderSeries();
    if (settings.loop && !watchPaused) {
      await sleep(settings.speed ? 3200 / Math.max(1, settings.speed) : 900);
      if (t === token && mode === 'watch' && !watchPaused) startWatch(true);
    }
  }
}

// ---------- modes ----------
function setMode(m) {
  if (m === mode) return;
  if (training) toggleTraining(false);
  mode = m;
  document.body.dataset.mode = m;
  for (const b of $$('.modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
  for (const p of $$('.panel')) p.hidden = p.dataset.panel !== m;
  token++;
  if (m === 'play') startPlay();
  if (m === 'watch') { watchPaused = true; showWatchIdle(); }
  if (m === 'train') showTrainIdle();
}
$('.modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });

// play
function startPlay() {
  let c = settings.playColor;
  if (c === 'r') c = Math.random() < 0.5 ? 'w' : 'b';
  const fly = { type: 'fly', id: settings.playOpp, depth: settings.depth };
  const me = { type: 'human' };
  board.setFlipped(c === 'b');
  updateFocus(settings.playOpp);
  $('#play-note').textContent = FLIES[settings.playOpp].learns
    ? 'Your fly learns from every game you finish against it.'
    : `The ${FLIES[settings.playOpp].label.toLowerCase()} is a snapshot and does not change. Pick your fly to teach it.`;
  newGame(c === 'w' ? me : fly, c === 'w' ? fly : me);
}
$('#play-new').onclick = () => { if (mode !== 'play') setMode('play'); else startPlay(); };
$('#play-resign').onclick = () => {
  if (mode !== 'play' || !game || game.over) return;
  const humanWhite = game.white.type === 'human';
  token++;
  endGame({ result: humanWhite ? '0-1' : '1-0', reason: 'resignation' }, true);
};
$('#play-undo').onclick = () => {
  if (mode !== 'play' || !game || !game.moves.length) return;
  const humanColor = game.white.type === 'human' ? WHITE : BLACK;
  let moves = game.moves.slice();
  moves.pop();
  const replay = () => { const p = new Position(game.fen0); for (const u of moves) p.make(p.legal().find((x) => p.uci(x) === u)); return p; };
  let p = replay();
  if (p.side !== humanColor && moves.length) { moves.pop(); p = replay(); }
  if (p.side !== humanColor) return;
  token++;
  const sans = [];
  const q = new Position(game.fen0);
  for (const u of moves) { const m = q.legal().find((x) => q.uci(x) === u); sans.push(q.san(m)); q.make(m); }
  Object.assign(game, { pos: q, moves, sans, over: null, lastMove: 0 });
  banner(null); board.arrows([]);
  drawGame(); look();
  tick(token);
};
$('#flip').onclick = () => { board.setFlipped(!board.flipped); renderSeats(); for (const [c] of [['w'], ['b']]) { const f = board.flies.get(c); if (f) board.perch(f, c); } };

// watch
let watchPaused = true;
const series = { w: 0, b: 0, d: 0 };
function renderSeries() {
  $('#watch-score').textContent = `White ${series.w}, Black ${series.b}, draws ${series.d}`;
}
function showWatchIdle() {
  series.w = series.b = series.d = 0;
  renderSeries();
  $('#watch-score').textContent = '';
  board.setFlipped(false);
  updateFocus(settings.watchW);
  game = { fen0: START_FEN, pos: new Position(), moves: [], sans: [], white: { type: 'fly', id: settings.watchW }, black: { type: 'fly', id: settings.watchB }, over: null, idle: true };
  board.removeFlies();
  board.perch(board.addFly('w', 'white'), 'w');
  board.perch(board.addFly('b', 'red'), 'b');
  drawGame();
  banner('Fly vs fly', 'Pick two flies and press Start.');
  status('');
}
function startWatch(next = false) {
  watchPaused = false;
  if (!next) { series.w = series.b = series.d = 0; }
  renderSeries();
  const w = { type: 'fly', id: settings.watchW, depth: 2 }, b = { type: 'fly', id: settings.watchB, depth: 2 };
  updateFocus(settings.watchW);
  newGame(w, b);
}
$('#watch-start').onclick = () => { if (mode !== 'watch') setMode('watch'); startWatch(false); };
$('#watch-pause').onclick = () => { watchPaused = true; token++; status('Paused.'); };

// train
function lifeHTML(i) {
  const steps = [['egg', 0], ['larva', 1], ['pupa', 400], ['adult', 3000]];
  const idx = steps.findIndex((s) => s[0] === i.stage);
  let frac = idx / 3;
  if (idx < 3) {
    const [, a] = steps[idx], [, b] = steps[idx + 1];
    frac += Math.min(1, (i.games - a) / (b - a)) / 3;
  }
  return `<span class="bar" style="width:${75 * frac}%"></span>` + steps.map(([name, g], k) =>
    `<div class="step ${k < idx ? 'done' : ''} ${k === idx ? 'now' : ''}"><i></i>${name}<small>${g ? g.toLocaleString('en') + '+ games' : 'new'}</small></div>`).join('');
}
const brainText = (i) => i.wiring === 'random'
  ? `random wiring: 806 inputs, ${i.nKC.toLocaleString('en')} Kenyon cells, 1 output neuron`
  : `real FlyWire wiring${i.wiring === 'shuffled' ? ' (shuffled)' : ''}: 806 inputs, ${i.nCell} projection neurons, ${i.nKC.toLocaleString('en')} Kenyon cells, 1 output neuron`;
function renderMine() {
  const i = infos.mine;
  if (!i) return;
  const rec = i.record;
  $('#mine-tag').innerHTML = `<dt>Specimen</dt><dd class="big">Your fly</dd>
    <dt>Stage</dt><dd>${i.stage}</dd>
    <dt>Games lived</dt><dd>${i.games.toLocaleString('en')}</dd>
    <dt>Strength</dt><dd>${i.elo != null ? i.elo : 'not measured yet'}</dd>
    <dt>Against you</dt><dd>${rec.w} won, ${rec.d} drawn, ${rec.l} lost</dd>
    <dt>Brain</dt><dd>${brainText(i)}</dd>`;
  $('#life').innerHTML = lifeHTML(i);
}
function showTrainIdle() {
  board.setFlipped(false);
  updateFocus('mine');
  game = null;
  board.removeFlies();
  board.draw(new Position(), null, -1);
  $('#seat-top').innerHTML = ''; $('#seat-bottom').innerHTML = '';
  $('#moves').innerHTML = '';
  banner(null);
  status(infos.mine && infos.mine.games ? 'Ready to keep training.' : 'A new egg. It has never seen a chess game.');
  renderMine();
}
let examining = false;
function toggleTraining(onOff) {
  training = onOff;
  $('#train-toggle').textContent = training ? 'Pause training' : 'Start training';
  $('#train-toggle').classList.toggle('primary', true);
  worker.postMessage({ type: 'train', id: 'mine', on: training, live: $('#train-live').checked, examGames: 10 });
  status(training ? 'Training: your fly is playing against itself.' : 'Training paused.');
}
$('#train-toggle').onclick = () => { if (mode !== 'train') setMode('train'); toggleTraining(!training); };
$('#train-live').onchange = () => { if (training) { toggleTraining(false); toggleTraining(true); } };
$('#train-exam').onclick = async () => {
  if (examining) return;
  const was = training;
  if (was) toggleTraining(false);
  examining = true;
  status('Exam in progress: 40 games against the four fixed opponents…');
  const r = await rpc({ type: 'exam', id: 'mine', n: 10 });
  examining = false;
  infos.mine = r.info;
  const vs = Object.entries(r.point.vs).map(([k, [w, d, l]]) => `${k} +${w} =${d} −${l}`).join(', ');
  status(`Exam result: strength ${r.point.elo}. ${vs}.`);
  worker.postMessage({ type: 'export', id: 'mine' });
  renderMine(); renderLearned(focusId); fillSelects();
  if (was) toggleTraining(true);
};
on('exported', (m) => { if (m.id === 'mine') saveMine(m.json); });
on('progress', (m) => {
  infos.mine = m.info;
  renderMine();
  if (m.dopamine) scope.dopamine(m.dopamine);
  if (focusId === 'mine') renderLearned('mine');
});
let lastLive = 0;
on('live', (m) => {
  if (mode !== 'train' || !training) return;
  const pos = new Position(m.fen);
  board.draw(pos, [sq64(parseSq(m.move.slice(0, 2))), sq64(parseSq(m.move.slice(2, 4)))], checkSq(pos));
  const now = performance.now();
  if (now - lastLive > 300) { lastLive = now; look(m.fen); }
});
on('examining', () => { if (mode === 'train') status('Exam in progress…'); });
on('exam', (m) => {
  infos.mine = m.info;
  renderMine(); renderLearned(focusId); fillSelects();
  if (mode === 'train') status(`Exam at ${m.point.games.toLocaleString('en')} games: strength ${m.point.elo}. Training continues.`);
});
on('save', (m) => { if (m.id === 'mine') saveMine(m.json); });

$('#mine-export').onclick = async () => {
  const r = await rpc({ type: 'export', id: 'mine' });
  const blob = new Blob([JSON.stringify(r.json)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chessfly-${r.json.games}-games.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#mine-import').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    if (training) toggleTraining(false);
    const r = await rpc({ type: 'load', id: 'mine', json, name: 'Your fly' });
    infos.mine = r.info; saveMine(json);
    fillSelects(); renderMine(); updateFocus('mine');
    status(`Loaded a fly with ${r.info.games.toLocaleString('en')} games behind it.`);
  } catch (err) {
    status(`That file is not a ChessFly brain (${err.message}).`);
  }
  e.target.value = '';
};
$('#mine-reset').onclick = async () => {
  if (!confirm('Replace your fly with a new egg? Its brain will be lost unless you saved it to a file.')) return;
  if (training) toggleTraining(false);
  const r = await rpc({ type: 'load', id: 'mine', json: null, name: 'Your fly', nKC: 4000, wiring: $('#egg-wiring').value });
  infos.mine = r.info;
  worker.postMessage({ type: 'export', id: 'mine' });
  fillSelects(); renderMine(); updateFocus('mine');
  if (mode === 'train') showTrainIdle();
  else if (mode === 'play') startPlay();
};

// ---------- 2D / 3D ----------
async function setView(v) {
  if (v === view) return;
  if (v === '3d' && !board3d) {
    status('Loading 3D…');
    try {
      const { Board3D } = await import('./board3d.js');
      board3d = new Board3D($('.board-wrap'));
    } catch (err) { status(`3D is not available here (${err.message}).`); return; }
  }
  view = v;
  try { localStorage.setItem('chessfly.view', v); } catch { /* ignore */ }
  for (const b of $$('#view button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  const next = v === '3d' ? board3d : board2d;
  next.setFlipped(board.flipped);
  board = next;
  $('.board-wrap').classList.toggle('is3d', v === '3d');
  if (board3d) board3d.show(v === '3d');
  if (v === '3d' && !scope3d) {
    try {
      const { BrainView3D } = await import('./brain3d.js');
      scope3d = new BrainView3D($('#brain3d'));
      if (scope.meta) scope3d.setBrain(scope.meta);
      if (lastAct) scope3d.show(lastAct);
    } catch { /* keep the 2D diagram */ }
  }
  if (scope3d) scope3d.show3d(v === '3d');
  $('#brain').style.display = v === '3d' && scope3d ? 'none' : 'block';
  $('#scope-readout').hidden = !(v === '3d' && scope3d);
  captionScope();
  board.removeFlies();
  if (game) {
    for (const [p, c] of [[game.white, 'w'], [game.black, 'b']]) if (p.type === 'fly') board.perch(board.addFly(c, c === 'w' ? 'white' : 'red'), c);
    drawGame();
    if (!game.over && mode !== 'train') { token++; tick(token); }
  } else board.draw(new Position(), null, -1);
}
window.chessfly = { get board() { return board; } }; // handy for scripted captures
$('#view').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });

// ---------- boot ----------
async function boot() {
  status('Hatching…');
  try { setAnatomy(await (await fetch('data/mushroom_body.json')).json()); } catch { /* 2D brain view falls back to a schematic layout */ }
  let mineJson = null;
  try { mineJson = JSON.parse(localStorage.getItem(MINE_KEY) || 'null'); } catch { mineJson = null; }
  const loads = [rpc({ type: 'load', id: 'mine', json: mineJson, name: 'Your fly', nKC: 4000 }).catch(() => rpc({ type: 'load', id: 'mine', json: null, name: 'Your fly', nKC: 4000 }))];
  for (const [id, f] of Object.entries(FLIES)) {
    if (id === 'mine') continue;
    if (!f.file) loads.push(rpc({ type: 'load', id, json: null, name: f.label, seed: f.seed, nKC: 4000 }));
    else loads.push(fetch(f.file).then((r) => (r.ok ? r.json() : null)).then((json) => (json ? rpc({ type: 'load', id, json, name: f.label }) : null)).catch(() => null));
  }
  for (const r of await Promise.all(loads)) if (r) infos[r.id] = r.info;
  if (!mineJson) worker.postMessage({ type: 'export', id: 'mine' });
  if (!infos.adult) settings.watchW = 'mine';
  if (!infos.adultRandom) settings.watchB = infos.pupa ? 'pupa' : 'hatchling';
  fillSelects();
  renderMine();
  const params = new URLSearchParams(location.search);
  let v0 = params.get('view');
  if (!v0) try { v0 = localStorage.getItem('chessfly.view'); } catch { v0 = null; }
  if (v0 === '3d') await setView('3d');
  const want = params.get('mode');
  if (want === 'watch' || want === 'train') { mode = 'play'; setMode(want); if (want === 'watch' && params.has('autostart')) startWatch(); }
  else startPlay();
}
document.body.dataset.mode = 'play';
boot();
