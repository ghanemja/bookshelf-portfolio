// ─── THE NORTH: a river with a stone bridge, Riverbend Country Club, and a suburb ─────
// The top of the planet (north of the Library) was empty grass. Now:
//   • the Riverbend: a river carved across it (world.js addRiver) from a lake at the
//     mountain's foot to a lake north of the airport — reeds and stones along its banks;
//   • a stone arch bridge carrying a road over it, north from the boulevard;
//   • Riverbend Country Club: a clubhouse with a veranda, a pool (deck, loungers, umbrellas,
//     a diving board), a tennis court, a putting green and a car park;
//   • the driving range: a covered tee line, a ball machine, a striped field with yardage
//     boards and a catch net;
//   • Riverbend Close: a ring of houses with gardens, picket fences and driveways round a
//     loop road near the pole;
//   • its people (createNorthLife): two playing tennis, a swimmer doing lengths, a reader on
//     a lounger, a golfer at the tee line, two neighbours strolling the Close. Like the park's,
//     the car knocks them flying (bump-registered), and they're only drawn and animated near.
// Order: planNorth() runs inside planTown (water and reservations before the planet is shaped
// and before any road is laid); buildNorth() lays its roads and builds; createNorthLife() is
// called from main.js once the game is up.
import * as THREE from 'three';
import { R, ll, arc, slerpDir, frame, reserve, flatten, addRiver, addLake, radiusAt, surfH, isWater,
  settle, yawToFace, alignToSurface, addFloor, buildRoad, deflect, smooth, ROADS, onRoad, standAt, zoneHit, LOTS, decoBlocked } from './world.js';
import { PAL, paint, ink, mergeStatic } from './style.js';
import { kit, lathe, signMat, upperGlass, DARK, placeOnPlanet, batchPlaced, hipRoofFine } from './buildings.js';
import { tree, pine, bush, lamp, bench, rbox } from './props.js';
import { buildCar, fitToGround } from './player.js';
import { person } from './human.js';
import { poseFolk, STANCES } from './folk.js';
import { audio } from './audio.js';
import { buildRiverWater, createRiverLife } from './riverlife.js';

const L2 = (a) => ll(a[0], a[1]);
export const NORTH = {
  // (across the empty grass above the Library and the boulevard, where the title page shows it;
  // clear of the Library's plaza)
  river: [[53, -18], [53.5, -8], [54.2, 2], [53.2, 12], [51.2, 22], [50.2, 32], [50.6, 42], [49.6, 52], [48.6, 61], [48.2, 68]],
  lakes: [[53.2, -19.6, 3.4], [47.8, 69.6, 3.6]],
  half: 2.5, depth: 0.9,
  bridge: [51.2, 22], bridgeLen: 8.4, bridgeW: 2.3,
  junction: [65, 26],
  club: { at: [70, 4], r: 5.4 },
  range: { at: [68.5, 58], r: 5.0 },
  close: { at: [87, 120], loop: 4.0, ring: 6.4, r: 7.4, houses: 10 },
};

// ── 1. PLAN (inside planTown): the water, and the ground the club, range and Close need ──
let RIVER_P = null;                                          // the river's dense centre line (addRiver)
export function planNorth() {
  RIVER_P = addRiver(NORTH.river.map(L2), NORTH.half, NORTH.depth);
  for (const [la, lo, r] of NORTH.lakes) addLake(ll(la, lo), r, 1.0);
  for (const k of ['club', 'range', 'close']) {
    const s = NORTH[k], d = L2(s.at);
    reserve(d, s.r, 'north:' + k);
    flatten(d, s.r + 0.6, undefined, k === 'close' ? { blend: 6 } : { plane: d, blend: 6 });
  }
}

// ── small builders ──
const rng = (seed) => { let s = seed % 2147483646 + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
// a striped awning: alternating boards, tilted out from the wall (local +z out)
function awning(K, w, x, y, z, a = PAL.roofGreen, b = 0xf6eedb) {
  const S = K.sub(x, y, z); S.g.rotation.x = 0.42;
  const n = Math.max(3, Math.round(w / 0.16));
  for (let i = 0; i < n; i++) S.box(w / n + 0.004, 0.035, 0.42, paint(i % 2 ? b : a), -w / 2 + (i + 0.5) * w / n, 0, 0.21, 0.012);
  return S;
}
// a canvas texture (chain-link fence, net, yardage board)
function tex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'); draw(c, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const meshTex = tex(64, 64, (c, w, h) => {
  c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(42,34,48,0.85)'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
});
function netMat(rx, ry) {
  const t = meshTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: true });
  return m;
}

// ── the club pool's shape, shared by the deck, the coping and the water's shader: a kidney —
// an ellipse (POOL_A × POOL_B) whose radius wobbles with two slow waves ──
const POOL_A = 1.3, POOL_B = 0.85;
const poolR = (th) => 1 + 0.10 * Math.sin(2 * th + 0.5) + 0.08 * Math.sin(3 * th + 2.0);
// the edge point at angle th, grown outward by `grow` world units
function poolEdge(th, grow = 0) {
  const r = poolR(th), x = Math.cos(th) * r * POOL_A, z = Math.sin(th) * r * POOL_B, L = Math.hypot(x, z);
  return [x * (1 + grow / L), z * (1 + grow / L)];
}
function poolIn(x, z, grow = 0) {
  const th = Math.atan2(z / POOL_B, x / POOL_A), [ex, ez] = poolEdge(th, grow);
  return Math.hypot(x, z) < Math.hypot(ex, ez);
}
// footprints covering the water (so she walks round it, not across)
const POOL_FEET = [[-0.85, 0, 0.5], [-0.35, 0, 0.62], [0.2, 0, 0.66], [0.75, 0, 0.6], [1.15, 0.05, 0.35], [-0.2, 0.5, 0.35], [0.4, -0.55, 0.35]];

// ── the country club (local +z: toward the road it's entered from) ──
function countryClub() {
  const K = kit(), cream = paint(0xf3ead7), green = paint(0x3e6b52), trim = paint(0xfaf6ec), stone = paint(0xd8cab0);
  const glass = upperGlass(1), dark = DARK(), asphalt = paint(PAL.road, { hatch: 0 }), white = paint(0xf6eedb, { hatch: 0 });
  // the car park at the front
  // (deep enough for a car nose-in: they're 2.8 long)
  K.box(4.6, 0.05, 2.9, asphalt, -0.2, 0.025, 4.05, 0.02).userData.noInk = true;
  for (let i = 0; i <= 4; i++) K.flat(0.05, 1.3, white, -2.2 + i * 1.0, 0.055, 3.35, [-Math.PI / 2, 0, 0]);
  // the clubhouse: cream boards, a green hip roof, a veranda along the front
  const CX = -0.8, CZ = -1.65, W = 4.6, D = 2.1, H = 1.55;
  K.box(W + 0.12, 0.16, D + 0.12, stone, CX, 0.08, CZ, 0.04);
  K.box(W, H, D, cream, CX, 0.16 + H / 2, CZ, 0.05);
  for (let y = 0.4; y < H; y += 0.22) K.box(W + 0.02, 0.025, D + 0.02, trim, CX, 0.16 + y, CZ, 0.01);   // clapboard lines
  K.box(W + 0.2, 0.1, D + 0.2, trim, CX, 0.16 + H + 0.05, CZ, 0.03);
  K.put(hipRoofFine(W + 0.5, D + 0.5, 0.95, 0.9), green, CX, 0.16 + H + 0.105, CZ);   // (resting on the eave band, not in its top face)
  K.g.userData.trimName = 'clubhouse'; K.g.userData.trims = [{ x: CX, z: CZ, w: W, d: D, y: 0.16 + H, top: 0.16 + H + 0.1, out: 0.1, kind: 'hip', trim: 0xfaf6ec, roof: 0x3e6b52, ovMax: 0.2 }];
  K.box(0.32, 0.6, 0.32, paint(PAL.terracotta), CX + 1.4, 0.16 + H + 0.6, CZ - 0.3, 0.03);   // chimney
  // front: double doors, windows with striped awnings
  const fz = CZ + D / 2 + 0.01;
  K.box(0.78, 1.05, 0.06, trim, CX, 0.16 + 0.55, fz, 0.02);
  for (const s of [-1, 1]) { K.box(0.33, 0.95, 0.04, green, CX + s * 0.18, 0.16 + 0.5, fz + 0.03, 0.015); K.flat(0.2, 0.45, glass, CX + s * 0.18, 0.16 + 0.68, fz + 0.06); }
  for (const wx of [-1.6, -0.85, 0.85, 1.6]) {
    K.box(0.52, 0.62, 0.05, trim, CX + wx, 0.16 + 0.85, fz, 0.02);
    K.flat(0.42, 0.52, glass, CX + wx, 0.16 + 0.85, fz + 0.03);
    awning(K, 0.6, CX + wx, 0.16 + 1.22, fz + 0.03);
  }
  for (const s of [-1, 1]) for (const wz of [-0.45, 0.45]) {                          // side windows
    K.box(0.05, 0.6, 0.5, trim, CX + s * (W / 2 + 0.01), 0.16 + 0.85, CZ + wz, 0.02);
    K.flat(0.42, 0.5, glass, CX + s * (W / 2 + 0.04), 0.16 + 0.85, CZ + wz, [0, s * Math.PI / 2, 0]);
  }
  // the veranda: a deck, white posts, a shallow roof, a step down to the path
  K.box(W + 0.4, 0.12, 0.85, paint(0xc8a47c), CX, 0.06, fz + 0.42, 0.03);
  for (let i = 0; i < 6; i++) K.box(0.08, 1.05, 0.08, trim, CX - W / 2 - 0.1 + i * (W + 0.2) / 5, 0.12 + 0.52, fz + 0.78, 0.02);
  const vr = K.box(W + 0.55, 0.06, 1.0, green, CX, 1.24, fz + 0.45, 0.02); vr.rotation.x = 0.12;
  // the club's name across the roof
  K.box(2.7, 0.42, 0.06, trim, CX, 0.16 + H + 0.42, fz + 0.18, 0.02);
  K.flat(2.6, 0.34, signMat('Riverbend Country Club', { bg: '#3e6b52', fg: '#f6eedb', gold: true, w: 640, h: 84 }), CX, 0.16 + H + 0.42, fz + 0.22);
  for (let k = -2; k <= 2; k++) K.foot(CX + k * 1.0, CZ, 0.62);
  // a flagpole by the car park, a pennant flying
  K.put(lathe([[0.001, 0], [0.06, 0], [0.04, 0.1], [0.03, 3.0], [0.05, 3.05], [0.001, 3.1]], 10), trim, 2.55, 0, 4.7);
  { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.75, -0.17); sh.lineTo(0, -0.38); sh.closePath();
    const g = new THREE.ShapeGeometry(sh); const m = K.put(g, paint(PAL.accent, { side: THREE.DoubleSide }), 2.58, 2.98, 4.7); m.userData.noInk = true; }
  K.foot(2.55, 4.7, 0.12);

  // ── the pool (west of the clubhouse): a free-form kidney of a pool with a mosaic floor —
  // its outline is POOL_R (shared with the water's shader), a pale stone deck and an inked
  // coping follow it; a sun terrace to the south with loungers and umbrellas; desert planters ──
  const PX = -3.3, PZ = 1.55, deck = paint(0xe6dcc6), coping = paint(0xfaf6ec);
  const ring = (grow, n = 72) => { const pts = []; for (let k = 0; k < n; k++) { const th = k / n * Math.PI * 2, [x, z] = poolEdge(th, grow); pts.push(new THREE.Vector2(PX + x, -(PZ + z))); } return pts; };
  // (shapes are drawn in x, −z and laid down: a shape's +y becomes the world's −z)
  const slab = (outer, inner, y0, h, mat) => {
    const sh = new THREE.Shape(outer); sh.holes.push(new THREE.Path(inner));
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 4 });
    g.rotateX(-Math.PI / 2); return K.put(g, mat, 0, y0, 0);
  };
  slab(ring(0.5), ring(0.06), 0.0, 0.088, deck);
  slab(ring(0.14), ring(0.0), 0.088, 0.05, coping);
  K.box(2.1, 0.088, 1.05, deck, PX - 0.3, 0.044, PZ + 1.45, 0.02);                    // the sun terrace
  for (const [x, z, r] of POOL_FEET) K.foot(PX + x, PZ + z, r);                        // you can't walk on the water
  // loungers on the terrace facing the pool, umbrellas between them
  const LZ = PZ + 1.5;
  for (let k = 0; k < 3; k++) {
    const S = K.sub(PX - 0.9 + k * 0.6, 0.088, LZ, 0);
    S.box(0.34, 0.05, 0.72, paint([0xf6eedb, 0xe1b95c, 0x7fb3a8][k]), 0, 0.12, 0.06, 0.02);
    const back = S.box(0.34, 0.05, 0.36, paint([0xf6eedb, 0xe1b95c, 0x7fb3a8][k]), 0, 0.24, -0.38, 0.02); back.rotation.x = 0.85;
    for (const sx of [-1, 1]) for (const sz of [-0.28, 0.32]) S.box(0.03, 0.12, 0.03, paint(0xd8dde2), sx * 0.15, 0.06, sz, 0.01);
  }
  for (const k of [0, 1]) {
    const ux = PX - 0.6 + k * 0.6, uz = LZ + 0.42, cols = [PAL.accent, 0xf6eedb];
    K.put(lathe([[0.001, 0], [0.02, 0], [0.02, 1.25], [0.001, 1.26]], 6), DARK(), ux, 0.088, uz);
    for (let s = 0; s < 8; s++) {
      const g = new THREE.ConeGeometry(0.42, 0.2, 2, 1, true, s * Math.PI / 4, Math.PI / 4);
      const m = K.put(g, paint(cols[s % 2], { side: THREE.DoubleSide }), ux, 1.22, uz); m.userData.noInk = true;
    }
  }
  // desert planters round the deck: agaves, a cactus, boulders in gravel
  const agave = (S, x, z, s = 1) => { const g = paint(0x7fa88a);
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, tilt = 0.55 + (k % 3) * 0.2;
      const leaf = S.put(new THREE.ConeGeometry(0.035 * s, 0.42 * s, 5), g, x + Math.cos(a) * 0.05 * s, 0.2 * s, z + Math.sin(a) * 0.05 * s);
      leaf.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt); } };
  const cactus = (S, x, z) => { const g = paint(0x5f8f5a);
    S.put(new THREE.CapsuleGeometry(0.08, 0.55, 4, 10), g, x, 0.42, z);
    for (const [sx, h] of [[1, 0.42], [-1, 0.3]]) { S.put(new THREE.CapsuleGeometry(0.05, 0.16, 3, 8), g, x + sx * 0.14, h + 0.12, z); S.put(new THREE.CapsuleGeometry(0.045, 0.08, 3, 8), g, x + sx * 0.08, h, z).rotation.z = sx * Math.PI / 2; } };
  const boulder = (S, x, z, s) => { const m = S.put(new THREE.IcosahedronGeometry(0.16 * s, 1), paint(0xc9b79a), x, 0.06 * s, z); m.scale.set(1.2, 0.7, 1); m.rotation.y = x * 3; };
  for (const [x, z, kind] of [[-5.0, 0.7, 0], [-5.05, 2.5, 1], [-4.75, 3.35, 2]]) {
    const S = K.sub(x, 0, z); S.g.userData.deco = 0.45;
    S.put(lathe([[0.001, 0], [0.42, 0], [0.44, 0.16], [0.4, 0.18], [0.001, 0.17]], 24), paint(0xd8cab0), 0, 0, 0);
    S.put(new THREE.CircleGeometry(0.39, 20).rotateX(-Math.PI / 2), paint(0xe2d3b0, { hatch: 0 }), 0, 0.175, 0).userData.noInk = true;
    const T = S.sub(0, 0.17, 0);
    if (kind === 0) { agave(T, -0.1, 0.05, 1.1); boulder(T, 0.2, -0.1, 0.8); }
    else if (kind === 1) { cactus(T, 0.05, 0); agave(T, -0.2, 0.15, 0.7); boulder(T, 0.22, 0.18, 0.6); }
    else { boulder(T, -0.1, 0, 1.2); boulder(T, 0.18, 0.12, 0.8); agave(T, 0.1, -0.2, 0.8); }
    K.foot(x, z, 0.45);
  }
  // ── the tennis court (east): a blue court in a green apron, white lines, a net, a fence ──
  const TX = 2.95, TZ = 0.55, tw = 2.2, td = 4.2;
  K.box(tw + 0.5, 0.04, td + 0.5, paint(0x5f9a6e, { hatch: 0 }), TX, 0.02, TZ, 0.01).userData.noInk = true;
  K.box(tw, 0.02, td, paint(0x5f86b8, { hatch: 0 }), TX, 0.05, TZ, 0.005).userData.noInk = true;
  const line = (w, d, x, z) => K.flat(w, d, white, x, 0.063, z, [-Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) { line(0.04, td, TX + s * tw / 2, TZ); line(0.04, td, TX + s * tw * 0.38, TZ); line(tw, 0.04, TX, TZ + s * td / 2); line(tw * 0.76, 0.04, TX, TZ + s * td * 0.27); }
  line(0.04, td * 0.54, TX, TZ);
  for (const s of [-1, 1]) K.box(0.05, 0.36, 0.05, DARK(), TX + s * (tw / 2 + 0.12), 0.24, TZ, 0.015);
  { const g = new THREE.PlaneGeometry(tw + 0.24, 0.26); g.rotateY(Math.PI / 2); const m = K.put(g, netMat(18, 3), TX, 0.2, TZ, [0, Math.PI / 2, 0]); m.userData.noInk = true; }
  K.box(tw + 0.24, 0.03, 0.03, white, TX, 0.34, TZ, 0.01);
  // the fence: posts, a top rail, chain-link panels (a gate gap on the club side)
  const FX = tw / 2 + 0.24, FZ = td / 2 + 0.24, FH = 1.0;
  const posts = [];
  for (let z = -FZ; z <= FZ + 1e-3; z += FZ / 3) for (const s of [-1, 1]) posts.push([TX + s * FX, TZ + z]);
  for (let x = -FX + FX / 2; x < FX; x += FX / 2) for (const s of [-1, 1]) posts.push([TX + x, TZ + s * FZ]);
  for (const [x, z] of posts) K.box(0.04, FH, 0.04, DARK(), x, FH / 2, z, 0.012);
  for (const s of [-1, 1]) {
    K.box(0.03, 0.03, 2 * FZ, DARK(), TX + s * FX, FH, TZ, 0.01); K.box(2 * FX, 0.03, 0.03, DARK(), TX, FH, TZ + s * FZ, 0.01);
    { const g = new THREE.PlaneGeometry(2 * FZ, FH); const m = K.put(g, netMat(2 * FZ * 5, FH * 5), TX + s * FX, FH / 2, TZ, [0, Math.PI / 2, 0]); m.userData.noInk = true; }
    { const g = new THREE.PlaneGeometry(2 * FX, FH); const m = K.put(g, netMat(2 * FX * 5, FH * 5), TX, FH / 2, TZ + s * FZ); m.userData.noInk = true; }
  }

  // ── a putting green between the pool and the court, its flag in the hole ──
  { const g = new THREE.CircleGeometry(0.85, 28); g.rotateX(-Math.PI / 2); const m = K.put(g, paint(0x9cc276, { hatch: 0 }), -0.35, 0.05, 1.9); m.userData.noInk = true; }
  { const g = new THREE.CircleGeometry(0.05, 12); g.rotateX(-Math.PI / 2); const m = K.put(g, DARK(), -0.15, 0.055, 1.75); m.userData.noInk = true; }
  K.put(lathe([[0.001, 0], [0.012, 0], [0.012, 0.8], [0.001, 0.81]], 6), white, -0.15, 0.05, 1.75);
  { const g = new THREE.PlaneGeometry(0.26, 0.17); g.translate(0.13, 0, 0); const m = K.put(g, paint(0xe8604c, { side: THREE.DoubleSide }), -0.15, 0.76, 1.75); m.userData.noInk = true; }
  for (let k = 0; k < 3; k++) K.put(new THREE.SphereGeometry(0.035, 8, 6), white, -0.6 + k * 0.22, 0.085, 2.15 - k * 0.1);

  // hedges, trees and lamps round the edge; benches by the green
  for (const [x, z] of [[-4.6, -1.2], [4.6, -2.2], [4.6, 3.3], [-2.6, -3.9], [1.2, -3.9]]) { const t = tree({ s: 0.85 }); t.position.set(x, 0, z); K.g.add(t); K.foot(x, z, 0.3); }
  for (const x of [-4.4, -3.8, -3.2, 2.3, 2.9, 3.5]) { const b = bush(0.38); b.position.set(x, 0, 5.0); K.g.add(b); }   // a hedge either side of the way in
  for (const x of [2.35]) { const l = lamp(); l.position.set(x, 0, 2.9); K.g.add(l); K.foot(x, 2.9, 0.15); }
  K.g.userData.club = { pool: { x: PX, z: PZ, swim: [PX - 0.15, PX + 0.85], swimZ: PZ + 0.22 }, court: { x: TX, z: TZ, w: tw, d: td },
    loungers: [0, 1, 2].map(k => ({ x: PX - 0.9 + k * 0.6, z: LZ + 0.06 })), park: [{ x: -1.7, z: 4.05 }, { x: 0.3, z: 4.05 }] };
  K.g.userData.floor = (x, z) => {
    if (Math.abs(x - CX) < W / 2 + 0.2 && z > fz - 0.02 && z < fz + 0.85) return 0.12;                 // the veranda
    if (poolIn(x - PX, z - PZ, 0.5) && !poolIn(x - PX, z - PZ, 0)) return 0.1;            // the pool deck
    if (Math.abs(x - PX + 0.3) < 1.05 && Math.abs(z - PZ - 1.45) < 0.52) return 0.088;    // the sun terrace
    if (Math.abs(x + 0.2) < 2.3 && Math.abs(z - 4.05) < 1.45) return 0.05;                               // the car park
    return null;
  };
  return K.g;
}

// ── the pool's mosaic: big cut-paper shapes (Matisse-ish) on a turquoise ground, then laid
// in small tesserae — each square takes the colour under its centre with a little jitter, and
// pale grout between. It covers the pool's local square (±MOS world units) ──
const MOS = 1.6;
function mosaicTexture() {
  const N = 1024, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const c = cv.getContext('2d'), R0 = rng(5150), U = N / (2 * MOS), P = (x, z) => [(x + MOS) * U, (z + MOS) * U];
  c.fillStyle = '#3fb8c9'; c.fillRect(0, 0, N, N);
  c.lineCap = c.lineJoin = 'round';
  const stroke = (col, w, pts) => { c.strokeStyle = col; c.lineWidth = w * U; c.beginPath(); const [x0, y0] = P(...pts[0]); c.moveTo(x0, y0);
    for (let k = 1; k + 1 < pts.length; k += 2) { const [a, b] = P(...pts[k]), [x, y] = P(...pts[k + 1]); c.quadraticCurveTo(a, b, x, y); } c.stroke(); };
  // sweeping blue and teal currents
  stroke('#2a6fb5', 0.34, [[-1.6, -0.5], [-0.9, -1.0], [-0.2, -0.45], [0.5, 0.1], [1.6, -0.35]]);
  stroke('#1f8f8a', 0.26, [[-1.6, 0.55], [-0.7, 0.05], [0.1, 0.55], [0.9, 1.05], [1.6, 0.6]]);
  stroke('#5fd0d8', 0.12, [[-1.4, -0.05], [-0.6, -0.5], [0.2, -0.05], [0.9, 0.4], [1.5, 0.05]]);
  // the orange-red ribbon snaking through
  stroke('#e8573c', 0.13, [[-1.5, 0.95], [-1.0, 0.35], [-0.55, 0.75], [-0.05, 1.15], [0.35, 0.45], [0.75, -0.25], [1.4, -0.8]]);
  // yellow fans
  const fan = (x, z, r, a0, a1, n = 7) => { c.fillStyle = '#f2c14e'; for (let k = 0; k < n; k++) { const a = a0 + (a1 - a0) * (k + 0.15) / n, b = a0 + (a1 - a0) * (k + 0.75) / n;
    const [cx, cy] = P(x, z); c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r * U, a, b); c.closePath(); c.fill(); } };
  fan(-1.05, -0.2, 0.42, -2.6, -0.6); fan(0.95, 0.75, 0.38, 2.4, 4.6);
  // green leaves
  const leaf = (x, z, l, rot) => { const [cx, cy] = P(x, z); c.save(); c.translate(cx, cy); c.rotate(rot); c.fillStyle = '#4f9a4a';
    c.beginPath(); c.moveTo(-l * U, 0); c.quadraticCurveTo(0, -l * 0.42 * U, l * U, 0); c.quadraticCurveTo(0, l * 0.42 * U, -l * U, 0); c.fill(); c.restore(); };
  leaf(-0.3, 0.2, 0.26, 0.5); leaf(0.15, -0.75, 0.22, -0.4); leaf(1.15, 0.15, 0.2, 1.2); leaf(-0.75, 0.9, 0.18, -0.9); leaf(0.55, 0.85, 0.16, 0.3);
  // a yellow sun with rays, in the deep end
  { const [cx, cy] = P(0.3, 0.1); c.fillStyle = '#f2c14e'; c.beginPath(); c.arc(cx, cy, 0.17 * U, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f2c14e'; c.lineWidth = 0.045 * U;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * 0.24 * U, cy + Math.sin(a) * 0.24 * U); c.lineTo(cx + Math.cos(a) * 0.34 * U, cy + Math.sin(a) * 0.34 * U); c.stroke(); } }
  // dotted lines
  c.fillStyle = '#f6eedb';
  for (const [x0, z0, x1, z1] of [[-1.3, -1.0, 0.2, -1.2], [-0.2, 1.05, 1.3, 1.0], [0.9, -0.95, 1.5, 0.2]])
    for (let k = 0; k <= 14; k++) { const t = k / 14, [x, y] = P(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t + 0.08 * Math.sin(t * 9)); c.beginPath(); c.arc(x, y, 0.022 * U, 0, Math.PI * 2); c.fill(); }
  // tesserae: each square the colour under its centre, jittered; pale grout between
  const T = 16, img = c.getImageData(0, 0, N, N).data;
  c.fillStyle = '#d8d2c4'; c.fillRect(0, 0, N, N);
  for (let y = 0; y < N; y += T) for (let x = 0; x < N; x += T) {
    const k = ((y + T / 2) * N + x + T / 2) * 4, j = 0.9 + R0() * 0.2;
    c.fillStyle = `rgb(${Math.min(255, img[k] * j) | 0},${Math.min(255, img[k + 1] * j) | 0},${Math.min(255, img[k + 2] * j) | 0})`;
    const o = 1.5 + R0() * 1.2; c.fillRect(x + o, y + o, T - o - 1.5, T - o - 1.5);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ── the pool's water: one shaded surface that looks INTO the mosaic basin under it ──
// The terrain mesh is too coarse to dig a real free-form hole with levels, so the basin is
// traced in the fragment shader: each pixel marches the view ray down from the surface
// through the pool's volume — its kidney outline (the same shape as the deck's), and a depth
// that steps: a shallow sun ledge at the west end, two wide entry steps, the deep basin and a
// round raised seat — and paints the mosaic where it lands: the floor, the step treads, and
// (in shade) the risers and walls, the mosaic carried up them. Caustics wander over it and the
// view wobbles with the ripples; the swimmer's body under the surface is a capsule traced in
// the same march. On top: a clear tint that thickens with depth and at grazing angles, ripple
// strokes, rings round the swimmer, a dark rim line. One draw, one texture.
const POOL_VS = /* glsl */`
  uniform float uTime; attribute float aLift; varying vec3 vP;
  void main() {
    vec3 p = position;
    p.y += aLift;                                   // the ground under the pool isn't quite level: ride it
    p.y += 0.005 * sin(p.x * 7.0 + uTime * 1.6) * sin(p.z * 9.0 - uTime * 1.2);
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const POOL_FS = /* glsl */`
  uniform float uTime, uLight, uSwimOn, uMos; uniform vec2 uAB; uniform vec3 uCam, uSwim;
  uniform sampler2D tMos;
  uniform vec3 cDeep, cTint, cFoam, cTop, cBottom, cSkin;
  varying vec3 vP;
  float edgeR(vec2 p) { vec2 q = p / uAB; float th = atan(q.y, q.x); return (1.0 + 0.10 * sin(2.0 * th + 0.5) + 0.08 * sin(3.0 * th + 2.0)) - length(q); }
  float depthAt(vec2 p) {
    float d = 0.56;
    if (p.x < -0.72) d = 0.12;                      // the sun ledge
    else if (p.x < -0.52) d = 0.25;                 // the entry steps
    else if (p.x < -0.32) d = 0.39;
    if (length(p - vec2(0.72, -0.36)) < 0.27) d = 0.24;   // the round seat
    return d;
  }
  vec3 mos(vec2 uv) { return texture2D(tMos, uv / (2.0 * uMos) + 0.5).rgb; }
  float capsule(vec3 ro, vec3 rd, vec3 a, vec3 b, float r) {
    vec3 ba = b - a, oa = ro - a;
    float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
    float A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba, h = B * B - A * C;
    if (h >= 0.0) {
      float t = (-B - sqrt(h)) / A, y = baoa + t * bard;
      if (y > 0.0 && y < baba) return t;
      vec3 oc = (y <= 0.0) ? oa : ro - b;
      B = dot(rd, oc); C = dot(oc, oc) - r * r; h = B * B - C;
      if (h > 0.0) return -B - sqrt(h);
    }
    return -1.0;
  }
  void main() {
    vec3 rd = normalize(vP - uCam);
    rd.y = min(rd.y, -0.03); rd = normalize(rd);
    vec3 ro = vec3(vP.x, 0.0, vP.z);
    ro.xz += 0.016 * vec2(sin(vP.z * 11.0 + uTime * 1.9), cos(vP.x * 9.0 - uTime * 1.5));
    vec3 r = normalize(vec3(rd.x * 0.75, rd.y, rd.z * 0.75));      // refraction: bent toward straight down
    // march down through the volume until the ray is under the floor or outside the outline
    float tMax = 0.62 / -r.y, dt = tMax / 40.0, t = 0.0;
    bool wall = false;
    for (int i = 0; i < 40; i++) {
      vec3 p = ro + r * (t + dt);
      if (edgeR(p.xz) < 0.0) { wall = true; break; }
      if (p.y < -depthAt(p.xz)) break;
      t += dt;
    }
    // refine the hit
    float lo = t, hi = t + dt;
    for (int i = 0; i < 6; i++) { float m = 0.5 * (lo + hi); vec3 p = ro + r * m; if (edgeR(p.xz) < 0.0 || p.y < -depthAt(p.xz)) hi = m; else lo = m; }
    t = hi; vec3 h = ro + r * t;
    vec3 col;
    bool riser = !wall && abs(h.y + depthAt(h.xz)) > 0.012;          // a step's face, not its tread
    if (wall || riser) {
      col = mos(h.xz + normalize(h.xz + 1e-4) * (h.y * 0.6)) * 0.78;   // the mosaic carried up the face, in shade
    } else {
      col = mos(h.xz);
      // the step nosings: a pale line of tiles along each edge where the floor drops
      float d0 = depthAt(h.xz);
      float dd = abs(depthAt(h.xz + vec2(0.03, 0.0)) - d0) + abs(depthAt(h.xz - vec2(0.03, 0.0)) - d0)
               + abs(depthAt(h.xz + vec2(0.0, 0.03)) - d0) + abs(depthAt(h.xz - vec2(0.0, 0.03)) - d0);
      col = mix(col, vec3(0.93, 0.9, 0.84), step(0.01, dd) * 0.7);
      float c = sin(h.x * 13.0 + uTime * 1.3 + 2.0 * sin(h.z * 9.0 + uTime * 0.9)) * sin(h.z * 12.0 - uTime * 1.1 + 2.0 * sin(h.x * 7.0 - uTime * 0.7));
      col = mix(col, cFoam, smoothstep(0.72, 0.95, c) * 0.45);       // caustics: the mosaic dances
    }
    if (uSwimOn > 0.5) {
      float tb = capsule(ro, r, vec3(uSwim.x, uSwim.y + 0.1, uSwim.z), vec3(uSwim.x, -0.02, uSwim.z), 0.105);
      if (tb > 0.0 && tb < t) { float y = (ro + r * tb).y; col = (y > uSwim.y + 0.36 ? cTop : y > uSwim.y + 0.24 ? cBottom : cSkin) * 0.92; t = tb; }
    }
    float fres = pow(1.0 - abs(rd.y), 3.0);
    col = mix(col, cDeep, clamp(t * -r.y / 1.4, 0.0, 0.45));        // deeper water, bluer
    col = mix(col, cTint, 0.14 + 0.45 * fres);
    float w = sin(vP.x * 16.0 + 1.8 * sin(vP.z * 10.0 + uTime) + uTime * 1.7) * sin(vP.z * 13.0 - uTime * 1.3 + 1.5 * sin(vP.x * 8.0));
    float ring = 0.0;
    if (uSwimOn > 0.5) { float d = length(vP.xz - uSwim.xz); ring = smoothstep(0.08, 0.0, abs(fract(d * 5.0 - uTime * 0.9) - 0.5) - 0.38) * exp(-d * 3.5) * step(0.09, d); }
    col = mix(col, cFoam, clamp(smoothstep(0.88, 0.97, w) * 0.6 + ring * 0.8, 0.0, 1.0));
    col *= mix(0.55, 1.0, smoothstep(0.0, 0.03, edgeR(vP.xz)));       // the rim line
    gl_FragColor = vec4(col * uLight, 1.0);
    #include <colorspace_fragment>
  }`;
function poolWater() {
  const C = (hex) => ({ value: new THREE.Color(hex) });
  const mat = new THREE.ShaderMaterial({
    vertexShader: POOL_VS, fragmentShader: POOL_FS,
    uniforms: {
      uTime: { value: 0 }, uLight: { value: 1 }, uSwimOn: { value: 0 }, uMos: { value: MOS },
      uAB: { value: new THREE.Vector2(POOL_A, POOL_B) }, uCam: { value: new THREE.Vector3() }, uSwim: { value: new THREE.Vector3(0, -0.6, 0) },
      tMos: { value: mosaicTexture() },
      cDeep: C(0x1f7fa6), cTint: C(0x8fd8e6), cFoam: C(0xf6fdff), cTop: C(0xe8604c), cBottom: C(0x3f5872), cSkin: C(0xdca78a),
    },
  });
  // the surface: the outline filled in rings round the centre (so the wobble has vertices to move)
  const pos = [0, 0, 0], idx = [], NA = 72, NR = 6;
  for (let r = 1; r <= NR; r++) for (let k = 0; k < NA; k++) { const [x, z] = poolEdge(k / NA * Math.PI * 2, 0); pos.push(x * r / NR, 0, z * r / NR); }
  for (let k = 0; k < NA; k++) idx.push(0, 1 + (k + 1) % NA, 1 + k);
  for (let r = 1; r < NR; r++) for (let k = 0; k < NA; k++) {
    const a = 1 + (r - 1) * NA + k, b = 1 + (r - 1) * NA + (k + 1) % NA;
    idx.push(a, b, a + NA, b, b + NA, a + NA);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.userData.noInk = true; m.userData.noGround = true; m.raycast = () => {};
  let hemi = null;
  const _c = new THREE.Vector3();
  m.onBeforeRender = (r, scene, cam) => {
    const U = mat.uniforms;
    U.uTime.value = performance.now() / 1000;
    U.uCam.value.copy(m.worldToLocal(_c.copy(cam.position)));
    if (hemi === null) { hemi = false; scene.traverse(o => { if (o.isHemisphereLight && !hemi) hemi = o; }); }
    if (hemi) U.uLight.value = Math.min(1, Math.max(0.35, hemi.intensity / 1.35));   // darker at night (the cold open)
  };
  return m;
}

// ── the driving range (local +z: toward the road; balls fly toward −z) ──
function drivingRange() {
  const K = kit(), green = paint(0x3e6b52), trim = paint(0xfaf6ec), white = paint(0xf6eedb, { hatch: 0 });
  // the field: mown stripes running out from the tee line
  // (ridden well above the terrain, with a depth offset: laid on at their vertices, the coarse ground bulged through)
  const stripe = [paint(PAL.meadow, { hatch: 0, unique: true }), paint(0xb8cd8a, { hatch: 0, unique: true })];
  for (const m of stripe) { m.polygonOffset = true; m.polygonOffsetFactor = m.polygonOffsetUnits = -3; }
  for (let i = 0; i < 7; i++) {
    const g = new THREE.PlaneGeometry(0.72, 6.6, 2, 12); g.rotateX(-Math.PI / 2);
    const m = K.put(g, stripe[i % 2], -2.16 + i * 0.72, 0.09, -0.9); m.userData.noInk = true;
  }
  // the covered tee line: a slab, posts, a sloped roof, a back wall, four bays with mats
  const TZ = 3.1;
  K.box(5.0, 0.1, 1.3, paint(0xd8cab0), 0, 0.05, TZ, 0.03);
  K.box(5.0, 1.2, 0.12, paint(0xf3ead7), 0, 0.7, TZ + 0.6, 0.03);
  for (let i = 0; i < 6; i++) K.box(0.08, 1.56, 0.08, trim, -2.4 + i * 0.96, 0.85, TZ - 0.6, 0.02);
  const roof = K.box(5.3, 0.08, 1.55, green, 0, 1.68, TZ, 0.03); roof.rotation.x = -0.14;
  K.box(5.32, 0.16, 0.06, trim, 0, 1.6, TZ - 0.78, 0.02);
  // the name on the back wall, facing the road you arrive by
  K.box(3.2, 0.36, 0.05, paint(0x3e6b52), 0, 0.92, TZ + 0.68, 0.02);
  K.flat(3.05, 0.28, signMat('Riverbend Driving Range', { bg: '#3e6b52', fg: '#faf6ec', gold: true, w: 640, h: 64, border: false }), 0, 0.92, TZ + 0.71);
  for (let b = 0; b < 4; b++) {
    const x = -1.8 + b * 1.2;
    K.box(0.7, 0.025, 0.7, paint(0x5f9a6e, { hatch: 0 }), x, 0.11, TZ - 0.15, 0.01);
    for (let k = 0; k < 6; k++) K.put(new THREE.SphereGeometry(0.035, 8, 6), white, x + 0.22 + (k % 3) * 0.07, 0.15 + (k > 2 ? 0.05 : 0), TZ + 0.05 + (k > 2 ? 0.035 : 0));
    if (b < 3) K.box(0.04, 0.9, 0.9, paint(0xe6dcc6), x + 0.6, 0.55, TZ + 0.1, 0.015);
  }
  // the ball machine at the end
  K.box(0.5, 0.95, 0.42, paint(PAL.accent), 2.75, 0.48, TZ + 0.2, 0.05);
  K.box(0.34, 0.2, 0.04, DARK(), 2.75, 0.75, TZ - 0.02, 0.02);
  K.box(0.16, 0.08, 0.2, paint(0xd8dde2), 2.75, 0.28, TZ - 0.1, 0.02);
  K.foot(2.75, TZ + 0.2, 0.35);
  for (let i = 0; i < 6; i++) K.foot(-2.5 + i * 1.0, TZ + 0.6, 0.45);
  // yardage boards and target flags out on the field
  [[0.6, '50'], [-1.6, '100'], [-3.6, '150']].forEach(([z, n], i) => {
    const x = [-1.2, 1.0, -0.2][i];
    K.box(0.06, 0.55, 0.06, trim, x, 0.3, z, 0.015);
    K.box(0.62, 0.38, 0.05, trim, x, 0.72, z, 0.02);
    K.flat(0.54, 0.3, signMat(n, { bg: '#faf6ec', fg: '#e8604c', w: 128, h: 72, border: false }), x, 0.72, z + 0.03);
    const fx = [1.2, -1.3, 1.5][i], fz = z - 0.4;
    { const g = new THREE.CircleGeometry(0.4, 20); g.rotateX(-Math.PI / 2); const m = K.put(g, paint(0x9cc276, { hatch: 0 }), fx, 0.05, fz); m.userData.noInk = true; }
    K.put(lathe([[0.001, 0], [0.012, 0], [0.012, 0.75], [0.001, 0.76]], 6), white, fx, 0.04, fz);
    { const g = new THREE.PlaneGeometry(0.24, 0.16); g.translate(0.12, 0, 0); const m = K.put(g, paint([0xe8604c, 0xe1b95c, 0x5f86b8][i], { side: THREE.DoubleSide }), fx, 0.7, fz); m.userData.noInk = true; }
  });
  const R0 = rng(311);
  for (let k = 0; k < 26; k++) K.put(new THREE.SphereGeometry(0.03, 6, 5), white, (R0() - 0.5) * 4.6, 0.07, 2.2 - R0() * 6.2);
  // the catch net at the far end
  for (const x of [-2.4, -0.8, 0.8, 2.4]) K.box(0.07, 2.3, 0.07, DARK(), x, 1.15, -4.25, 0.02);
  K.box(4.9, 0.04, 0.04, DARK(), 0, 2.28, -4.25, 0.01);
  { const g = new THREE.PlaneGeometry(4.8, 2.2); const m = K.put(g, netMat(24, 11), 0, 1.15, -4.25); m.userData.noInk = true; }
  for (const x of [-2.4, -0.8, 0.8, 2.4]) K.foot(x, -4.25, 0.12);
  K.g.userData.range = { tee: { x: -0.6, z: TZ - 0.15 } };
  K.g.userData.floor = (x, z) => Math.abs(x) < 2.5 && Math.abs(z - TZ) < 0.65 ? 0.1 : null;
  return K.g;
}

// ── a suburban house, light on the browser: the town's house() is ~34k triangles (flower
// boxes of tiny spheres, bevels everywhere); this one is ~4k and reads the same at street
// distance — boards, a gabled roof with fascias, a porch, framed windows with shutters ──
const HOUSE_COLS = [[0xf1e4c8, 0xb85a3e, 0x3e6b52], [0x93abc0, 0x6f7d92, 0xe1b95c], [0xe1b95c, 0xb85a3e, 0x7fb3a8],
  [0xa8b994, 0x6f9a7c, 0xe8604c], [0xdc9e9a, 0x6f7d92, 0xf6eedb], [0xf6eedb, 0x6f9a7c, 0x3f5872], [0xb7a3c6, 0xb85a3e, 0xe1b95c], [0xd58b63, 0x6f7d92, 0xf6eedb]];
function bungalow(i, w = 2.2, d = 1.8, h = 1.5) {
  const K = kit(), [wc, rc, dc] = HOUSE_COLS[i % HOUSE_COLS.length];
  const wall = paint(wc), roofM = paint(rc), trim = paint(0xfaf6ec), door = paint(dc), glass = upperGlass(i % 3), stone = paint(0xb3a99a);
  const bx = (W, H, D, m, x, y, z, r = 0.04, rot) => K.put(rbox(W, H, D, r, 1), m, x, y, z, rot);
  bx(w + 0.08, 0.16, d + 0.08, stone, 0, 0.08, 0, 0.03);
  bx(w, h, d, wall, 0, 0.16 + h / 2, 0, 0.05);
  bx(w + 0.12, 0.08, d + 0.12, trim, 0, 0.16 + h, 0, 0.03);
  // the roof: two slabs over a gable, a ridge
  const rh = h * 0.6, ov = 0.18, half = w / 2 + ov, sl = Math.hypot(half, rh), ang = Math.atan2(rh, half);
  for (const sx of [-1, 1]) { const r = bx(sl + 0.04, 0.09, d + ov * 2, roofM, sx * half / 2, 0.16 + h + rh / 2 + 0.03, 0, 0.03); r.rotation.z = -sx * ang; }
  K.put(new THREE.CylinderGeometry(0.05, 0.05, d + ov * 2, 8).rotateX(Math.PI / 2), roofM, 0, 0.16 + h + rh + 0.04, 0);
  { const tri = new THREE.Shape(); tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, rh * 0.95); tri.closePath();
    const g = new THREE.ExtrudeGeometry(tri, { depth: d - 0.04, bevelEnabled: false }); g.translate(0, 0, -(d - 0.04) / 2);
    K.put(g, wall, 0, 0.16 + h, 0); }
  for (const sz of [-1, 1]) K.put(new THREE.TorusGeometry(0.13, 0.03, 6, 14), trim, 0, 0.16 + h + rh * 0.38, sz * (d / 2 + 0.01));
  if (i % 3 !== 1) { bx(0.26, 0.6, 0.26, paint(0xd58b63), w * 0.25, 0.16 + h + rh * 0.65, -d * 0.15, 0.03); }
  // front: a door under a little porch roof, a window either side with shutters; a window each side and back
  const fz = d / 2 + 0.01, wy = 0.16 + h * 0.55;
  bx(0.52, 0.95, 0.05, trim, 0, 0.16 + 0.47, fz, 0.02);
  bx(0.4, 0.84, 0.04, door, 0, 0.16 + 0.43, fz + 0.025, 0.015);
  K.put(new THREE.SphereGeometry(0.028, 6, 5), paint(PAL.gold, { hatch: 0 }), 0.13, 0.16 + 0.43, fz + 0.06);
  bx(0.8, 0.06, 0.42, roofM, 0, 0.16 + 1.08, fz + 0.18, 0.02).rotation.x = 0.18;
  for (const sx of [-1, 1]) bx(0.05, 0.16, 0.36, trim, sx * 0.34, 0.16 + 0.98, fz + 0.18, 0.015);
  bx(0.7, 0.08, 0.32, stone, 0, 0.04, fz + 0.18, 0.02);
  const win = (x, y, z, ry, shutters = true) => {
    const S = K.sub(x, y, z, ry);
    S.put(rbox(0.5, 0.56, 0.05, 0.02, 1), trim, 0, 0, 0);
    S.flat(0.4, 0.46, glass, 0, 0, 0.03);
    S.put(rbox(0.035, 0.46, 0.03, 0.01, 1), trim, 0, 0, 0.045); S.put(rbox(0.4, 0.035, 0.03, 0.01, 1), trim, 0, 0.02, 0.045);
    S.put(rbox(0.6, 0.05, 0.1, 0.02, 1), trim, 0, -0.3, 0.04);
    if (shutters) for (const s of [-1, 1]) S.put(rbox(0.14, 0.54, 0.03, 0.01, 1), door, s * 0.34, 0, 0.02);
  };
  for (const sx of [-1, 1]) win(sx * (w / 2 - 0.42), wy, fz, 0);
  win(0, wy, -fz, Math.PI, false);
  for (const sx of [-1, 1]) win(sx * (w / 2 + 0.01), wy, 0, sx * Math.PI / 2, false);
  return K.g;
}

// ── a house lot on the Close (local +z: toward the road) — the house, a lawn, a picket
// fence along the front with a gate, a driveway out to the kerb, a tree, a mailbox ──
function houseLot(i) {
  const K = kit(), R0 = rng(907 + i * 13);
  const h = bungalow(i, 2.1 + R0() * 0.3, 1.8, 1.4 + R0() * 0.3); h.position.set(-0.3, 0, -0.45); K.g.add(h);
  const lawn = new THREE.PlaneGeometry(3.4, 3.0); lawn.rotateX(-Math.PI / 2);
  const lm = K.put(lawn, paint(0xb8cd8a, { hatch: 0 }), 0, 0.04, -0.2); lm.userData.noInk = true;
  const drive = new THREE.PlaneGeometry(0.75, 2.0); drive.rotateX(-Math.PI / 2);
  const dm = K.put(drive, paint(0xc9bfae, { hatch: 0 }), 1.25, 0.06, 0.65); dm.userData.noInk = true;
  const wood = paint(0xfaf6ec);
  for (let x = -1.65; x <= 0.8; x += 0.24) { if (Math.abs(x + 0.3) < 0.28) continue; K.box(0.06, 0.4, 0.04, wood, x, 0.2, 1.3, 0.015); }
  for (const y of [0.14, 0.3]) for (const [a, b] of [[-1.65, -0.6], [0.0, 0.8]]) K.box(b - a, 0.035, 0.03, wood, (a + b) / 2, y, 1.28, 0.01);
  // the path from the gate to the door
  const path = new THREE.PlaneGeometry(0.4, 0.95); path.rotateX(-Math.PI / 2);
  const pm = K.put(path, paint(0xe6dcc6, { hatch: 0 }), -0.3, 0.055, 0.85); pm.userData.noInk = true;
  // mailbox, a tree or two, bushes under the windows
  K.box(0.04, 0.42, 0.04, DARK(), 0.75, 0.21, 1.45, 0.01);
  K.box(0.14, 0.1, 0.2, paint([PAL.accent, PAL.teal, PAL.mustard][i % 3]), 0.75, 0.46, 1.45, 0.03);
  const t = R0() > 0.4 ? tree({ s: 0.75 + R0() * 0.25 }) : pine({ s: 0.8 }); t.position.set(-1.4, 0, 0.55); K.g.add(t);
  for (const x of [-1.0, 0.4]) { const b = bush(0.24); b.position.set(x, 0.04, 0.6); K.g.add(b); }
  K.foot(-0.3, -0.45, 1.1); K.foot(-1.4, 0.55, 0.28);
  return K.g;
}

// ── the stone arch bridge: geometry swept along its own axis (local z: south → north,
// x across, y up from the water). deckY(z) is the road's height at each point ──
function bridgeMesh(deckY, bottomY, Lh, Wd, N = 48) {
  const g = new THREE.Group(), stone = paint(0xcdbfa6), ring = paint(0xb3a48a), kerb = paint(PAL.kerb), road = paint(PAL.road, { hatch: 0 });
  // a grid between cross-sections: prof(z) → [[x, y], …]
  const sweep = (prof, mat, { noInk = false } = {}) => {
    const pos = [], idx = []; let m = 0;
    for (let i = 0; i <= N; i++) {
      const z = -Lh + 2 * Lh * i / N, P = prof(z); m = P.length;
      for (const [x, y] of P) pos.push(x, y, z);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = a + m;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat); mesh.userData.noInk = noInk; g.add(mesh); return mesh;
  };
  const RW = 0.9, PW = 0.17, H = Wd / 2;
  // the road and its pavements, kerb faces between
  sweep(z => [[RW, deckY(z)], [-RW, deckY(z)]], road, { noInk: true });          // (wound so its normal faces up)
  for (const s of [-1, 1]) {
    sweep(z => s < 0 ? [[-RW, deckY(z)], [-RW, deckY(z) + 0.05], [-H + PW, deckY(z) + 0.05]] : [[H - PW, deckY(z) + 0.05], [RW, deckY(z) + 0.05], [RW, deckY(z)]], kerb, { noInk: true });
    // the side walls (spandrels), down to the arch
    sweep(z => s < 0 ? [[-H, deckY(z) + 0.05], [-H, bottomY(z)]] : [[H, bottomY(z)], [H, deckY(z) + 0.05]], stone);
    // the arch ring: a band of darker stone along the arch's edge
    sweep(z => { const b = bottomY(z); return s < 0 ? [[-H - 0.02, b + 0.2], [-H - 0.02, b]] : [[H + 0.02, b], [H + 0.02, b + 0.2]]; }, ring, { noInk: true });
    // the parapet: a low wall with a rounded coping
    sweep(z => { const y = deckY(z) + 0.05, o = s * (H - PW / 2);
      const pts = [[-PW / 2, 0], [-PW / 2, 0.36], [-PW / 2 + 0.03, 0.42], [PW / 2 - 0.03, 0.42], [PW / 2, 0.36], [PW / 2, 0]];
      return pts.reverse().map(([x, yy]) => [o + x, y + yy]); }, stone);           // (wound outward on both sides)
  }
  // the underside
  sweep(z => [[-H, bottomY(z)], [H, bottomY(z)]], stone, { noInk: true });
  return g;
}

// ── 2. BUILD (inside buildTown, after the town's own roads, before the countryside trees) ──
export function buildNorth(scene, { add, solid, boulevard }) {
  const out = { roots: [] };
  { const add0 = add; add = (o) => { out.roots.push(o); return add0(o); }; }   // (everything placed here, for dev measurements)
  const feet = (g) => { g.updateWorldMatrix(true, false); for (const [x, z, r] of g.userData.foots || []) solid(g.localToWorld(new THREE.Vector3(x, 0, z)).normalize(), r); };
  const J = L2(NORTH.junction);

  // ── the bridge: where the river runs nearest the planned spot, square across it ──
  const river = NORTH.river.map(L2);
  let C = null, T = null;
  { const want = L2(NORTH.bridge); let best = 1e9;
    for (let i = 0; i < river.length - 1; i++) for (let k = 0; k <= 20; k++) {
      const p = slerpDir(river[i], river[i + 1], k / 20), a = arc(p, want);
      if (a < best) { best = a; C = p; T = river[i + 1].clone().sub(river[i]).projectOnPlane(p).normalize(); }
    } }
  const A = new THREE.Vector3().crossVectors(C, T).normalize();                   // across the river
  if (A.dot(J.clone().sub(C)) < 0) A.negate();                                     // pointing north (to the junction)
  const Lh = NORTH.bridgeLen / 2, Wd = NORTH.bridgeW;
  const G = new THREE.Group();
  alignToSurface(G, C, yawToFace(C, C.clone().multiplyScalar(R).addScaledVector(A, 3).normalize()));
  G.position.copy(C).multiplyScalar(R);
  G.updateMatrixWorld(true);
  const at = (x, z) => G.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
  const _t = new THREE.Vector3();
  const groundY = (z) => { const d = at(0, z); return G.worldToLocal(_t.copy(d).multiplyScalar(radiusAt(d))).y; };
  const yA = groundY(-Lh) + 0.06, yB = groundY(Lh) + 0.06;
  const bump = Math.max(0.4, 0.95 - (yA + yB) / 2);
  const deckY = (z) => { const u = (z + Lh) / (2 * Lh); return yA + (yB - yA) * u + bump * Math.sin(Math.PI * u); };
  const S = 2.7, top = deckY(0) - 0.32;
  const bottomY = (z) => Math.abs(z) < S ? -0.5 + (top + 0.5) * Math.sqrt(1 - (z / S) ** 2) : -0.8;
  G.add(bridgeMesh(deckY, bottomY, Lh, Wd));
  // newel posts and lamps at the four corners
  { const K = kit(G), stone = paint(0xcdbfa6);
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const z = sz * (Lh - 0.15), y = deckY(z) + 0.05;
      K.box(0.24, 0.55, 0.24, stone, sx * (Wd / 2 - 0.085), y + 0.27, z, 0.03);
      K.box(0.3, 0.06, 0.3, paint(0xfaf6ec), sx * (Wd / 2 - 0.085), y + 0.57, z, 0.02);
      if (sx * sz > 0) { const l = lamp(); l.scale.setScalar(0.8); l.position.set(sx * (Wd / 2 - 0.085), y + 0.6, z); G.add(l); }
    }
    K.flat(0.7, 0.16, signMat('Riverbend Bridge', { bg: '#cdbfa6', fg: '#2a2230', w: 256, h: 56, border: false }), -Wd / 2 - 0.035, deckY(0) - 0.15, 0, [0, -Math.PI / 2, 0]);
  }
  ink(G, 'mid');
  add(G);
  // she and the car stand on the deck (groundAt reads it over the water); the curve of the
  // planet is added back, since the floor is read as a height above the bridge's centre
  addFloor(G, (x, z) => Math.abs(z) <= Lh + 0.05 && Math.abs(x) <= Wd / 2 ? deckY(z) + (Math.abs(x) > 0.9 ? 0.05 : 0) + (x * x + z * z) / (2 * R) : null);
  // the deck is road too (no ribbon of its own: the car's keep-to-the-road assist follows it)
  { const pts = []; for (let z = -Lh; z <= Lh + 1e-6; z += 0.6) pts.push(at(0, z));
    ROADS.push({ pts, half: 0.85, closed: false, dashed: false, group: G }); }
  out.bridge = { root: G, dir: C, at };

  // ── roads ──
  const road = (pts, { half = 0.85, keep = () => false, except = null, dashed = false } = {}) => {
    deflect(pts, { keep, except, clear: 1.6 });
    const sm = smooth(pts, 2);
    deflect(sm, { keep: (i) => i === 0 || i === sm.length - 1 || keep(i), except, clear: 1.6 });
    return buildRoad(scene, sm, { half, dashed });
  };
  const line = (a, b, step = 1.4) => { const n = Math.max(2, Math.round(arc(a, b) / step)), o = []; for (let k = 0; k <= n; k++) o.push(slerpDir(a, b, k / n)); return o; };
  // a gentle curve from a (leaving along `ctrl`'s direction) to b: a quadratic bezier on the sphere
  const curve = (a, ctrl, b, step = 1.2) => { const n = Math.max(4, Math.round((arc(a, ctrl) + arc(ctrl, b)) / step)), o = [];
    for (let k = 0; k <= n; k++) { const t = k / n; o.push(slerpDir(slerpDir(a, ctrl, t), slerpDir(ctrl, b, t), t)); } return o; };
  // from the boulevard's nearest point up to the bridge's south end, arriving square to it
  // (both arrive square to the bridge and bend away in a long curve: a sharp corner at its end
  // trapped the car's keep-to-the-road assist against the kerb)
  { let b0 = boulevard[0]; const sEnd = at(0, -Lh - 2);
    for (const p of boulevard) if (arc(p, sEnd) < arc(b0, sEnd)) b0 = p;
    const c = curve(b0, at(0, -Lh - 2 - Math.min(9, arc(b0, sEnd) * 0.6)), sEnd);
    const pts = [...c, at(0, -Lh - 0.8), at(0, -Lh + 0.3)];
    road(pts, { half: 0.95, keep: (i) => i === 0 || i >= pts.length - 4, dashed: true }); }
  // from the north end on to the junction
  { const nEnd = at(0, Lh + 2), c = curve(nEnd, at(0, Lh + 2 + Math.min(9, arc(nEnd, J) * 0.6)), J);
    const pts = [at(0, Lh - 0.3), at(0, Lh + 0.8), ...c];
    road(pts, { half: 0.95, keep: (i) => i < 4 || i === pts.length - 1, dashed: true }); }
  // the club, the range and the Close each get a road from the junction to their gate
  const gate = (k, back = 0.6) => { const s = NORTH[k], d = L2(s.at); return slerpDir(d, J, (s.r + back) / arc(d, J)); };
  road(line(J, gate('club', 0.2)), { keep: (i, n) => i === 0, except: (z) => z.key === 'north:club' });
  road(line(J, gate('range', 0.2)), { keep: (i) => i === 0, except: (z) => z.key === 'north:range' });
  // Riverbend Close: a loop road round a green, the houses outside it
  const CL = NORTH.close, cd = L2(CL.at), fC = frame(cd, J);
  { const ring = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; ring.push(fC(Math.sin(a) * CL.loop, Math.cos(a) * CL.loop)); }
    buildRoad(scene, ring, { half: 0.62, closed: true, dashed: false });
    const entry = fC(0, CL.loop);                                                 // the loop's south side (toward the junction)
    road(line(J, entry), { half: 0.75, keep: (i, n) => i === 0, except: (z) => z.key === 'north:close' }); }

  // ── the club and the range ──
  for (const k of ['club', 'range']) {
    const d = L2(NORTH[k].at), g = add(placeOnPlanet(k === 'club' ? countryClub() : drivingRange(), d, yawToFace(d, J), { weight: 'mid' }));
    addFloor(g, g.userData.floor); feet(g);
    out[k] = { dir: d, root: g, ...(g.userData.club || g.userData.range) };
  }
  // the pool's water, at the pool's place on the placed (ground-bent) club: the water lies 0.03
  // above the ground there, under the coping, as the deck was laid
  { const g = out.club.root, P = out.club.pool, w = poolWater();
    const groundY = (x, z) => { const dir = g.localToWorld(new THREE.Vector3(x, 0, z)).normalize(); return g.worldToLocal(dir.multiplyScalar(radiusAt(dir))).y; };
    const gy = groundY(P.x, P.z), pos = w.geometry.attributes.position, lift = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) lift[i] = groundY(P.x + pos.getX(i), P.z + pos.getZ(i)) - gy;   // (the deck and coping were laid on the same ground)
    w.geometry.setAttribute('aLift', new THREE.BufferAttribute(lift, 1));
    w.position.set(P.x, gy + 0.03, P.z); g.add(w);
    out.club.water = w; }
  // the club's car park and drive are paved: the car may pull in off the road
  { const g = out.club.root, inv = g.matrixWorld.clone().invert(), p = new THREE.Vector3(), r = g.position.length();
    LOTS.push((d) => { if (arc(d, out.club.dir) > 7) return false; p.copy(d).multiplyScalar(r).applyMatrix4(inv); return Math.abs(p.x + 0.2) < 2.4 && p.z > 2.6 && p.z < 6.2; }); }

  // ── the Close: a lot every so often round the ring, skipping where the road comes in ──
  { const lots = [];
    for (let i = 0; i < CL.houses; i++) {
      const a = (i + 0.5) / CL.houses * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.4) continue;           // the entrance (a = 0: toward the junction)
      const d = fC(Math.sin(a) * CL.ring, Math.cos(a) * CL.ring);
      const g = placeOnPlanet(houseLot(i), d, yawToFace(d, cd), { inked: false });
      feet(g); lots.push(g);
    }
    // the green in the middle: a tree, a bench, a swing
    const K = kit(); { const t = tree({ s: 1.1 }); K.g.add(t); K.foot(0, 0, 0.35); }
    for (const a of [0.6, 2.7, 4.6]) { const b = bench(); b.position.set(Math.sin(a) * 1.4, 0, Math.cos(a) * 1.4); b.rotation.y = a + Math.PI; K.g.add(b); K.foot(Math.sin(a) * 1.4, Math.cos(a) * 1.4, 0.35); }
    { const S = K.sub(1.6, 0, -1.2, 0.5), red = paint(PAL.accent);
      for (const s of [-1, 1]) for (const t of [-1, 1]) { const p = S.box(0.05, 1.3, 0.05, red, s * 0.55, 0.62, t * 0.32, 0.015); p.rotation.x = -t * 0.24; }
      S.box(1.2, 0.05, 0.05, red, 0, 1.25, 0, 0.015);
      S.box(0.36, 0.04, 0.16, paint(0xe1b95c), 0, 0.42, 0, 0.012);
      for (const s of [-1, 1]) S.box(0.012, 0.82, 0.012, DARK(), s * 0.16, 0.84, 0, 0.004);
      K.foot(1.6, -1.2, 0.5); }
    const green = placeOnPlanet(K.g, cd, 0, { inked: false }); feet(green); lots.push(green);
    add(batchPlaced(lots, 'mid'));
    out.close = { dir: cd, frame: fC, loop: CL.loop };
  }

  // ── the river's and lakes' water: transparent and flowing (riverlife.js) ──
  out.water = buildRiverWater(scene, RIVER_P, NORTH.lakes.map(([la, lo, r]) => ({ c: ll(la, lo), r })), NORTH.half, C);

  // ── reeds and stones along both banks of the river and round the lakes ──
  { const root = new THREE.Group(), R0 = rng(4242), reed = paint(0x7f9a5a), reed2 = paint(0xa5b36a), tail = paint(0x7a5236), rock = paint(0xb3a99a);
    const stemGeo = lathe([[0.001, 0], [0.018, 0], [0.008, 0.55], [0.001, 0.56]], 5), tailGeo = new THREE.CapsuleGeometry(0.03, 0.09, 3, 6);
    const rockGeo = new THREE.IcosahedronGeometry(0.22, 1);
    const clump = (d) => { const s = new THREE.Group(); settle(s, d, 0.15, 0.03, R0() * 6);
      if (R0() < 0.3) { const m = new THREE.Mesh(rockGeo, rock); m.scale.set(1 + R0(), 0.5 + R0() * 0.4, 1 + R0() * 0.6); m.rotation.y = R0() * 6; s.add(m); }
      else for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(stemGeo, k % 2 ? reed : reed2); const a = R0() * 6, r = R0() * 0.14;
        m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); m.scale.y = 0.7 + R0() * 0.7; m.rotation.set((R0() - 0.5) * 0.3, 0, (R0() - 0.5) * 0.3); s.add(m);
        if (k < 2) { const c = new THREE.Mesh(tailGeo, tail); c.position.set(m.position.x, 0.42 * m.scale.y, m.position.z); s.add(c); } }
      root.add(s); };
    const shore = (p, perp) => {                                                    // the first dry ground out from the water
      for (let o = 1.2; o < 3.2; o += 0.08) { const d = p.clone().multiplyScalar(R).addScaledVector(perp, o).normalize(); if (surfH(d) > 0.06) return d; }
      return null;
    };
    const P = river; const pts = [];
    for (let i = 0; i < P.length - 1; i++) { const n = Math.ceil(arc(P[i], P[i + 1]) / 1.5); for (let k = 0; k < n; k++) pts.push([slerpDir(P[i], P[i + 1], k / n), P[i + 1].clone().sub(P[i])]); }
    for (const [p, dv] of pts) {
      if (arc(p, C) < 4.5) continue;                                                // leave the bridge's banks clear
      const perp = new THREE.Vector3().crossVectors(p, dv.projectOnPlane(p).normalize()).normalize();
      for (const s of [-1, 1]) { if (R0() < 0.3) continue; const d = shore(p, perp.clone().multiplyScalar(s)); if (d && !decoBlocked(d, 0.3) && !zoneHit(d, 0.3)) clump(d); }
    }
    for (const [la, lo, r] of NORTH.lakes) {
      const c = ll(la, lo), f = frame(c);
      for (let k = 0; k < 18; k++) { if (R0() < 0.35) continue; const a = k / 18 * Math.PI * 2, dir = f(Math.sin(a), Math.cos(a)).multiplyScalar(R).sub(c.clone().multiplyScalar(R));
        const dd = shore(c, dir.normalize()); if (dd && !decoBlocked(dd, 0.3)) clump(dd); }
    }
    ink(root, 'fine'); mergeStatic(root);
    for (const m of root.children) { m.geometry.computeBoundingSphere(); }
    root.traverse(o => { o.userData.noGround = true; });
    add(root);
  }
  return out;
}

// ── 3. LIFE (from main.js, once the game is up) ──
// stances for the club's sports, added to the folk's repertoire
STANCES.tennis = { free: 'L',
  R: { fwd: 0.45, out: 0.35, twist: 0.2, bend: 0.5, wrist: -0.2, grip: 1 },
  anim: (side, t, p) => { if (side === 'R') { const sw = Math.sin(t * 2.4); p.fwd += 0.7 * sw; p.out += 0.3 * Math.max(0, -sw); p.bend -= 0.3 * Math.max(0, sw); } } };
STANCES.golf = { free: null,
  L: { fwd: 0.5, out: -0.32, twist: 1.0, bend: 0.25, wrist: 0.1, grip: 1 },
  R: { fwd: 0.5, out: -0.36, twist: 1.0, bend: 0.32, wrist: 0.1, grip: 1 },
  anim: (side, t, p) => { const c = (t % 5.5) / 5.5; const back = c < 0.35 ? Math.sin(c / 0.35 * Math.PI / 2) : c < 0.45 ? Math.cos((c - 0.35) / 0.1 * Math.PI) : -Math.max(0, 1 - (c - 0.45) / 0.25) * 0.9;
    p.out += (side === 'L' ? -0.55 : 0.55) * back; p.fwd += 0.35 * Math.abs(back); } };

const LOOK = (o) => ({ folk: true, height: 1.0, build: 1.0, ...o });
const PEOPLE = {
  tennisA: LOOK({ skin: 'tan', hair: 0x2a1d17, hairStyle: 'pony', top: 0xf6eedb, sleeve: 'short', bottom: 0xf6eedb, shoes: 0xf1ece0, height: 0.98, build: 0.92, stance: 'tennis',
    face: { shape: { jaw: 0.3, chin: 0.5, cheeks: 0.4, long: 0.15, skull: 0.5, brow: 0.4 }, nose: 'snub', noseSize: 0.95, eyes: 'round', brows: 'raised', lashes: true, hair: 'pony', blush: 0.5 } }),
  tennisB: LOOK({ skin: 'deep', hair: 0x1d1716, hairStyle: 'crop', top: 0x7fb3a8, sleeve: 'short', bottom: 0xf6eedb, shoes: 0xf1ece0, height: 1.05, build: 1.0, stance: 'tennis', hat: 'cap', hatColor: 0xf6eedb,
    face: { shape: { jaw: 0.6, chin: 0.4, cheeks: 0.4, long: 0.2, skull: 0.5, brow: 0.55 }, nose: 'round', noseSize: 1.05, eyes: 'round', brows: 'flat', hair: 'crop', blush: 0.2 } }),
  swimmer: LOOK({ skin: 'rose', hair: 0xb06a3a, hairStyle: 'crop', top: 0xe8604c, sleeve: 'short', bottom: 0x3f5872, shoes: 0xdc9e9a, height: 1.0, build: 0.95,
    face: { shape: { jaw: 0.45, chin: 0.45, cheeks: 0.45, long: 0.1, skull: 0.5, brow: 0.45 }, nose: 'straight', noseSize: 1.0, eyes: 'round', brows: 'flat', hair: 'crop', blush: 0.4 } }),
  lounger: LOOK({ skin: 'olive', hair: 0x2b1d1a, hairStyle: 'bun', outfit: 'dress', top: 0xe1b95c, bottom: 0xe1b95c, shoes: 0x8a5a3a, height: 0.95, build: 0.92, stance: 'reading', glasses: true,
    face: { shape: { jaw: 0.3, chin: 0.5, cheeks: 0.45, long: 0.2, skull: 0.5, brow: 0.4 }, nose: 'roman', noseSize: 1.0, eyes: 'round', brows: 'raised', glasses: true, lashes: true, hair: 'bun', blush: 0.5 } }),
  golfer: LOOK({ skin: 'rose', hair: 0xe8e2d6, hairStyle: 'crop', top: 0xdc9e9a, sleeve: 'short', bottom: 0xd8cab0, shoes: 0x6a4a3a, height: 1.04, build: 1.1, belly: 0.4, stance: 'golf', hat: 'cap', hatColor: 0x3e6b52,
    face: { shape: { jaw: 0.6, chin: 0.35, cheeks: 0.5, long: 0.25, skull: 0.55, brow: 0.6 }, nose: 'round', noseSize: 1.1, eyes: 'round', brows: 'flat', hair: 'sides', blush: 0.5 } }),
  walkerA: LOOK({ skin: 'deep', hair: 0xe8e2d6, hairStyle: 'curls', outfit: 'cardigan', top: 0x8f7ae8, accent: 0xf6eedb, bottom: 0x4a4458, shoes: 0x3a2a30, height: 0.93, build: 0.95,
    face: { shape: { jaw: 0.3, chin: 0.45, cheeks: 0.5, long: 0.25, skull: 0.5, brow: 0.4 }, nose: 'round', noseSize: 1.0, eyes: 'round', brows: 'raised', hair: 'fringe', blush: 0.3 } }),
  walkerB: LOOK({ skin: 'tan', hair: 0x6a3b22, hairStyle: 'crop', beard: true, top: 0x5f8f4c, sleeve: 'short', bottom: 0x2f3f55, shoes: 0xf1ece0, height: 1.06, build: 1.0,
    face: { shape: { jaw: 0.65, chin: 0.35, cheeks: 0.4, long: 0.2, skull: 0.55, brow: 0.6 }, nose: 'straight', noseSize: 1.1, eyes: 'round', brows: 'flat', hair: 'crop', blush: 0.2 } }),
};
// a racket / a golf club in the right fist, sized in the world's units whatever the rig's scale
function holdProp(obj, kind) {
  const h = obj.userData.human; if (!h?.J?.handR) return;
  const g = new THREE.Group(), dark = paint(PAL.ink, { hatch: 0 });
  if (kind === 'racket') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 6), dark).translateY(-0.07));
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.01, 6, 18), paint(PAL.accent)); head.scale.set(0.8, 1.15, 1); head.position.y = -0.23; g.add(head);
    const str = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), new THREE.MeshBasicMaterial({ color: 0xf6eedb, transparent: true, opacity: 0.5, side: THREE.DoubleSide })); str.scale.set(0.8, 1.15, 1); str.position.y = -0.23; str.userData.noInk = true; g.add(str);
  } else {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.62, 6), paint(0xd8dde2)).translateY(-0.29));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.09), dark); head.position.set(0, -0.6, 0.03); g.add(head);
  }
  ink(g, 'fine');
  obj.updateWorldMatrix(true, true);
  const s = new THREE.Vector3(); h.J.handR.getWorldScale(s);
  const o = new THREE.Vector3(); obj.getWorldScale(o);
  g.scale.setScalar(o.x / Math.max(1e-4, s.x));
  h.J.handR.add(g);
}

const NEAR = 22;
export function createNorthLife({ scene, town, game, player }) {
  const N = town.north; if (!N?.club) return { update() {} };
  const people = [];
  const club = N.club, cr = club.root; cr.updateWorldMatrix(true, false);
  const CLW = (x, z) => cr.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
  const put = (look, d, face, lift = 0) => { const o = person(look); o.position.copy(d).multiplyScalar(standAt(d) + lift); alignToSurface(o, d, yawToFace(d, face)); scene.add(o); return o; };
  const bumpIt = (s, pitch, line) => game.bumps.add(s.obj, { pitch, line, home: () => s.dir.clone(), onAway: () => { s.paused = true; }, onBack: () => { s.paused = false; } });

  // tennis: one at each baseline, shuffling side to side, swinging
  const ct = club.court;
  [[PEOPLE.tennisA, -1, 360, 'My SERVE!'], [PEOPLE.tennisB, 1, 180, 'That was IN!']].forEach(([look, s, pitch, line], i) => {
    const z = ct.z + s * (ct.d / 2 - 0.25), d = CLW(ct.x, z);
    const obj = put(look, d, CLW(ct.x, ct.z - s));
    holdProp(obj, 'racket');
    const p = { obj, dir: d.clone(), kind: 'tennis', z, s, t: i * 1.3 };
    bumpIt(p, pitch, line); people.push(p);
  });
  // a swimmer doing lengths: shoulders out of the water, gently bobbing
  const pl = club.pool;
  { const d = CLW(pl.swim[0], pl.swimZ), obj = put(PEOPLE.swimmer, d, CLW(pl.swim[0] + 1, pl.swimZ));
    const p = { obj, dir: d.clone(), kind: 'swim', t: 0 }; people.push(p); }
  // a reader on the middle lounger
  // (the seated stance is drawn for a bench seat ~0.2 higher than a lounger's: she sits down onto it)
  { const L = club.loungers[1], d = CLW(L.x, L.z + 0.1), obj = put(PEOPLE.lounger, d, CLW(L.x, L.z - 2), -0.04);
    obj.userData.turn.rotation.x = -0.18;                                         // leaning back a little, on the raised backrest
    const p = { obj, dir: d.clone(), kind: 'still' }; bumpIt(p, 390, 'My SUNBATHE!'); people.push(p); }
  // a golfer at the tee line, facing down the range
  if (N.range) {
    const rr = N.range.root; rr.updateWorldMatrix(true, false);
    const RW = (x, z) => rr.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
    const t = N.range.tee, d = RW(t.x + 0.12, t.z + 0.05), obj = put(PEOPLE.golfer, d, RW(t.x + 3, t.z + 0.05), 0.1);
    holdProp(obj, 'club');
    const p = { obj, dir: d.clone(), kind: 'still' }; bumpIt(p, 150, 'FORE!'); people.push(p);
  }
  // two neighbours strolling round the Close (on its outer pavement)
  if (N.close) {
    const r = N.close.loop + 0.95, f = N.close.frame;
    const onRing = (u) => f(Math.sin(u * Math.PI * 2) * r, Math.cos(u * Math.PI * 2) * r);
    [[PEOPLE.walkerA, 0.15, 1, 0.42, 380, 'My EVENING WALK!'], [PEOPLE.walkerB, 0.62, -1, 0.55, 160, 'I was WATERING!']].forEach(([look, u, way, speed, pitch, line]) => {
      const d = onRing(u), obj = put(look, d, onRing(u + way * 0.02));
      const p = { obj, dir: d.clone(), kind: 'walk', u, way, speed, onRing, rr: r, wait: 0 };
      bumpIt(p, pitch, line); people.push(p);
    });
  }
  // two cars in the club's car park, solid
  for (const [k, col] of [[0, 0x6f9fc0], [1, 0xf3ead7]]) {
    const c = club.park[k], frameO = new THREE.Group(), body = buildCar({ body: col });
    frameO.add(body); frameO.userData.noGround = true;
    const d = CLW(c.x, c.z); frameO.position.copy(d).multiplyScalar(standAt(d));
    alignToSurface(frameO, d, yawToFace(d, CLW(c.x, c.z - 3))); scene.add(frameO); fitToGround(body, frameO);
    frameO.updateWorldMatrix(true, false);
    for (const z of [-0.6, 0.6]) town.colliders.push({ dir: frameO.localToWorld(new THREE.Vector3(0, 0, z)).normalize(), r: 0.75 });
  }

  const river = createRiverLife({ scene, water: N.water, player, game, audio });
  return {
    list: people,
    update(dt) {
      river.update(dt);
      const cold = game.G.state === 'cold', here = player.st.dir;
      for (const p of people) {
        const busy = game.bumps.busy?.(p.obj), far = arc(here, p.dir) > NEAR;
        p.obj.visible = !cold && (!far || busy);
        if (cold || far || busy || p.paused) continue;
        const h = p.obj.userData.human;
        if (p.kind === 'tennis') {                                                 // side to side along the baseline
          p.t += dt; const x = ct.x + Math.sin(p.t * 0.9) * 0.55, d = CLW(x, p.z);
          const v = Math.abs(Math.cos(p.t * 0.9)) * 0.5;
          p.dir.copy(d); p.obj.position.copy(d).multiplyScalar(standAt(d));
          alignToSurface(p.obj, d, yawToFace(d, CLW(ct.x, ct.z - p.s)));
          if (h) poseFolk(h, dt, v);
        } else if (p.kind === 'swim') {                                            // lengths, turning at each end
          p.t += dt; const u = (Math.sin(p.t * 0.28) + 1) / 2, x = pl.swim[0] + u * (pl.swim[1] - pl.swim[0]);
          const d = CLW(x, pl.swimZ), dirx = Math.cos(p.t * 0.28) >= 0 ? 1 : -1;
          p.dir.copy(d);
          const bob = 0.025 * Math.sin(p.t * 3.1);
          p.obj.position.copy(d).multiplyScalar(radiusAt(d) + 0.03 - 0.62 + bob);   // the water lies 0.03 above the ground there
          alignToSurface(p.obj, d, yawToFace(d, CLW(x + dirx, pl.swimZ)));
          // the pool's shader draws the part of her under the surface (and the rings round her)
          if (club.water) { const U = club.water.material.uniforms; U.uSwimOn.value = 1; U.uSwim.value.set(x - pl.x, -0.62 + bob, pl.swimZ - pl.z); }
          if (h) poseFolk(h, dt, 0.6);
        } else if (p.kind === 'walk') {
          if (player.st.mode === 'walk' && arc(here, p.dir) < 1.1) { if (h) poseFolk(h, dt, 0); continue; }
          if (p.wait > 0) { p.wait -= dt; if (h) poseFolk(h, dt, 0); continue; }
          p.u = (p.u + p.way * p.speed * dt / (2 * Math.PI * p.rr) + 1) % 1;
          if (Math.random() < dt * 0.04) p.wait = 2 + Math.random() * 3;               // a word over a fence
          const d = p.onRing(p.u); p.dir.copy(d);
          p.obj.position.copy(d).multiplyScalar(standAt(d));
          alignToSurface(p.obj, d, yawToFace(d, p.onRing(p.u + p.way * 0.02)));
          if (h) poseFolk(h, dt, Math.min(1, p.speed / 0.7));
        } else if (h) poseFolk(h, dt, 0);
      }
    },
  };
}
