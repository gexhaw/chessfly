// Live view of the fly's mushroom body: PNs (the board, split into piece channels) → Kenyon cells → MBON.
import { Brain, N_WHERE, getAnatomy } from './brain.js';

const W = 560, H = 300;
const TYPES = ['P', 'N', 'B', 'R', 'Q', 'K'];

export class BrainView {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.act = null;
    this.glow = 0; this.dop = 0; this.dopSign = 0;
    this.wiring = null;
    this.resize();
    addEventListener('resize', () => this.resize());
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.c.clientWidth || W;
    this.scale = w / W;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(w * (H / W) * dpr);
    this.c.style.height = `${w * (H / W)}px`;
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    // everything except the dopamine pulse is drawn once per change into an offscreen layer
    if (!this.off) this.off = document.createElement('canvas');
    this.off.width = this.c.width; this.off.height = this.c.height;
    this.octx = this.off.getContext('2d');
    this.octx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    this.xf = dpr * this.scale;
    this.dirty = true;
  }

  setBrain(meta) {
    const key = `${meta.wiring}:${meta.nKC}:${meta.seed}`;
    if (this.key === key) return;
    this.key = key;
    const b = new Brain({ nKC: meta.nKC, seed: meta.seed, wiring: meta.wiring || 'random' });
    this.b = b; this.nKC = b.nKC; this.wiring = b.wiring;
    // which board channels drive each PN (several converge on one real PN)
    this.cellChans = Array.from({ length: b.nCell }, () => []);
    for (let ch = 0; ch < N_WHERE; ch++) this.cellChans[b.chanPN[ch]].push(ch);
    this.kx = new Float32Array(b.nKC); this.ky = new Float32Array(b.nKC);
    const A = getAnatomy();
    if (b.wiring !== 'random' && A) {
      // real cell bodies (front view, height stretched 3x so both calyces fit)
      const S = A.kc.soma;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let k = 0; k < b.nKC; k++) { x0 = Math.min(x0, S[3 * k]); x1 = Math.max(x1, S[3 * k]); y0 = Math.min(y0, S[3 * k + 1]); y1 = Math.max(y1, S[3 * k + 1]); }
      for (let k = 0; k < b.nKC; k++) {
        this.kx[k] = 282 + ((S[3 * k] - x0) / (x1 - x0)) * 176;
        this.ky[k] = 58 + ((S[3 * k + 1] - y0) / (y1 - y0)) * 140;
      }
    } else {
      // Kenyon cell bodies scattered in the calyx
      let a = 12345 ^ meta.seed;
      const rnd = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296);
      for (let k = 0; k < b.nKC; k++) {
        const r = 78 * Math.sqrt(rnd()), t = rnd() * Math.PI * 2;
        this.kx[k] = 368 + r * Math.cos(t) * 1.05; this.ky[k] = 128 + r * Math.sin(t) * 0.92;
      }
    }
    this.dirty = true;
  }

  pnXY(pn) {
    if (pn < N_WHERE) {
      const side = pn >= 384 ? 1 : 0, t = (pn % 384) >> 6, sq = pn & 63;
      const bx = 14 + t * 40, by = 46 + side * 70;
      return [bx + (sq & 7) * 4 + 2, by + (7 - (sq >> 3)) * 4 + 2];
    }
    const i = pn - N_WHERE, side = i >= 19 ? 1 : 0, o = i % 19;
    return [14 + o * 12.6 + 3, 222 + side * 18 + 3];
  }

  show(act, label = '') { this.act = act; this.label = label; this.pnSet = new Set(act.pn); this.glow = 1; this.dirty = true; }
  dopamine(err) { this.danDirty = true; this.dop = 1; this.dopSign = Math.sign(err) || 1; this.dopMag = Math.min(1, Math.abs(err) * 4); }

  frame() {
    if (!this.dirty && this.dop <= 0.01 && !this.danDirty) return;
    if (this.dirty) { this.base(this.octx); this.dirty = false; }
    this.danDirty = false;
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.off, 0, 0);
    g.setTransform(this.xf, 0, 0, this.xf, 0, 0);
    // DAN (dopamine)
    const d = this.dop;
    g.fillStyle = d > 0.01 ? (this.dopSign > 0 ? `rgba(130,255,180,${0.2 + 0.8 * d})` : `rgba(255,120,120,${0.2 + 0.8 * d})`) : 'rgba(236,224,200,.1)';
    g.beginPath(); g.arc(520, 150, 10 + 8 * d * (this.dopMag || 0), 0, Math.PI * 2); g.fill();
    if (d > 0.01) { this.dop *= 0.93; if (this.dop <= 0.01) this.danDirty = true; }
  }

  base(g) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#15120e'; g.fillRect(0, 0, W, H);
    g.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = 'rgba(236,224,200,.55)';
    g.fillText(this.wiring === 'random' ? 'Projection neurons' : 'Inputs, converging on 285 real PNs', 14, 22);
    g.fillText(this.wiring === 'random' ? 'Kenyon cells' : 'Kenyon cells, FlyWire', 300, 22);
    g.fillText('Output', 490, 22);
    g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = 'rgba(236,224,200,.38)';
    g.fillText('its pieces', 14, 40); g.fillText('opponent', 14, 110);
    g.fillText('how many (its / opponent)', 14, 214);
    for (let s = 0; s < 2; s++) for (let t = 0; t < 6; t++) {
      g.fillStyle = 'rgba(236,224,200,.32)';
      g.fillText(TYPES[t], 14 + t * 40 + 12, 46 + s * 70 + 32 + 12);
    }
    const act = this.act, set = this.pnSet || new Set();
    // PN grid
    for (let pn = 0; pn < N_WHERE + 38; pn++) {
      const [x, y] = this.pnXY(pn);
      const on = set.has(pn);
      g.fillStyle = on ? (pn < 384 || (pn >= N_WHERE && pn < N_WHERE + 19) ? '#ffd27a' : '#8fd3ff') : 'rgba(236,224,200,.07)';
      if (pn < N_WHERE) g.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
      else g.fillRect(x - 3, y - 3, 9, 6);
    }
    // calyx outline + lobes
    g.strokeStyle = 'rgba(236,224,200,.12)'; g.lineWidth = 1;
    if (this.wiring === 'random') { g.beginPath(); g.ellipse(368, 128, 88, 78, 0, 0, Math.PI * 2); g.stroke(); }
    else { g.fillStyle = 'rgba(236,224,200,.38)'; g.fillText('left', 300, 50); g.fillText('right', 420, 50); }
    const lobe = act ? Math.min(1, act.kc.length / (this.nKC * 0.06)) : 0;
    g.strokeStyle = `rgba(255,200,120,${0.1 + 0.35 * lobe})`; g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath(); g.moveTo(420, 190); g.quadraticCurveTo(450, 236, 470, 250); g.lineTo(520, 250); g.stroke();
    g.beginPath(); g.moveTo(470, 250); g.lineTo(470, 196); g.stroke();
    g.lineCap = 'butt';
    // all KCs, dim (cached per brain)
    if (this.kx) {
      if (!this.cloud || this.cloudKey !== this.key + ':' + this.off.width) {
        this.cloud = document.createElement('canvas'); this.cloud.width = this.off.width; this.cloud.height = this.off.height;
        const c = this.cloud.getContext('2d'); c.setTransform(this.xf, 0, 0, this.xf, 0, 0);
        c.fillStyle = 'rgba(236,224,200,.13)';
        for (let k = 0; k < this.nKC; k++) c.fillRect(this.kx[k] - 0.6, this.ky[k] - 0.6, 1.2, 1.2);
        this.cloudKey = this.key + ':' + this.off.width;
      }
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.cloud, 0, 0); g.restore();
    }
    if (act && this.kx) {
      // claws: lines from active PNs to the KCs they switched on
      g.lineWidth = 0.6;
      g.strokeStyle = 'rgba(255,214,140,.12)';
      g.beginPath();
      const b = this.b;
      for (const k of act.kc) {
        for (let j = b.kcStart[k]; j < b.kcStart[k + 1]; j++) {
          for (const ch of this.cellChans[b.kcList[j]]) {
            if (!set.has(ch)) continue;
            const [x, y] = this.pnXY(ch);
            g.moveTo(x, y); g.lineTo(this.kx[k], this.ky[k]);
          }
        }
      }
      g.stroke();
      let maxW = 1e-6;
      for (const w of act.kcW) maxW = Math.max(maxW, Math.abs(w));
      act.kc.forEach((k, i) => {
        const w = act.kcW[i] / maxW;
        g.fillStyle = w >= 0 ? `rgba(120,255,170,${0.45 + 0.55 * w})` : `rgba(255,110,140,${0.45 - 0.55 * w})`;
        g.beginPath(); g.arc(this.kx[k], this.ky[k], 2.1, 0, Math.PI * 2); g.fill();
      });
      g.fillStyle = 'rgba(236,224,200,.5)';
      g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText(`${act.kc.length} of ${this.nKC.toLocaleString('en')} firing (${((100 * act.kc.length) / this.nKC).toFixed(1)}%)`, 290, 226);
    }
    // MBON
    const v = act ? act.value : 0;
    const col = v >= 0 ? `rgba(110,240,160,${0.25 + 0.75 * v})` : `rgba(255,100,130,${0.25 - 0.75 * v})`;
    g.fillStyle = col;
    g.beginPath(); g.arc(520, 250, 22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(236,224,200,.45)'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#15120e'; g.font = '600 11px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center';
    g.fillText((v >= 0 ? '+' : '') + v.toFixed(2), 520, 254);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(236,224,200,.55)'; g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText('gut feeling', 490, 38);
    if (act) {
      const good = v > 0.05 ? 'likes it' : v < -0.05 ? 'dislikes it' : 'unsure';
      g.fillText(good, 490, 52);
    }
    g.fillStyle = 'rgba(236,224,200,.55)';
    g.fillText('DAN', 508, 128);
    g.fillText('dopamine', 494, 180);
    if (this.label) { g.fillStyle = 'rgba(236,224,200,.35)'; g.fillText(this.label, 14, 290); }
  }
}
