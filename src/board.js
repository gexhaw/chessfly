// SVG chess board with drag/click input, move animation and a fruit fly that carries the pieces.
import { pieceSymbols } from './pieces.js';
import { flyMarkup } from './fly.js';

const NS = 'http://www.w3.org/2000/svg';
const M = 56; // frame margin (board squares are 100 units)
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LETTERS = 'abcdefgh';

export class Board {
  constructor(svg) {
    this.svg = svg;
    svg.setAttribute('viewBox', `${-M} ${-M} ${800 + 2 * M} ${800 + 2 * M}`);
    svg.innerHTML = `<defs>${pieceSymbols()}
      <filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="6" dy="10" stdDeviation="6" flood-opacity=".35"/></filter>
      <marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
      <pattern id="grain" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M0,30 C40,26 80,36 120,30 M0,75 C30,70 90,82 120,74 M0,104 C50,100 70,110 120,103" stroke="rgba(60,35,10,.06)" stroke-width="2" fill="none"/></pattern>
    </defs>`;
    el('rect', { x: -M, y: -M, width: 800 + 2 * M, height: 800 + 2 * M, rx: 18, class: 'frame' }, svg);
    el('rect', { x: -M, y: -M, width: 800 + 2 * M, height: 800 + 2 * M, rx: 18, fill: 'url(#grain)' }, svg);
    this.gSq = el('g', {}, svg);
    this.gHi = el('g', {}, svg);
    this.gCoord = el('g', { class: 'coords' }, svg);
    this.gPieces = el('g', {}, svg);
    this.gArrows = el('g', { class: 'arrows' }, svg);
    this.gFly = el('g', {}, svg);
    this.gOver = el('g', {}, svg);
    this.flipped = false;
    this.flies = new Map();
    this.pos = null;
    this.legal = null; // Map fromIdx -> [{to, promo}]
    this.onMove = null;
    this.sel = -1;
    for (let i = 0; i < 64; i++) {
      const r = el('rect', { width: 100, height: 100, class: ((i >> 3) + (i & 7)) % 2 ? 'sq light' : 'sq dark' }, this.gSq);
      r.dataset.i = i;
    }
    this.layout();
    this.bindInput();
  }

  // square index 0..63 (a1 = 0) -> top-left corner in board units
  xy(i) {
    const f = i & 7, r = i >> 3;
    return this.flipped ? [(7 - f) * 100, r * 100] : [f * 100, (7 - r) * 100];
  }
  center(i) { const [x, y] = this.xy(i); return [x + 50, y + 50]; }

  setFlipped(v) { this.flipped = v; this.layout(); if (this.pos) this.draw(this.pos, this.last); }

  layout() {
    for (const r of this.gSq.children) { const [x, y] = this.xy(+r.dataset.i); r.setAttribute('x', x); r.setAttribute('y', y); }
    this.gCoord.innerHTML = '';
    for (let k = 0; k < 8; k++) {
      const file = this.flipped ? 7 - k : k, rank = this.flipped ? k : 7 - k;
      el('text', { x: k * 100 + 50, y: 800 + M * 0.62, 'text-anchor': 'middle' }, this.gCoord).textContent = LETTERS[file];
      el('text', { x: -M * 0.5, y: k * 100 + 58, 'text-anchor': 'middle' }, this.gCoord).textContent = rank + 1;
    }
  }

  // pos: Position; opts: { last: [from64, to64], check: sq64 }
  draw(pos, last = null, check = -1) {
    this.pos = pos; this.last = last; this.check = check;
    this.gPieces.innerHTML = '';
    for (let i = 0; i < 64; i++) {
      const p = pos.board[((i >> 3) << 4) | (i & 7)];
      if (!p) continue;
      const [x, y] = this.xy(i);
      const u = el('use', { href: `#piece-${p & 8 ? 'b' : 'w'}${' pnbrqk'[p & 7]}`, x: x + 5, y: y + 5, width: 90, height: 90, class: 'piece' }, this.gPieces);
      u.dataset.i = i;
    }
    this.highlight();
  }

  highlight() {
    this.gHi.innerHTML = '';
    const mark = (i, cls) => { const [x, y] = this.xy(i); el('rect', { x, y, width: 100, height: 100, class: cls }, this.gHi); };
    if (this.last) { mark(this.last[0], 'hi-last'); mark(this.last[1], 'hi-last'); }
    if (this.check >= 0) { const [x, y] = this.center(this.check); el('circle', { cx: x, cy: y, r: 48, class: 'hi-check' }, this.gHi); }
    if (this.sel >= 0) {
      mark(this.sel, 'hi-sel');
      for (const t of this.legal?.get(this.sel) || []) {
        const [x, y] = this.center(t.to);
        const occupied = this.pos.board[((t.to >> 3) << 4) | (t.to & 7)];
        el('circle', occupied ? { cx: x, cy: y, r: 44, class: 'hi-cap' } : { cx: x, cy: y, r: 14, class: 'hi-dot' }, this.gHi);
      }
    }
  }

  // Candidate moves the fly weighed: [{from, to, w (0..1), best}]
  arrows(list) {
    this.gArrows.innerHTML = '';
    for (const a of list || []) {
      const [x1, y1] = this.center(a.from), [x2, y2] = this.center(a.to);
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      el('line', {
        x1: x1 + (dx / L) * 22, y1: y1 + (dy / L) * 22, x2: x2 - (dx / L) * 30, y2: y2 - (dy / L) * 30,
        class: a.best ? 'arrow best' : 'arrow', 'stroke-width': a.best ? 16 : 5 + 9 * a.w, 'marker-end': 'url(#ah)', opacity: a.best ? 0.75 : 0.15 + 0.4 * a.w,
      }, this.gArrows);
    }
  }

  // ---- input ----
  setInput(legal, onMove) { this.legal = legal; this.onMove = onMove; this.sel = -1; this.highlight(); }

  sqAt(evt) {
    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(this.gSq.getScreenCTM().inverse());
    if (p.x < 0 || p.y < 0 || p.x >= 800 || p.y >= 800) return { i: -1, p };
    const cx = Math.floor(p.x / 100), cy = Math.floor(p.y / 100);
    const f = this.flipped ? 7 - cx : cx, r = this.flipped ? cy : 7 - cy;
    return { i: r * 8 + f, p };
  }

  bindInput() {
    let drag = null;
    this.svg.addEventListener('pointerdown', (e) => {
      if (this.free) { this.freeDown(e); return; }
      if (!this.legal || this.promoOpen) return;
      const { i, p } = this.sqAt(e);
      if (i < 0) return;
      if (this.sel >= 0 && this.tryMove(this.sel, i)) return;
      if (this.legal.has(i)) {
        this.sel = i; this.highlight();
        const u = [...this.gPieces.children].find((c) => +c.dataset.i === i);
        if (u) {
          drag = { u, i, ox: p.x - +u.getAttribute('x'), oy: p.y - +u.getAttribute('y'), moved: false };
          this.gPieces.appendChild(u);
          this.svg.setPointerCapture(e.pointerId);
        }
      } else { this.sel = -1; this.highlight(); }
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (this.free) { this.freeMove(e); return; }
      if (!drag) return;
      const { p } = this.sqAt(e);
      drag.moved = true;
      drag.u.setAttribute('x', p.x - 45); drag.u.setAttribute('y', p.y - 45);
      drag.u.classList.add('dragging');
    });
    this.svg.addEventListener('pointerup', (e) => {
      if (this.free) { this.freeUp(e); return; }
      if (!drag) return;
      const d = drag; drag = null;
      d.u.classList.remove('dragging');
      const { i } = this.sqAt(e);
      if (d.moved && i >= 0 && i !== d.i && this.tryMove(d.i, i)) return;
      const [x, y] = this.xy(d.i);
      d.u.setAttribute('x', x + 5); d.u.setAttribute('y', y + 5);
    });
  }

  tryMove(from, to) {
    const opts = (this.legal.get(from) || []).filter((t) => t.to === to);
    if (!opts.length) return false;
    this.sel = -1; this.highlight();
    const cb = this.onMove;
    this.legal = null;
    if (opts.some((t) => t.promo)) this.promotion(from, to, (promo) => cb(from, to, promo));
    else cb(from, to, 0);
    return true;
  }

  promotion(from, to, done) {
    this.promoOpen = true;
    const white = to >> 3 === 7;
    const [x0] = this.xy(to);
    const g = el('g', { class: 'promo' }, this.gOver);
    el('rect', { x: -M, y: -M, width: 800 + 2 * M, height: 800 + 2 * M, fill: 'rgba(20,14,8,.35)' }, g);
    const types = ['q', 'r', 'b', 'n'], codes = [5, 4, 3, 2];
    const x = Math.min(Math.max(x0 - 150, 0), 400);
    el('rect', { x: x - 8, y: 342, width: 416, height: 116, rx: 14, class: 'promo-box' }, g);
    types.forEach((t, k) => {
      const u = el('use', { href: `#piece-${white ? 'w' : 'b'}${t}`, x: x + k * 100 + 5, y: 350, width: 90, height: 90, class: 'promo-pick' }, g);
      u.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.gOver.innerHTML = ''; this.promoOpen = false; done(codes[k]); });
    });
  }


  // ---- sandbox input: no rules at all ----
  // handler(action): {type:'move', from, to} | {type:'remove', from} | {type:'throw', from, x, y, vx, vy}
  //                  | {type:'add', to} (click on a square while a piece is picked in the tray)
  setFree(handler) {
    this.free = handler; this.fdrag = null; this.sel = -1; this.legal = null; this.freeLocked = false;
    this.svg.classList.toggle('free', !!handler);
    this.highlight();
  }
  boardPoint(evt) {
    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(this.gSq.getScreenCTM().inverse());
  }
  freeDown(e) {
    if (this.freeLocked) return;
    const { i, p } = this.sqAt(e);
    if (this.placing && i >= 0) { this.free({ type: 'add', to: i }); return; }
    if (i < 0) return;
    const u = [...this.gPieces.children].find((c) => +c.dataset.i === i);
    if (!u) return;
    this.gPieces.appendChild(u);
    u.classList.add('dragging');
    this.fdrag = { u, i, trail: [[p.x, p.y, performance.now()]], moved: false };
    this.svg.setPointerCapture(e.pointerId);
  }
  freeMove(e) {
    const d = this.fdrag;
    if (!d) return;
    const p = this.boardPoint(e), t = performance.now();
    d.moved = true;
    d.trail.push([p.x, p.y, t]);
    while (d.trail.length > 2 && t - d.trail[0][2] > 90) d.trail.shift();
    d.u.setAttribute('x', p.x - 45); d.u.setAttribute('y', p.y - 45);
  }
  freeUp(e) {
    const d = this.fdrag;
    if (!d) return;
    this.fdrag = null;
    d.u.classList.remove('dragging');
    const p = this.boardPoint(e), t = performance.now();
    const [x0, y0, t0] = d.trail[0];
    const dt = Math.max(16, t - t0);
    const vx = (p.x - x0) / dt, vy = (p.y - y0) / dt, speed = Math.hypot(vx, vy);
    const back = () => { const [x, y] = this.xy(d.i); d.u.setAttribute('x', x + 5); d.u.setAttribute('y', y + 5); };
    if (d.moved && speed > 1.25 && t - d.trail[d.trail.length - 1][2] < 60) {
      this.free({ type: 'throw', from: d.i, x: p.x, y: p.y, vx, vy, u: d.u });
      return;
    }
    const { i } = this.sqAt(e);
    if (!d.moved || i === d.i) { back(); return; }
    if (i < 0) { this.free({ type: 'remove', from: d.i, u: d.u }); return; }
    this.free({ type: 'move', from: d.i, to: i, u: d.u });
  }

  // A thrown piece: slides and spins across the board, bounces off the frame, maybe flies off
  // altogether, maybe hits the fly. Resolves to { sq (landing square or -1), out, hitFly }.
  throwPiece(u, x, y, vx, vy, flyName = null) {
    const fly = flyName ? this.flies.get(flyName) : null;
    const lo = -M + 30, hi = 800 + M - 30;
    vx *= 0.35; vy *= 0.35;
    let z = 0, vz = Math.min(0.9, 0.25 + Math.hypot(vx, vy) * 0.25), ang = 0, out = false, hitFly = false;
    const spin = (vx >= 0 ? 1 : -1) * (0.6 + Math.hypot(vx, vy) * 0.5);
    u.classList.add('lifted', 'thrown');
    this.gPieces.appendChild(u);
    return new Promise((res) => {
      let last = performance.now();
      const step = (now) => {
        const dt = Math.max(0, Math.min(40, now - last)); last = Math.max(last, now);
        x += vx * dt; y += vy * dt;
        z += vz * dt; vz -= 0.0032 * dt;
        if (z <= 0 && vz <= 0) { z = 0; vz = Math.abs(vz) > 0.12 ? -vz * 0.35 : 0; vx *= 0.82; vy *= 0.82; }
        const f = Math.exp(-dt / (z > 0 ? 2200 : 420));
        vx *= f; vy *= f;
        ang += spin * dt * Math.min(1, Math.hypot(vx, vy) + 0.1);
        const speed = Math.hypot(vx, vy);
        if (!out) {
          if (x < lo || x > hi) { if (speed > 0.9 || z > 40) out = true; else { vx = -vx * 0.55; x = Math.max(lo, Math.min(hi, x)); } }
          if (y < lo || y > hi) { if (speed > 0.9 || z > 40) out = true; else { vy = -vy * 0.55; y = Math.max(lo, Math.min(hi, y)); } }
        }
        if (fly && !hitFly && z < 70 && Math.hypot(x - fly.x, y - fly.y) < 58) {
          hitFly = true; vx *= -0.4; vy *= -0.4;
        }
        const s = 1 + z / 160;
        u.setAttribute('x', x - 45); u.setAttribute('y', y - 45 - z * 0.6);
        u.setAttribute('transform', `rotate(${ang.toFixed(1)} ${x.toFixed(1)} ${(y - z * 0.6).toFixed(1)}) translate(${x} ${y}) scale(${s.toFixed(3)}) translate(${-x} ${-y})`);
        const gone = out && (x < -M - 120 || x > 800 + M + 120 || y < -M - 120 || y > 800 + M + 120);
        if (gone || (speed < 0.03 && z === 0 && vz === 0)) {
          u.classList.remove('lifted', 'thrown');
          u.removeAttribute('transform');
          let sq = -1;
          if (!gone && x >= 0 && x < 800 && y >= 0 && y < 800) {
            const cx = Math.floor(x / 100), cy = Math.floor(y / 100);
            sq = (this.flipped ? cy : 7 - cy) * 8 + (this.flipped ? 7 - cx : cx);
          }
          res({ sq, out: gone || sq < 0, hitFly });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // fade a piece out where it lies (rolled off the board, or swept away)
  vanish(u) {
    if (!u) return;
    u.classList.add('captured');
    setTimeout(() => u.remove(), 300);
  }

  // ---- fly moods (sandbox) ----
  say(flyName, text, mood = 'calm', ms = 2600) {
    const f = this.flies.get(flyName);
    if (!f) return;
    if (this.bubble) this.bubble.remove();
    const g = el('g', { class: `bubble ${mood}` }, this.gOver);
    const t = el('text', { 'text-anchor': 'middle' }, g);
    t.textContent = text;
    const w = Math.min(760, Math.max(120, text.length * 15.5 + 44)), h = 62;
    const top = f.y < 400;
    const bx = Math.min(800 + M - w / 2 - 6, Math.max(-M + w / 2 + 6, f.x));
    const by = top ? f.y + 52 : f.y - 52 - h;
    const tail = top ? `M${f.x - 12},${by} L${f.x},${f.y + 26} L${f.x + 12},${by}` : `M${f.x - 12},${by + h} L${f.x},${f.y - 26} L${f.x + 12},${by + h}`;
    g.insertBefore(el('path', { d: tail, class: 'bubble-tail' }), t);
    g.insertBefore(el('rect', { x: bx - w / 2, y: by, width: w, height: h, rx: 22 }), g.querySelector('path'));
    t.setAttribute('x', bx); t.setAttribute('y', by + 41);
    this.bubble = g;
    clearTimeout(this.bubbleT);
    this.bubbleT = setTimeout(() => { if (this.bubble === g) { g.classList.add('out'); setTimeout(() => g.remove(), 300); this.bubble = null; } }, ms);
  }
  async mood(flyName, cls, ms) {
    const f = this.flies.get(flyName);
    if (!f) return;
    f.g.classList.add(cls);
    await sleep(ms);
    f.g.classList.remove(cls);
  }
  angry(flyName, ms = 900) { return this.mood(flyName, 'angry', ms); }
  async dizzy(flyName) {
    const f = this.flies.get(flyName);
    if (!f) return;
    const stars = el('g', { class: 'stars', transform: `translate(${f.x} ${f.y})` }, this.gOver);
    for (let k = 0; k < 3; k++) el('text', { class: `star s${k}`, 'text-anchor': 'middle', y: 8 }, stars).textContent = '✦';
    await this.mood(flyName, 'dizzy', 1700);
    stars.remove();
  }
  // a startled hop sideways and back
  async dodge(flyName) {
    const f = this.flies.get(flyName);
    if (!f) return;
    const x0 = f.x, y0 = f.y, a0 = f.a, s0 = f.s;
    const dx = x0 > 400 ? -110 : 110;
    await this.flyTo(f, x0 + dx, y0, 220, 0.75);
    await sleep(380);
    await this.flyTo(f, x0, y0, 420, s0);
    f.a = a0; this.place(f); f.g.classList.remove('flying');
  }
  // a panicked lap around the board
  async panic(flyName) {
    const f = this.flies.get(flyName);
    if (!f) return;
    const x0 = f.x, y0 = f.y, a0 = f.a, s0 = f.s;
    for (const [x, y] of [[120, 160], [690, 230], [560, 650], [170, 560], [400, 380]]) await this.flyTo(f, x, y, 330, 0.95);
    await this.flyTo(f, x0, y0, 420, s0);
    f.a = a0; this.place(f); f.g.classList.remove('flying');
  }
  // the fly carries a piece somewhere: to a square (toSq) or off the board (toSq = -1, then drops it)
  async carry(flyName, fromSq, toSq, homeSide, speed = 1) {
    const f = this.flies.get(flyName);
    const u = [...this.gPieces.children].find((c) => +c.dataset.i === fromSq);
    if (!f || !u) return;
    const k = 1 / speed;
    const [fx, fy] = this.center(fromSq);
    await this.flyTo(f, fx, fy - 10, Math.min(700, 260 + Math.hypot(fx - f.x, fy - f.y) * 0.5) * k, 1);
    this.gPieces.appendChild(u);
    u.classList.add('lifted');
    await sleep(70 * k);
    let tx, ty;
    if (toSq >= 0) [tx, ty] = this.center(toSq);
    else { tx = fx < 400 ? -M - 10 : 800 + M + 10; ty = Math.max(60, Math.min(740, fy)); }
    await this.flyTo(f, tx, ty - 18, Math.min(900, 300 + Math.hypot(tx - fx, ty - fy) * 0.55) * k, 1, u);
    u.classList.remove('lifted');
    if (toSq >= 0) { const [px, py] = this.xy(toSq); u.setAttribute('x', px + 5); u.setAttribute('y', py + 5); u.dataset.i = toSq; }
    else this.vanish(u);
    await sleep(90 * k);
    if (homeSide) {
      const bottom = (homeSide === 'w') !== this.flipped;
      await this.flyTo(f, 400, bottom ? 800 + M * 0.5 : -M * 0.5, 420 * k, 0.62);
      f.a = bottom ? 0 : 180; this.place(f); f.g.classList.remove('flying');
    }
  }

  // ---- flies ----
  addFly(name, eye) {
    if (this.flies.has(name)) return this.flies.get(name);
    const g = el('g', { class: 'fly' }, this.gFly);
    g.innerHTML = flyMarkup(name.replace(/\W/g, ''), eye);
    const f = { g, x: 400, y: 900, a: 0, s: 1, name };
    this.flies.set(name, f);
    this.place(f);
    return f;
  }
  removeFlies() { this.gFly.innerHTML = ''; this.flies.clear(); }
  place(f) { f.g.setAttribute('transform', `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)}) rotate(${f.a.toFixed(1)}) scale(${(f.s * 0.78).toFixed(3)})`); }

  // perch in the frame on its own side of the board
  perch(f, side, file = 3.5) {
    const bottom = (side === 'w') !== this.flipped;
    f.x = Math.min(760, Math.max(40, (this.flipped ? 7 - file : file) * 100 + 50));
    f.y = bottom ? 800 + M * 0.5 : -M * 0.5;
    f.a = bottom ? 0 : 180; f.s = 0.62;
    f.g.classList.remove('flying');
    this.place(f);
  }

  async flyTo(f, x, y, ms, s = 1, carry = null) {
    const x0 = f.x, y0 = f.y, s0 = f.s;
    const dx = x - x0, dy = y - y0, dist = Math.hypot(dx, dy);
    if (dist > 4) {
      let target = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      let d = ((target - f.a + 540) % 360) - 180;
      f.a0 = f.a; f.a1 = f.a + d;
    } else { f.a0 = f.a1 = f.a; }
    f.g.classList.add('flying');
    const t0 = performance.now();
    await new Promise((res) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms), e = ease(t);
        f.x = x0 + dx * e; f.y = y0 + dy * e - Math.sin(Math.PI * t) * Math.min(60, dist * 0.18);
        f.a = f.a0 + (f.a1 - f.a0) * Math.min(1, t * 3);
        f.s = s0 + (s - s0) * e + Math.sin(Math.PI * t) * 0.12;
        this.place(f);
        if (carry) { carry.setAttribute('x', f.x - 45); carry.setAttribute('y', f.y - 45 + 18); }
        if (t < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  // The fly flies to the piece, carries it to its square, and returns to its perch.
  // info: { from, to, side, capture: sq|-1, rook: [from,to]|null }; speed: 1 = normal.
  async flyMove(flyName, info, speed = 1) {
    const f = this.flies.get(flyName);
    const u = [...this.gPieces.children].find((c) => +c.dataset.i === info.from);
    if (!f || !u || speed <= 0) return;
    const k = 1 / speed;
    const [fx, fy] = this.center(info.from), [tx, ty] = this.center(info.to);
    await this.flyTo(f, fx, fy - 10, Math.min(700, 260 + Math.hypot(fx - f.x, fy - f.y) * 0.5) * k, 1);
    this.gPieces.appendChild(u);
    u.classList.add('lifted');
    await sleep(70 * k);
    await this.flyTo(f, tx, ty - 18, Math.min(800, 280 + Math.hypot(tx - fx, ty - fy) * 0.55) * k, 1, u);
    if (info.capture >= 0) {
      const v = [...this.gPieces.children].find((c) => +c.dataset.i === info.capture && c !== u);
      if (v) v.classList.add('captured');
    }
    u.classList.remove('lifted');
    const [px, py] = this.xy(info.to);
    u.setAttribute('x', px + 5); u.setAttribute('y', py + 5);
    if (info.rook) {
      const r = [...this.gPieces.children].find((c) => +c.dataset.i === info.rook[0]);
      if (r) {
        const [rx, ry] = this.xy(info.rook[1]);
        r.style.transition = `x ${220 * k}ms, y ${220 * k}ms`;
        r.setAttribute('x', rx + 5); r.setAttribute('y', ry + 5);
      }
    }
    await sleep(90 * k);
    const bottom = (info.side === 'w') !== this.flipped;
    const file = info.to & 7;
    const px2 = Math.min(760, Math.max(40, (this.flipped ? 7 - file : file) * 100 + 50));
    const py2 = bottom ? 800 + M * 0.5 : -M * 0.5;
    this.flyTo(f, px2, py2, 380 * k, 0.62).then(() => { f.a = bottom ? 0 : 180; this.place(f); f.g.classList.remove('flying'); });
  }

  // the old six-seven from FLY67, for checkmate
  async celebrate(flyName) {
    const f = this.flies.get(flyName);
    if (!f) return;
    await this.flyTo(f, 400, 400, 600, 1.9);
    f.a = 0; this.place(f);
    f.g.classList.remove('flying');
    f.g.classList.add('six');
    const t = el('text', { x: 400, y: 250, class: 'sixseven', 'text-anchor': 'middle' }, this.gOver);
    t.textContent = '6 · 7';
    await sleep(2600);
    t.remove();
    f.g.classList.remove('six');
  }

  async sulk(flyName) {
    const f = this.flies.get(flyName);
    if (!f) return;
    f.g.classList.add('sulk');
    await sleep(1600);
    f.g.classList.remove('sulk');
  }
}
