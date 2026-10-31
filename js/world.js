// ─── THE PLANET: shaped terrain, painted ground, water, sky, light ──────────
// Plus the shared surface helpers and the RESERVATION MAP: every structure
// reserves its ground before any road is laid, roads bend around reserved
// ground, and nothing may be built on anything (see CLAUDE.md).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import PLAN, { R } from './manifest.js';
import { PAL, paint, ink } from './style.js';
export { R };

const UP = new THREE.Vector3(0, 1, 0);
export const ll = (lat, lon) => {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), Math.cos(a) * Math.sin(b)).normalize();
};
export const llv = (p) => ll(p[0], p[1]);
export const arc = (a, b) => a.angleTo(b) * R;                 // world-unit distance along the surface
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ── terrain: features from the plan, gentle hills in between ──
const T = PLAN.terrain;
const F = {
  plateau: { d: llv(T.plateau.at), r: T.plateau.r },
  sea: { d: llv(T.sea.at), r: T.sea.r, depth: T.sea.depth },
  bay: { d: llv(T.bay.at), r: T.bay.r, depth: T.bay.depth },
  mtn: { d: llv(T.mountain.at), r: T.mountain.r, h: T.mountain.height },
};
export const SEA = 0.0;                                         // sea level above R
const LAND = 0.45;                                              // the plateau's level
const extraFlats = [];                                          // {d, r, h} — sites level their own ground
// plane: a tangent point (unit dir). Then the ground is levelled to a true flat PLANE
// touching the planet there, not a curved shell: on a radius-40 planet a 14-unit
// building's edges would otherwise sit ~0.6 above the ground (floating, looking slanted).
// lawn: paint the levelled ground (and its easing) grass however high it stands — see inLawn()
export function flatten(d, r, h = LAND, { plane = null, blend = null, lawn = false } = {}) { extraFlats.push({ d: d.clone(), r, h, plane: plane?.clone(), blend, lawn }); }

// rivers and lakes carved like the sea (after everything else): isWater sees them, and the sea
// sheet (one sphere at sea level) shows through wherever the ground dips under it.
// addRiver: a polyline of directions, `half` = the carve's outer half-width (banks included);
// addLake: a round pool. Each keeps a bounding cap so far-off points skip it cheaply.
const WATERS = [];
export function addRiver(pts, half = 2.4, depth = 0.9) {
  const P = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = Math.max(1, Math.ceil(arc(pts[i], pts[i + 1]) / 0.45));
    for (let k = 0; k < n; k++) P.push(slerpDir(pts[i], pts[i + 1], k / n));
  }
  P.push(pts[pts.length - 1].clone());
  const c = P.reduce((a, p) => a.add(p), new THREE.Vector3()).normalize();
  const reach = Math.max(...P.map(p => p.angleTo(c))) + (half + 0.5) / R;
  const xyz = new Float32Array(P.length * 3); P.forEach((p, i) => xyz.set([p.x, p.y, p.z], i * 3));
  WATERS.push({ kind: 'river', pts: P, xyz, half, depth, c, cosReach: Math.cos(reach) });
  return P;
}
export function addLake(d, r, depth = 1.0) { WATERS.push({ kind: 'lake', c: d.clone().normalize(), r, depth, cosReach: Math.cos((r + 0.5) / R) }); }
export const RIVERS = WATERS;
// in a river's or lake's carve (its bed and banks)
export function inFreshWater(d) {
  for (const w of WATERS) if (d.dot(w.c) >= w.cosReach && waterDist(w, d) < (w.kind === 'lake' ? w.r : w.half)) return true;
  return false;
}
function waterDist(w, d) {                                       // world units to the water's middle
  if (w.kind === 'lake') return arc(d, w.c);
  let best = -2; const X = w.xyz;
  for (let i = 0; i < X.length; i += 3) { const t = d.x * X[i] + d.y * X[i + 1] + d.z * X[i + 2]; if (t > best) best = t; }
  return Math.acos(Math.min(1, best)) * R;
}

export function surfH(d) {
  // rolling hills: three soft, incommensurate waves
  let h = LAND + T.hills * (
    Math.sin(d.x * 2.1 + 0.7) * Math.sin(d.y * 1.7 + 2.2) * 0.9 +
    Math.sin(d.z * 3.3 + 1.1) * Math.sin(d.x * 2.9 + 0.4) * 0.6 +
    Math.sin(d.y * 4.6 + 0.9) * 0.35);
  // the mountain
  const dm = arc(d, F.mtn.d);
  if (dm < F.mtn.r) { const k = 1 - dm / F.mtn.r; h += F.mtn.h * k * k * (3 - 2 * k); }
  // level ground for town and every site that asked for it
  const dp = arc(d, F.plateau.d);
  h += (LAND - h) * (1 - ss(F.plateau.r, F.plateau.r + 7, dp));
  for (const f of extraFlats) {
    const df = arc(d, f.d), blend = f.blend ?? (f.plane ? 9 : 5);
    if (df < f.r + blend + 1) {
      // a plane rises off the sphere as you leave its tangent point: past its edge it holds the
      // edge's height while it eases out (it used to keep climbing there, and threw up a ~5-high
      // ridge round the museum — the steep hill the project roads ran over)
      // (the plane's height is measured from ITS tangent point, not the flat's centre — they
      // differ for the museum, and measuring from the centre lifted the forecourt's lawn over its paving)
      const pd = df <= f.r || !f.plane ? d : slerpDir(f.d, d, f.r / df);
      const target = f.plane ? (R + f.h) / Math.max(0.5, pd.dot(f.plane)) - R : f.h;
      h += (target - h) * (1 - ss(f.r, f.r + blend, df));
    }
  }
  // water last: the sea and its bay carve below everything
  for (const w of [F.sea, F.bay]) {
    const dw = arc(d, w.d);
    if (dw < w.r) h += (-w.depth - h) * (1 - ss(w.r * 0.7, w.r, dw));
  }
  for (const w of WATERS) {
    if (d.dot(w.c) < w.cosReach) continue;
    const dw = waterDist(w, d), r = w.kind === 'lake' ? w.r : w.half;
    if (dw < r) h += (-w.depth - h) * (1 - ss(r * 0.5, r, dw));
  }
  return h;
}
export const radiusAt = (d) => R + Math.max(surfH(d), SEA);
export const posOn = (d, lift = 0) => d.clone().multiplyScalar(radiusAt(d) + lift);
export const isWater = (d, m = 0.05) => surfH(d) < SEA - m;
export function alignToSurface(obj, d, yaw = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
  if (yaw) q.premultiply(new THREE.Quaternion().setFromAxisAngle(d, yaw));
  obj.quaternion.copy(q);
}
export function yawToFace(d, target) {
  const q0 = new THREE.Quaternion().setFromUnitVectors(UP, d);
  const v0 = new THREE.Vector3(0, 0, 1).applyQuaternion(q0);
  const f = target.clone().sub(d.clone().multiplyScalar(d.dot(target))).normalize();
  const c = new THREE.Vector3().crossVectors(v0, f);
  return Math.atan2(c.dot(d), v0.dot(f));
}
// a local frame at d: x east-ish, y = forward toward `toward` (or north)
export function frame(d, toward = null) {
  const fwd = (toward ? toward.clone() : UP.clone()).sub(d.clone().multiplyScalar(d.dot(toward || UP)));
  if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0).sub(d.clone().multiplyScalar(d.x));
  fwd.normalize();
  const side = new THREE.Vector3().crossVectors(fwd, d).normalize();
  return (x, y) => d.clone().multiplyScalar(R).addScaledVector(side, x).addScaledVector(fwd, y).normalize();
}
export function slerpDir(a, b, t) {
  const th = a.angleTo(b); if (th < 1e-6) return a.clone();
  const s = Math.sin(th);
  return a.clone().multiplyScalar(Math.sin((1 - t) * th) / s).addScaledVector(b, Math.sin(t * th) / s).normalize();
}
// sit a thing on the LOWEST ground under its footprint, a touch sunk
// ── floors: raised things you can stand on (the museum forecourt, platforms) ──
// each is an object on the planet plus a test in its local frame → the floor's
// local height there, or null. groundAt() is the terrain or the highest floor.
export const FLOORS = [];
// a building laid onto the terrain (buildings.js `conform`) sets userData.conform
// to its sink: its floor heights are then read above the ground under the point
export function addFloor(obj, test) { obj.updateWorldMatrix(true, false); FLOORS.push({ obj, test, inv: obj.matrixWorld.clone().invert(), dir: obj.position.clone().normalize(), reach: 12, conform: obj.userData.conform }); }
const _fp = new THREE.Vector3();
export function groundAt(d) {
  let r = radiusAt(d);
  for (const f of FLOORS) {
    if (f.dir.dot(d) < 0.95) continue;
    _fp.copy(d).multiplyScalar(r).applyMatrix4(f.inv);
    const y = f.test(_fp.x, _fp.z);
    if (y != null) r = Math.max(r, f.conform != null ? radiusAt(d) + y - f.conform : f.obj.position.length() + y);
  }
  return r;
}

export function settle(obj, d, half = 1, sink = 0.05, yaw = 0) {
  let r = groundAt(d);
  const f = frame(d);
  for (const [x, y] of [[half, 0], [-half, 0], [0, half], [0, -half], [half * .7, half * .7], [-half * .7, -half * .7]])
    r = Math.min(r, groundAt(f(x, y)));
  obj.position.copy(d).multiplyScalar(r - sink);
  alignToSurface(obj, d, yaw);
  return obj;
}

// ── the reservation map ──
export const ZONES = [];
export function reserve(d, r, key) { ZONES.push({ dir: d.clone().normalize(), r, key }); }
export function zoneHit(d, pad = 0, except = null) {
  for (const z of ZONES) { if (except && except(z)) continue; if (arc(d, z.dir) < z.r + pad) return z; }
  return null;
}
// push polyline samples out of reserved ground, relax, and let the zones have the last word
export function deflect(pts, { closed = false, clear = 1.6, keep = () => false, except = null } = {}) {
  const n = pts.length;
  const push = () => {
    let moved = false;
    for (let i = 0; i < n; i++) {
      if (keep(i)) continue;
      for (const z of ZONES) {
        if (except && except(z)) continue;
        const a = pts[i].angleTo(z.dir), want = (z.r + clear) / R;
        if (a >= want) continue;
        const perp = pts[i].clone().sub(z.dir.clone().multiplyScalar(z.dir.dot(pts[i])));
        if (perp.lengthSq() < 1e-10) perp.set(1, 0, 0);
        perp.normalize();
        pts[i] = z.dir.clone().multiplyScalar(Math.cos(want)).addScaledVector(perp, Math.sin(want)).normalize();
        moved = true;
      }
    }
    return moved;
  };
  for (let pass = 0; pass < 10; pass++) {
    if (!push()) break;
    const out = pts.map(p => p.clone());
    for (let i = 0; i < n; i++) {
      if (keep(i) || (!closed && (i === 0 || i === n - 1))) continue;
      out[i] = pts[i].clone().multiplyScalar(2).add(pts[(i - 1 + n) % n]).add(pts[(i + 1) % n]).normalize();
    }
    for (let i = 0; i < n; i++) pts[i] = out[i];
  }
  push();
  return pts;
}
export function smooth(pts, passes = 3, closed = false) {
  for (let p = 0; p < passes; p++) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) { out.push(pts[i]); continue; }
      out.push(pts[i].clone().multiplyScalar(2).add(pts[(i - 1 + n) % n]).add(pts[(i + 1) % n]).normalize());
    }
    pts = out;
  }
  return pts;
}

// ── roads: every carriageway's centre-line samples, so nothing builds on one ──
export const ROADS = [];          // {pts, half}
// paved ground a car may drive off the road onto (car parks and their drives): (dir) => bool.
// Inside one, the car's keep-to-the-road assist lets go (player.js keepOnRoad)
export const LOTS = [];
// the painted road ribbons sit a hair above the ground: people stand ON them
const ROAD_TOP = 0.05, KERB_TOP = 0.035;
export function roadLift(d) {
  let lift = 0;
  for (const rd of ROADS) for (const p of rd.pts) {
    const a = arc(d, p);
    if (a < rd.half) return ROAD_TOP;
    if (a < rd.half + 0.28) lift = KERB_TOP;
  }
  return lift;
}
// …but the truth is what's DRAWN: forecourts, plazas, roads laid over slopes and
// bent buildings' floors can sit a few cm above the numbers above. Once the town is
// built, registerGround() indexes the static meshes; standAt then drops a short ray
// onto them and stands on the highest upward-facing surface just above the base ground.
const _ground = { meshes: [], spheres: [] };
const _rc = new THREE.Raycaster(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
export function registerGround(roots) {
  _ground.meshes.length = 0; _ground.spheres.length = 0; _standCache.clear();
  const walk = (o) => {                                   // skip whole subtrees that move (people, cars)
    if (o.userData.noGround) return;
    visit(o); for (const c of o.children) walk(c);
  };
  const visit = (o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.userData.isInk || o.userData.noGround) return;
    if (o.name === 'planet' || o.name === 'sea' || !o.geometry?.attributes?.position) return;
    if (o.material?.transparent || o.material?.blending === THREE.AdditiveBlending) return;
    o.updateWorldMatrix(true, false);
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const sph = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
    if (sph.radius > 60) return;
    _ground.meshes.push(o); _ground.spheres.push(sph);
  };
  for (const root of roots) walk(root);
}
const STEP_UP = 0.45;                                   // how far above the base ground a walkable surface may be
// the ground never moves, so each ~0.2-unit patch of the planet is measured once and cached
const _standCache = new Map(), CELL = 0.2;
export function standAt(d) {
  if (!_ground.meshes.length) return groundAt(d) + roadLift(d);
  const k = Math.round(d.x * R / CELL) + ',' + Math.round(d.y * R / CELL) + ',' + Math.round(d.z * R / CELL);
  let v = _standCache.get(k);
  if (v === undefined) {                                // measured at the cell's centre, so a cell that
    _cc.set(Math.round(d.x * R / CELL), Math.round(d.y * R / CELL), Math.round(d.z * R / CELL)).normalize();
    v = measureStand(_cc); _standCache.set(k, v);       // straddles a step reads the same whoever asks first
  }
  return v;
}
const _cc = new THREE.Vector3();
// ── footing: where a walker's FEET are, not just her centre ──
// Her shoes stride ~0.25 past her centre, so sampling only the centre leaves a
// foot inside a step's riser while she still stands on the ground below it.
// footing() reads a small ring round her. A raised FLOOR (addFloor: the museum
// forecourt, a platform, a pavement) that a foot reaches lifts her as soon as the
// shoe lands on it, if it is within a step of `ref` (her current height); one
// higher than that is a riser she can't climb, returned as `wall` (unit tangent
// toward it) so the walker stops at it instead of standing inside it. Small rises
// (kerbs, road ribbons) count too; other drawn bits (a window sill, a bench seat,
// a buffer stop) only count under her centre, as before.
export const STEP_CLIMB = STEP_UP + 0.1;               // a little slack: a 0.46 platform edge is still a step
const SMALL_RISE = 0.12;
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fp2 = new THREE.Vector3(), _fo = new THREE.Vector3();
export function footing(d, ref = null, reach = 0.26, N = 8) {
  const c = standAt(d), gc = groundAt(d);
  if (ref == null) ref = c;
  _fa.set(0, 1, 0); if (Math.abs(d.y) > 0.9) _fa.set(1, 0, 0);
  _fa.cross(d).normalize(); _fb.crossVectors(d, _fa);
  let top = c, wall = null;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2;
    _fo.copy(_fa).multiplyScalar(Math.cos(a)).addScaledVector(_fb, Math.sin(a));
    _fp2.copy(d).multiplyScalar(R).addScaledVector(_fo, reach).normalize();
    const g = groundAt(_fp2);
    if (g > ref + STEP_CLIMB) { (wall ??= new THREE.Vector3()).add(_fo); continue; }
    const h = standAt(_fp2);
    if (h > top && (g > gc + SMALL_RISE || h < c + SMALL_RISE)) top = h;
  }
  if (wall && wall.lengthSq() < 1e-8) wall.copy(_fo);   // walled in all round: any direction will do
  return { r: top, wall: wall && wall.normalize() };
}
function measureStand(d) {
  const base = groundAt(d) + roadLift(d);
  _rd.copy(d).negate(); _ro.copy(d).multiplyScalar(base + STEP_UP + 0.05);
  const near = [];
  for (let i = 0; i < _ground.meshes.length; i++) {
    const s = _ground.spheres[i];
    if (_rc.ray.set(_ro, _rd), _rc.ray.distanceSqToPoint(s.center) <= s.radius * s.radius) near.push(_ground.meshes[i]);
  }
  if (!near.length) return base;
  _rc.set(_ro, _rd); _rc.near = 0; _rc.far = STEP_UP + 0.15;
  let best = base;
  for (const h of _rc.intersectObjects(near, false)) {
    if (!h.face) continue;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    let up = n.dot(d);
    if (h.object.material?.side === THREE.DoubleSide) up = Math.abs(up);   // ribbons are drawn from both sides
    if (up < 0.6) continue;                             // walls and undersides don't count
    const r = h.point.length();
    if (r > best && r < base + STEP_UP) best = r;
  }
  return best;
}
// ── no plant on a road, a rail or a bridge deck (the deck is in ROADS): r = the plant's own
// footprint; the kerb strip and a little more are kept clear. Other systems (the railway)
// add their own tests with addBlocker ──
const BLOCKERS = [];
export function addBlocker(f) { BLOCKERS.push(f); }
export function decoBlocked(d, r = 0.3) { return onRoad(d, r + 0.4) || BLOCKERS.some(f => f(d, r)); }
// drop every plant (userData.deco) inside `root` that stands on a road or rail, and the walker's
// footprint markers placed with it; returns how many went. `root` must be placed (world matrices)
export function pruneDeco(root) {
  root.updateMatrixWorld(true);
  const gone = [], w = new THREE.Vector3();
  root.traverse(o => { if (o !== root && o.userData.deco && !gone.some(g => isAncestor(g, o))) { o.getWorldPosition(w); if (decoBlocked(w.clone().normalize(), o.userData.deco)) gone.push(o); } });
  for (const o of gone) {
    const par = o.parent; if (!par) continue;
    for (const f of [...par.children]) if (f.userData.foot && f.position.distanceTo(o.position) < 0.3) par.remove(f);
    par.remove(o);
  }
  return gone.length;
}
const isAncestor = (a, o) => { for (let q = o.parent; q; q = q.parent) if (q === a) return true; return false; };
export function onRoad(d, pad = 0) {
  for (const rd of ROADS) for (const p of rd.pts) if (arc(d, p) < rd.half + pad) return true;
  return false;
}
// the nearest road to a direction: which carriageway, how far from its centre
// line, which way it runs there. The car uses it to stay on the road. All the
// centre-line samples are packed once (after the town is built) for speed.
let _rp = null, _rn = 0;
export function nearestRoad(d) {
  const n = ROADS.reduce((a, r) => a + r.pts.length, 0);
  if (!_rp || _rn !== n) {
    _rp = { xyz: new Float32Array(n * 3), half: new Float32Array(n), road: new Int32Array(n), idx: new Int32Array(n) };
    let k = 0;
    ROADS.forEach((r, ri) => r.pts.forEach((p, pi) => { _rp.xyz.set([p.x, p.y, p.z], k * 3); _rp.half[k] = r.half; _rp.road[k] = ri; _rp.idx[k] = pi; k++; }));
    _rn = n;
  }
  // the road whose edge is nearest (most inside): minimise distance − half-width
  let best = -1, bestEx = 1e9, bestA = 0;
  const { xyz, half } = _rp;
  for (let k = 0; k < n; k++) {
    const dot = d.x * xyz[k * 3] + d.y * xyz[k * 3 + 1] + d.z * xyz[k * 3 + 2];
    if (dot < 0.97) continue;                                   // > ~10 units away
    const a = Math.acos(Math.min(1, dot)) * R, ex = a - half[k];
    if (ex < bestEx) { bestEx = ex; best = k; bestA = a; }
  }
  if (best < 0) return null;
  const rd = ROADS[_rp.road[best]], i = _rp.idx[best], P = rd.pts;
  const p = P[i], a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
  const tangent = b.clone().sub(a).projectOnPlane(p).normalize();
  return { point: p, dist: bestA, half: rd.half, tangent };
}

// a road ribbon laid ON the terrain, with a pale kerb underlay and a dashed
// centre line for the wide ones — painted, not modelled
const roadMat = paint(PAL.road, { hatch: 0 });
const kerbMat = paint(PAL.kerb, { hatch: 0 });
const dashMat = paint(PAL.dash, { hatch: 0 });
// where roads meet, one road's kerb and the next one's surface (or a dash and the surface)
// lie a hair apart over curved ground and flickered through each other: the surface draws
// in front of any kerb, and the dashes in front of the surface
for (const [m, o] of [[roadMat, -2], [dashMat, -4]]) { m.polygonOffset = true; m.polygonOffsetFactor = o; m.polygonOffsetUnits = o; }
for (const m of [roadMat, kerbMat, dashMat]) { m.polygonOffset = true; m.side = THREE.DoubleSide; }
roadMat.polygonOffsetFactor = -2; roadMat.polygonOffsetUnits = -2;
kerbMat.polygonOffsetFactor = -1; kerbMat.polygonOffsetUnits = -1;
dashMat.polygonOffsetFactor = -3; dashMat.polygonOffsetUnits = -3;
// the highest ground within a road sample's reach, + the carriageway's lift (as ribbon drapes it)
const _rt1 = new THREE.Vector3(), _rt2 = new THREE.Vector3(), _rtq = new THREE.Vector3();
function roadTop(dir) {
  _rt1.crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize(); _rt2.crossVectors(dir, _rt1);
  let r = radiusAt(dir);
  for (const [u, v] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.42, 0.42], [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42]])
    r = Math.max(r, radiusAt(_rtq.copy(dir).multiplyScalar(R).addScaledVector(_rt1, u).addScaledVector(_rt2, v).normalize()));
  return r + 0.06;
}
function ribbon(pts, half, lift, closed, mat, dashed = false) {
  // Draped ACROSS its width too: one height per cross-section tilted the strip
  // on a side-slope (the museum's levelled plane), so grass bit through one
  // edge and the other floated. Each vertex sits on the highest ground near it,
  // which also keeps it above the planet mesh's flat triangles on concave ground.
  const pos = [], idx = [], lat = new THREE.Vector3(), a1 = new THREE.Vector3(), a2 = new THREE.Vector3(), q = new THREE.Vector3();
  const n = pts.length, N = closed ? n + 1 : n;
  const L = dashed ? 1 : Math.max(2, Math.ceil((half * 2) / 0.45));
  const drape = (dir) => {
    a1.crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : lat).normalize(); a2.crossVectors(dir, a1);
    let r = radiusAt(dir);
    for (const [u, v] of [[0.38, 0], [-0.38, 0], [0, 0.38], [0, -0.38]]) r = Math.max(r, radiusAt(q.copy(dir).multiplyScalar(R).addScaledVector(a1, u).addScaledVector(a2, v).normalize()));
    return r;
  };
  for (let k = 0; k < N; k++) {
    const i = k % n;
    const d = pts[i], dn = pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)], dp = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)];
    const tang = dn.clone().sub(dp).normalize();
    lat.crossVectors(d, tang).normalize();
    for (let j = 0; j <= L; j++) {
      const dir = d.clone().multiplyScalar(R).addScaledVector(lat, half - (2 * half * j) / L).normalize();
      pos.push(...dir.multiplyScalar(drape(dir.clone()) + lift).toArray());
    }
  }
  for (let k = 0; k < N - 1; k++) {
    if (dashed && (k % 3) !== 0) continue;
    for (let j = 0; j < L; j++) {
      const a = k * (L + 1) + j, b = a + L + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.userData.noInk = true;
  return m;
}
// resample a polyline so samples are ~step units apart (ribbons stay smooth)
export function resample(pts, step = 0.6, closed = false) {
  const out = [];
  const n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const k = Math.max(1, Math.round(arc(a, b) / step));
    for (let j = 0; j < k; j++) out.push(slerpDir(a, b, j / k));
  }
  if (!closed) out.push(pts[n - 1].clone());
  return out;
}
export function buildRoad(scene, pts, { half = 1.1, closed = false, dashed = true } = {}) {
  pts = resample(pts, 0.6, closed);
  const g = new THREE.Group();
  ROADS.push({ pts, half, closed, dashed: dashed && half > 0.8, group: g });
  g.add(ribbon(pts, half + 0.28, 0.03, closed, kerbMat));
  g.add(ribbon(pts, half, 0.06, closed, roadMat));
  scene.add(g);
  return pts;
}

// ── centre lines, painted once every road exists ──
// Straight dashes at an even spacing along each road's length (never bent round a
// sample corner). None inside a junction: a dash is dropped where another road's
// carriageway crosses it, and where two roads run on top of each other only the
// first-built one is painted — so lines never double up, kink or form L shapes.
export function paintRoadMarkings() {
  const DASH = 0.8, GAP = 1.1, W = 0.07;
  const near = (d, i, tang) => {
    for (let j = 0; j < ROADS.length; j++) {
      if (j === i) continue;
      const o = ROADS[j];
      for (let k = 0; k < o.pts.length; k++) {
        if (arc(d, o.pts[k]) >= o.half + 0.35) continue;              // arc() is already in world units
        const ot = o.pts[Math.min(k + 1, o.pts.length - 1)].clone().sub(o.pts[Math.max(k - 1, 0)]).normalize();
        if (j < i || Math.abs(ot.dot(tang)) < 0.9) return true;          // a crossing, or an earlier road on the same line
      }
    }
    return false;
  };
  ROADS.forEach((rd, i) => {
    if (!rd.dashed) return;
    const P = rd.closed ? [...rd.pts, rd.pts[0]] : rd.pts;
    const cum = [0]; for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + arc(P[k - 1], P[k]));
    const total = cum[cum.length - 1];
    const at = (s) => { let k = 1; while (k < cum.length - 1 && cum[k] < s) k++; const t = (s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]); return slerpDir(P[k - 1], P[k], THREE.MathUtils.clamp(t, 0, 1)); };
    const pos = [], idx = [];
    for (let s = GAP / 2; s + DASH < total - GAP / 2; s += DASH + GAP) {
      const c = at(s + DASH / 2), a = at(s), b = at(s + DASH);
      const tang = b.clone().sub(a).normalize();
      if (near(c, i, tang) || near(a, i, tang) || near(b, i, tang)) continue;
      const lat = new THREE.Vector3().crossVectors(c, tang).normalize();
      const base = pos.length / 3;
      for (let u = 0; u <= 6; u++) {                           // a straight dash, draped in 6 steps along its length
        const along = (u / 6 - 0.5) * DASH;
        for (const sx of [-1, 1]) {
          const d = c.clone().multiplyScalar(R).addScaledVector(tang, along).addScaledVector(lat, sx * W).normalize();
          // never below the road's own top (the ribbon's drape + its 0.06 lift): a ray slipping
          // through a seam to the grass sank one corner and notched the dash
          pos.push(...d.multiplyScalar(Math.max(standAt(d), roadTop(d)) + 0.016).toArray());
        }
      }
      for (let u = 0; u < 6; u++) { const q = base + u * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, dashMat); m.userData.noInk = true; m.userData.noGround = true;
    rd.group.add(m);
  });
}

// ── the DRAWN ground: the planet mesh's own surface along a direction. radiusAt is the exact
// terrain, but the mesh cuts straight across it between its vertices (~0.75 apart) — where the
// ground curves hard (a levelled site's edge easing into the hills) the drawn ground sits a
// little below it, and anything laid on radiusAt there hovers. Landscaping lays onto this. ──
let DG = null;
function indexDrawnGround(geo) {
  const pos = geo.attributes.position, idx = geo.index, P = Float32Array.from(pos.array), CELL = 0.02, buckets = new Map();
  const n = idx ? idx.count / 3 : pos.count / 3, tri = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) tri[t * 3 + k] = idx ? idx.getX(t * 3 + k) : t * 3 + k;
  for (let t = 0; t < n; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { const i = tri[t * 3 + k] * 3; x += P[i]; y += P[i + 1]; z += P[i + 2]; }
    const l = Math.hypot(x, y, z), key = `${Math.floor(x / l / CELL)},${Math.floor(y / l / CELL)},${Math.floor(z / l / CELL)}`;
    let a = buckets.get(key); if (!a) buckets.set(key, a = []); a.push(t);
  }
  DG = { P, tri, buckets, CELL };
}
export function drawnGroundAt(d) {
  if (!DG) return radiusAt(d);
  const { P, tri, buckets, CELL } = DG, l = d.length(), dx = d.x / l, dy = d.y / l, dz = d.z / l;
  const fx = Math.floor(dx / CELL), fy = Math.floor(dy / CELL), fz = Math.floor(dz / CELL);
  let best = -1;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const arr = buckets.get(`${fx + i},${fy + j},${fz + k}`); if (!arr) continue;
    for (const t of arr) {                     // a ray from the centre through the triangle (Möller–Trumbore)
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const tx = -P[a], ty = -P[a + 1], tz = -P[a + 2];
      const u = (tx * px + ty * py + tz * pz) / det; if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const w = (dx * qx + dy * qy + dz * qz) / det; if (w < -1e-6 || u + w > 1 + 1e-6) continue;
      const r = (e2x * qx + e2y * qy + e2z * qz) / det; if (r > best) best = r;
    }
  }
  return best > 0 ? best : radiusAt(d);
}

// ── the planet mesh: painted in posterized bands with a watercolour wobble ──
// the ground's paint at a point (direction v, height h): the planet's own bands, and a river or
// lake bed a smooth sand → pebble → deep gradient by depth. Shared by the planet and the fine
// riverbed mesh (riverlife.js) so their colours meet without a seam
const _GC = {}, GC = (hex) => (_GC[hex] ??= new THREE.Color(hex));
export function groundColour(v, h, c, fresh = h < SEA + 0.02 && inFreshWater(v)) {
  const wash = Math.sin(v.x * 7.1 + 1.3) * Math.sin(v.z * 6.3 + 0.2) + Math.sin(v.y * 9.7) * 0.5;   // a slow watercolour wash, posterized into bands
  if (fresh) {
    const dd = -h;
    return c.copy(GC(PAL.sand)).lerp(GC(0xbfae84), ss(0.02, 0.35, dd)).lerp(GC(0x8fa38e), ss(0.4, 0.85, dd));
  }
  if (h < SEA - 0.05) return c.copy(GC(PAL.waterDeep));
  if (h < SEA + 0.22) return c.copy(GC(PAL.sand));
  if (h > 1.4 && !inLawn(v, wash)) {
    if (h > 2.6) return c.copy(GC(PAL.snow));
    return c.copy(GC(PAL.rock)).lerp(GC(PAL.earth), wash > 0 ? 0.3 : 0);
  }
  return c.copy(GC(wash > 0.45 ? PAL.meadow : wash < -0.5 ? PAL.grassDeep : PAL.grass));
}
// A levelled site that asked for a lawn (flatten { lawn: true }) is painted grass however high
// it stands. The bands above go by height alone (over 1.4 is rock/earth, over 2.6 snow), and a
// site levelled to a true PLANE on a hilltop sits high: Makers' Row's plane touches the planet at
// ~1.2 and rises off the sphere toward its rim (~2.9 at r 11), so its whole yard and easing ring
// came out bare beige "earth" round the car park. Opt-in, so no other site changes. The lawn
// reaches into the easing ring by a wash-wobbled amount, so where it meets the natural hillside's
// colour the edge is soft and irregular, not a drawn circle.
function inLawn(v, wash) {
  for (const f of extraFlats) {
    if (!f.lawn) continue;
    const blend = f.blend ?? (f.plane ? 9 : 5);
    if (arc(v, f.d) < f.r + blend * (0.72 + 0.14 * wash)) return true;
  }
  return false;
}
export let groundMaterial = null;
export function buildPlanet(scene) {
  let g = mergeVertices(new THREE.IcosahedronGeometry(R, 56));
  const p = g.attributes.position, v = new THREE.Vector3();
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const h = surfH(v), fresh = h < SEA + 0.02 && inFreshWater(v);
    // under a river or lake the coarse planet sinks well out of sight: the fine bed mesh
    // (riverlife.js) is the bed you see — the planet's big triangles showed through the clear
    // water as starbursts and jagged blotches
    const r = R + h - (fresh ? 1.6 : 0);
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
    groundColour(v, h, c, fresh);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, groundMaterial = paint(0xffffff, { vertexColors: true, hatch: 0.6 }));
  mesh.userData.noInk = true;          // the ground's edge is the horizon; ink it with the rim below
  mesh.name = 'planet';
  indexDrawnGround(g);
  scene.add(mesh);
  // the sea: one flat sheet of gouache, slightly translucent at the shore
  const sea = new THREE.Mesh(new THREE.IcosahedronGeometry(R + SEA, 24), paint(PAL.water, { hatch: 0.4 }));
  sea.userData.noInk = true; sea.name = 'sea';
  scene.add(sea);
  // a single ink rim around the whole planet: the horizon line of the drawing
  const rim = new THREE.Mesh(new THREE.IcosahedronGeometry(R + 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  rim.visible = false;
  return { mesh, sea };
}

// ── sky: a soft watercolour wash behind everything (no stars, no bloom) ──
export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0xbcd3dc) }, mid: { value: new THREE.Color(0xf2e6cf) }, low: { value: new THREE.Color(0xf6d9bf) }, upv: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    // the gradient follows the camera's own "up" — on a tiny planet, up is wherever you stand
    fragmentShader: `uniform vec3 top, mid, low, upv; varying vec3 vP;
      void main(){
        float y = dot(normalize(vP), upv) + 0.08;
        vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, y)) : mix(mid, low, smoothstep(0.0, -0.6, y));
        // paper tooth on the sky too
        vec2 fc = gl_FragCoord.xy;
        float g = fract(sin(dot(floor(fc / 2.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        gl_FragColor = vec4(c * (1.0 + g * 0.03), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.userData.noInk = true; sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xfff6e8, 0xb7a9a0, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(60, 80, 50);
  scene.add(sun);
  return { hemi, sun };
}

// drawn clouds: flat puffs with ink, drifting slowly round the planet
export function buildClouds(scene, n = 9, rand = Math.random) {
  const group = new THREE.Group();
  const mat = paint(0xfffaf0, { hatch: 0 });
  for (let i = 0; i < n; i++) {
    const piv = new THREE.Group();
    const cl = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < puffs; k++) {
      const s = 1.1 + rand() * 1.1;
      const p = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), mat);
      p.position.set((k - puffs / 2) * 1.5, rand() * 0.5, rand() * 0.6);
      p.scale.y = 0.55;
      cl.add(p);
    }
    ink(cl, 'fine');
    cl.position.y = R + 9 + rand() * 4;
    piv.add(cl);
    piv.rotation.set(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI);
    piv.userData.spin = 0.006 + rand() * 0.01;
    group.add(piv);
  }
  scene.add(group);
  return group;
}
