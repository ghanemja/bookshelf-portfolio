// ─── THE PROP KIT: everything soft-edged, hand-made, in the same gouache ─────
// No raw boxes or cones: walls are rounded boxes, roofs are bevelled gables,
// trees are puffs, windows are drawn by hand into the texture. Every builder
// returns a Group with its origin at ground level, +Z = front.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL, paint, ink, blobShadow, inkUniforms } from './style.js';

let _seed = 7;
export const rnd = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
export const pick = (a) => a[Math.floor(rnd() * a.length)];

export const rbox = (w, h, d, r = 0.08, seg = 2) =>
  new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const weld = (g) => { g.deleteAttribute('normal'); const w = mergeVertices(g, 1e-4); w.computeVertexNormals(); return w; };
export function lathe(pts, seg = 16) {
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  g.deleteAttribute('uv');
  return weld(g);
}
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

// ── hand-drawn window sheets (canvas), tiled per storey ──
const _winTex = {};
function windowTex(kind = 'flat', lit = false) {
  const key = kind + lit;
  if (_winTex[key]) return _winTex[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 128, 128);
  const jit = (v) => v + (Math.random() - 0.5) * 2.2;
  const win = (x, y, w, h) => {
    c.fillStyle = lit ? (Math.random() > 0.4 ? '#ffd98a' : '#5d6a86') : '#6f84a4';
    c.beginPath(); c.moveTo(jit(x), jit(y)); c.lineTo(jit(x + w), jit(y)); c.lineTo(jit(x + w), jit(y + h)); c.lineTo(jit(x), jit(y + h)); c.closePath(); c.fill();
    c.strokeStyle = '#2a2230'; c.lineWidth = 3.2; c.lineJoin = 'round'; c.stroke();
    if (kind !== 'shop') { c.lineWidth = 2; c.beginPath(); c.moveTo(jit(x + w / 2), jit(y)); c.lineTo(jit(x + w / 2), jit(y + h)); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(x + 4, y + 4, 5, h * 0.4);   // a glint, painted
  };
  if (kind === 'shop') { win(14, 44, 100, 60); }
  else { win(18, 28, 36, 52); win(74, 28, 36, 52); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  _winTex[key] = t;
  return t;
}
// a wall whose four faces carry the window sheet, one tile per ~1.6 units
export function windowWall(w, h, d, color, kind) {
  const g = rbox(w, h, d, 0.12, 2);
  const uv = g.attributes.uv, n = g.attributes.normal, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.7) { uv.setXY(i, 0.02, 0.02); continue; }      // roof/floor: plain wall colour
    const u = ax > 0.7 ? pos.getZ(i) + d / 2 : pos.getX(i) + w / 2;
    uv.setXY(i, u / 1.6, (pos.getY(i) + h / 2) / 1.7);
  }
  return new THREE.Mesh(g, paint(color, { map: windowTex(kind) }));
}

// a bevelled gable roof: an extruded triangle, softened
function gable(w, d, h, color, overhang = 0.25) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - overhang, 0); s.lineTo(w / 2 + overhang, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d + overhang * 2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
  g.deleteAttribute('uv');
  const w2 = weld(g);
  w2.translate(0, 0, -(d + overhang * 2) / 2);
  return new THREE.Mesh(w2, paint(color));
}

// ── a house, built like Main Street's shops: modelled windows (frames, mullions, sills,
// shutters, a flower box), a panelled door under a little porch roof, corner boards and a
// stone plinth, gable ends with a round attic window, a tiled roof with fascia and ridge cap ──
const _roofTex = {};
function roofTiles(hex) {
  if (_roofTex[hex]) return _roofTex[hex];
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d'), base = new THREE.Color(hex);
  c.fillStyle = '#' + base.getHexString(); c.fillRect(0, 0, 128, 128);
  const dark = '#' + base.clone().multiplyScalar(0.72).getHexString(), lite = '#' + base.clone().lerp(new THREE.Color(0xffffff), 0.12).getHexString();
  for (let r = 0; r < 4; r++) for (let k = -1; k < 5; k++) {              // rows of rounded tiles, staggered
    const x = k * 32 + (r % 2) * 16, y = r * 32;
    c.fillStyle = (k + r) % 3 ? '#' + base.getHexString() : lite;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 32, y); c.lineTo(x + 32, y + 22); c.quadraticCurveTo(x + 16, y + 34, x, y + 22); c.closePath(); c.fill();
    c.strokeStyle = dark; c.lineWidth = 2.2; c.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return (_roofTex[hex] = t);
}
// window-box flowers: little stems, petals and a centre, swaying in a breeze. The sway is
// in the vertex shader (world-position phase), so it survives the buildings being baked
// and batched, and costs nothing per frame
const _sway = {};
function swayPaint(hex, amp) {
  const key = hex + ':' + amp; if (_sway[key]) return _sway[key];
  const m = paint(hex, { unique: true, hatch: 0 }), base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base?.(sh, r);
    sh.uniforms.uTime = inkUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 wp = modelMatrix * vec4(transformed, 1.0);
        float ph = dot(wp.xyz, vec3(2.3, 1.7, 2.9));
        float gust = 0.6 + 0.4 * sin(uTime * 0.31 + ph * 0.05);
        float sw = (sin(uTime * 1.6 + ph) * 0.65 + sin(uTime * 2.7 + ph * 1.4) * 0.35) * gust;
        transformed.x += sw * ${amp.toFixed(3)}; transformed.z += cos(uTime * 1.2 + ph) * ${(amp * 0.4).toFixed(3)} * gust; }`);
  };
  const ck = m.customProgramCacheKey; m.customProgramCacheKey = () => (ck ? ck() : '') + 'sway' + amp;
  m.userData.noBatchMerge = true;
  return (_sway[key] = m);
}
function windowFlowers(parent, x0, x1, y, z) {
  const stem = swayPaint(0x5f8a4a, 0.012), leaf = swayPaint(0x6f9a52, 0.014), mid = swayPaint(0xf2c94c, 0.028);
  const n = Math.max(3, Math.round((x1 - x0) / 0.085));
  for (let k = 0; k < n; k++) {
    const x = x0 + (x1 - x0) * (k + 0.5) / n + (rnd() - 0.5) * 0.02, hh = 0.13 + rnd() * 0.07;
    const st = mesh(new THREE.CylinderGeometry(0.008, 0.011, hh, 5), stem, x, y + hh / 2, z); parent.add(st);
    const lf = mesh(new THREE.SphereGeometry(0.03, 6, 4), leaf, x + (k % 2 ? 0.024 : -0.024), y + hh * 0.35, z); lf.scale.set(1, 0.4, 0.6); lf.rotation.z = k % 2 ? 0.5 : -0.5; parent.add(lf);
    const pet = swayPaint(pick([PAL.accent, 0xf6efdf, PAL.rose, 0xe8a0c4, PAL.gold, 0x9fb4e8]), 0.03);
    for (let p = 0; p < 5; p++) {
      const a = p / 5 * Math.PI * 2 + k;
      const q = mesh(new THREE.SphereGeometry(0.026, 7, 5), pet, x + Math.cos(a) * 0.03, y + hh + Math.sin(a) * 0.03, z + 0.01); q.scale.set(1, 1, 0.5); parent.add(q);
    }
    parent.add(mesh(new THREE.SphereGeometry(0.018, 7, 5), mid, x, y + hh, z + 0.025));
  }
}

export function house(o = {}) {
  const w = o.w ?? 2.4, d = o.d ?? 2.0, h = o.h ?? 1.7;
  const g = new THREE.Group();
  const wallC = o.color ?? pick([PAL.cream, PAL.rose, PAL.dusty, PAL.sage, PAL.mustard]);
  const roofC = o.roof ?? pick([PAL.roofRed, PAL.roofSlate, PAL.roofGreen]);
  const trimC = pick([0xf6efdf, 0xefe4cc, 0xf3ead7]), shutC = pick([PAL.teal, PAL.roofGreen, PAL.accent, PAL.roofSlate, PAL.mustard]);
  const wall = paint(wallC), trim = paint(trimC), shut = paint(shutC), glass = paint(0x6f84a4, { hatch: 0 }), stone = paint(0xb3a99a);
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = mesh(geo, mat, x, y, z); g.add(m); return m; };
  // body, plinth, corner boards, eave band
  add(rbox(w, h, d, 0.08, 2), wall, 0, h / 2, 0);
  add(rbox(w + 0.08, 0.2, d + 0.08, 0.05), stone, 0, 0.1, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(rbox(0.09, h - 0.2, 0.09, 0.03), trim, sx * (w / 2 - 0.01), h / 2 + 0.08, sz * (d / 2 - 0.01));
  add(rbox(w + 0.12, 0.1, d + 0.12, 0.04), trim, 0, h - 0.04, 0);
  // the roof: two tiled slopes with an overhang, fascia boards, a ridge cap
  const rh = h * 0.62, ov = 0.22, half = w / 2 + ov, slope = Math.hypot(half, rh), ang = Math.atan2(rh, half);
  const tiles = paint(0xffffff, { map: roofTiles(roofC) });
  for (const sx of [-1, 1]) {
    const geo = rbox(slope + 0.04, 0.09, d + ov * 2, 0.035);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * slope / 0.55, uv.getY(i) * (d + ov * 2) / 0.55);
    const r = add(geo, tiles, sx * half / 2, h + rh / 2 + 0.02, 0); r.rotation.z = -sx * ang;
    const fas = add(rbox(slope + 0.06, 0.07, 0.06, 0.02), trim, sx * half / 2, h + rh / 2 - 0.03, (d / 2 + ov));
    fas.rotation.z = -sx * ang;
    const fas2 = add(rbox(slope + 0.06, 0.07, 0.06, 0.02), trim, sx * half / 2, h + rh / 2 - 0.03, -(d / 2 + ov)); fas2.rotation.z = -sx * ang;
  }
  add(new THREE.CylinderGeometry(0.06, 0.06, d + ov * 2 + 0.04, 10).rotateX(Math.PI / 2), paint(new THREE.Color(roofC).multiplyScalar(0.8).getHex()), 0, h + rh + 0.03, 0);
  // gable ends, each with a round attic window
  const tri = new THREE.Shape(); tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, rh * 0.96); tri.closePath();
  const triG = weld(new THREE.ExtrudeGeometry(tri, { depth: d - 0.02, bevelEnabled: false }));
  triG.translate(0, 0, -(d - 0.02) / 2); add(triG, wall, 0, h, 0);
  for (const sz of [-1, 1]) {
    const f = add(new THREE.TorusGeometry(0.16, 0.035, 8, 20), trim, 0, h + rh * 0.38, sz * (d / 2 + 0.01));
    add(new THREE.CircleGeometry(0.15, 18), glass, 0, h + rh * 0.38, sz * (d / 2 + 0.005)).rotation.y = sz > 0 ? 0 : Math.PI;
    void f;
  }
  // a window: trim frame, glass with a cross of mullions, a sill, shutters, maybe a flower box
  const win = (x, y, z, ry, ww = 0.42, wh = 0.5, sw = 0.16, box = true) => {
    const W = new THREE.Group(); W.position.set(x, y, z); W.rotation.y = ry; g.add(W);
    const m = (geo, mat, px, py, pz) => { const q = mesh(geo, mat, px, py, pz); W.add(q); return q; };
    m(rbox(ww + 0.1, wh + 0.1, 0.05, 0.02), trim, 0, 0, 0.01);
    m(rbox(ww, wh, 0.03, 0.01), glass, 0, 0, 0.03);
    m(rbox(0.03, wh, 0.03, 0.01), trim, 0, 0, 0.05); m(rbox(ww, 0.03, 0.03, 0.01), trim, 0, 0.02, 0.05);
    m(rbox(ww + 0.18, 0.05, 0.12, 0.02), trim, 0, -wh / 2 - 0.06, 0.05);
    for (const sx of [-1, 1]) {
      const sh = m(rbox(sw, wh + 0.06, 0.03, 0.015), shut, sx * (ww / 2 + sw / 2 + 0.06), 0, 0.03);
      for (let k = 0; k < 4; k++) m(rbox(sw * 0.75, 0.012, 0.012, 0.004), paint(new THREE.Color(shutC).multiplyScalar(0.75).getHex(), { hatch: 0 }), sx * (ww / 2 + sw / 2 + 0.06), -wh / 2 + 0.1 + k * (wh - 0.1) / 3.4, 0.05);
      void sh;
    }
    if (box) {
      m(rbox(ww + 0.06, 0.12, 0.14, 0.03), paint(PAL.bark), 0, -wh / 2 - 0.15, 0.16);
      m(rbox(ww - 0.02, 0.02, 0.1, 0.01), paint(0x6a4a34, { hatch: 0 }), 0, -wh / 2 - 0.085, 0.16);   // soil
      windowFlowers(W, -ww / 2 + 0.03, ww / 2 - 0.03, -wh / 2 - 0.085, 0.16);
    }
  };
  // the front: lay the door and windows out to FIT the width (no window may touch the door)
  const fz = d / 2 + 0.005, wy = h * 0.56, edge = w / 2 - 0.1, DW = 0.56, GAP = 0.08;
  const winTotal = (ww, sw) => ww + 2 * (sw + 0.06);
  let doorX = 0;
  if (2 * edge >= DW + 2 * (winTotal(0.42, 0.16) + GAP)) {            // wide: a window either side
    const cx = DW / 2 + GAP + winTotal(0.42, 0.16) / 2;
    win(-cx, wy, fz, 0); win(cx, wy, fz, 0);
  } else {                                                            // narrow: the door to one side, one window
    const side = rnd() > 0.5 ? 1 : -1;
    doorX = -side * (edge - DW / 2);
    const room = 2 * edge - DW - GAP;                                 // what's left beside the door
    const sw = Math.min(0.16, Math.max(0.08, room * 0.16)), ww = Math.min(0.42, room - 2 * (sw + 0.06));
    if (ww > 0.18) win(side * (edge - room / 2), wy, fz, 0, ww, 0.5, sw);
  }
  win(0, wy, -fz, Math.PI);
  for (const sx of [-1, 1]) win(sx * (w / 2 + 0.005), wy, 0, sx * Math.PI / 2, 0.38, 0.46);
  // the door: a frame, two raised panels, a knob, a number, a step — under a little porch roof
  add(rbox(0.56, 0.98, 0.06, 0.02), trim, doorX, 0.53, fz + 0.01);
  const doorC = pick([PAL.accent, PAL.teal, PAL.bark, PAL.roofGreen, PAL.mustard]);
  add(rbox(0.44, 0.86, 0.05, 0.02), paint(doorC), doorX, 0.5, fz + 0.03);
  for (const y of [0.32, 0.66]) add(rbox(0.3, 0.24, 0.03, 0.02), paint(new THREE.Color(doorC).multiplyScalar(0.85).getHex()), doorX, y, fz + 0.06);
  add(new THREE.SphereGeometry(0.03, 8, 6), paint(PAL.gold, { hatch: 0 }), doorX + 0.15, 0.5, fz + 0.08);
  add(rbox(0.72, 0.1, 0.36, 0.04), stone, doorX, 0.05, fz + 0.18);
  const porch = new THREE.Shape(); porch.moveTo(-0.36, 0); porch.lineTo(0.36, 0); porch.lineTo(0, 0.2); porch.closePath();
  const pg = weld(new THREE.ExtrudeGeometry(porch, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2 }));
  add(pg, paint(roofC), doorX, 1.06, fz);
  for (const sx of [-1, 1]) { add(rbox(0.05, 0.16, 0.12, 0.015), trim, doorX + sx * 0.3, 0.99, fz + 0.06); }   // brackets flat to the wall, beside the door frame
  if (o.chimney !== false && rnd() > 0.35) {
    add(rbox(0.3, 0.75, 0.3, 0.04), paint(PAL.terracotta), w * 0.24, h + rh * 0.62, -d * 0.12);
    add(rbox(0.38, 0.08, 0.38, 0.03), stone, w * 0.24, h + rh * 0.62 + 0.4, -d * 0.12);
  }
  g.add(blobShadow(w * 0.78, d * 0.78));
  return ink(g, 'mid');
}

// ── a downtown block building: mid-rise or tower, setback crown, drawn windows ──
export function block(o = {}) {
  const w = o.w ?? 2.6, d = o.d ?? 2.6, h = o.h ?? 6;
  const g = new THREE.Group();
  const col = o.color ?? pick([PAL.cream, PAL.terracotta, PAL.dusty, PAL.sage, PAL.mustard, PAL.rose, PAL.lilac]);
  const base = windowWall(w, 1.4, d, col, 'shop');                // shopfronts at street level
  base.position.y = 0.7; g.add(base);
  const body = windowWall(w * 0.94, h - 1.4, d * 0.94, col, 'flat');
  body.position.y = 1.4 + (h - 1.4) / 2; g.add(body);
  g.add(mesh(rbox(w + 0.1, 0.14, d + 0.1, 0.06), paint(PAL.kerb), 0, 1.42, 0));   // string course
  // crown: a setback top storey + cornice, so the skyline reads hand-designed
  g.add(mesh(rbox(w * 0.98, 0.18, d * 0.98, 0.07), paint(PAL.kerb), 0, h + 0.09, 0));
  if (h > 4.5) {
    const cw = w * 0.6, cd = d * 0.6;
    g.add(mesh(rbox(cw, 0.8, cd, 0.1), paint(col), 0, h + 0.58, 0));
    g.add(mesh(rbox(cw + 0.12, 0.12, cd + 0.12, 0.05), paint(PAL.kerb), 0, h + 1.02, 0));
    if (rnd() > 0.5) g.add(mesh(lathe([[0.001, 0], [0.22, 0], [0.22, 0.5], [0.04, 0.9], [0.001, 0.95]], 12), paint(PAL.roofSlate), 0, h + 1.08, 0));
  }
  // awning over the shopfront
  const aw = mesh(rbox(w * 0.7, 0.08, 0.5, 0.04), paint(pick([PAL.accent, PAL.teal, PAL.mustard, PAL.rose])), 0, 1.25, d / 2 + 0.22);
  aw.rotation.x = 0.28; g.add(aw);
  g.add(blobShadow(w * 0.8, d * 0.8));
  return ink(g, h > 4.5 ? 'heavy' : 'mid');
}

// ── trees: a tapered trunk and a canopy of soft puffs (never a cone) ──
const _puff = new THREE.IcosahedronGeometry(1, 3);
export function tree(o = {}) {
  const s = o.s ?? (0.8 + rnd() * 0.5);
  const g = new THREE.Group();
  g.add(mesh(lathe([[0.001, 0], [0.16, 0], [0.12, 0.5], [0.09, 1.1], [0.001, 1.15]], 10).scale(s, s, s), paint(PAL.bark)));
  const leaf = paint(rnd() > 0.5 ? PAL.leaf : PAL.leafLight);
  const puffs = [[0, 1.45, 0, 0.62], [0.38, 1.25, 0.1, 0.45], [-0.34, 1.3, -0.12, 0.48], [0.05, 1.78, -0.05, 0.42]];
  const geos = puffs.map(([x, y, z, r]) => _puff.clone().scale(r * s, r * s * 0.92, r * s).translate(x * s, y * s, z * s));
  g.add(new THREE.Mesh(weld(mergeGeometries(geos.map(q => { q.deleteAttribute('uv'); return q; }))), leaf));
  g.add(blobShadow(0.7 * s));
  g.userData.deco = 0.3;                       // a plant: never on a road or rail (world.js decoBlocked)
  return ink(g, 'fine');
}
export function pine(o = {}) {
  const s = o.s ?? (0.8 + rnd() * 0.5);
  const g = new THREE.Group();
  g.add(mesh(lathe([[0.001, 0], [0.13, 0], [0.1, 0.5], [0.001, 0.55]], 8).scale(s, s, s), paint(PAL.bark)));
  // three soft tiers, each a rounded lathe (a drawn fir, not a party hat)
  const tier = (y, r, hh) => lathe([[0.001, y], [r, y + 0.05], [r * 0.92, y + 0.12], [r * 0.45, y + hh * 0.7], [0.05, y + hh], [0.001, y + hh]], 14);
  const geos = [tier(0.35, 0.62, 0.8), tier(0.85, 0.48, 0.7), tier(1.3, 0.34, 0.6)].map(q => q.scale(s, s, s));
  g.add(new THREE.Mesh(mergeGeometries(geos), paint(PAL.grassDeep)));
  g.add(blobShadow(0.6 * s));
  g.userData.deco = 0.28;                       // a plant: never on a road or rail (world.js decoBlocked)
  return ink(g, 'fine');
}
export function bush(s = 0.5) {
  const g = new THREE.Group();
  const geos = [[0, 0.3, 0, 1], [0.45, 0.22, 0.1, 0.75], [-0.4, 0.24, -0.1, 0.8]]
    .map(([x, y, z, r]) => _puff.clone().scale(r * s, r * s * 0.8, r * s).translate(x * s, y * s, z * s));
  g.add(new THREE.Mesh(mergeGeometries(geos.map(q => { q.deleteAttribute('uv'); return q; })), paint(PAL.leaf)));
  g.add(blobShadow(0.8 * s));
  g.userData.deco = 0.3;                       // a plant: never on a road or rail (world.js decoBlocked)
  return ink(g, 'fine');
}

// ── street furniture ──
export function lamp(mark = 'street') {   // (mark: 'feature' for a lamp that's part of a structure's design — the bridge's newels)
  const g = new THREE.Group();
  // the post rises into a cup (a collar and a flared gallery) that the globe sits down in, and a
  // little cap and finial crown it: the globe used to balance on the post's flat top, touching it
  // at a point, so from below it looked loose. (The cup's lip meets the globe's surface; its top
  // face is inside the globe, never seen)
  // (post and cap are one mesh: a lamp is still two draws — post, globe)
  const post = lathe([[0.001, 0], [0.12, 0], [0.12, 0.06], [0.05, 0.14], [0.04, 1.9], [0.06, 1.93], [0.06, 1.98], [0.045, 2.01],
    [0.07, 2.06], [0.105, 2.11], [0.128, 2.15], [0.12, 2.165], [0.001, 2.165]], 14);
  const cap = lathe([[0.001, 0], [0.05, 0], [0.075, 0.02], [0.06, 0.04], [0.022, 0.055], [0.018, 0.095], [0.032, 0.115], [0.001, 0.145]], 14).translate(0, 2.41, 0);
  g.add(mesh(mergeGeometries([post, cap]), paint(PAL.ink, { hatch: 0 })));
  const bulb = mesh(new THREE.SphereGeometry(0.17, 16, 12), paint(0xfff1c8, { emissive: 0xffd98a, hatch: 0 }), 0, 2.27, 0);
  bulb.userData.lamp = true;
  g.add(bulb);
  const tag = new THREE.Object3D(); tag.userData.lampMark = mark; g.add(tag);   // (world.js collectLamps)
  return ink(g, 'fine');
}
export function bench() {
  const g = new THREE.Group();
  g.add(mesh(rbox(1.2, 0.08, 0.38, 0.03), paint(PAL.bark), 0, 0.42, 0));
  g.add(mesh(rbox(1.2, 0.32, 0.06, 0.03), paint(PAL.bark), 0, 0.62, -0.17));
  for (const x of [-0.5, 0.5]) g.add(mesh(rbox(0.06, 0.42, 0.34, 0.02), paint(PAL.ink, { hatch: 0 }), x, 0.21, 0));
  return ink(g, 'fine');
}

