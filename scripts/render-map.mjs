// Render the city-planning map PNG straight from the placement manifest
// (city_layout.js) + the grown street plan (city_plan.js). Two panels:
//   left  — the whole planet, equirectangular: landmarks, districts, stops,
//           the rail line, the spur roads, hero assets
//   right — downtown detail: the grown street graph + parcels + Central Station
// Run: node scripts/render-map.mjs   → city_map.png
import LAYOUT from '../city_layout.js';
import CITY_PLAN from '../city_plan.js';
import sharp from 'sharp';

// ── minimal sphere math (mirrors planet.js's ll/slerp) ──
const D2R = Math.PI / 180;
const ll = ([lat, lon]) => {
  const phi = (90 - lat) * D2R, th = (lon + 180) * D2R;
  return [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
};
const toLatLon = (v) => {
  const [x, y, z] = v, r = Math.hypot(x, y, z);
  return [90 - Math.acos(y / r) / D2R, Math.atan2(z, x) / D2R - 180];
};
const norm = (v) => { const l = Math.hypot(...v); return v.map(c => c / l); };
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const slerp = (a, b, t) => {
  const ang = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
  if (ang < 1e-6) return a;
  const s = Math.sin(ang);
  return norm(a.map((c, i) => (Math.sin((1 - t) * ang) * c + Math.sin(t * ang) * b[i]) / s));
};

// ── projections ──
const W = 1560, H = 900, MAIN_W = 1000;
const px = ([lat, lon]) => {           // equirect, lon -180..180 → 30..MAIN_W-30
  let L = lon; while (L > 180) L -= 360; while (L < -180) L += 360;
  return [30 + (L + 180) / 360 * (MAIN_W - 60), 120 + (90 - lat) / 180 * (H - 190)];
};
// downtown inset: plan units → panel
const IX = MAIN_W + 30, IY = 120, IW = W - MAIN_W - 60, IH = 560;
const ipx = ([x, y]) => [IX + IW / 2 + x * (IW / 46), IY + IH / 2 - y * (IH / 46)];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let svg = [];
const line = (a, b, cls) => svg.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" class="${cls}"/>`);
const arc = (fromV, toV, cls, steps = 24) => {   // great-circle polyline, split on wrap
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const p = px(toLatLon(slerp(fromV, toV, i / steps)));
    if (prev && Math.abs(p[0] - prev[0]) < (MAIN_W - 60) / 2) line(prev, p, cls);
    prev = p;
  }
};
const dotAt = (p, r, fill, cls = '') => svg.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${fill}" class="${cls}"/>`);
const label = (p, text, dy = -10, cls = 'lbl') => svg.push(`<text x="${p[0].toFixed(1)}" y="${(p[1] + dy).toFixed(1)}" class="${cls}">${esc(text)}</text>`);

// ── styles ──
svg.push(`<style>
  .lbl { font: 600 13px 'Avenir Next', 'Trebuchet MS', sans-serif; fill: #2d2138; text-anchor: middle; }
  .lbl2 { font: 500 11px 'Avenir Next', sans-serif; fill: #7a6f8a; text-anchor: middle; }
  .ttl { font: 800 30px 'Avenir Next', sans-serif; fill: #2d2138; }
  .sub { font: 600 13px 'Avenir Next', sans-serif; fill: #7a6f8a; }
  .rail { stroke: #6b5b95; stroke-width: 2.4; stroke-dasharray: 7 4; fill: none; }
  .spur { stroke: #b9a26a; stroke-width: 2.6; fill: none; }
  .grat { stroke: #e4dced; stroke-width: 1; }
  .maj  { stroke: #6e5a6a; stroke-width: 3.4; stroke-linecap: round; }
  .min  { stroke: #a394a0; stroke-width: 1.6; stroke-linecap: round; }
  .lot  { fill: #d9cdbd; stroke: #b9a894; stroke-width: 0.7; }
  .box  { fill: #fffaf2; stroke: #d8cfe0; stroke-width: 1.5; }
</style>`);
svg.push(`<rect width="${W}" height="${H}" fill="#f6f1e8"/>`);
svg.push(`<text x="30" y="52" class="ttl">janelle's tiny planet — city plan</text>`);
svg.push(`<text x="30" y="76" class="sub">generated from city_layout.js + city_plan.js · ${new Date().toISOString().slice(0, 10)}</text>`);

// graticule
for (let lon = -180; lon <= 180; lon += 30) line(px([90, lon]), px([-90, lon]), 'grat');
for (let lat = -60; lat <= 60; lat += 30) line(px([lat, -180]), px([lat, 180]), 'grat');

// rail line through the stations (same order as planet.js trackPts)
const RAIL = ['central', 'lakeside', 'farside', 'museumst'];
for (let i = 0; i < RAIL.length - 1; i++)
  arc(ll(LAYOUT.stops[RAIL[i]]), ll(LAYOUT.stops[RAIL[i + 1]]), 'rail', 40);

// spur roads: downtown → each district (as planet.js builds them)
const DT = ll(LAYOUT.anchors.downtown);
for (const k of ['airport', 'resort', 'mall', 'farmA', 'farmB', 'beach'])
  arc(DT, ll(LAYOUT.anchors[k]), 'spur', 30);

// districts
const DISTRICT_NAMES = { downtown: 'DOWNTOWN', lake: 'the Lake', mountain: 'the Mountain', airport: 'Airport', mall: 'the Mall', farmA: 'North Farm', farmB: 'South Farm', resort: 'the Resort', beach: 'the Beach' };
for (const [k, v] of Object.entries(LAYOUT.anchors)) {
  const p = px(v);
  dotAt(p, k === 'downtown' ? 7 : 5, k === 'downtown' ? '#2d2138' : '#8a7f96');
  label(p, DISTRICT_NAMES[k] || k, k === 'downtown' ? -12 : 16, k === 'downtown' ? 'lbl' : 'lbl2');
}

// stops
for (const [k, v] of Object.entries(LAYOUT.stops)) {
  const p = px(v);
  svg.push(`<rect x="${p[0] - 4}" y="${p[1] - 4}" width="8" height="8" fill="#6b5b95" transform="rotate(45 ${p[0]} ${p[1]})"/>`);
  label(p, `${k} stn`, 18, 'lbl2');
}

// landmarks (colours mirror planet.js's table)
const LM_COL = { library: '#e8a350', yarnflow: '#ff7eb6', inbox: '#4e8eff', charterscope: '#33c9ff', deckgpt: '#b265ff', council: '#8f7ae8', brainu: '#d06ee0', sinescape: '#2dd47b', pixels: '#ff8a3d', ros2: '#ff4d6e', artgarden: '#ffd23d' };
const LM_NAME = { library: 'The Library', yarnflow: 'YarnFlow', inbox: 'Inbox Zero', charterscope: 'CharterScope', deckgpt: 'DeckGPT', council: 'The Council', brainu: 'Brain U', sinescape: 'Sinescape', pixels: 'Pixels→Params', ros2: 'Robot Lab', artgarden: 'Downtown Museum' };
for (const [k, v] of Object.entries(LAYOUT.landmarks)) {
  const p = px(v);
  dotAt(p, 6.5, LM_COL[k]); dotAt(p, 6.5, 'none');
  svg.push(`<circle cx="${p[0]}" cy="${p[1]}" r="6.5" fill="none" stroke="#2d2138" stroke-width="1.6"/>`);
  label(p, LM_NAME[k], -11);
}

// hero assets on the main map (computed from their frames)
const east = (v) => norm([ -v[2], 0, v[0] ]);                    // ll-space east
const north = (v) => { const e = east(v); return norm([          // v × east
  v[1] * e[2] - v[2] * e[1], v[2] * e[0] - v[0] * e[2], v[0] * e[1] - v[1] * e[0]]); };
const R_WORLD = 40;
const frameAt = (v, [x, y]) => {
  const e = east(v), n = north(v);
  return norm(v.map((c, i) => c * R_WORLD + e[i] * x + n[i] * y));
};
const AIR = ll(LAYOUT.anchors.airport);
const heroes = [
  ['✈ jet', frameAt(AIR, LAYOUT.heroes.jetParked.at)],
  ['🚘 limo apron', frameAt(AIR, LAYOUT.heroes.limoApron.at)],
  ['⛽ Gas-N-Go', (() => { const m = slerp(DT, AIR, LAYOUT.heroes.gasStation.t);
     const e = east(m); return norm(m.map((c, i) => c * R_WORLD + e[i] * LAYOUT.heroes.gasStation.side)); })()],
  ['🚉 Central Stn (GLB)', ll(LAYOUT.stops.central)],
  ['🚀 pad', (() => { const f = ll(LAYOUT.stops.farside); const e = east(f);
     return norm(f.map((c, i) => c + e[i] * LAYOUT.heroes.rocketPad.side)); })()],
];
for (const [name, v] of heroes) {
  const p = px(toLatLon(v));
  svg.push(`<rect x="${p[0] - 5}" y="${p[1] - 5}" width="10" height="10" fill="#e8433f" stroke="#2d2138" stroke-width="1.2"/>`);
  label(p, name, 20, 'lbl2');
}

// ── downtown inset: the grown street graph ──
svg.push(`<rect x="${IX - 14}" y="${IY - 34}" width="${IW + 28}" height="${IH + 62}" rx="12" class="box"/>`);
svg.push(`<text x="${IX + IW / 2}" y="${IY - 10}" class="lbl" style="font-size:16px">DOWNTOWN — grown street plan (city_plan.js)</text>`);
for (const lot of CITY_PLAN.lots) {
  const pts = lot.v.map(ipx).map(p => p.map(c => c.toFixed(1)).join(',')).join(' ');
  svg.push(`<polygon points="${pts}" class="lot"/>`);
}
for (const [ai, bi, minor] of CITY_PLAN.edges)
  line(ipx(CITY_PLAN.nodes[ai]), ipx(CITY_PLAN.nodes[bi]), minor ? 'min' : 'maj');
// museum + station markers in the inset (approx: museum sits at plan origin's SW)
dotAt(ipx([0, 0]), 6, '#ffd23d'); label(ipx([0, 0]), 'city centre', -10, 'lbl2');
svg.push(`<text x="${IX + IW / 2}" y="${IY + IH + 24}" class="lbl2">roads: thick = boulevards · thin = lanes · beige = building parcels (90)</text>`);

// legend
const LY = H - 46;
svg.push(`<text x="30" y="${LY}" class="sub">◆ train stop&#160;&#160;&#160;● landmark&#160;&#160;&#160;■ hero asset (GLB)&#160;&#160;&#160;— — rail&#160;&#160;&#160;— spur road · edit city_layout.js to move anything, then re-run scripts/render-map.mjs</text>`);

const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('\n')}</svg>`;
await sharp(Buffer.from(out), { density: 110 }).png().toFile('city_map.png');
console.log('wrote city_map.png', W + 'x' + H);
