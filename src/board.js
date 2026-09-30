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
      if (!drag) return;
      const { p } = this.sqAt(e);
      drag.moved = true;
      drag.u.setAttribute('x', p.x - 45); drag.u.setAttribute('y', p.y - 45);
      drag.u.classList.add('dragging');
    });
    this.svg.addEventListener('pointerup', (e) => {
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
