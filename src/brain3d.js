// 3D view of the mushroom body: every Kenyon cell body at its real FlyWire position (micrometres),
// the projection neurons that feed them, and which ones are firing for the current board.
import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial,
  LineSegments, LineBasicMaterial, AdditiveBlending, CanvasTexture, SRGBColorSpace, OrbitControls,
} from './vendor/three.js';
import { Brain, N_WHERE, getAnatomy } from './brain.js';

function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.8)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

export class BrainView3D {
  constructor(canvas) {
    this.c = canvas;
    this.r = new WebGLRenderer({ canvas, antialias: true });
    this.r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.r.setClearColor(new Color(0x15120e));
    this.scene = new Scene();
    this.cam = new PerspectiveCamera(40, 560 / 300, 1, 5000);
    this.ctl = new OrbitControls(this.cam, canvas);
    this.ctl.enableDamping = true; this.ctl.enablePan = false; this.ctl.autoRotate = true; this.ctl.autoRotateSpeed = 0.8;
    this.tex = dot();
    this.active = false;
    new ResizeObserver(() => this.resize()).observe(canvas);
    const loop = () => { if (this.active) { this.ctl.update(); this.r.render(this.scene, this.cam); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.c.clientWidth || 560, h = Math.round(w * (300 / 560));
    this.r.setSize(w, h, false);
    this.c.style.height = `${h}px`;
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }

  show3d(v) { this.active = v; this.c.style.display = v ? 'block' : 'none'; if (v) this.resize(); }

  setBrain(meta) {
    const key = `${meta.wiring}:${meta.nKC}:${meta.seed}`;
    if (this.key === key) return;
    this.key = key;
    const A = getAnatomy();
    if (!A) return;
    const b = this.b = new Brain({ nKC: meta.nKC, seed: meta.seed, wiring: meta.wiring || 'random' });
    this.scene.clear();
    const S = A.kc.soma;
    // centre of the real mushroom body cell bodies
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < A.kc.n; k++) { cx += S[3 * k]; cy += S[3 * k + 1]; cz += S[3 * k + 2]; }
    cx /= A.kc.n; cy /= A.kc.n; cz /= A.kc.n;
    const P = (x, y, z) => [x - cx, -(y - cy), -(z - cz)]; // FlyWire y points down
    // KC positions: real ones, or for a random brain, real positions drawn at random with jitter
    this.kpos = new Float32Array(b.nKC * 3);
    let a = 99 ^ meta.seed;
    const rnd = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let k = 0; k < b.nKC; k++) {
      const src = b.wiring === 'random' ? Math.floor(rnd() * A.kc.n) : k;
      const j = b.wiring === 'random' ? 4 : 0;
      const [x, y, z] = P(S[3 * src] + (rnd() - 0.5) * j, S[3 * src + 1] + (rnd() - 0.5) * j, S[3 * src + 2] + (rnd() - 0.5) * j);
      this.kpos.set([x, y, z], 3 * k);
    }
    // PN cell bodies (real ones for FlyWire brains; for random brains, one per board channel around the lobe)
    const nC = b.nCell;
    this.ppos = new Float32Array(nC * 3);
    for (let c = 0; c < nC; c++) {
      if (b.wiring !== 'random') { const T = A.pn.soma; this.ppos.set(P(T[3 * c], T[3 * c + 1], T[3 * c + 2]), 3 * c); }
      else { const t = (c / nC) * Math.PI * 2, side = c % 2 ? 1 : -1; this.ppos.set([side * (60 + 20 * Math.cos(t * 7)), -110 + 25 * Math.sin(t * 5), 40 + 20 * Math.cos(t * 3)], 3 * c); }
    }
    const geo = (arr) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(arr, 3)); return g; };
    this.scene.add(new Points(geo(this.kpos), new PointsMaterial({ color: 0xece0c8, size: 5, map: this.tex, transparent: true, opacity: 0.22, depthWrite: false })));
    this.scene.add(new Points(geo(this.ppos), new PointsMaterial({ color: 0x8fd3ff, size: 9, map: this.tex, transparent: true, opacity: 0.4, depthWrite: false })));
    this.onKC = new Points(geo(new Float32Array(3)), new PointsMaterial({ size: 13, map: this.tex, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.onPN = new Points(geo(new Float32Array(3)), new PointsMaterial({ color: 0xffd27a, size: 18, map: this.tex, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.wires = new LineSegments(geo(new Float32Array(6)), new LineBasicMaterial({ color: 0xffd68c, transparent: true, opacity: 0.05, blending: AdditiveBlending, depthWrite: false }));
    this.scene.add(this.onKC, this.onPN, this.wires);
    // frame the cloud
    let r = 0;
    for (let i = 0; i < this.kpos.length; i += 3) r = Math.max(r, Math.hypot(this.kpos[i], this.kpos[i + 1], this.kpos[i + 2]));
    for (let i = 0; i < this.ppos.length; i += 3) r = Math.max(r, Math.hypot(this.ppos[i], this.ppos[i + 1], this.ppos[i + 2]));
    this.cam.position.set(0, r * 0.25, r * 1.9); this.ctl.target.set(0, -r * 0.15, 0); this.ctl.update();
  }

  show(act) {
    if (!this.b) return;
    const b = this.b;
    const on = new Set();
    for (const ch of act.pn) if (ch < N_WHERE) on.add(b.chanPN[ch]);
    const pn = [], kc = [], col = [], wires = [];
    for (const c of on) pn.push(...this.ppos.subarray(3 * c, 3 * c + 3));
    let maxW = 1e-6;
    for (const w of act.kcW) maxW = Math.max(maxW, Math.abs(w));
    act.kc.forEach((k, i) => {
      kc.push(...this.kpos.subarray(3 * k, 3 * k + 3));
      const w = act.kcW[i] / maxW;
      if (w >= 0) col.push(0.35, 1, 0.6); else col.push(1, 0.35, 0.5);
      for (let j = b.kcStart[k]; j < b.kcStart[k + 1]; j++) {
        const c = b.kcList[j];
        if (on.has(c)) wires.push(...this.ppos.subarray(3 * c, 3 * c + 3), ...this.kpos.subarray(3 * k, 3 * k + 3));
      }
    });
    const set = (obj, arr) => { obj.geometry.setAttribute('position', new Float32BufferAttribute(arr.length ? arr : [0, 0, 0], 3)); obj.geometry.computeBoundingSphere(); };
    set(this.onPN, pn); set(this.onKC, kc); set(this.wires, wires);
    this.onKC.geometry.setAttribute('color', new Float32BufferAttribute(col.length ? col : [0, 0, 0], 3));
  }
}
