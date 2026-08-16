// Render the city-planning map PNG from city_layout.js + city_plan.js.
// v2: BLUEPRINT MODE — every panel is a true-scale unit grid and every asset
// is drawn at its real world-unit footprint (heroes carry `dims` in the
// manifest), so you can SEE whether things fit before touching the scene.
//   panel 1 — DOWNTOWN: grown streets at true road width + actual building
//             footprints (same size formula as planet.js) on their parcels
//   panel 2 — AIRPORT district: runway, jet, terminal, limo apron to scale
//   panel 3 — CENTRAL STATION: station vs rail line vs boarding trigger
//   corner  — world overview (no grid; context only)
// All three detail panels share ONE scale (px/unit), printed in the footer.
// Run: node scripts/render-map.mjs → city_map.png
import LAYOUT from '../city_layout.js';
import CITY_PLAN from '../city_plan.js';
import sharp from 'sharp';

const W = 1720, H = 1180;
const S = 13;                                   // px per world unit — shared
const svg = [];
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

svg.push(`<style>
  .ttl  { font: 800 30px 'Avenir Next', 'Trebuchet MS', sans-serif; fill: #2d2138; }
  .sub  { font: 600 13px 'Avenir Next', sans-serif; fill: #7a6f8a; }
  .h2   { font: 700 16px 'Avenir Next', sans-serif; fill: #2d2138; text-anchor: middle; }
  .lbl  { font: 600 12px 'Avenir Next', sans-serif; fill: #2d2138; text-anchor: middle; }
  .lbl2 { font: 500 10.5px 'Avenir Next', sans-serif; fill: #7a6f8a; text-anchor: middle; }
  .dim  { font: 500 10px ui-monospace, monospace; fill: #a0662a; text-anchor: middle; }
  .grid { stroke: #e7dff0; stroke-width: 1; }
  .grid5{ stroke: #d5c9e4; stroke-width: 1.2; }
  .gnum { font: 500 9px ui-monospace, monospace; fill: #b3a8c4; text-anchor: middle; }
  .maj  { stroke: #6e5a6a; stroke-linecap: butt; fill: none; }
  .min  { stroke: #a394a0; stroke-linecap: butt; fill: none; }
  .lot  { fill: none; stroke: #cfc2ae; stroke-width: 1; stroke-dasharray: 3 2; }
  .bld  { fill: #d9cdbd; stroke: #8d8477; stroke-width: 1; }
  .hero { fill: #ffb3ad; stroke: #b03a30; stroke-width: 1.6; }
  .refc { fill: #cfe6ff; stroke: #4e8eff; stroke-width: 1; }
  .rail { stroke: #6b5b95; stroke-width: 2.2; stroke-dasharray: 8 4; fill: none; }
  .box  { fill: #fffaf2; stroke: #d8cfe0; stroke-width: 1.5; }
</style>`);
svg.push(`<rect width="${W}" height="${H}" fill="#f6f1e8"/>`);
svg.push(`<text x="30" y="52" class="ttl">city plan — blueprint mode</text>`);
svg.push(`<text x="30" y="76" class="sub">true footprints at ${S}px/unit · a car is ${LAYOUT.reference.car[1]} units long · generated ${new Date().toISOString().slice(0,10)} from city_layout.js + city_plan.js</text>`);

// ── panel machinery: each panel gets its own local frame (units → px) ──
function panel(x0, y0, w, h, title, span) {
  svg.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="12" class="box"/>`);
  svg.push(`<text x="${x0 + w / 2}" y="${y0 + 24}" class="h2">${esc(title)}</text>`);
  const cx = x0 + w / 2, cy = y0 + (h + 26) / 2;
  const px = ([x, y]) => [cx + x * S, cy - y * S];
  // unit grid: light every 1, strong every 5, numbers every 5
  const gx = Math.floor(span[0] / 2), gy = Math.floor(span[1] / 2);
  for (let i = -gx; i <= gx; i++) {
    const [X] = px([i, 0]);
    svg.push(`<line x1="${X}" y1="${cy - gy * S}" x2="${X}" y2="${cy + gy * S}" class="${i % 5 ? 'grid' : 'grid5'}"/>`);
    if (i % 5 === 0) svg.push(`<text x="${X}" y="${cy + gy * S + 11}" class="gnum">${i}</text>`);
  }
  for (let j = -gy; j <= gy; j++) {
    const [, Y] = px([0, j]);
    svg.push(`<line x1="${cx - gx * S}" y1="${Y}" x2="${cx + gx * S}" y2="${Y}" class="${j % 5 ? 'grid' : 'grid5'}"/>`);
    if (j % 5 === 0) svg.push(`<text x="${cx - gx * S - 10}" y="${Y + 3}" class="gnum">${j}</text>`);
  }
  return px;
}
const rect = (px, [x, y], [w, l], cls, rot = 0) => {
  const [X, Y] = px([x, y]);
  svg.push(`<rect x="${X - w * S / 2}" y="${Y - l * S / 2}" width="${w * S}" height="${l * S}" class="${cls}"${rot ? ` transform="rotate(${rot} ${X} ${Y})"` : ''}/>`);
};
const label = (px, [x, y], t, dy = 0, cls = 'lbl') => {
  const [X, Y] = px([x, y]);
  svg.push(`<text x="${X}" y="${Y + dy}" class="${cls}">${esc(t)}</text>`);
};
const dim = (px, [x, y], t, dy) => label(px, [x, y], t, dy, 'dim');

// ═══ PANEL 1: DOWNTOWN — streets at true width + real building footprints ═══
{
  const px = panel(30, 110, 700, 700, 'DOWNTOWN — grown streets + true building footprints', [50, 48]);
  const RW = LAYOUT.reference.roadHalf;
  for (const [ai, bi, minor] of CITY_PLAN.edges) {
    const A = px(CITY_PLAN.nodes[ai]), B = px(CITY_PLAN.nodes[bi]);
    svg.push(`<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" class="${minor ? 'min' : 'maj'}" stroke-width="${(minor ? RW * 1.4 : RW * 2.2) * S}" stroke-opacity="0.8"/>`);
  }
  // parcels (dashed) + the building actually placed on each (same formula as planet.js)
  for (const lot of CITY_PLAN.lots) {
    const pts = lot.v.map(px).map(p => p.map(c => c.toFixed(1)).join(',')).join(' ');
    svg.push(`<polygon points="${pts}" class="lot"/>`);
    let nearGap = 1e9;
    for (const o of CITY_PLAN.lots) {
      if (o === lot) continue;
      const g = Math.hypot(o.c[0] - lot.c[0], o.c[1] - lot.c[1]);
      if (g < nearGap) nearGap = g;
    }
    const half = Math.min(1.7, Math.max(0.4, Math.sqrt(lot.a) * 0.34), nearGap * 0.42);
    rect(px, lot.c, [half * 2, half * 2], 'bld');
  }
  label(px, [0, 0], '◉ city centre', -8, 'lbl2');
  // scale reference: one car parked on a boulevard
  rect(px, [-22, -21], LAYOUT.reference.car, 'refc');
  label(px, [-22, -21], `car ${LAYOUT.reference.car[0]}×${LAYOUT.reference.car[1]}`, 22, 'lbl2');
}

// ═══ PANEL 2: AIRPORT — runway, jet, terminal, limo apron, all to scale ═══
{
  const px = panel(760, 110, 460, 700, 'AIRPORT district — hero assets to scale', [32, 48]);
  const R = LAYOUT.reference.runway;
  // runway strip + centreline
  rect(px, [(R.from[0] + R.to[0]) / 2, (R.from[1] + R.to[1]) / 2], [R.width, R.to[1] - R.from[1]], 'maj');
  svg.push(`<line x1="${px([0, R.from[1]])[0]}" y1="${px([0, R.from[1]])[1]}" x2="${px([0, R.to[1]])[0]}" y2="${px([0, R.to[1]])[1]}" stroke="#f2ecd8" stroke-width="2" stroke-dasharray="10 8"/>`);
  dim(px, [0, R.to[1]], `runway ${R.width} × ${R.to[1] - R.from[1]}`, -8);
  const H2 = LAYOUT.heroes;
  rect(px, H2.jetParked.at, H2.jetParked.dims, 'hero');
  label(px, H2.jetParked.at, '✈ jet', 4);
  dim(px, H2.jetParked.at, `${H2.jetParked.dims[0]}×${H2.jetParked.dims[1]}`, 16);
  rect(px, H2.limoApron.at, H2.limoApron.dims, 'hero');
  label(px, H2.limoApron.at, 'limo', -10);
  dim(px, H2.limoApron.at, `${H2.limoApron.dims[0]}×${H2.limoApron.dims[1]}`, 18);
  rect(px, H2.airportTerminal.at, H2.airportTerminal.dims, 'bld');
  label(px, H2.airportTerminal.at, 'terminal', 4);
  dim(px, H2.airportTerminal.at, `${H2.airportTerminal.dims[0]}×${H2.airportTerminal.dims[1]}`, 16);
  // gap annotation jet ↔ limo apron
  const gap = Math.hypot(H2.limoApron.at[0] - 0, H2.limoApron.at[1] - 12) + 0; // jet rolls out to (0,12)
  svg.push(`<line x1="${px([0, 12])[0]}" y1="${px([0, 12])[1]}" x2="${px(H2.limoApron.at)[0]}" y2="${px(H2.limoApron.at)[1]}" stroke="#b03a30" stroke-width="1" stroke-dasharray="3 3"/>`);
  dim(px, [2.6, 12.8], `rollout→apron ${H2.limoApron.at[0].toFixed(1)}`, 0);
  label(px, [0, 12], '⌖ rollout', -10, 'lbl2');
}

// ═══ PANEL 3: CENTRAL STATION — station vs rails vs boarding trigger ═══
{
  const px = panel(1250, 110, 440, 460, 'CENTRAL STATION — fit vs rails', [30, 28]);
  const T = LAYOUT.heroes.trainStation;
  // rails run vertically through x=0 (the stop); station offset offTrack on x
  svg.push(`<line x1="${px([0, -13])[0]}" y1="${px([0, -13])[1]}" x2="${px([0, 13])[0]}" y2="${px([0, 13])[1]}" class="rail"/>`);
  label(px, [0, 12.3], 'rails', -8, 'lbl2');
  rect(px, [T.offTrack, 0], [T.dims[0], T.dims[1]], 'hero');
  label(px, [T.offTrack, 0], '🚉 station', 4);
  dim(px, [T.offTrack, 0], `${T.dims[0]} × ${T.dims[1]}`, 16);
  // platform gap annotation
  const gapEdge = Math.abs(T.offTrack) - T.dims[0] / 2;
  svg.push(`<line x1="${px([T.offTrack + T.dims[0] / 2, 3])[0]}" y1="${px([0, 3])[1]}" x2="${px([0, 3])[0]}" y2="${px([0, 3])[1]}" stroke="#b03a30" stroke-width="1" stroke-dasharray="3 3"/>`);
  dim(px, [(T.offTrack + T.dims[0] / 2) / 2, 3.6], `platform gap ${gapEdge.toFixed(2)}`, 0);
  // boarding trigger radius around the stop
  const [BX, BY] = px([0, 0]);
  svg.push(`<circle cx="${BX}" cy="${BY}" r="${LAYOUT.reference.boardRadius * S}" fill="none" stroke="#4e8eff" stroke-width="1.4" stroke-dasharray="5 4"/>`);
  label(px, [0, -LAYOUT.reference.boardRadius - 1], `board < ${LAYOUT.reference.boardRadius}`, 0, 'lbl2');
  // a person for scale
  rect(px, [3, -8], LAYOUT.reference.person, 'refc');
  label(px, [3, -8], 'person', 14, 'lbl2');
}

// ═══ corner: world overview (context, not to scale) ═══
{
  const x0 = 1250, y0 = 600, w = 440, h = 300;
  svg.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="12" class="box"/>`);
  svg.push(`<text x="${x0 + w / 2}" y="${y0 + 22}" class="h2">world overview (context)</text>`);
  const px = ([lat, lon]) => {
    let L = lon; while (L > 180) L -= 360; while (L < -180) L += 360;
    return [x0 + 16 + (L + 180) / 360 * (w - 32), y0 + 34 + (90 - lat) / 180 * (h - 50)];
  };
  for (const [k, v] of Object.entries(LAYOUT.landmarks)) {
    const p = px(v);
    svg.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="#8f7ae8"/>`);
  }
  for (const [k, v] of Object.entries(LAYOUT.anchors)) {
    const p = px(v);
    svg.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="#2d2138"/>`);
    svg.push(`<text x="${p[0].toFixed(1)}" y="${(p[1] - 6).toFixed(1)}" class="lbl2">${esc(k)}</text>`);
  }
}

// footer legend
svg.push(`<text x="30" y="${H - 26}" class="sub">grid: 1 unit per square, bold every 5 · pink = hero GLB footprint · beige = building · dashed = parcel · blue = scale reference · every number comes from city_layout.js — edit it, re-run scripts/render-map.mjs</text>`);

const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('\n')}</svg>`;
await sharp(Buffer.from(out), { density: 110 }).png().toFile('city_map.png');
console.log('wrote city_map.png', `${W}x${H}`, `scale ${S}px/unit`);
