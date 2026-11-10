// Sandbox: no rules. Move anything anywhere, take pieces off the board, throw them, conjure new
// ones, and watch how the fly takes it. Its gut feeling (the real output neuron) is re-read after
// everything you do, and its mood builds up as you break the rules.

import { Position, WHITE, BLACK, KING, QUEEN, PAWN, sq64, sq88, moveFrom, moveTo, moveFlags, F_CAPTURE, F_EP, F_CASTLE } from './chess.js';

const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const T = ' pnbrqk';
const VALUE = [0, 1, 3, 3, 5, 9, 0];
const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colorOf = (p) => (p & 8 ? 'b' : 'w');
const pname = (p) => NAME[T[p & 7]];

// what the fly says (a few of each, so it doesn't repeat itself too much)
const LINES = {
  illegal: {
    n: ['Knights jump in an L. That was not an L.', 'That knight just teleported.'],
    b: ['Bishops go diagonally. I checked.', 'That bishop forgot its diagonals.'],
    r: ['Rooks go straight. STRAIGHT.', 'Rooks don\'t do that. Ever.'],
    p: ['Pawns don\'t move like that!', 'That pawn is cheating.'],
    q: ['Even a queen has rules.', 'Her Majesty cannot do that.'],
    k: ['Kings move one square. One.', 'Your king is not a knight.'],
  },
  illegalAgain: ['Again?!', 'Stop. Doing. That.', 'I can see you, you know.', 'Is that allowed where you come from?'],
  illegalFurious: ['THAT. IS. NOT. CHESS.', 'I have 5,177 Kenyon cells and ALL of them are angry.'],
  theft: ['Hey! That\'s MY {p}!', 'Hands off my {p}!', 'Excuse me. Mine.'],
  putBack: ['Put that back. …Never mind, I\'ll do it.', 'My {p} goes HERE.'],
  twice: ['It\'s my turn, you know.', 'Two moves in a row? Bold.'],
  stole: ['Give me back my {p}!', 'Where did my {p} go?!', 'You can\'t just TAKE my {p}.'],
  stoleBig: ['That {p} was important!', 'NOT MY {P}!'],
  gift: ['You threw away your own {p}? …Thanks?', 'One less {p} to worry about.'],
  throwLand: ['Whoa! Did you just throw a {p}?', 'Flying {p}s now?', 'Interesting new rule.'],
  throwKnock: ['Strike! It knocked my {k} right off.', 'You bowled over my {k}!'],
  throwKnockOwn: ['You knocked over your own {k}. Nice aim.'],
  throwOut: ['And it\'s gone. Out of the arena.', 'Bye bye, {p}.'],
  hit: ['OW! Right in the compound eyes!', 'OUCH. That hurt my ommatidia.', 'Hey! I have only one brain!'],
  dodge: ['Whoa! Watch it!', 'Missed me!'],
  addTheirs: ['Ooh, a free {p}!', 'For me? You shouldn\'t have.'],
  addYours: ['Where did that {p} come from?!', 'A spare {p}? From your pocket?'],
  addMany: ['That\'s not fair and you know it.', 'How many {p}s do you need?!'],
  revenge: ['Fine. Two can play that game.', 'Your {p} is taking a little trip.', 'Rules? What rules?'],
  myKingGone: ['WHERE IS MY KING?!', 'My king! Somebody took my king!'],
  yourKingGone: ['No king? Then I win, I guess.', 'You lost your king. That\'s… a loss.'],
  kingHanging: ['Your king is hanging. I\'m taking it.', 'You left your king in check. Gotcha.'],
  happy: ['I like this.', 'Oh, this looks good for me.', 'Nice.'],
  worried: ['Hmm. I don\'t like this.', 'This feels bad.', 'Uh-oh.'],
  mated: ['Checkmate. Fair and square… unlike some of us.', 'Checkmate! 6 · 7!'],
  gotMated: ['…I\'m checkmated. Probably because you cheated.', 'I lost. I demand a rematch with rules.'],
  stalemate: ['Stalemate. Nobody wins.', 'I can\'t move. That\'s a draw.'],
  calmMove: ['', '', '', 'My move.', 'Hm.'],
};
const fill = (s, p, k) => s.replace('{p}', p || '').replace('{P}', (p || '').toUpperCase()).replace('{k}', k || '');

export class Sandbox {
  // ctx: { board(): Board, rpc, scope, $, infos, FLIES, status(text), seats(game), focus(id), look(...) }
  constructor(ctx) {
    this.ctx = ctx;
    this.flyColor = 'b';
    this.flyId = 'adult';
    this.reply = true;
    this.placing = 0;
    this.reset();
  }

  get board() { return this.ctx.board(); }
  get you() { return this.flyColor === 'w' ? 'b' : 'w'; }

  reset() {
    this.arr = new Int8Array(64);
    for (let i = 0; i < 64; i++) {
      const ch = START[(7 - (i >> 3)) * 8 + (i & 7)];
      if (ch === '.') continue;
      const lower = ch.toLowerCase();
      this.arr[i] = (ch === lower ? BLACK : WHITE) | T.indexOf(lower);
    }
    this.touched = new Set();
    this.turn = 'w';
    this.anger = 0;
    this.value = null;
    this.log = [];
    this.busy = false;
    this.over = false;
    this.ep = -1;
  }

  // ---- position bookkeeping ----
  fen(side = this.turn) {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.arr[r * 8 + f];
        if (!p) { e++; continue; }
        if (e) { s += e; e = 0; }
        const c = T[p & 7];
        s += p & 8 ? c : c.toUpperCase();
      }
      if (e) s += e;
      if (r) s += '/';
    }
    const W = (i, t) => this.arr[i] === (WHITE | t) && !this.touched.has(i);
    const B = (i, t) => this.arr[i] === (BLACK | t) && !this.touched.has(i);
    let c = '';
    if (W(4, KING) && W(7, 4)) c += 'K';
    if (W(4, KING) && W(0, 4)) c += 'Q';
    if (B(60, KING) && B(63, 4)) c += 'k';
    if (B(60, KING) && B(56, 4)) c += 'q';
    const ep = this.ep >= 0 && side === this.turn ? 'abcdefgh'[this.ep & 7] + ((this.ep >> 3) + 1) : '-';
    return `${s} ${side} ${c || '-'} ${ep} 0 1`;
  }
  kings() {
    const k = { w: 0, b: 0 };
    for (const p of this.arr) if ((p & 7) === KING) k[colorOf(p)]++;
    return k;
  }
  // a position the engine can work with: exactly one king each
  sane() { const k = this.kings(); return k.w === 1 && k.b === 1; }
  pos(side = this.turn) { return new Position(this.fen(side)); }
  readPos(pos) { for (let i = 0; i < 64; i++) this.arr[i] = pos.board[sq88(i)]; }

  draw(last = null) {
    let check = -1;
    if (this.sane()) {
      const p = this.pos();
      if (p.inCheck()) check = sq64(p.kings[p.side >> 3]);
    }
    const pos = { board: new Int8Array(128) };
    for (let i = 0; i < 64; i++) pos.board[sq88(i)] = this.arr[i];
    this.board.draw(pos, last, check);
    this.ctx.renderLog(this.log);
  }

  note(text) { this.log.push(text); if (this.log.length > 60) this.log.shift(); }

  // ---- entering / leaving the mode ----
  enter() {
    this.active = (this.active || 0) + 1;
    this.busy = false;
    const b = this.board;
    b.setFlipped(this.flyColor === 'w');
    b.removeFlies();
    b.clearDebris?.();
    b.perch(b.addFly(this.flyColor, this.flyColor === 'w' ? 'white' : 'red'), this.flyColor);
    b.arrows([]);
    this.draw();
    b.setFree((a) => this.act(a));
    this.ctx.focus(this.flyId);
    this.feel(true);
    this.say(pick(['Go on. Do something.', 'I\'m watching you.', 'Rules? We have rules, right?']), 'calm', 2400);
    this.renderMood();
    if (this.turn === this.flyColor && this.reply) this.act({ type: 'pass' });
  }
  leave() {
    this.active = (this.active || 0) + 1; // anything still in flight belongs to an old session
    this.busy = false;
    this.board.setFree(null); this.setPlacing(0);
    if (this.board.bubble) { this.board.bubble.remove(); this.board.bubble = null; }
  }

  // ---- the fly's feelings ----
  async feel(quiet = false) {
    const before = this.value;
    if (!this.kings()[this.flyColor]) { this.value = -1; this.renderMood(); return { before, after: -1, d: -1 - (before ?? 0) }; }
    const fen = this.fen(this.flyColor);
    let a;
    try { a = await this.ctx.rpc({ type: 'look', id: this.flyId, fen, moves: [], as: this.flyColor }); } catch { return { before, after: before, d: 0 }; }
    this.ctx.scope.show(a, `${this.ctx.FLIES[this.flyId].label}, feeling the board as ${this.flyColor === 'w' ? 'White' : 'Black'}`);
    this.value = a.value;
    this.renderMood();
    const d = before == null || quiet ? 0 : a.value - before;
    return { before, after: a.value, d };
  }
  say(text, mood, ms) { if (text) this.board.say(this.flyColor, text, mood || this.moodName().cls, ms || 2800); }
  moodName() {
    const a = this.anger;
    if (a >= 4) return { label: 'Furious', cls: 'furious' };
    if (a >= 3) return { label: 'Angry', cls: 'angry' };
    if (a >= 2) return { label: 'Annoyed', cls: 'annoyed' };
    if (a >= 1) return { label: 'Suspicious', cls: 'puzzled' };
    if (this.value != null && this.value > 0.35) return { label: 'Smug', cls: 'happy' };
    if (this.value != null && this.value < -0.35) return { label: 'Worried', cls: 'worried' };
    return { label: 'Calm', cls: 'calm' };
  }
  renderMood() {
    const $ = this.ctx.$;
    const m = this.moodName();
    const v = this.value ?? 0;
    $('#sb-mood').textContent = m.label;
    $('#sb-mood').className = `mood ${m.cls}`;
    $('#sb-anger').style.width = `${Math.min(100, this.anger * 25)}%`;
    $('#sb-feel-bar').style.left = `${50 + Math.min(50, Math.max(-50, v * 50))}%`;
    $('#sb-feel').textContent = `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  }
  angerUp(x) { this.anger = Math.max(0, Math.min(5, this.anger + x)); this.renderMood(); }

  setPlacing(code) {
    this.placing = code;
    this.board.placing = code;
    for (const b of this.ctx.$$('#sb-tray button')) b.setAttribute('aria-pressed', String(+b.dataset.p === code));
  }

  // ---- what you did ----
  async act(a) {
    if (this.busy) return;
    this.busy = true;
    this.board.freeLocked = true;
    const session = this.active;
    try { await this.handle(a); } finally { if (session === this.active) { this.busy = false; this.board.freeLocked = false; } }
  }

  async handle(a) {
    const b = this.board, fly = this.flyColor, you = this.you;
    if (a.type === 'pass') { await this.flyTurn(); return; }
    let kind = null, piece = 0, extra = {};
    if (a.type === 'move') {
      piece = this.arr[a.from];
      const target = this.arr[a.to];
      const mine = colorOf(piece) === you;
      // was it a legal move, for whoever's piece it was?
      let legal = null;
      if (this.sane()) {
        const p = new Position(this.fen(colorOf(piece)));
        this.ep = -1;
        legal = p.legal().find((m) => sq64(moveFrom(m)) === a.from && sq64(moveTo(m)) === a.to) || null;
        if (legal) {
          const fl = moveFlags(legal);
          const promo = (legal >> 14) & 7;
          if (promo && promo !== QUEEN) legal = p.legal().find((m) => sq64(moveFrom(m)) === a.from && sq64(moveTo(m)) === a.to && ((m >> 14) & 7) === QUEEN);
          p.make(legal);
          this.readPos(p);
          if (fl & 8) this.ep = (a.from + a.to) >> 1;
          extra.castle = !!(fl & F_CASTLE); extra.ep = !!(fl & F_EP);
        }
      }
      this.ep = legal ? this.ep : -1;
      if (!legal) { this.arr[a.to] = piece; this.arr[a.from] = 0; }
      this.touched.add(a.from); this.touched.add(a.to);
      if (!mine) kind = 'theft';
      else if (!legal) kind = 'illegal';
      else if (this.turn === fly && this.reply) kind = 'twice';
      else kind = 'legal';
      extra.captured = target;
      extra.from = a.from; extra.to = a.to;
      this.draw([a.from, a.to]);
      this.note(`You: ${pname(piece)} ${sqn(a.from)}–${sqn(a.to)}${kind === 'legal' ? '' : kind === 'theft' ? ' (its piece!)' : kind === 'twice' ? ' (out of turn)' : ' (illegal)'}`);
    } else if (a.type === 'remove') {
      this.ep = -1;
      piece = this.arr[a.from];
      this.arr[a.from] = 0; this.touched.add(a.from);
      b.vanish(a.u);
      kind = colorOf(piece) === fly ? 'stole' : 'gift';
      this.draw();
      this.note(`You took the ${colorOf(piece) === fly ? 'fly\'s' : 'your own'} ${pname(piece)} off ${sqn(a.from)}`);
    } else if (a.type === 'throw') {
      this.ep = -1;
      piece = this.arr[a.from];
      this.arr[a.from] = 0; this.touched.add(a.from);
      const r = await b.throwPiece(a.u, a.x, a.y, a.vx, a.vy, fly);
      kind = 'throw';
      extra = r;
      if (r.sq >= 0) {
        extra.knocked = this.arr[r.sq] && r.sq !== a.from ? this.arr[r.sq] : 0;
        this.arr[r.sq] = piece; this.touched.add(r.sq);
      }
      this.draw(r.sq >= 0 ? [a.from, r.sq] : null);
      this.note(`You threw a ${pname(piece)}${r.out ? ' off the board' : ` to ${sqn(r.sq)}`}${extra.knocked ? `, knocking over a ${pname(extra.knocked)}` : ''}${r.hitFly ? ' (it hit the fly)' : ''}`);
    } else if (a.type === 'add') {
      this.ep = -1;
      piece = this.placing;
      if (!piece) return;
      extra.replaced = this.arr[a.to];
      this.arr[a.to] = piece; this.touched.add(a.to);
      kind = colorOf(piece) === fly ? 'addTheirs' : 'addYours';
      this.draw();
      this.note(`You conjured a ${colorOf(piece) === 'w' ? 'white' : 'black'} ${pname(piece)} on ${sqn(a.to)}`);
    }
    if (!kind) return;
    await this.react(kind, piece, extra);
  }

  async react(kind, piece, x) {
    const b = this.board, fly = this.flyColor, p = pname(piece), session = this.active;
    const f = await this.feel();
    if (session !== this.active) return;
    const dv = f.d;
    let line = '', mood = null, anim = null;
    const kings = this.kings();
    switch (kind) {
      case 'legal':
        this.anger = Math.max(0, this.anger - 0.5);
        break;
      case 'illegal':
        this.angerUp(1);
        line = this.anger >= 4 ? pick(LINES.illegalFurious) : this.anger >= 2 ? pick(LINES.illegalAgain) : pick(LINES.illegal[T[piece & 7]]);
        anim = () => b.angry(fly, 700 + this.anger * 150);
        break;
      case 'theft':
        this.angerUp(1.5);
        line = fill(pick(LINES.theft), p);
        anim = () => b.angry(fly, 900);
        break;
      case 'twice':
        this.angerUp(0.7);
        line = pick(LINES.twice);
        anim = () => b.angry(fly, 500);
        break;
      case 'stole':
        this.angerUp((piece & 7) === KING ? 2.5 : VALUE[piece & 7] >= 5 ? 1.5 : 1);
        line = fill(pick(dv < -0.2 || VALUE[piece & 7] >= 5 ? LINES.stoleBig : LINES.stole), p);
        anim = () => b.angry(fly, 900);
        break;
      case 'gift':
        this.angerUp(0.3);
        line = fill(pick(LINES.gift), p);
        break;
      case 'throw': {
        this.angerUp(x.hitFly ? 2 : 1);
        if (x.hitFly) { line = pick(LINES.hit); anim = () => b.dizzy(fly); } else if (x.knocked) {
          line = fill(pick(colorOf(x.knocked) === fly ? LINES.throwKnock : LINES.throwKnockOwn), p, pname(x.knocked));
          anim = () => b.dodge(fly);
        } else if (x.out) { line = fill(pick(LINES.throwOut), p); anim = () => b.dodge(fly); } else { line = fill(pick(LINES.throwLand), p); anim = () => b.dodge(fly); }
        break;
      }
      case 'addTheirs':
        line = fill(pick(LINES.addTheirs), p);
        break;
      case 'addYours': {
        this.angerUp(1);
        let n = 0;
        for (const q of this.arr) if (q === piece) n++;
        line = fill(pick(n >= 3 && (piece & 7) !== PAWN ? LINES.addMany : LINES.addYours), p);
        anim = () => b.angry(fly, 600);
        break;
      }
    }
    // kings first: they change everything
    if (!kings[fly]) { line = pick(LINES.myKingGone); mood = 'furious'; anim = () => b.panic(fly); }
    else if (!kings[this.you] && kind !== 'legal') { line = pick(LINES.yourKingGone); mood = 'happy'; anim = () => this.party(); }
    // otherwise, if nothing else to say, the gut feeling speaks
    if (!line && Math.abs(dv) > 0.25) line = pick(dv > 0 ? LINES.happy : LINES.worried);
    if (line) this.say(line, mood);
    this.renderFeelNote(f);
    if (anim) await anim();
    if (session !== this.active) return;
    this.turn = fly;
    if (this.reply) await this.flyTurn(kind, x);
    else this.ctx.status('The fly is just watching (it won\'t answer back).');
  }

  renderFeelNote(f) {
    const el = this.ctx.$('#sb-feel-note');
    if (f.before == null || Math.abs(f.d) < 0.015) { el.textContent = ''; return; }
    el.textContent = `Gut feeling ${fmt(f.before)} → ${fmt(f.after)}: ${f.d > 0 ? 'it likes this better' : 'it likes this less'}.`;
  }

  async party() {
    await this.board.celebrate(this.flyColor);
    const f = this.board.flies.get(this.flyColor);
    if (f) this.board.perch(f, this.flyColor);
  }

  // ---- the fly's turn ----
  async flyTurn(kind = null, x = {}) {
    const b = this.board, fly = this.flyColor, you = this.you, session = this.active;
    const kings = this.kings();
    if (!kings[fly] || !kings[you] || kings[fly] > 1 || kings[you] > 1) {
      this.ctx.status(!kings[fly] ? 'The fly has no king. Give it one back (pick a king in the tray).' : !kings[you] ? 'You have no king left. Reset the board to play on.' : 'Too many kings for real chess. The fly refuses to move.');
      this.turn = you;
      return;
    }
    // revenge for a stolen piece it can put back
    if (kind === 'theft' && this.anger >= 2 && !this.arr[x.from] && this.arr[x.to]) {
      this.say(fill(pick(LINES.putBack), pname(this.arr[x.to])), 'annoyed');
      await b.carry(fly, x.to, x.from, fly);
      this.arr[x.from] = this.arr[x.to]; this.arr[x.to] = x.captured || 0;
      this.note(`Fly: put its ${pname(this.arr[x.from])} back on ${sqn(x.from)}`);
      this.draw([x.to, x.from]);
      this.angerUp(-1);
      await this.feel();
      this.turn = you;
      return;
    }
    // if your king can be captured right now, it will be
    const posK = this.pos(fly);
    const yk = posK.kings[you === 'w' ? 0 : 1];
    if (posK.attacked(yk, fly === 'w' ? WHITE : BLACK)) {
      const m = posK.pseudo([]).find((mv) => moveTo(mv) === yk);
      if (m) {
        this.say(pick(LINES.kingHanging), 'happy');
        await b.flyMove(fly, { from: sq64(moveFrom(m)), to: sq64(yk), side: fly, capture: sq64(yk), rook: null }, 1);
        this.arr[sq64(yk)] = this.arr[sq64(moveFrom(m))]; this.arr[sq64(moveFrom(m))] = 0;
        this.note(`Fly: took your king on ${sqn(sq64(yk))}`);
        this.draw([sq64(moveFrom(m)), sq64(yk)]);
        await this.feel();
        await this.party();
        this.over = true;
        this.turn = you;
        return;
      }
    }
    // furious: it breaks the rules too
    if (this.anger >= 4) {
      let best = -1, bv = 0;
      for (let i = 0; i < 64; i++) { const q = this.arr[i]; if (q && colorOf(q) === you && VALUE[q & 7] > bv) { bv = VALUE[q & 7]; best = i; } }
      if (best >= 0) {
        this.say(fill(pick(LINES.revenge), pname(this.arr[best])), 'furious', 3000);
        await b.carry(fly, best, -1, fly);
        this.note(`Fly: threw your ${pname(this.arr[best])} off the board!`);
        this.arr[best] = 0; this.touched.add(best);
        this.anger = 1.5;
        this.draw();
        await this.feel();
        this.turn = you;
        return;
      }
    }
    const pos = this.pos(fly);
    const st = pos.status();
    if (st && (st.reason === 'checkmate' || st.reason === 'stalemate')) {
      this.say(pick(st.reason === 'checkmate' ? LINES.gotMated : LINES.stalemate), st.reason === 'checkmate' ? 'worried' : 'calm', 3500);
      if (st.reason === 'checkmate') b.sulk(fly);
      this.ctx.status(st.reason === 'checkmate' ? 'You checkmated the fly.' : 'Stalemate.');
      this.over = true;
      this.turn = you;
      return;
    }
    this.ctx.status('The fly is thinking…');
    let r;
    try { r = await this.ctx.rpc({ type: 'think', id: this.flyId, fen: this.fen(fly), moves: [], timeMs: 300 }); } catch (e) { this.ctx.status(`The fly is confused by this position (${e.message}).`); this.turn = you; return; }
    if (session !== this.active) return;
    const m = pos.legal().find((mv) => pos.uci(mv) === r.uci);
    if (!m) { this.turn = you; return; }
    const from = sq64(moveFrom(m)), to = sq64(moveTo(m)), fl = moveFlags(m);
    const info = { from, to, side: fly, capture: fl & F_CAPTURE ? (fl & F_EP ? to + (fly === 'w' ? -8 : 8) : to) : -1, rook: null };
    if (fl & F_CASTLE) info.rook = to > from ? [from + 3, from + 1] : [from - 4, from - 1];
    const san = pos.san(m);
    await b.flyMove(fly, info, 1);
    if (session !== this.active) return;
    pos.make(m);
    this.readPos(pos);
    this.touched.add(from); this.touched.add(to);
    this.ep = fl & 8 ? (from + to) >> 1 : -1;
    this.note(`Fly: ${san}`);
    this.turn = you;
    this.draw([from, to]);
    await this.feel();
    this.anger = Math.max(0, this.anger - 0.25);
    this.renderMood();
    const after = this.pos(you);
    const st2 = after.status();
    if (st2 && st2.reason === 'checkmate') { this.say(pick(LINES.mated), 'happy', 3500); this.party(); this.over = true; this.ctx.status('Checkmate. The fly wins.'); return; }
    if (r.score > 0.5 && Math.random() < 0.5) this.say(pick(LINES.happy), 'happy', 1800);
    else if (r.score < -0.5 && Math.random() < 0.5) this.say(pick(LINES.worried), 'worried', 1800);
    this.ctx.status(after.inCheck() ? 'Check! Your move (or do whatever you like).' : 'Your move. Or do whatever you like.');
  }
}

const sqn = (i) => 'abcdefgh'[i & 7] + ((i >> 3) + 1);
const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
