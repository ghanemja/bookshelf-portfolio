// ─── LANDSCAPING: the museum's grounds, and the project shops' cobbled approaches ───
// Built in the frame of the thing they surround (the museum's, or each shop's: +Z faces
// the road, y up) and set down with placeOnPlanet(..., { sink: 0 }), so every vertex rides
// the terrain under it and the whole lot bakes to one mesh per material. Solid things
// leave K.foot markers (town.js feet() turns them into colliders).
import * as THREE from 'three';
import { PAL, paint } from './style.js';
import { rbox, lathe } from './props.js';
import { kit } from './buildings.js';

// a tiny seeded random, so the grounds come out the same every load
const rng = (s) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

// ── hand-painted ground textures (tiled in metres) ──
function groundTex(size, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d'), size, rng(size * 13 + 7));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
let _M = null;
function mats() {
  if (_M) return _M;
  // gravel: a warm sand with soft speckles
  const gravelTex = groundTex(128, (c, n, R) => {
    c.fillStyle = '#e4d5b2'; c.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) { c.fillStyle = R() > 0.5 ? 'rgba(150,120,85,0.35)' : 'rgba(255,248,230,0.55)'; c.beginPath(); c.arc(R() * n, R() * n, 1 + R() * 2.2, 0, 7); c.fill(); }
  });
  // flagstones: irregular pale slabs with dark joints
  const flagTex = groundTex(256, (c, n, R) => {
    c.fillStyle = '#8f8270'; c.fillRect(0, 0, n, n);
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      let x = -R() * 40;
      while (x < n) {
        const w = 50 + R() * 50, y = r * n / rows;
        c.fillStyle = ['#d9cdb5', '#cfc1a6', '#e2d7c2', '#c8b99c'][Math.floor(R() * 4)];
        c.beginPath(); c.roundRect(x + 3, y + 3, w - 6, n / rows - 6, 9); c.fill();
        x += w;
      }
    }
  });
  // cobbles: rows of rounded setts, each shaded a little differently, with a highlight
  const cobbleTex = groundTex(256, (c, n, R) => {
    c.fillStyle = '#6f6656'; c.fillRect(0, 0, n, n);
    const rows = 8, h = n / rows;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * -h * 0.5;
      while (x < n + h) {
        const w = h * (0.8 + R() * 0.45), tone = Math.floor(170 + R() * 50);
        c.fillStyle = `rgb(${tone + 12},${tone + 2},${tone - 18})`;
        c.beginPath(); c.roundRect(x + 2.5, r * h + 2.5, w - 5, h - 5, h * 0.35); c.fill();
        c.fillStyle = 'rgba(255,250,235,0.35)';
        c.beginPath(); c.ellipse(x + w * 0.4, r * h + h * 0.35, w * 0.22, h * 0.14, 0, 0, 7); c.fill();
        x += w;
      }
    }
  });
  // mulch: dark bark chips
  const mulchTex = groundTex(128, (c, n, R) => {
    c.fillStyle = '#6e4c38'; c.fillRect(0, 0, n, n);
    for (let i = 0; i < 220; i++) { c.fillStyle = ['#8a6248', '#5a3c2c', '#9a7356'][Math.floor(R() * 3)]; c.save(); c.translate(R() * n, R() * n); c.rotate(R() * 3); c.fillRect(-3, -1.2, 6 + R() * 4, 2.4); c.restore(); }
  });
  const flat = (o) => { const m = paint(0xffffff, { hatch: 0, side: THREE.DoubleSide, ...o }); m.polygonOffset = true; m.polygonOffsetFactor = m.polygonOffsetUnits = -3; return m; };
  _M = {
    gravel: flat({ map: gravelTex }), flag: flat({ map: flagTex }), cobble: flat({ map: cobbleTex }),
    edge: (() => { const m = paint(0xb9ad95, { hatch: 0, side: THREE.DoubleSide }); m.polygonOffset = true; m.polygonOffsetFactor = m.polygonOffsetUnits = -2; return m; })(),
    stone: paint(0xd6cbb4), stoneD: paint(0xb3a68c), soil: paint(0x8a6a52, { hatch: 0 }), mulch: paint(0x7a5640, { map: mulchTex }),
    hedge: paint(0x5f8a4e), hedgeD: paint(0x4f7a44), water: paint(PAL.water, { hatch: 0 }),
    dark: paint(PAL.ink, { hatch: 0 }), glow: paint(0xfff1c8, { emissive: 0xffd98a, hatch: 0 }),
    wood: paint(PAL.bark), bronze: paint(0xb07a3e), patina: paint(0x6fa596), terracotta: paint(PAL.terracotta ?? 0xc8714f),
    flowers: [0xe8604c, 0xe1b95c, 0xf6eedb, 0xdc9e9a, 0x8f7ae8, 0xf2a07a].map(c => paint(c, { hatch: 0 })),
  };
  return _M;
}

// a flat ribbon down a smoothed polyline [[x, z], ...] at height y, its texture tiled in metres
function strip(K, pts, half, mat, y, tile = 1, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, 'centripetal');
  const L = curve.getLength(), n = Math.max(2, Math.ceil(L / 0.3));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = closed ? (i % n) / n : i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const sx = -tg.z, sz = tg.x;                                   // across the path, in xz
    for (const s of [-1, 1]) { pos.push(p.x + sx * half * s, y, p.z + sz * half * s); uv.push((s * half) / tile, (i / n) * L / tile); }
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = K.put(g, mat); m.userData.noInk = true;
  return curve;
}
// a path: the walking surface and, a hair below and a touch wider, a stone edging line
function path(K, pts, half, mat, y = 0.01, tile = 1) {
  const M = mats();
  strip(K, pts, half + 0.07, M.edge, y - 0.008, tile);
  return strip(K, pts, half, mat, y, tile);
}
// a flat shape lying in xz at height y, with uvs in metres (so a texture tiles like the paths')
function lay(K, geo, mat, x, y, z, tile = 1) {
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push((p.getX(i) + x) / tile, (p.getZ(i) + z) / tile);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = K.put(geo, mat, x, y, z); m.userData.noInk = true;
  return m;
}
// a low lamp on a post, knee to waist high (the grounds' lamps, not the street's)
function bollard(K, x, z, h = 0.9) {
  const M = mats();
  K.put(lathe([[0.001, 0], [0.09, 0], [0.09, 0.05], [0.05, 0.1], [0.04, h - 0.08], [0.07, h - 0.04], [0.001, h]], 10), M.dark, x, 0, z);
  K.put(lathe([[0.001, 0], [0.07, 0.01], [0.09, 0.1], [0.06, 0.2], [0.001, 0.22]], 12), M.glow, x, h, z);
  K.put(lathe([[0.001, 0], [0.11, 0], [0.03, 0.07], [0.001, 0.1]], 12), M.dark, x, h + 0.2, z);
  K.foot(x, z, 0.1).userData.lampMark = 'low';
}
function gardenBench(K, x, z, ry) {
  const M = mats(), s = K.sub(x, 0, z, ry);
  s.box(1.2, 0.07, 0.38, M.wood, 0, 0.42, 0, 0.025);
  s.box(1.2, 0.28, 0.06, M.wood, 0, 0.63, -0.17, 0.025, [-0.12, 0, 0]);
  for (const sx of [-0.52, 0.52]) s.box(0.06, 0.46, 0.36, M.dark, sx, 0.19, 0, 0.02);
  K.foot(x, z, 0.45);
}
// ── planting: plants are listed (plants.js grows them on the drawn ground after placement,
// merged per colour, nodding in the breeze). A bed is filled in layers — tall at the back,
// low at the front, something spilling over the edge — from a harmonious palette ──
const PALETTES = [
  { tall: ['cosmos', 'spikes'], mid: ['tulip', 'bloom'], low: ['daisy', 'trail'], c: [0xd8508a, 0xf2a0b4, 0xf6eedb], spike: 0x9c8ad8 },   // pinks and lavender
  { tall: ['spikes', 'grass'], mid: ['tulip', 'mound'], low: ['daisy', 'trail'], c: [0xf2c14e, 0xf29a4a, 0xf6eedb], spike: 0x6676d6 },    // gold, orange and blue salvia
  { tall: ['cosmos', 'grass'], mid: ['bloom', 'tulip'], low: ['daisy', 'trail'], c: [0xe8604c, 0xf27a6a, 0xf6eedb], spike: 0xe8604c },    // reds and corals
  { tall: ['spikes', 'cosmos'], mid: ['mound', 'tulip'], low: ['trail', 'daisy'], c: [0x8f7ae8, 0xf6eedb, 0xf2a0b4], spike: 0x9c8ad8 },  // violets and whites
];
function plant(K, k, x, z, o = {}) { (K.g.userData.plants ||= []).push({ k, x, z, ...o }); }
// fill a rectangle (w × d, its back at −z unless `front` says which way the path is) at height y
function fillBed(K, x, z, w, d, R, y, { pal = PALETTES[Math.floor(R() * PALETTES.length)], front = [0, 1], edge = true } = {}) {
  const [fx, fz] = front, ax = fz, az = -fx;                     // along the bed: perpendicular to the front
  const at = (u, v) => [x + ax * u + fx * v, z + az * u + fz * v];    // u along, v toward the front
  const L = Math.abs(ax) > 0.5 ? w : d, D = Math.abs(ax) > 0.5 ? d : w;
  const rows = [[-D / 2 + 0.16, pal.tall, 1.45], [0, pal.mid, 1.4], [D / 2 - 0.14, pal.low, 1.3]];
  for (const [v, kinds, sc] of rows) {
    if (D < 0.7 && v === 0) continue;
    const n = Math.max(3, Math.round(L / (kinds === pal.mid ? 0.24 : 0.17)));
    for (let i = 0; i < n; i++) {
      const u = -L / 2 + (i + 0.5) * L / n + (R() - 0.5) * 0.08, k = kinds[(i + Math.floor(R() * 2)) % kinds.length];
      const [px, pz] = at(u, v + (R() - 0.5) * 0.08);
      const c = k === 'spikes' ? pal.spike : pal.c[Math.floor(R() * pal.c.length)];
      plant(K, k, px, pz, { y, s: sc * (0.85 + R() * 0.3), c: k === 'mound' || k === 'grass' ? undefined : c, ry: k === 'trail' ? Math.atan2(fx, fz) + (R() - 0.5) * 0.6 : undefined });
    }
  }
  if (edge) for (let i = 0, n = Math.max(2, Math.round(L / 0.3)); i < n; i++) {   // a clipped box edge along the front
    const [px, pz] = at(-L / 2 + (i + 0.5) * L / n, D / 2 + 0.02);
    plant(K, 'boxBall', px, pz, { y, s: 1 });
  }
}
// a flower bed: a stone kerb (round or rounded-square), mulch, and layered planting
function flowerBed(K, x, z, w, d, R, { round = false, kerb = true, front = [0, 1] } = {}) {
  const M = mats();
  if (round) {
    const r = w / 2;
    if (kerb) K.put(lathe([[r - 0.06, -0.05], [r + 0.04, -0.05], [r + 0.04, 0.16], [r - 0.06, 0.16]], 28), M.stone, x, 0, z);
    K.put(lathe([[0.001, 0.1], [r - 0.06, 0.1], [r - 0.08, 0.15], [0.001, 0.16]], 28), M.mulch, x, 0, z);
    const pal = PALETTES[Math.floor(R() * PALETTES.length)];
    plant(K, R() > 0.5 ? 'bloom' : 'grass', x, z, { y: 0.15, s: 1.1 });
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28, rr = r * 0.62; plant(K, pal.low[i % 2], x + Math.sin(a) * rr, z + Math.cos(a) * rr, { y: 0.15, c: pal.c[i % pal.c.length], ry: a }); }
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28 + 0.6, rr = r * 0.34; plant(K, pal.mid[i % 2], x + Math.sin(a) * rr, z + Math.cos(a) * rr, { y: 0.15, c: pal.c[(i + 1) % pal.c.length] }); }
    return;
  }
  if (kerb) K.box(w + 0.1, 0.2, d + 0.1, M.stone, x, 0.06, z, 0.04);
  K.box(w - 0.04, 0.06, d - 0.04, M.mulch, x, 0.15, z, 0.02);
  fillBed(K, x, z, w - 0.1, d - 0.1, R, 0.18, { front, edge: false });
}
// a square bed planted as a little island: a feature plant in the middle, rings round it
function islandBed(K, x, z, w, R) {
  const M = mats(), pal = PALETTES[Math.floor(R() * PALETTES.length)];
  K.box(w + 0.1, 0.2, w + 0.1, M.stone, x, 0.06, z, 0.04);
  K.box(w - 0.04, 0.06, w - 0.04, M.mulch, x, 0.15, z, 0.02);
  plant(K, R() > 0.5 ? 'spikes' : 'grass', x, z, { y: 0.18, s: 1.3, c: pal.spike });
  const h = w / 2 - 0.16;
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) plant(K, pal.tall[(u + v + 2) / 2 % 2], x + u * h * 0.55, z + v * h * 0.55, { y: 0.18, c: pal.tall[(u + v + 2) / 2 % 2] === 'spikes' ? pal.spike : pal.c[(u + 1) / 2], s: 1.15 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28 + 0.4; plant(K, pal.low[i % 2], x + Math.sin(a) * h, z + Math.cos(a) * h, { y: 0.18, c: pal.c[i % pal.c.length], ry: a, s: 1.25 }); }
  for (let i = 0; i < 4; i++) { const a = i / 4 * 6.28 + 1.2; plant(K, pal.mid[i % 2] === 'bloom' || pal.mid[i % 2] === 'mound' ? 'tulip' : pal.mid[i % 2], x + Math.sin(a) * h * 0.5, z + Math.cos(a) * h * 0.5, { y: 0.18, c: pal.c[(i + 2) % pal.c.length], s: 1.3 }); }
}
// a trough planter (stone box, mulch, planted, something trailing over the front)
function trough(K, x, z, R, { w = 0.62, d = 0.62, h = 0.56, front = [0, 1] } = {}) {
  const M = mats();
  K.box(w, h, d, M.stone, x, h / 2 - 0.06, z, 0.06);
  K.box(w - 0.1, 0.05, d - 0.1, M.mulch, x, h - 0.07, z, 0.02);
  const pal = PALETTES[Math.floor(R() * PALETTES.length)];
  plant(K, pal.mid[0] === 'mound' ? 'grass' : 'bloom', x - front[0] * 0.08, z - front[1] * 0.08, { y: h - 0.06, s: 0.75 });
  for (const s2 of [-1, 1]) plant(K, 'trail', x + front[0] * (d / 2 - 0.08) + front[1] * s2 * 0.13, z + front[1] * (d / 2 - 0.08) - front[0] * s2 * 0.13, { y: h - 0.06, s: 0.9, c: pal.c[0], ry: Math.atan2(front[0], front[1]) });
  plant(K, 'tulip', x + front[1] * 0.16, z - front[0] * 0.16, { y: h - 0.06, s: 0.85, c: pal.c[1] });
  plant(K, 'tulip', x - front[1] * 0.16, z + front[0] * 0.16, { y: h - 0.06, s: 0.85, c: pal.c[2] });
  K.foot(x, z, Math.max(w, d) / 2 + 0.05);
}
// a clipped hedge along a straight run (a rounded box, its top a touch darker)
function hedge(K, x0, z0, x1, z1, h = 0.45, w = 0.34) {
  const M = mats(), L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
  K.put(rbox(w, h + 0.13, L, 0.13, 3), M.hedge, (x0 + x1) / 2, (h - 0.13) / 2, (z0 + z1) / 2, [0, a, 0]);   // bevel below ground
}
// a tree: a mix of kinds (blossom, birch, autumn maple, cypress, a round shade tree)
const TREES = ['blossom', 'maple', 'birch', 'shade', 'cypress', 'blossom', 'maple', 'birch'];
let _treeN = 0;
function specimen(K, x, z, s, R, kind = null) {
  plant(K, kind ?? TREES[(_treeN++ + Math.floor(R() * 3)) % TREES.length], x, z, { s: s * 1.05 });
  K.foot(x, z, 0.3);
}
// a shrub on the lawn: a mounding shrub or a flowering bush, a grass clump beside it
function shrub(K, x, z, R) {
  plant(K, R() > 0.45 ? 'bloom' : 'mound', x, z, { s: 1.1 + R() * 0.4 });
  if (R() > 0.4) plant(K, 'grass', x + 0.38, z + 0.15, { s: 0.9 });
}
// clipped topiary in a stone pot: a cone, a spiral or a ball on a stem
function topiary(K, x, z, s = 1, kind = 'spiral') {
  const M = mats();
  K.put(lathe([[0.001, -0.05], [0.24, -0.05], [0.28, 0.3], [0.31, 0.34], [0.001, 0.34]], 16).scale(s, s, s), M.stone, x, 0, z);
  plant(K, kind, x, z, { y: 0.3 * s, s });
  K.foot(x, z, 0.3 * s);
}

// ── the museum's grounds (museum frame: the building spans x ±6.8, z −2.4…−11.6 with its
// stylobate; the forecourt disc is r 3.3 round (0, −0.3); roads run past both sides,
// close at the front, opening out behind) ──
export function museumGrounds({ ok = () => true, pool: poolAt = null } = {}) {
  const K = kit(), M = mats(), R = rng(5153);
  // optional pieces go where ok() says the world is free (no road, water, or a project shop
  // and its approach) and they don't overlap each other; the first free candidate wins
  const placed = [];
  const free = (x, z, r) => !placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + r + 0.15) && ok(x, z, r);
  const onWalk = (x, z, r) => (Math.abs(Math.abs(x) - 8.6) < 0.6 + r && z < -2 && z > -12.6) || (Math.abs(z + 13.0) < 0.6 + r && Math.abs(x) < 8.6);
  const spot = (x, z, r) => !onWalk(x, z, r) && !(Math.abs(x) < 7.2 + r && z > -12.1 - r && z < -2.2 + r) && free(x, z, r);
  const pick = (cands, r) => { for (const [x, z] of cands) if (spot(x, z, r)) { placed.push([x, z, r]); return [x, z]; } return null; };
  // gravel walks from the side pavements round both wings, meeting behind the building
  // either side of the service ramp (x ±0.8, z −11.4…−14.1)
  path(K, [[-7.35, -1.3], [-7.9, -2.7], [-8.25, -4.6], [-8.25, -10.3], [-7.85, -12.4], [-5.6, -13.0], [-1.55, -13.0]], 0.42, M.gravel, 0.01, 1.2);
  path(K, [[8.55, -2.25], [8.95, -4.3], [9.0, -10.4], [8.5, -12.45], [5.6, -13.0], [1.55, -13.0]], 0.42, M.gravel, 0.01, 1.2);
  // box hedges along the walks' road side; a flower strip under the east wing's windows
  if (ok(-8.95, -7.4, 0.2)) hedge(K, -8.95, -4.9, -8.95, -9.9);
  hedge(K, 9.67, -4.5, 9.67, -10.3);
  // flower strips under the east wing's windows, planted tall at the wall, low at the walk
  flowerBed(K, 8.05, -5.0, 0.7, 2.4, R, { front: [1, 0] });
  flowerBed(K, 8.05, -9.4, 0.7, 2.0, R, { front: [1, 0] });
  // low lamps along the walks, a bench on the east lawn
  for (const [x, z] of [[-7.62, -5.0], [-7.62, -10.6], [10.15, -5.6], [10.15, -9.4], [-4.2, -12.3], [4.2, -12.3]]) if (ok(x, z, 0.1)) bollard(K, x, z);
  if (ok(10.45, -8.6, 0.5)) { gardenBench(K, 10.45, -8.6, -Math.PI / 2); placed.push([10.45, -8.6, 0.5]); }
  // a flagstone path from the back walk out to a garden (cx, cz), stopping r short of its centre
  const spurTo = (cx, cz, r) => {
    const sx = Math.abs(cx) < 1.8 ? Math.sign(cx || 1) * 1.8 : Math.max(-5.4, Math.min(5.4, cx)), sz = -13.0;
    const L = Math.hypot(cx - sx, cz - sz); if (L < r + 0.3) return Math.atan2(sx - cx, sz - cz);
    const ux = (cx - sx) / L, uz = (cz - sz) / L;
    path(K, [[sx, sz - 0.2], [sx + ux * (L - r) * 0.5, sz + uz * (L - r) * 0.5], [cx - ux * (r - 0.15), cz - uz * (r - 0.15)]], 0.38, M.flag, 0.01, 1.4);
    return Math.atan2(-ux, -uz);                    // the garden's mouth: toward the walk
  };

  // ── behind: a sculpture garden round an ornamental pool ──
  const PR = 1.5, OUT = PR + 2.2;                   // pool radius, and the garden's reach
  // (its spot comes from town.js planMuseumGarden, which levelled a terrace for it there)
  const pool = poolAt && free(poolAt[0], poolAt[1], OUT - 0.4) ? (placed.push([poolAt[0], poolAt[1], OUT]), poolAt) : null;
  if (pool) {
    const [PX, PZ] = pool;
    const mouth = spurTo(PX, PZ, PR + 1.3);
    lay(K, new THREE.RingGeometry(PR + 0.55, PR + 1.3, 64, 1), M.edge, PX, 0.002, PZ, 1.4);
    lay(K, new THREE.RingGeometry(PR + 0.62, PR + 1.23, 64, 1), M.flag, PX, 0.01, PZ, 1.4);
    K.put(lathe([[PR - 0.04, 0], [PR + 0.24, 0], [PR + 0.26, 0.26], [PR + 0.14, 0.32], [PR - 0.05, 0.3], [PR - 0.06, 0.05]], 56), M.stone, PX, 0, PZ);
    lay(K, new THREE.CircleGeometry(PR, 48), M.water, PX, 0.2, PZ);
    K.put(lathe([[0.001, 0], [0.3, 0], [0.32, 0.31], [0.16, 0.41], [0.12, 0.77], [0.28, 0.85], [0.001, 0.89]], 18), M.stone, PX, 0, PZ);   // stands on the basin floor
    for (let k = 0; k < 6; k++) {                                       // the jet's splash
      const a = k / 6 * Math.PI * 2;
      K.put(new THREE.SphereGeometry(0.07, 8, 6), paint(0xd8eef0, { hatch: 0 }), PX + Math.sin(a) * 0.2, 0.84 + (k % 2) * 0.07, PZ + Math.cos(a) * 0.2).userData.noInk = true;
    }
    for (let k = 0; k < 6; k++) {                                        // lily pads
      const a = R() * Math.PI * 2, r = 0.55 + R() * 0.7;
      const g = new THREE.CircleGeometry(0.13 + R() * 0.05, 12, 0.3, Math.PI * 2 - 0.6); g.rotateZ(R() * 6);
      lay(K, g, paint(0x6f9a5a, { hatch: 0 }), PX + Math.sin(a) * r, 0.21, PZ + Math.cos(a) * r);
    }
    K.foot(PX, PZ, PR + 0.3);
    // three sculptures on plinths round the far side of the ring, benches and topiary either side
    const plinth = (x, z) => { K.box(0.62, 0.66, 0.62, M.stone, x, 0.27, z, 0.05); K.box(0.74, 0.08, 0.74, M.stoneD, x, 0.64, z, 0.03); K.foot(x, z, 0.45); };
    const ring = PR + 1.85, at = (a) => [PX + Math.sin(a) * ring, PZ + Math.cos(a) * ring];
    { const [x, z] = at(mouth + 1.4); plinth(x, z);                          // three balanced pebbles
      for (const [y, r] of [[0.84, 0.24], [1.14, 0.19], [1.38, 0.13]]) K.put(new THREE.SphereGeometry(r, 16, 12).scale(1.25, 0.72, 1), M.stoneD, x + (y - 1.1) * 0.12, y, z); }
    { const [x, z] = at(mouth + Math.PI); plinth(x, z);                      // a bronze ring, on edge
      K.put(new THREE.TorusGeometry(0.32, 0.085, 12, 32), M.bronze, x, 1.02, z, [0, mouth, 0]); }
    { const [x, z] = at(mouth - 1.4); plinth(x, z);                          // a patina head, gazing at the pool
      K.put(lathe([[0.001, 0], [0.15, 0], [0.12, 0.12], [0.08, 0.2], [0.001, 0.22]], 16), M.patina, x, 0.68, z);
      K.put(new THREE.SphereGeometry(0.22, 18, 14).scale(0.85, 1.1, 0.95), M.patina, x, 1.06, z); }
    for (const da of [2.3, -2.3]) { const a = mouth + da, x = PX + Math.sin(a) * (PR + 1.75), z = PZ + Math.cos(a) * (PR + 1.75); gardenBench(K, x, z, a + Math.PI); }
    for (const da of [0.6, -0.6]) { const a = mouth + da; topiary(K, PX + Math.sin(a) * (PR + 1.7), PZ + Math.cos(a) * (PR + 1.7), 0.85, da > 0 ? 'spiral' : 'cone'); }
  }

  // (the four-bed garden square that used to sit behind here is now Makers' Row's centrepiece)
  // trees round the back lawn and the east lawn, wherever they fit
  let n = 0;
  for (const [x, z, s] of [[10.85, -9.95, 0.7], [11.8, -11.3, 0.9], [12.0, -15.0, 0.85], [3.4, -20.4, 0.95], [-5.4, -19.5, 0.75], [-1.9, -21.2, 0.8], [1.2, -23.0, 0.9], [9.6, -19.6, 0.8], [-2.6, -15.6, 0.7]]) {
    if (n >= 6 || !spot(x, z, 0.8)) continue;
    specimen(K, x, z, s, R); placed.push([x, z, 0.8]); n++;
  }
  K.g.userData.keep = placed;                       // what it took ([x, z, r]): the shops' planting keeps off it
  return K.g;
}

// ── a project shop's cobbled approach (shop frame: the shop spans x ±2.8, z ±2.3, its door
// and stoop at +z). A cobbled forecourt across the front, a cobbled lane from it out to
// where the spur road now stops (ex, ez — or none), edging stones, planters, a lamp and a
// bench, and planting round the shop. ok(x, z, r) says a spot is free in the world (no
// road, water or anything solid); `shop` is the shop's raw groups, so nothing lands on
// its own props outside ──
export const APPROACH_STOP = 6.2;          // the spur stops this far from the shop's centre
export function shopApproach({ ex = null, ez = null, ok = () => true, shop = [], seed = 1 } = {}) {
  const K = kit(), M = mats(), R = rng(7919 * seed + 11);
  // the shop's own outside props, as occupied half-metre cells
  const busy = new Set(), v = new THREE.Vector3();
  for (const g of shop) {
    g.updateMatrixWorld(true);
    g.traverse(m => {
      if (!m.isMesh) return;
      const P = m.geometry.attributes.position;
      for (let i = 0; i < P.count; i += 3) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
        if (Math.abs(v.x) < 3.0 && v.z > -2.5 && v.z < 2.5) continue;
        busy.add(`${Math.round(v.x * 2)},${Math.round(v.z * 2)}`);
      }
    });
  }
  const placed = [];
  const clear = (x, z, r, { onPlaza = false } = {}) => {
    for (let i = Math.round((x - r) * 2); i <= Math.round((x + r) * 2); i++)
      for (let k = Math.round((z - r) * 2); k <= Math.round((z + r) * 2); k++) if (busy.has(`${i},${k}`)) return false;
    if (Math.abs(x) < 3.0 + r && z > -2.5 - r && z < 2.5 + r) return false;                 // the shop itself
    if (!onPlaza && inPaving(x, z, r)) return false;
    if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + r + 0.1)) return false;
    return ok(x, z, r);
  };
  const take = (x, z, r) => placed.push([x, z, r]);

  // the forecourt: a cobbled apron across the shopfront, rounded at its outer corners
  const FX = 3.45, Z0 = 2.3, Z1 = 5.1, CR = 1.5;
  const sh = new THREE.Shape();                    // drawn in (x, -z): lay() turns it flat
  sh.moveTo(-FX, -Z0); sh.lineTo(FX, -Z0); sh.lineTo(FX, -(Z1 - CR)); sh.quadraticCurveTo(FX, -Z1, FX - CR, -Z1);
  sh.lineTo(-FX + CR, -Z1); sh.quadraticCurveTo(-FX, -Z1, -FX, -(Z1 - CR)); sh.closePath();
  const outline = sh.getSpacedPoints(80).map(p => [p.x, -p.y]);
  lay(K, new THREE.ShapeGeometry(sh, 12), M.cobble, 0, 0.01, 0, 1.1);
  // the lane: from the forecourt's edge nearest the road's end, out to just under it
  let lane = null;
  if (ex != null) {
    let best = outline[0];
    for (const p of outline) if (p[1] > Z0 + 0.4 && Math.hypot(p[0] - ex, p[1] - ez) < Math.hypot(best[0] - ex, best[1] - ez)) best = p;
    const L = Math.hypot(ex - best[0], ez - best[1]);
    if (L > 0.5) {
      const dx = (ex - best[0]) / L, dz = (ez - best[1]) / L;
      const a = [best[0] - dx * 0.8, best[1] - dz * 0.8], e = [ex + dx * 0.5, ez + dz * 0.5];
      const pts = [a, [best[0] + dx * L * 0.35, best[1] + dz * L * 0.35], e];
      strip(K, pts, 1.05, M.edge, 0.002, 1.1);
      strip(K, pts, 0.98, M.cobble, 0.01, 1.1);
      lane = { ax: best[0], az: best[1], ex, ez };
    }
  }
  // paving test (forecourt or lane), for keeping plants off it
  function inPaving(x, z, r) {
    if (Math.abs(x) < FX + r && z > Z0 - r && z < Z1 + r) return true;
    if (lane) {
      const qx = lane.ex - lane.ax, qz = lane.ez - lane.az, t = Math.max(0, Math.min(1, ((x - lane.ax) * qx + (z - lane.az) * qz) / (qx * qx + qz * qz)));
      if (Math.hypot(x - lane.ax - qx * t, z - lane.az - qz * t) < 1.05 + r) return true;
    }
    return false;
  }
  // edging stones round the forecourt's outer edge (not along the shopfront, not across the lane)
  for (let i = 0; i < outline.length; i += 2) {
    const [x, z] = outline[i], [nx, nz] = outline[(i + 1) % outline.length];
    if (z < Z0 + 0.15) continue;
    if (lane && Math.hypot(x - lane.ax, z - lane.az) < 1.15) continue;
    K.put(rbox(0.28, 0.12, 0.16, 0.04, 1), M.stoneD, x, 0.03, z, [0, Math.atan2(nx - x, nz - z), 0]);
  }
  // planters at the forecourt's back corners, a lamp and a bench on it
  const planter = (x, z) => { trough(K, x, z, R, { front: [0, 1] }); take(x, z, 0.4); };
  for (const s of [-1, 1]) for (const [x, z] of [[s * 3.05, 2.85], [s * 2.95, 4.35]]) if (clear(x, z, 0.4, { onPlaza: true })) { planter(x, z); break; }
  const laneSide = lane ? Math.sign(lane.ax || 1) : 1;
  for (const [x, z] of [[laneSide * -2.3, 4.75], [laneSide * 2.3, 4.75], [laneSide * -1.8, 4.75]]) if (clear(x, z, 0.12, { onPlaza: true })) { bollard(K, x, z, 1.15); take(x, z, 0.12); break; }
  for (const [x, z] of [[laneSide * 1.75, 4.5], [laneSide * -1.75, 4.5]]) if (clear(x, z, 0.5, { onPlaza: true })) { gardenBench(K, x, z, Math.PI); take(x, z, 0.5); break; }
  // planting round the shop: trees at the sides and back, bushes and a bed or two
  let trees = 0;
  for (const [x, z, s] of [[-4.5, -1.2, 0.85], [4.5, -1.4, 0.8], [-3.6, -3.6, 0.95], [3.8, -3.5, 0.85], [0.4, -4.3, 1.0], [-4.9, 1.5, 0.75], [4.9, 1.3, 0.8], [-1.9, -4.4, 0.8]]) {
    if (trees >= 5 || !clear(x, z, 0.8)) continue;
    specimen(K, x, z, s, R); take(x, z, 0.8); trees++;
  }
  for (const [x, z] of [[-3.75, 1.9], [3.75, 1.9], [-3.6, 0.2], [3.6, 0.2], [-2.6, -3.0], [2.6, -3.0]]) {
    if (!clear(x, z, 0.4)) continue;
    shrub(K, x, z, R); take(x, z, 0.4);
  }
  for (const [x, z, w, d] of [[-4.2, 3.4, 0.9, 1.3], [4.2, 3.4, 0.9, 1.3]]) {
    if (!clear(x, z, 0.75)) continue;
    flowerBed(K, x, z, w, d, R, { front: [-Math.sign(x), 0] }); K.foot(x, z, 0.65); take(x, z, 0.75);
  }
  return K.g;
}

// ── Makers' Row: Behavior Search and Borrowed Eyes side by side, sharing a level cobbled
// car park (row frame, like a shop's: +z toward the road, the shops at x ±ROW_X, z 0). An
// apron in front of both shopfronts; a garden square of four planted beds round a cross in
// the middle (the car park's centrepiece, walkway from the aisle to the shops); two bays
// either side of it, nose-in, painted lines and wheel stops; a cobbled aisle across the
// front; a lane out to where the spur stops (ex, ez). userData.row.bays tells plaza.js
// where to park cars ──
export const ROW_X = 6.0;          // Behavior Search's ramp and drop rig stand 1.7 out from its walls: room for them in the gap
export const ROW_MOUTH_LAP = 0.08;   // the row's spur ends this far in under the car park's front edge (no gap, no seam)
export const ROW_ROAD_HALF = 0.85;   // that spur's carriageway half-width (town.js spur(): buildRoad half)
export const ROW = { half: 9.4, apron: [2.3, 4.25], bays: [4.25, 7.55], aisle: [7.55, 10.7] };
export function makersRow({ ex = null, ez = null, ok = () => true, seed = 3 } = {}) {
  const K = kit(), M = mats(), R = rng(seed * 104729);
  const H = ROW.half, Z0 = ROW.apron[0], Z1 = ROW.aisle[1], CR = 1.6;
  // the whole lot: one cobbled slab, rounded at its road-side corners
  const sh = new THREE.Shape();
  sh.moveTo(-H, -Z0); sh.lineTo(H, -Z0); sh.lineTo(H, -(Z1 - CR)); sh.quadraticCurveTo(H, -Z1, H - CR, -Z1);
  sh.lineTo(-H + CR, -Z1); sh.quadraticCurveTo(-H, -Z1, -H, -(Z1 - CR)); sh.closePath();
  const outline = sh.getSpacedPoints(120).map(p => [p.x, -p.y]);
  lay(K, new THREE.ShapeGeometry(sh, 16), M.cobble, 0, 0.01, 0, 1.1);
  // painted bay lines (thin pale strips on the cobbles) and a wheel stop in each bay
  const line = (() => { const m = paint(0xf3eee4, { hatch: 0, side: THREE.DoubleSide }); m.polygonOffset = true; m.polygonOffsetFactor = m.polygonOffsetUnits = -5; return m; })();
  const [B0, B1] = ROW.bays, bays = [];
  for (const s of [-1, 1]) {
    const xs = [2.35, 4.95, 7.55].map(x => s * x);                // two bays a side, 2.6 wide
    for (const x of xs) lay(K, new THREE.PlaneGeometry(0.07, B1 - B0 - 0.3), line, x, 0.014, (B0 + B1) / 2 + 0.15);
    lay(K, new THREE.PlaneGeometry(5.2, 0.07), line, s * 4.95, 0.014, B1 - 0.02);
    for (const i of [0, 1]) {
      const bx = (xs[i] + xs[i + 1]) / 2, stopZ = B0 + 0.45;
      K.put(rbox(1.2, 0.16, 0.2, 0.05, 1), M.stoneD, bx, 0.03, stopZ);
      bays.push({ x: bx, stopZ, side: s });
    }
  }
  // the garden square: four planted beds round a flagstone cross, a lamp at its heart
  const GX = 0, GZ = (B0 + B1) / 2 + 0.1, GW = 1.9;
  lay(K, new THREE.PlaneGeometry(0.62, GW * 2 + 0.3), M.flag, GX, 0.011, GZ, 1.4);
  lay(K, new THREE.PlaneGeometry(GW * 2 + 0.1, 0.62), M.flag, GX, 0.012, GZ, 1.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const bx = GX + sx * 0.98, bz = GZ + sz * 0.98;
    islandBed(K, bx, bz, 1.2, R);
    K.foot(bx, bz, 0.66);
  }
  bollard(K, GX, GZ, 1.25);                                        // a lamp at the cross's heart
  // kerb stones round the lot's outer edge (not along the shopfronts, not across the road's mouth)
  // The spur (town.js) now runs right up to the lot's front edge and ROW_MOUTH_LAP under it, so
  // the entrance is the road itself: no separate cobble tongue (it was wider than the road, off
  // its line, and z-fought the slab). The edging stops either side of the carriageway + its kerb
  // bands, and a stone set along the edge at each kerb's end turns the road's kerbs into it.
  let mouth = null, lane = null;
  if (ex != null) {
    let best = outline[0];
    for (const p of outline) if (p[1] > Z0 + 1 && Math.hypot(p[0] - ex, p[1] - ez) < Math.hypot(best[0] - ex, best[1] - ez)) best = p;
    const L = Math.hypot(ex - best[0], ez - best[1]);
    if (L < ROW_MOUTH_LAP + 0.4) mouth = { x: ex, z: best[1] };
    else {                                       // (fallback: the spur couldn't reach — a lane out to it, as before)
      const dx = (ex - best[0]) / L, dz = (ez - best[1]) / L;
      const pts = [[best[0] - dx * 0.8, best[1] - dz * 0.8], [best[0] + dx * L * 0.4, best[1] + dz * L * 0.4], [ex + dx * 0.5, ez + dz * 0.5]];
      strip(K, pts, 1.42, M.edge, 0.002, 1.1);
      strip(K, pts, 1.35, M.cobble, 0.01, 1.1);
      lane = { ax: best[0], az: best[1] };
    }
  }
  const MH = ROW_ROAD_HALF + 0.28 + 0.08;        // the road's carriageway + kerb band (world.js buildRoad), + half a stone (set crosswise, as round the lot)
  for (let i = 0; i < outline.length; i += 2) {
    const [x, z] = outline[i], [nx, nz] = outline[(i + 1) % outline.length];
    if (z < Z0 + 0.15) continue;
    if (lane && Math.hypot(x - lane.ax, z - lane.az) < 1.5) continue;
    if (mouth && Math.hypot(x - mouth.x, z - mouth.z) < MH + 0.3) continue;
    K.put(rbox(0.28, 0.12, 0.16, 0.04, 1), M.stoneD, x, 0.03, z, [0, Math.atan2(nx - x, nz - z), 0]);
  }
  if (mouth) for (const s of [-1, 1]) K.put(rbox(0.28, 0.12, 0.16, 0.04, 1), M.stoneD, mouth.x + s * MH, 0.03, mouth.z, [0, Math.PI / 2, 0]);
  // the apron: lamps between the shops and at its ends, planters, a bench in the gap
  for (const x of [-H + 0.35, H - 0.35]) bollard(K, x, Z0 + 0.5, 1.2);
  for (const x of [-1.6, 1.6]) {
    trough(K, x, Z0 + 0.55, R, { front: [0, 1] });
  }
  gardenBench(K, 0, 0.9, 0);                                         // in the gap between the shops
  // planting: trees behind and beside the shops, bushes and beds round the lot's sides
  const placed = [];
  const take = (x, z, r) => { if (!ok(x, z, r) || placed.some(([a, b, c]) => Math.hypot(a - x, b - z) < c + r + 0.1)) return false; placed.push([x, z, r]); return true; };
  for (const [x, z, s] of [[-10.2, -1.0, 0.9], [10.2, -1.2, 0.85], [-7.4, -3.8, 1.0], [-2.0, -3.4, 0.85], [2.6, -3.5, 0.95], [7.6, -3.7, 0.9], [-10.6, 3.0, 0.8], [10.6, 3.2, 0.8]])
    if (take(x, z, 0.8)) specimen(K, x, z, s, R);
  for (const [x, z] of [[-10.5, 6.0], [10.5, 6.0], [-10.4, 8.8], [10.4, 8.8], [0, -1.6]]) if (take(x, z, 0.4)) shrub(K, x, z, R);
  K.g.userData.row = { bays, half: H, z0: Z0, z1: Z1 };
  return K.g;
}
// (dev: the grounding check reads which materials are draped surfaces / water)
export function groundsMats() { return mats(); }
