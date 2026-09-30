// Top-down Drosophila melanogaster drawn in SVG, ~100 units long, head pointing to -y.
// eye: 'red' (wild type) or 'white' (the classic w¹¹¹⁸ mutant).

export function flyMarkup(uid, eye = 'red') {
  const eyeA = eye === 'white' ? '#fbf7ef' : '#e2303b';
  const eyeB = eye === 'white' ? '#cfc6b8' : '#8e0f1a';
  const leg = (cls, pts) => `<polyline class="leg ${cls}" points="${pts}" fill="none" stroke="#3a2915" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  const legs = [
    ['leg-fr', '5,-10 13,-17 16,-29'], ['leg-fl', '-5,-10 -13,-17 -16,-29'],
    ['leg-mr', '7,-4 19,-6 27,1'], ['leg-ml', '-7,-4 -19,-6 -27,1'],
    ['leg-hr', '6,2 16,11 20,26'], ['leg-hl', '-6,2 -16,11 -20,26'],
  ].map(([c, p]) => leg(c, p)).join('');
  const wing = (side) => {
    const s = side === 'r' ? 1 : -1;
    return `<g class="wing wing-${side}" style="transform-origin:${3 * s}px -6px">
      <path d="M${3 * s},-6 C${14 * s},-4 ${21 * s},12 ${19 * s},28 C${17 * s},37 ${9 * s},38 ${5 * s},30 C${2 * s},20 ${1 * s},6 ${3 * s},-6 Z"
        fill="url(#wingfill-${uid})" stroke="rgba(90,110,130,.55)" stroke-width=".7"/>
      <path d="M${4 * s},-3 C${10 * s},8 ${14 * s},20 ${15 * s},31 M${3.5 * s},0 C${6 * s},12 ${8 * s},24 ${9 * s},33 M${6 * s},6 L${12 * s},10"
        fill="none" stroke="rgba(90,110,130,.4)" stroke-width=".55"/></g>`;
  };
  const bristles = [[-5, -11], [5, -11], [-7, -6], [7, -6], [-4, -2], [4, -2], [-6, 1], [6, 1]]
    .map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x * 1.08}" y2="${y + 3.2}" stroke="#2a1b0c" stroke-width=".7" stroke-linecap="round"/>`).join('');
  return `
  <defs>
    <radialGradient id="eye-${uid}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".25" stop-color="${eyeA}"/><stop offset="1" stop-color="${eyeB}"/></radialGradient>
    <radialGradient id="thx-${uid}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#d9a766"/><stop offset="1" stop-color="#8a5a26"/></radialGradient>
    <linearGradient id="wingfill-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(225,235,248,.55)"/><stop offset="1" stop-color="rgba(200,215,235,.25)"/></linearGradient>
    <pattern id="facet-${uid}" width="1.6" height="1.6" patternUnits="userSpaceOnUse"><circle cx=".8" cy=".8" r=".45" fill="rgba(0,0,0,.18)"/></pattern>
    <clipPath id="abd-${uid}"><ellipse cx="0" cy="15" rx="9.5" ry="14"/></clipPath>
  </defs>
  <ellipse class="shadow" cx="3" cy="8" rx="22" ry="30" fill="rgba(0,0,0,.18)"/>
  <g class="fly-body">
    ${legs}
    <ellipse cx="0" cy="15" rx="9.5" ry="14" fill="#cf9f55" stroke="#6b4518" stroke-width=".8"/>
    <g clip-path="url(#abd-${uid})" fill="#3b2612">
      <rect x="-12" y="9" width="24" height="2.6" rx="1"/><rect x="-12" y="14" width="24" height="2.8" rx="1"/>
      <rect x="-12" y="19.2" width="24" height="3" rx="1"/><rect x="-12" y="24.6" width="24" height="6"/>
    </g>
    ${wing('l')}${wing('r')}
    <ellipse cx="0" cy="-5" rx="9" ry="10" fill="url(#thx-${uid})" stroke="#5e3b12" stroke-width=".8"/>
    ${bristles}
    <ellipse cx="0" cy="-17.5" rx="8.2" ry="6.2" fill="#b98544" stroke="#5e3b12" stroke-width=".8"/>
    <g class="eyes">
      <ellipse cx="-6.3" cy="-18.2" rx="4.4" ry="5.9" fill="url(#eye-${uid})" transform="rotate(-12 -6.3 -18.2)"/>
      <ellipse cx="6.3" cy="-18.2" rx="4.4" ry="5.9" fill="url(#eye-${uid})" transform="rotate(12 6.3 -18.2)"/>
      <ellipse cx="-6.3" cy="-18.2" rx="4.4" ry="5.9" fill="url(#facet-${uid})" transform="rotate(-12 -6.3 -18.2)"/>
      <ellipse cx="6.3" cy="-18.2" rx="4.4" ry="5.9" fill="url(#facet-${uid})" transform="rotate(12 6.3 -18.2)"/>
    </g>
    <g class="antennae" stroke="#3a2915" stroke-width=".9" stroke-linecap="round" fill="none">
      <path class="ant-l" d="M-1.6,-23 L-2.6,-26.5 M-2.6,-26.5 C-4,-29 -3,-31 -5.5,-33"/>
      <path class="ant-r" d="M1.6,-23 L2.6,-26.5 M2.6,-26.5 C4,-29 3,-31 5.5,-33"/>
    </g>
  </g>`;
}
