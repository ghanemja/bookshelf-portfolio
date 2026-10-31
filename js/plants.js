// ─── PLANTS: real cartoon planting, in a slight breeze ──────────────────────────
// Flowers with stems and leaves (tulips, daisies, cosmos, lavender and salvia spikes),
// mounding shrubs of leaf clusters, flowering bushes, ornamental grasses, trailing plants
// that spill over a trough's edge, clipped topiary (cones, spirals, balls) and trees of a
// few kinds (blossom, birch, maple in autumn tones, cypress, a round shade tree).
//
// A builder lists plants as instances — { k: kind, x, z, y, s, ry } in its own frame — in
// userData.plants. Once that group is placed, growPlants(group) seats every instance on the
// ground AS DRAWN under it (world.js drawnGroundAt, + y for one standing in a bed or
// planter), builds it, and merges the lot into one mesh per material (and its outline).
// Each vertex carries a `sway` weight (0 at the root, growing with height); the materials'
// vertex shader nods everything gently in a shared breeze (style.js uTime) — no per-plant JS.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, inkUniforms } from './style.js';
import { drawnGroundAt } from './world.js';

const rng = (s) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

// ── the breeze: a shared vertex-shader nod, its strength per vertex in `sway` (world units) ──
const BREEZE = /* glsl */`
  attribute float sway;
  uniform float uTime;
  vec3 breeze(vec3 p) {
    vec3 up = normalize(p);
    vec3 wind = normalize(cross(up, vec3(0.31, 0.95, 0.17)));
    float ph = dot(p, vec3(0.83, 0.57, 0.71));
    float gust = 0.65 + 0.35 * sin(uTime * 0.37 + ph * 0.11);
    float w = sin(uTime * 1.55 + ph) + 0.33 * sin(uTime * 4.1 + ph * 2.3);
    return wind * sway * w * gust + cross(up, wind) * sway * 0.35 * sin(uTime * 2.2 + ph * 1.7);
  }`;
const _mats = new Map();
function mat(color) {
  if (_mats.has(color)) return _mats.get(color);
  const m = paint(color, { unique: true, soft: true });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.uniforms.uTime = inkUniforms.uTime;
    sh.vertexShader = BREEZE + '\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += breeze(position);');
  };
  m.customProgramCacheKey = () => 'paper-sway' + (m.userData.hatch > 0 ? 'h' : '');
  _mats.set(color, m);
  return m;
}
// the outline sways with its plant (the town's ink, plus the same nod)
let _ink = null;
function swayInk() {
  if (_ink) return _ink;
  _ink = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { ...inkUniforms, uWeight: { value: 0.62 }, uColor: { value: new THREE.Color(0x2a2230) } },
    // BREEZE declares (and its breeze() uses) uTime, so it comes first and the ink's own
    // line no longer repeats it: GLSL needs a uniform declared before the function that reads it
    vertexShader: BREEZE + /* glsl */`
      uniform float uWidth, uWeight; uniform vec2 uRes;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 pos = position + breeze(position);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        vec3 nv = normalize(normalMatrix * normal);
        vec2 n2 = normalize((projectionMatrix * vec4(nv, 0.0)).xy + 1e-5);
        float tick = floor(uTime * 4.0);
        float along = h(floor(position * 2.5) + 0.37);
        float boil = h(position * 7.0 + tick) - 0.5;
        float w = uWidth * uWeight * (0.8 + 0.45 * along + 0.12 * boil);
        clip.xy += n2 * w * 2.0 / uRes * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  });
  return _ink;
}

// ── colours ──
const C = {
  stem: 0x5f8a4e, leaf: 0x6f9a5a, leafD: 0x4f7a44, leafL: 0x93b86c, leafY: 0xa9bf62,
  grass: 0xb4bf72, grassG: 0xd2b866, grassD: 0x7f9a58,
  red: 0xe8604c, yellow: 0xf2c14e, pink: 0xf2a0b4, white: 0xf6eedb, purple: 0x8f7ae8, lav: 0x9c8ad8,
  blue: 0x6676d6, magenta: 0xd8508a, orange: 0xf29a4a, coral: 0xf27a6a, centre: 0xe9a93a,
  blossom: 0xf4b6c8, blossomW: 0xfbeef0, mapleA: 0xe0703a, mapleB: 0xc9493a, mapleC: 0xefa548,
  birch: 0xf2efe6, birchMark: 0x3a3340, cypress: 0x3f6b46, bark: 0x8a5a3c, barkD: 0x6f4a33, box: 0x557f47,
};

// ── geometry helpers (all in a plant's own frame: y up from its root) ──
const _sphere = new THREE.IcosahedronGeometry(1, 2);
const _sphereLo = new THREE.IcosahedronGeometry(1, 1);
function ball(r, x, y, z, sy = 1, lo = false) { return (lo ? _sphereLo : _sphere).clone().scale(r, r * sy, r).translate(x, y, z); }
function lathe(pts, seg = 10) { return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg); }
// a stem: a thin tapered tube up a gentle curve
function stem(h, r = 0.012, bend = 0.04, ang = 0, seg = 5) {
  const pts = []; for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push(new THREE.Vector3(Math.sin(ang) * bend * t * t, h * t, Math.cos(ang) * bend * t * t)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 5, false);
}
function stemTop(h, bend = 0.04, ang = 0) { return new THREE.Vector3(Math.sin(ang) * bend, h, Math.cos(ang) * bend); }
// a leaf blade: a flattened lens shape, standing out from the stem at an angle
function blade(len, wid, ang, tilt = 0.5, y = 0.02, thick = 0.012) {
  const g = new THREE.SphereGeometry(1, 8, 5).scale(wid, len / 2, thick).translate(0, len / 2, 0);
  g.rotateX(tilt); g.rotateY(ang); g.translate(0, y, 0);
  return g;
}
// a grass blade: an arching tapered ribbon (two-sided)
function grassBlade(len, wid, ang, arch) {
  const pos = [], idx = [], N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N, w = wid * (1 - t * 0.92), out = arch * t * t * len, up = len * (t - 0.35 * arch * t * t);
    pos.push(-w / 2, up, out, w / 2, up, out);
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals(); g.rotateY(ang);
  return g;
}
// a flower head of n petals round a centre, facing up (tilted a little)
function petals(n, len, wid, cupped, col, centreCol, at, tilt, out) {
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const p = new THREE.SphereGeometry(1, 8, 4).scale(wid, 0.012, len / 2).translate(0, 0, len / 2);
    p.rotateX(-cupped); p.rotateY(a); p.rotateX(tilt); p.translate(at.x, at.y, at.z);
    out(col, p);
  }
  if (centreCol != null) out(centreCol, ball(len * 0.32, at.x, at.y + 0.01, at.z, 0.6).rotateX(0));
}

// ── the plants: each pushes (colour, geometry) pairs through out() ──
const KINDS = {
  // a tulip: a cupped head of six petals on a stem, two long leaves
  tulip(R, out, s, o) {
    const h = (0.32 + R() * 0.12) * s, ang = R() * 6;
    out(C.stem, stem(h, 0.011 * s, 0.03 * s, ang));
    const top = stemTop(h, 0.03 * s, ang), col = o.c ?? [C.red, C.yellow, C.pink, C.white, C.purple, C.coral][Math.floor(R() * 6)];
    out(col, lathe([[0.001, 0], [0.04, 0.01], [0.055, 0.05], [0.05, 0.09], [0.035, 0.11], [0.032, 0.095], [0.04, 0.06], [0.001, 0.02]].map(([x, y]) => [x * s, y * s]), 10).translate(top.x, top.y - 0.01 * s, top.z));
    for (const a of [ang + 1.2, ang + 4.1]) out(C.leaf, blade(0.2 * s, 0.035 * s, a, 0.35, 0));
  },
  // a daisy: a flat ring of white (or pink) petals and a golden middle, on a thin stem
  daisy(R, out, s, o) {
    const h = (0.2 + R() * 0.1) * s, ang = R() * 6;
    out(C.stem, stem(h, 0.008 * s, 0.03 * s, ang));
    petals(10, 0.06 * s, 0.016 * s, 0.15, o.c ?? (R() > 0.75 ? C.pink : C.white), C.centre, stemTop(h, 0.03 * s, ang), 0.25, out);
    out(C.leaf, blade(0.1 * s, 0.03 * s, ang + 2, 0.9, 0));
  },
  // cosmos: tall and airy, a big open flower of eight petals
  cosmos(R, out, s, o) {
    const h = (0.48 + R() * 0.18) * s, ang = R() * 6;
    out(C.stem, stem(h, 0.008 * s, 0.07 * s, ang));
    petals(8, 0.075 * s, 0.03 * s, 0.25, o.c ?? [C.magenta, C.pink, C.white][Math.floor(R() * 3)], C.centre, stemTop(h, 0.07 * s, ang), 0.35, out);
    for (const a of [ang + 1, ang + 3.4]) out(C.leafL, blade(0.12 * s, 0.018 * s, a, 0.7, h * 0.4));
  },
  // a clump of spikes (lavender, or salvia in blue / red), from a small leafy base
  spikes(R, out, s, o) {
    const col = o.c ?? C.lav, n = 5 + Math.floor(R() * 3);
    for (let i = 0; i < 5; i++) out(i % 2 ? C.leaf : C.leafD, blade(0.12 * s, 0.03 * s, i * 1.26 + R(), 0.85, 0));
    for (let i = 0; i < n; i++) {
      const ang = i / n * 6.28 + R() * 0.5, lean = 0.06 + R() * 0.08, h = (0.3 + R() * 0.14) * s;
      out(C.stem, stem(h, 0.006 * s, lean * s, ang, 4));
      for (let k = 0; k < 7; k++) {
        const t = 0.55 + k * 0.065, r = (0.026 - k * 0.0025) * s;
        out(col, ball(r, Math.sin(ang) * lean * s * t * t, h * t, Math.cos(ang) * lean * s * t * t, 1.15, true));
      }
    }
  },
  // a mounding shrub: overlapping leaf clusters, darker inside, lighter on top
  mound(R, out, s, o) {
    const n = 7 + Math.floor(R() * 4), col = o.c ?? C.leaf;
    out(C.leafD, ball(0.26 * s, 0, 0.12 * s, 0, 0.75));
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.28 + R(), r = (0.12 + R() * 0.07) * s, d = (0.14 + R() * 0.08) * s;
      out(i % 3 ? col : C.leafL, ball(r, Math.sin(a) * d, (0.16 + R() * 0.12) * s, Math.cos(a) * d, 0.8, true));
    }
    out(C.leafL, ball(0.12 * s, 0, 0.32 * s, 0, 0.75, true));
  },
  // a flowering bush: a mound covered in small blossoms
  bloom(R, out, s, o) {
    KINDS.mound(R, out, s, { c: C.leaf });
    const col = o.c ?? [C.pink, C.white, C.purple, C.magenta][Math.floor(R() * 4)];
    for (let i = 0; i < 16; i++) {
      const a = R() * 6.28, el = 0.25 + R() * 1.1, r = 0.27 * s;
      out(col, ball(0.035 * s, Math.sin(a) * Math.cos(el) * r, 0.17 * s + Math.sin(el) * r * 0.8, Math.cos(a) * Math.cos(el) * r, 0.7, true));
    }
  },
  // an ornamental grass: a fountain of arching blades, green with golden tips
  grass(R, out, s, o) {
    const n = 14 + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) out(R() > 0.4 ? (o.c ?? C.grass) : C.grassG, grassBlade((0.38 + R() * 0.2) * s, 0.03 * s, R() * 6.28, 0.55 + R() * 0.5));
  },
  // a trailing plant: leaves on stems spilling out over an edge (toward +z), small flowers
  trail(R, out, s, o) {
    const col = o.c ?? [C.purple, C.white, C.coral][Math.floor(R() * 3)];
    for (let i = 0; i < 4; i++) out(C.leaf, blade(0.1 * s, 0.035 * s, i * 1.57 + R(), 1.05, 0.01 * s));
    for (let i = 0; i < 6; i++) {
      const sp = (i - 2.5) * 0.18, pts = [];
      for (let t = 0; t <= 1.001; t += 0.25) pts.push(new THREE.Vector3(Math.sin(sp) * 0.12 * t * s, (0.06 - 0.32 * t * t) * s + 0.05 * s * t, (0.04 + 0.2 * t) * s * Math.cos(sp)));
      const cur = new THREE.CatmullRomCurve3(pts);
      out(C.stem, new THREE.TubeGeometry(cur, 6, 0.007 * s, 4, false));
      for (let k = 1; k <= 4; k++) { const p = cur.getPointAt(k / 4.4); out(k === 4 ? col : C.leafL, ball((k === 4 ? 0.03 : 0.028) * s, p.x, p.y, p.z, 0.6, true)); }
    }
  },
  // clipped topiary: a cone, a spiral (a coil round a cone), or a ball on a stem
  cone(R, out, s) { out(C.box, lathe([[0.001, 0], [0.28, 0.06], [0.24, 0.5], [0.12, 0.95], [0.03, 1.12], [0.001, 1.15]].map(([x, y]) => [x * s, y * s]), 16)); },
  spiral(R, out, s) {
    const pts = []; for (let t = 0; t <= 1.0001; t += 0.02) { const r = (0.27 - 0.21 * t) * s; pts.push(new THREE.Vector3(Math.sin(t * 19) * r, (0.08 + 1.05 * t) * s, Math.cos(t * 19) * r)); }
    out(C.box, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.075 * s, 8, false));
    out(C.box, lathe([[0.001, 0], [0.07, 0], [0.05, 1.1], [0.001, 1.15]].map(([x, y]) => [x * s, y * s]), 8));
  },
  // a small clipped box ball, for edging a bed
  boxBall(R, out, s) { out(C.box, ball(0.1 * s, 0, 0.08 * s, 0, 0.85)); },
  ballTop(R, out, s) { out(C.barkD, lathe([[0.001, 0], [0.03, 0], [0.025, 0.7], [0.001, 0.72]].map(([x, y]) => [x * s, y * s]), 8)); out(C.box, ball(0.26 * s, 0, 0.86 * s, 0)); },

  // ── trees ──
  blossom(R, out, s) {
    out(C.bark, trunk(s, 1.0, 0.13));
    for (const [x, y, z, r] of [[0, 1.45, 0, 0.6], [0.42, 1.3, 0.12, 0.42], [-0.4, 1.35, -0.1, 0.45], [0.1, 1.82, -0.05, 0.4], [-0.15, 1.2, 0.38, 0.36]])
      out(R() > 0.3 ? C.blossom : C.blossomW, ball(r * s, x * s, y * s, z * s, 0.9));
  },
  birch(R, out, s) {
    const h = 1.9 * s;
    out(C.birch, lathe([[0.001, 0], [0.09, 0], [0.07, 0.4], [0.055, h * 0.7], [0.03, h], [0.001, h + 0.02]].map(([x, y]) => [x * s / s * (x > 0.01 ? s : 1), y]), 10));
    for (let i = 0; i < 6; i++) { const y = (0.25 + i * 0.22) * s, a = R() * 6; out(C.birchMark, new THREE.BoxGeometry(0.05 * s, 0.018 * s, 0.02 * s).translate(0, 0, 0.068 * s).rotateY(a).translate(0, y, 0)); }
    for (const [x, y, z, r] of [[0.1, 1.55, 0, 0.38], [-0.25, 1.35, 0.1, 0.3], [0.25, 1.2, -0.15, 0.28], [0, 1.95, 0.05, 0.3], [-0.1, 1.7, -0.25, 0.27]])
      out(R() > 0.5 ? C.leafY : C.leafL, ball(r * s, x * s, y * s, z * s, 0.85, true));
  },
  maple(R, out, s) {
    out(C.barkD, trunk(s, 0.95, 0.15));
    for (const [x, y, z, r] of [[0, 1.5, 0, 0.66], [0.48, 1.3, 0.15, 0.46], [-0.46, 1.32, -0.12, 0.5], [0.12, 1.92, -0.06, 0.44], [-0.2, 1.25, 0.45, 0.4]])
      out([C.mapleA, C.mapleB, C.mapleC][Math.floor(R() * 3)], ball(r * s, x * s, y * s, z * s, 0.88));
  },
  cypress(R, out, s) {
    out(C.barkD, lathe([[0.001, 0], [0.08, 0], [0.06, 0.3], [0.001, 0.32]].map(([x, y]) => [x * s, y * s]), 8));
    out(C.cypress, lathe([[0.001, 0.15], [0.26, 0.35], [0.31, 0.9], [0.26, 1.6], [0.15, 2.15], [0.05, 2.45], [0.001, 2.5]].map(([x, y]) => [x * s, y * s]), 14));
  },
  shade(R, out, s) {
    out(C.bark, trunk(s, 1.05, 0.15));
    for (const [x, y, z, r] of [[0, 1.5, 0, 0.66], [0.44, 1.3, 0.12, 0.46], [-0.4, 1.34, -0.14, 0.5], [0.08, 1.9, -0.05, 0.44]])
      out(R() > 0.5 ? C.leaf : C.leafL, ball(r * s, x * s, y * s, z * s, 0.9));
  },
};
function trunk(s, h, r) { return lathe([[0.001, 0], [r, 0], [r * 0.75, 0.45], [r * 0.6, h], [0.001, h + 0.05]].map(([x, y]) => [x * s, y * s]), 10); }
// how hard each kind nods at its top (world units), and its height for the weight curve
const SWAY = {
  tulip: 0.05, daisy: 0.045, cosmos: 0.08, spikes: 0.06, mound: 0.02, bloom: 0.022, grass: 0.1, trail: 0.03,
  cone: 0.008, spiral: 0.008, ballTop: 0.015, boxBall: 0.004, blossom: 0.05, birch: 0.07, maple: 0.05, cypress: 0.045, shade: 0.045,
};
export const TREE_KINDS = ['blossom', 'birch', 'maple', 'cypress', 'shade'];

// ── grow a placed group's planting ──
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _UP = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
export function growPlants(scene, group, { seed = 1 } = {}) {
  const list = group.userData.plants; if (!list?.length) return null;
  group.updateMatrixWorld(true);
  const buckets = new Map(), R = rng(seed * 7919 + list.length);
  for (const p of list) {
    const d = group.localToWorld(_v.set(p.x, 0, p.z)).clone().normalize();
    const base = d.clone().multiplyScalar(drawnGroundAt(d) + (p.y ?? 0) - 0.01);
    // stand up along the ground's normal direction (radial), turned ry about it
    _q.setFromUnitVectors(_UP, d); _q2.setFromAxisAngle(_UP, p.ry ?? R() * 6.28);
    _m.compose(base, _q.clone().multiply(_q2), new THREE.Vector3(1, 1, 1));
    const s = p.s ?? 1, top = SWAY[p.k] ?? 0.04, H = { blossom: 2.1, birch: 2.2, maple: 2.2, cypress: 2.5, shade: 2.2, cone: 1.15, spiral: 1.15, ballTop: 1.1 }[p.k] ?? 0.45;
    const pr = rng(Math.floor((p.x * 131 + p.z * 977 + seed * 13) * 1000) & 0x7fffffff || 7);
    KINDS[p.k](pr, (col, g) => {
      g = g.index ? g : g;                                         // (geometries are indexed or not: merged per colour as they come)
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
      if (!g.attributes.normal) g.computeVertexNormals();
      const pos = g.attributes.position, sw = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) { const t = Math.max(0, pos.getY(i)) / (H * s); sw[i] = top * Math.min(1.4, t * t * 1.2 + t * 0.2); }
      g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
      g.applyMatrix4(_m);
      const key = col, b = buckets.get(key);
      const gi = g.index ? g.toNonIndexed() : g;
      if (b) b.push(gi); else buckets.set(key, [gi]);
    }, s, p);
  }
  const out = new THREE.Group(); out.userData.plantsOf = group;
  for (const [col, geos] of buckets) {
    const geo = mergeGeometries(geos, false); if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat(col));
    m.userData.noInk = true;
    const line = new THREE.Mesh(geo, swayInk()); line.userData.isInk = true; line.renderOrder = -1; line.raycast = () => {};
    m.add(line);
    out.add(m);
  }
  scene.add(out);
  return out;
}
// the list a builder adds its plants to (kept on the group: it survives placeOnPlanet's bake)
export function plantsOf(g) { return (g.userData.plants ||= []); }
