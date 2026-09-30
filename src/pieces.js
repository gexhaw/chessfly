// Original minimalist chess piece set (45×45 units), drawn for ChessFly.
const BASE = 'M11.5,33.5 h22 a2,2 0 0 1 2,2 v2.5 a1.5,1.5 0 0 1 -1.5,1.5 h-23 a1.5,1.5 0 0 1 -1.5,-1.5 v-2.5 a2,2 0 0 1 2,-2 z';

const SHAPES = {
  p: [
    'M15.5,34 C16,28.5 18.5,24.5 20.2,21.5 L24.8,21.5 C26.5,24.5 29,28.5 29.5,34 Z',
    'M17.5,21.8 h10 a1.6,1.6 0 0 0 0,-3.2 h-10 a1.6,1.6 0 0 0 0,3.2 z',
    { circle: [22.5, 13.5, 5.6] },
  ],
  r: [
    'M14.5,34 L16,19.5 L29,19.5 L30.5,34 Z',
    'M12.5,11.5 L12.5,19.5 L32.5,19.5 L32.5,11.5 L28.5,11.5 L28.5,14.5 L25,14.5 L25,11.5 L20,11.5 L20,14.5 L16.5,14.5 L16.5,11.5 Z',
    { line: [16, 24.5, 29, 24.5] },
  ],
  n: [
    'M15.5,34 C15.5,28.5 18.5,25.5 21,22.5 C18.5,23.2 15.2,24.3 13.2,26 C11.3,27.4 8.8,26 9.6,23.5 C10.5,20.4 13.3,17.4 15.4,14.3 C16.5,12.6 16.9,10.4 17.7,7.8 L20,10 L21.3,6.8 C27.5,7.6 32.8,12.8 33.6,21 C34,26 32.6,30.5 31.5,34 Z',
    { circle: [17.6, 13.2, 1.3], fillStroke: true },
    { line: [22, 10.5, 29.5, 18.5] },
  ],
  b: [
    'M16,34 C16,28 18,25 19.5,22.5 C15,19.5 15.5,13.5 22.5,8 C29.5,13.5 30,19.5 25.5,22.5 C27,25 29,28 29,34 Z',
    { circle: [22.5, 6.2, 2.3] },
    { line: [24.8, 12.2, 20.6, 17.8] },
    { line: [18.5, 26.5, 26.5, 26.5] },
  ],
  q: [
    'M14,34 L10,14.5 L16.5,24.5 L16.5,11.5 L20.6,23.8 L22.5,9.8 L24.4,23.8 L28.5,11.5 L28.5,24.5 L35,14.5 L31,34 Z',
    { circle: [10, 13.3, 2.3] }, { circle: [16.5, 10.2, 2.3] }, { circle: [22.5, 8.4, 2.3] },
    { circle: [28.5, 10.2, 2.3] }, { circle: [35, 13.3, 2.3] },
    { line: [15.5, 29, 29.5, 29] },
  ],
  k: [
    'M14.2,34 C12.8,28 11.6,22.8 14.8,19.6 C18,16.6 21.2,19.2 22.5,22.4 C23.8,19.2 27,16.6 30.2,19.6 C33.4,22.8 32.2,28 30.8,34 Z',
    'M19.8,20 C19.8,15.5 25.2,15.5 25.2,20',
    { line: [22.5, 4.5, 22.5, 15.2], w: 2.4 },
    { line: [18.8, 8.6, 26.2, 8.6], w: 2.4 },
    { line: [15.5, 29, 29.5, 29] },
  ],
};

const COLORS = {
  w: { fill: '#f5efe3', stroke: '#1d1b20', detail: '#1d1b20' },
  b: { fill: '#2a2830', stroke: '#0c0b0e', detail: '#bdb6aa' },
};

// Returns SVG <symbol> markup for all 12 pieces: ids piece-wp, piece-bk, ...
export function pieceSymbols() {
  let out = '';
  for (const c of ['w', 'b']) {
    const col = COLORS[c];
    for (const t of Object.keys(SHAPES)) {
      let g = `<symbol id="piece-${c}${t}" viewBox="0 0 45 45"><g stroke-linejoin="round" stroke-linecap="round">`;
      g += `<path d="${BASE}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5"/>`;
      for (const s of SHAPES[t]) {
        if (typeof s === 'string') g += `<path d="${s}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5"/>`;
        else if (s.circle) {
          const [x, y, r] = s.circle;
          g += s.fillStroke
            ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${col.detail}"/>`
            : `<circle cx="${x}" cy="${y}" r="${r}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5"/>`;
        } else if (s.line) {
          const [x1, y1, x2, y2] = s.line;
          const isCross = s.w;
          g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${isCross ? col.stroke : col.detail}" stroke-width="${s.w || 1.2}"/>`;
          if (isCross && c === 'b') g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col.fill}" stroke-width="${s.w - 1.4}"/>`;
          else if (isCross) g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col.fill}" stroke-width="${s.w - 1.4}"/>`;
        }
      }
      g += '</g></symbol>';
      out += g;
    }
  }
  return out;
}
