// 3D board: three.js scene with turned pieces and a fruit fly that flies over and carries them.
// Same interface as the SVG Board (board.js), so the app can switch between them at any time.
import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Fog, HemisphereLight, DirectionalLight, AmbientLight,
  Mesh, Group, BoxGeometry, PlaneGeometry, CylinderGeometry, SphereGeometry, LatheGeometry, ExtrudeGeometry,
  Shape, ShapeGeometry, RingGeometry, CircleGeometry, TubeGeometry, CatmullRomCurve3, MeshStandardMaterial,
  MeshPhysicalMaterial, MeshBasicMaterial, CanvasTexture, Vector2, Vector3, Raycaster, SRGBColorSpace,
  ACESFilmicToneMapping, PCFShadowMap, DoubleSide, OrbitControls,
} from './vendor/three.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const LETTERS = 'abcdefgh';
const sqX = (i) => (i & 7) - 3.5;
const sqZ = (i) => 3.5 - (i >> 3);
const BOARD_Y = 0.08;

// ---------- pieces ----------
function lathe(pts, segs = 40) { return new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), segs); }
const BASE = [[0, 0], [0.37, 0], [0.37, 0.05], [0.345, 0.075], [0.31, 0.085], [0.305, 0.12], [0.27, 0.14]];

function svgShape(d, s, ox, oy) {
  // tiny parser for the absolute M/L/C/Z paths in pieces.js
  const shape = new Shape();
  const tok = d.match(/[MLCZ]|-?\d*\.?\d+/g);
  let i = 0, cmd = '';
  const n = () => parseFloat(tok[i++]);
  const P = () => { const x = n(), y = n(); return [(x - ox) * s, (oy - y) * s]; };
  while (i < tok.length) {
    if (/[MLCZ]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M') { shape.moveTo(...P()); cmd = 'L'; }
    else if (cmd === 'L') shape.lineTo(...P());
    else if (cmd === 'C') { const a = P(), b = P(), c = P(); shape.bezierCurveTo(...a, ...b, ...c); }
    else if (cmd === 'Z') { shape.closePath(); }
  }
  return shape;
}
const KNIGHT_PATH = 'M15.5,34 C15.5,28.5 18.5,25.5 21,22.5 C18.5,23.2 15.2,24.3 13.2,26 C11.3,27.4 8.8,26 9.6,23.5 C10.5,20.4 13.3,17.4 15.4,14.3 C16.5,12.6 16.9,10.4 17.7,7.8 L20,10 L21.3,6.8 C27.5,7.6 32.8,12.8 33.6,21 C34,26 32.6,30.5 31.5,34 Z';

function pieceGroup(type, mat, dark) {
  const g = new Group();
  const add = (geo, y = 0, m = mat) => { const me = new Mesh(geo, m); me.position.y = y; me.castShadow = true; me.receiveShadow = true; g.add(me); return me; };
  const sphere = (r, y, sx = 1, sy = 1) => { const me = add(new SphereGeometry(r, 28, 18), y); me.scale.set(sx, sy, sx); return me; };
  if (type === 1) { // pawn
    add(lathe([...BASE, [0.24, 0.17], [0.15, 0.3], [0.115, 0.42], [0.18, 0.46], [0.18, 0.49], [0.1, 0.51], [0, 0.51]]));
    sphere(0.14, 0.62);
  } else if (type === 4) { // rook
    add(lathe([...BASE, [0.26, 0.18], [0.215, 0.3], [0.2, 0.62], [0.27, 0.67], [0.28, 0.83], [0, 0.83]]));
    for (let k = 0; k < 6; k++) {
      const m = add(new BoxGeometry(0.1, 0.1, 0.09), 0.88);
      const a = (k / 6) * Math.PI * 2;
      m.position.x = Math.cos(a) * 0.22; m.position.z = Math.sin(a) * 0.22; m.rotation.y = -a;
    }
  } else if (type === 3) { // bishop
    add(lathe([...BASE, [0.25, 0.18], [0.15, 0.38], [0.12, 0.56], [0.19, 0.6], [0.19, 0.63], [0.11, 0.66], [0, 0.66]]));
    sphere(0.15, 0.81, 1, 1.35);
    sphere(0.05, 1.03);
    const slit = add(new BoxGeometry(0.02, 0.2, 0.34), 0.86, new MeshStandardMaterial({ color: dark ? 0xbdb6aa : 0x1d1b20, roughness: 0.6 }));
    slit.rotation.x = 0.5; slit.rotation.y = Math.PI / 2;
  } else if (type === 5 || type === 6) { // queen / king
    const top = type === 5 ? 0.96 : 1.0;
    add(lathe([...BASE, [0.27, 0.18], [0.15, 0.52], [0.12, 0.76], [0.2, 0.8], [0.2, 0.84], [0.13, 0.87], [0.23, top], [0.18, top + 0.02], [0, top - 0.04]]));
    if (type === 5) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const b = sphere(0.045, top + 0.03); b.position.x = Math.cos(a) * 0.2; b.position.z = Math.sin(a) * 0.2;
      }
      sphere(0.075, top + 0.1);
    } else {
      add(lathe([[0.16, 0], [0.1, 0.07], [0, 0.08]]), top);
      add(new BoxGeometry(0.07, 0.26, 0.07), top + 0.2);
      add(new BoxGeometry(0.2, 0.07, 0.07), top + 0.22);
    }
  } else if (type === 2) { // knight: turned base + the 2D silhouette, extruded
    add(lathe([...BASE, [0.26, 0.2], [0, 0.2]]));
    const shape = svgShape(KNIGHT_PATH, 0.028, 22, 34.5);
    const geo = new ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3, curveSegments: 16 });
    geo.translate(0, 0, -0.1);
    add(geo, 0.16); // profile faces the player's left, like on most sets
    const eye = add(new SphereGeometry(0.035, 12, 8), 0.16 + (34.5 - 13.2) * 0.028, new MeshStandardMaterial({ color: dark ? 0xbdb6aa : 0x1d1b20 }));
    eye.position.set((17.6 - 22) * 0.028, eye.position.y, 0.13);
    const eye2 = eye.clone(); eye2.position.z = -0.13; g.add(eye2);
  }
  return g;
}

// ---------- the fly ----------
function stripes() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#cf9f55'; g.fillRect(0, 0, 16, 128);
  g.fillStyle = '#3b2612';
  for (const [y, h] of [[40, 9], [58, 10], [77, 11], [96, 32]]) g.fillRect(0, y, 16, h);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}
function buildFly(eye) {
  const fly = new Group();
  const body = new Group(); fly.add(body);
  const brown = new MeshStandardMaterial({ color: 0xa8753c, roughness: 0.55 });
  const dark = new MeshStandardMaterial({ color: 0x3a2915, roughness: 0.7 });
  const eyes = new MeshPhysicalMaterial({ color: eye === 'white' ? 0xf4efe6 : 0xd6202b, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const thorax = new Mesh(new SphereGeometry(0.1, 24, 16), brown); thorax.scale.set(1, 0.9, 1.15); body.add(thorax);
  const head = new Mesh(new SphereGeometry(0.075, 20, 14), new MeshStandardMaterial({ color: 0xb98544, roughness: 0.5 }));
  head.position.set(0, 0.01, -0.16); head.scale.set(1.1, 0.9, 0.8); body.add(head);
  for (const s of [-1, 1]) {
    const e = new Mesh(new SphereGeometry(0.055, 20, 14), eyes); e.position.set(s * 0.062, 0.02, -0.165); e.scale.set(0.8, 1, 0.95); body.add(e);
  }
  const abd = new SphereGeometry(0.1, 24, 18); abd.rotateX(Math.PI / 2);
  const abdomen = new Mesh(abd, new MeshStandardMaterial({ map: stripes(), roughness: 0.5 }));
  abdomen.position.set(0, -0.01, 0.2); abdomen.scale.set(0.95, 0.8, 1.45); body.add(abdomen);
  // antennae
  for (const s of [-1, 1]) {
    const a = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(s * 0.02, 0.04, -0.21), new Vector3(s * 0.035, 0.07, -0.25), new Vector3(s * 0.06, 0.09, -0.27)]), 8, 0.007, 5), dark);
    body.add(a);
  }
  // legs: [attach, knee, foot]
  fly.legs = {};
  const legDefs = { fl: [-1, -0.07, -0.22, -0.3], fr: [1, -0.07, -0.22, -0.3], ml: [-1, 0, -0.02, 0.0], mr: [1, 0, -0.02, 0.0], hl: [-1, 0.06, 0.14, 0.26], hr: [1, 0.06, 0.14, 0.26] };
  for (const [k, [s, z0, z1, z2]] of Object.entries(legDefs)) {
    const leg = new Group(); leg.position.set(s * 0.05, -0.04, z0);
    const tube = new TubeGeometry(new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(s * 0.16, 0.07, z1 - z0), new Vector3(s * 0.25, -0.12, z2 - z0)]), 16, 0.011, 6);
    leg.add(new Mesh(tube, dark));
    body.add(leg); fly.legs[k] = leg;
  }
  // wings, hinged at the thorax
  const wingShape = new Shape();
  wingShape.moveTo(0, 0); wingShape.bezierCurveTo(0.09, 0.02, 0.12, 0.22, 0.07, 0.34); wingShape.bezierCurveTo(0.03, 0.4, -0.03, 0.36, -0.02, 0.24); wingShape.bezierCurveTo(-0.02, 0.12, -0.02, 0.05, 0, 0);
  const wingMat = new MeshPhysicalMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.38, roughness: 0.1, side: DoubleSide, depthWrite: false, iridescence: 0.8 });
  fly.wings = [];
  for (const s of [-1, 1]) {
    const hinge = new Group(); hinge.position.set(s * 0.03, 0.07, -0.05);
    const geo = new ShapeGeometry(wingShape, 16); geo.rotateX(Math.PI / 2);
    const w = new Mesh(geo, wingMat); w.scale.x = s; hinge.add(w);
    hinge.userData.side = s;
    body.add(hinge); fly.wings.push(hinge);
  }
  // soft shadow blob
  const sh = new Mesh(new CircleGeometry(0.28, 24), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; fly.shadow = sh;
  fly.body = body;
  fly.scale.setScalar(1.8);
  return fly;
}

export class Board3D {
  constructor(container) {
    this.container = container;
    this.flipped = false;
    this.flies = new Map();
    this.pieces = new Map();
    this.legal = null; this.onMove = null; this.sel = -1;
    this.active = false;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board3d';
    container.appendChild(this.canvas);
    const r = this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    r.outputColorSpace = SRGBColorSpace; r.toneMapping = ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = PCFShadowMap;
    const sc = this.scene = new Scene();
    sc.fog = new Fog(new Color(0x1a2522), 22, 40);
    this.camera = new PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 12.6, 11.4);
    const ctl = this.controls = new OrbitControls(this.camera, this.canvas);
    ctl.target.set(0, 0, 0.25); ctl.enableDamping = true; ctl.enablePan = false;
    ctl.minDistance = 8; ctl.maxDistance = 20; ctl.minPolarAngle = 0.15; ctl.maxPolarAngle = 1.25;
    sc.add(new HemisphereLight(0xf3efe6, 0x2a3431, 1.1));
    sc.add(new AmbientLight(0xffffff, 0.15));
    const sun = new DirectionalLight(0xfff3dd, 2.2);
    sun.position.set(-5, 12, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
    sun.shadow.bias = -0.0005;
    sc.add(sun);
    this.buildBoard();
    this.mats = {
      w: new MeshPhysicalMaterial({ color: 0xf1e9d8, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
      b: new MeshPhysicalMaterial({ color: 0x2a2830, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    };
    this.pieceProto = {};
    for (const c of ['w', 'b']) for (let t = 1; t <= 6; t++) this.pieceProto[c + t] = pieceGroup(t, this.mats[c], c === 'b');
    this.gPieces = new Group(); sc.add(this.gPieces);
    this.gHi = new Group(); sc.add(this.gHi);
    this.gArrows = new Group(); sc.add(this.gArrows);
    this.gFly = new Group(); sc.add(this.gFly);
    this.ray = new Raycaster();
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = (t) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  labelTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#21322e'; g.fillRect(0, 0, 1024, 1024);
    g.fillStyle = 'rgba(236,223,189,.8)'; g.font = '600 34px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const u = 1024 / 9.4, o = 0.7 * u; // board spans 8 of the 9.4 units
    for (let k = 0; k < 8; k++) {
      const x = o + (k + 0.5) * u;
      g.fillText(LETTERS[k], x, 1024 - o / 2);
      g.save(); g.translate(x, o / 2); g.rotate(Math.PI); g.fillText(LETTERS[k], 0, 0); g.restore();
      const y = o + (7 - k + 0.5) * u;
      g.fillText(String(k + 1), o / 2, y);
      g.save(); g.translate(1024 - o / 2, y); g.rotate(Math.PI); g.fillText(String(k + 1), 0, 0); g.restore();
    }
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  buildBoard() {
    const frame = new Mesh(new BoxGeometry(9.4, 0.36, 9.4), [
      ...Array(2).fill(new MeshStandardMaterial({ color: 0x1b2926, roughness: 0.6 })),
      new MeshStandardMaterial({ map: this.labelTexture(), roughness: 0.55 }),
      new MeshStandardMaterial({ color: 0x1b2926 }),
      ...Array(2).fill(new MeshStandardMaterial({ color: 0x1b2926, roughness: 0.6 })),
    ]);
    frame.position.y = -0.18 + 0.02; frame.receiveShadow = true;
    this.scene.add(frame);
    const light = new MeshStandardMaterial({ color: 0xecdfbd, roughness: 0.62 }), dark = new MeshStandardMaterial({ color: 0x6e8c83, roughness: 0.55 });
    this.squares = [];
    const geo = new BoxGeometry(1, 0.06, 1);
    for (let i = 0; i < 64; i++) {
      const m = new Mesh(geo, ((i >> 3) + (i & 7)) % 2 ? light : dark);
      m.position.set(sqX(i), BOARD_Y - 0.03, sqZ(i)); m.receiveShadow = true; m.userData.sq = i;
      this.scene.add(m); this.squares.push(m);
    }
    const table = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: 0x1a2522, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2; table.position.y = -0.36; table.receiveShadow = true;
    this.scene.add(table);
  }

  resize() {
    const w = this.container.clientWidth || 600;
    this.renderer.setSize(w, w, false);
    this.canvas.style.width = this.canvas.style.height = `${w}px`;
    this.camera.aspect = 1; this.camera.updateProjectionMatrix();
  }

  // client coordinates of a square's centre (used by the capture/test scripts)
  screenOf(i) {
    const v = new Vector3(sqX(i), BOARD_Y, sqZ(i)).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }

  show(v) { this.active = v; this.canvas.style.display = v ? 'block' : 'none'; if (v) this.resize(); }

  setFlipped(v) {
    if (v === this.flipped) return;
    this.flipped = v;
    const c = this.camera.position, t = this.controls.target;
    c.set(-c.x, c.y, -c.z); t.set(-t.x, t.y, -t.z);
    this.controls.update();
    if (this.pos) this.draw(this.pos, this.last, this.check);
  }

  draw(pos, last = null, check = -1) {
    this.pos = pos; this.last = last; this.check = check;
    this.gPieces.clear(); this.pieces.clear();
    for (let i = 0; i < 64; i++) {
      const p = pos.board[((i >> 3) << 4) | (i & 7)];
      if (!p) continue;
      const g = this.pieceProto[(p & 8 ? 'b' : 'w') + (p & 7)].clone();
      g.position.set(sqX(i), BOARD_Y, sqZ(i));
      if ((p & 7) === 2) g.rotation.y = p & 8 ? Math.PI : 0;
      g.userData.sq = i;
      this.gPieces.add(g); this.pieces.set(i, g);
    }
    this.highlight();
  }

  mark(i, color, opacity, kind = 'square') {
    let m;
    if (kind === 'square') m = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    else if (kind === 'dot') m = new Mesh(new CircleGeometry(0.14, 24), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    else m = new Mesh(new RingGeometry(0.38, 0.47, 36), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(sqX(i), BOARD_Y + 0.004, sqZ(i));
    this.gHi.add(m);
  }

  highlight() {
    this.gHi.clear();
    if (this.last) { this.mark(this.last[0], 0xd6a03c, 0.42); this.mark(this.last[1], 0xd6a03c, 0.42); }
    if (this.check >= 0) this.mark(this.check, 0xcf2531, 0.85, 'ring');
    if (this.sel >= 0) {
      this.mark(this.sel, 0xd6a03c, 0.75);
      for (const t of this.legal?.get(this.sel) || []) this.mark(t.to, 0x16302b, 0.45, this.pieces.has(t.to) ? 'ring' : 'dot');
    }
  }

  arrows(list) {
    this.gArrows.clear();
    for (const a of list || []) {
      const x1 = sqX(a.from), z1 = sqZ(a.from), x2 = sqX(a.to), z2 = sqZ(a.to);
      const L = Math.hypot(x2 - x1, z2 - z1), w = a.best ? 0.16 : 0.05 + 0.09 * a.w;
      const s = new Shape();
      const len = L - 0.3, hw = w / 2, head = Math.max(0.2, w * 1.6);
      s.moveTo(-hw, 0.2); s.lineTo(hw, 0.2); s.lineTo(hw, len - head * 0.9); s.lineTo(head, len - head * 0.9); s.lineTo(0, len); s.lineTo(-head, len - head * 0.9); s.lineTo(-hw, len - head * 0.9); s.closePath();
      // drawn on top of the pieces (like the 2D board), so a candidate move is never hidden behind one
      const m = new Mesh(new ShapeGeometry(s), new MeshBasicMaterial({ color: a.best ? 0xcf2531 : 0xe0a93c, transparent: true, opacity: a.best ? 0.85 : 0.35 + 0.4 * a.w, depthWrite: false, depthTest: false, side: DoubleSide }));
      m.renderOrder = a.best ? 11 : 10;
      m.rotation.x = -Math.PI / 2;
      const holder = new Group(); holder.add(m);
      holder.position.set(x1, BOARD_Y + 0.012 + (a.best ? 0.002 : 0), z1);
      holder.rotation.y = Math.atan2(-(x2 - x1), -(z2 - z1));
      this.gArrows.add(holder);
    }
  }

  // ---- input: click a piece, then click its square (drag orbits the camera) ----
  setInput(legal, onMove) { this.legal = legal; this.onMove = onMove; this.sel = -1; this.highlight(); }

  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const v = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObjects([...this.gPieces.children, ...this.squares], true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.sq === undefined) o = o.parent;
      if (o) return o.userData.sq;
    }
    return -1;
  }

  bindInput() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) { down = null; return; }
      down = null;
      if (!this.legal || this.promoOpen) return;
      const i = this.pick(e);
      if (i < 0) return;
      if (this.sel >= 0) {
        const opts = (this.legal.get(this.sel) || []).filter((t) => t.to === i);
        if (opts.length) {
          const from = this.sel, cb = this.onMove;
          this.sel = -1; this.legal = null; this.highlight();
          if (opts.some((t) => t.promo)) this.promotion(i >> 3 === 7, (p) => cb(from, i, p));
          else cb(from, i, 0);
          return;
        }
      }
      this.sel = this.legal.has(i) ? i : -1;
      this.highlight();
    });
  }

  promotion(white, done) {
    this.promoOpen = true;
    const box = document.createElement('div');
    box.className = 'promo3d';
    box.innerHTML = ['q', 'r', 'b', 'n'].map((t, k) => `<button data-k="${k}" aria-label="${['Queen', 'Rook', 'Bishop', 'Knight'][k]}"><svg viewBox="0 0 45 45"><use href="#piece-${white ? 'w' : 'b'}${t}"/></svg></button>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      box.remove(); this.promoOpen = false;
      done([5, 4, 3, 2][+b.dataset.k]);
    });
    this.container.appendChild(box);
  }

  // ---- flies ----
  addFly(name, eye) {
    if (this.flies.has(name)) return this.flies.get(name);
    const g = buildFly(eye);
    this.gFly.add(g); this.gFly.add(g.shadow);
    const f = { g, name, flying: false, six: false, sulk: false };
    this.flies.set(name, f);
    return f;
  }
  removeFlies() { this.gFly.clear(); this.flies.clear(); }

  perchXZ(side, file) {
    const white = side === 'w';
    return [Math.max(-3.8, Math.min(3.8, file - 3.5)), white ? 4.35 : -4.35];
  }
  perch(f, side, file = 3.5) {
    const [x, z] = this.perchXZ(side, file);
    f.g.position.set(x, 0.12, z);
    f.g.rotation.set(0, side === 'w' ? 0 : Math.PI, 0);
    f.flying = false;
  }

  async flyTo(f, x, y, z, ms, carry = null, carryDy = 0) {
    const p0 = f.g.position.clone(), p2 = new Vector3(x, y, z);
    const dist = p0.distanceTo(p2);
    const p1 = p0.clone().lerp(p2, 0.5); p1.y = Math.max(p0.y, p2.y) + Math.min(1.4, 0.3 + dist * 0.2);
    const dx = x - p0.x, dz = z - p0.z;
    const yaw0 = f.g.rotation.y, yaw1 = Math.hypot(dx, dz) > 0.05 ? Math.atan2(-dx, -dz) : yaw0;
    let d = ((yaw1 - yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    f.flying = true;
    const t0 = performance.now();
    await new Promise((res) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms), e = ease(t), u = 1 - e;
        f.g.position.set(u * u * p0.x + 2 * u * e * p1.x + e * e * p2.x, u * u * p0.y + 2 * u * e * p1.y + e * e * p2.y, u * u * p0.z + 2 * u * e * p1.z + e * e * p2.z);
        f.g.rotation.y = yaw0 + d * Math.min(1, t * 3);
        f.g.rotation.x = -0.25 * Math.sin(Math.PI * t);
        if (carry) carry.position.set(f.g.position.x, f.g.position.y - carryDy, f.g.position.z);
        if (t < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  async flyMove(name, info, speed = 1) {
    const f = this.flies.get(name), piece = this.pieces.get(info.from);
    if (!f || !piece || speed <= 0) return;
    const k = 1 / speed;
    const top = new Vector3(); piece.children.forEach((c) => { c.geometry.computeBoundingBox(); top.y = Math.max(top.y, c.geometry.boundingBox.max.y + c.position.y); });
    const grip = top.y + 0.12;
    const fx = sqX(info.from), fz = sqZ(info.from), tx = sqX(info.to), tz = sqZ(info.to);
    await this.flyTo(f, fx, BOARD_Y + grip, fz, Math.min(900, 380 + f.g.position.distanceTo(new Vector3(fx, grip, fz)) * 60) * k);
    await sleep(60 * k);
    // lift and carry
    const lift = 0.9;
    await this.flyTo(f, fx, BOARD_Y + grip + lift, fz, 220 * k, piece, grip);
    await this.flyTo(f, tx, BOARD_Y + grip + lift, tz, Math.min(900, 300 + Math.hypot(tx - fx, tz - fz) * 70) * k, piece, grip);
    if (info.capture >= 0) {
      const v = this.pieces.get(info.capture);
      if (v && v !== piece) this.shrink(v, 260 * k);
    }
    await this.flyTo(f, tx, BOARD_Y + grip, tz, 240 * k, piece, grip);
    piece.position.set(tx, BOARD_Y, tz);
    if (info.rook) {
      const r = this.pieces.get(info.rook[0]);
      if (r) this.slide(r, sqX(info.rook[1]), sqZ(info.rook[1]), 260 * k);
    }
    await sleep(80 * k);
    const [px, pz] = this.perchXZ(info.side, info.to & 7);
    this.flyTo(f, px, 0.12, pz, 520 * k).then(() => { f.g.rotation.set(0, info.side === 'w' ? 0 : Math.PI, 0); f.flying = false; });
  }

  shrink(o, ms) {
    const t0 = performance.now();
    const step = (now) => { const t = Math.min(1, (now - t0) / ms); o.scale.setScalar(1 - t); if (t < 1) requestAnimationFrame(step); else o.visible = false; };
    requestAnimationFrame(step);
  }
  slide(o, x, z, ms) {
    const x0 = o.position.x, z0 = o.position.z, t0 = performance.now();
    const step = (now) => { const t = ease(Math.min(1, (now - t0) / ms)); o.position.x = x0 + (x - x0) * t; o.position.z = z0 + (z - z0) * t; if (t < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  async celebrate(name) {
    const f = this.flies.get(name);
    if (!f) return;
    const cam = this.camera.position;
    await this.flyTo(f, 0, 1.6, this.flipped ? -0.8 : 0.8, 700);
    f.g.rotation.set(0, Math.atan2(cam.x, cam.z) + Math.PI, 0);
    f.g.rotation.x = -0.7;
    f.six = true;
    const t = document.createElement('div'); t.className = 'sixseven3d'; t.textContent = '6 · 7';
    this.container.appendChild(t);
    await sleep(2600);
    t.remove();
    f.six = false; f.g.rotation.x = 0;
  }
  async sulk(name) {
    const f = this.flies.get(name);
    if (!f) return;
    f.sulk = true; await sleep(1600); f.sulk = false;
  }

  frame(now) {
    if (!this.active) return;
    const t = now / 1000;
    for (const f of this.flies.values()) {
      const g = f.g;
      for (const w of g.wings) {
        const s = w.userData.side;
        if (f.flying) { w.rotation.z = s * (0.3 + 0.9 * Math.abs(Math.sin(t * 60))); w.rotation.y = s * 0.9; }
        else { w.rotation.z = 0; w.rotation.y = s * 0.12; }
      }
      g.legs.fl.rotation.x = f.six ? 0.9 + 0.7 * Math.sin(t * 13.6) : 0;
      g.legs.fr.rotation.x = f.six ? 0.9 - 0.7 * Math.sin(t * 13.6) : 0;
      g.body.position.y = f.flying ? 0.01 * Math.sin(t * 40) : 0;
      g.body.rotation.z = f.sulk ? 0.18 * Math.sin(t * 18) : 0;
      g.shadow.position.set(g.position.x, BOARD_Y + 0.005 - (Math.abs(g.position.z) > 4 ? -0.02 : 0), g.position.z);
      g.shadow.material.opacity = Math.max(0.05, 0.25 - (g.position.y - 0.1) * 0.08);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
