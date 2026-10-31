// ─── TOWN: reservations first, then roads, then buildings ───────────────────
// Order matters and is the whole point: every structure reserves its ground,
// THEN roads are laid around the reservations, THEN buildings fill the blocks
// the roads leave. Nothing can be built on anything.
import * as THREE from 'three';
import PLAN from './manifest.js';
import { R, llv, arc, frame, slerpDir, reserve, zoneHit, deflect, smooth, buildRoad, ROADS, onRoad,
  settle, yawToFace, radiusAt, flatten, addFloor, isWater, alignToSurface, posOn, nearestRoad, surfH, decoBlocked } from './world.js';
import { PAL, paint, ink, blobShadow } from './style.js';
import { house, tree, pine, bush, lamp, bench, rnd, pick, rbox, lathe } from './props.js';
import { buildMuseum } from '../museum.js?v=12';
import { planHarbour, buildHarbour } from './harbour.js';
import { MAIN_STREET, buildShop, stripMall, mallDrive, mallPylon, station, townBlock, capeFarSide, placeOnPlanet, batchPlaced, bookLibrary, projectShop, isProjectShop, STATION_TRACK, parkGarden, shopLot, SHOP_LOT } from './buildings.js';
import { parkedTrain } from './train.js';
import { museumGrounds, shopApproach, APPROACH_STOP, APPROACH_Z1, MOUTH_LAP, makersRow, ROW_X, ROW, ROW_MOUTH_LAP } from './grounds.js';
import { growPlants } from './plants.js';
import { railLoop, buildRailway, onRail } from './rail.js';
import { planNorth, buildNorth } from './north.js';
import { dressRoads } from './roadside.js';

export const TOWN_C = llv(PLAN.town.center);
const ROAD_MAJOR = 1.05, ROAD_MINOR = 0.62;
// Main Street runs along the town frame's y = 0 line, museum end → east. Its
// two rows of shops front onto it at |y| = SHOP_Y; the minor streets that
// would cut the terraces are left out, so the frontages run unbroken.
const SHOP_Y = 2.75, SHOP_D = 2.7;
const P0 = PLAN.town.pitch;
const minorCut = (axis, i, x, y) => i % 2 !== 0 && (axis === 0 || Math.abs(y) < 2 * P0 - ROAD_MAJOR);
const inShops = (x, y, pad = 0) => Math.abs(y) > SHOP_Y - 1.5 - pad && Math.abs(y) < SHOP_Y + SHOP_D + pad &&
  [...MAIN_STREET.north, ...MAIN_STREET.south].some(t => x > t.x[0] - pad && x < t.x[1] + pad);
const MALL = PLAN.town.mall;
// a direction → town-frame [x, y] (the inverse of frame(TOWN_C))
const _fwdT = new THREE.Vector3(0, 1, 0).sub(TOWN_C.clone().multiplyScalar(TOWN_C.y)).normalize();
const _sideT = new THREE.Vector3().crossVectors(_fwdT, TOWN_C).normalize();
const toTown = (d) => { const t = d.clone().divideScalar(d.dot(TOWN_C)).multiplyScalar(R); return [t.dot(_sideT), t.dot(_fwdT)]; };

// restyle a model built with standard materials into the gouache look
export function restyle(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const conv = (m) => {
      if (!m || m.isShaderMaterial || m.userData?.keep) return m;
      if (m.blending === THREE.AdditiveBlending) return m;          // light beams stay light
      const col = m.color ? m.color.getHex() : 0xffffff;
      const emiss = m.emissive && m.emissive.getHex() !== 0 ? m.emissive.getHex() : undefined;
      return paint(col, { map: m.map || undefined, opacity: m.transparent ? Math.max(0.35, m.opacity) : 1,
        side: m.side, emissive: emiss, hatch: m.map ? 0 : 1 });
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  return root;
}

// ── Makers' Row (landscaping): Behavior Search moves beside Borrowed Eyes, the two facing one
// level cobbled car park (grounds.js makersRow). The row's centre sits on the dry side of Borrowed
// Eyes; ROW.L(x, z) maps the row's own frame (shop-like: +z toward town, x mirrored from frame())
// to a direction. PDIR: every project's direction (the row's two come from it) ──
const ROW_KEYS = ['borrowed-eyes', 'behaviors'];
const PDIR = {};
let ROWP = null;
function resolveRow() {
  if (ROWP) return ROWP;
  for (const p of PLAN.projects) PDIR[p.key] = llv(p.at);
  const eyes = PDIR['borrowed-eyes'], f0 = frame(eyes, TOWN_C);
  // the hub somewhere round Borrowed Eyes where the row's whole yard is dry and clear of other
  // reserved ground (the museum, the sites…): fewest bad samples wins, then the smallest move
  let best = null;
  for (const s of [1, -1]) for (const k of [ROW_X, ROW_X + 2, ROW_X + 4, ROW_X - 2, ROW_X + 6]) for (const fy of [0, -2, -4, 2]) {
    const hub = f0(s * k, fy), f = frame(hub, TOWN_C);
    let bad = 0;
    for (let x = -12; x <= 12; x += 1.5) for (let y = -5; y <= 13; y += 1.5) {
      const w = f(x, y);
      if (isWater(w, 0.6) || zoneHit(w, 0.4, z => !z.key.startsWith('lm:')) || arc(w, mF(0, -7.5)) < 13.5) bad++;   // (the museum's grounds reach past its zone)
    }
    const cost = bad * 10 + Math.abs(k - ROW_X) + Math.abs(fy);
    if (!best || cost < best.cost) best = { hub, cost, s, k, fy };
  }
  const f = frame(best.hub, TOWN_C);
  const L = (x, z) => f(-x, z);                       // shop-like local frame (local +x is frame −x)
  // Borrowed Eyes stays (near enough) where it was; Behavior Search takes the other side
  const eyesX = best.s * ROW_X;                       // f0(s·X) is the hub, so Eyes sits at frame −s·X = local +s·X
  ROWP = { hub: best.hub, L, x: { 'borrowed-eyes': eyesX, behaviors: -eyesX } };
  PDIR['borrowed-eyes'] = L(eyesX, 0); PDIR.behaviors = L(-eyesX, 0);
  return ROWP;
}

// a ground piece's frame as placeOnPlanet sets it down at `hub` facing `yaw`, with exact
// conversions between a world direction and its own (x, z) — the piece is laid on the ground
// along its OWN up (placeOnPlanet's conform), so frame()'s tangent-plane units and a radius-R
// point run through the inverse matrix are both a few % off at its edge (that put a spur's end
// ~0.4 out). Used to run a spur road exactly onto a paved edge (Makers' Row, the shops' forecourts)
function placeFrame(hub, yaw) {
  const probe = new THREE.Object3D();
  settle(probe, hub, 0, 0, yaw); probe.updateMatrixWorld(true);
  const inv = probe.matrixWorld.clone().invert();
  const toLocal = (dir) => dir.clone().normalize().multiplyScalar(radiusAt(dir)).applyMatrix4(inv);
  const toDir = (x, z) => {                        // the ground straight below local (x, z), as a direction
    const v = new THREE.Vector3(x, 0, z);
    for (let it = 0; it < 3; it++) { const w = probe.localToWorld(v.clone()).normalize(); v.y = toLocal(w).y; }
    return probe.localToWorld(v).normalize();
  };
  return { hub, yaw, probe, inv, toLocal, toDir };
}
// the row's car park as it is placed (makersRow, below)
function rowPlace() {
  const RW = resolveRow(), hub = RW.L(0, 0);
  return placeFrame(hub, yawToFace(hub, RW.L(0, 40)));
}
// a project shop's cobbled forecourt (shopApproach, below), where it has one: not in the row, no car park
const hasForecourt = (p) => isProjectShop(p.style) && !ROW_KEYS.includes(p.key) && !p.lot;
const shopPlace = (p) => placeFrame(PDIR[p.key], yawToFace(PDIR[p.key], TOWN_C));

// ── the museum's sculpture garden (landscaping) sits on its OWN level terrace: behind the museum
// the ground rises off the museum's flat, and laid onto that slope the pool tilted and floated.
// Its spot (museum-local [x, z]) is picked here, before the planet is shaped, well behind the
// back walk (the building, forecourt and lawn keep their levels) and clear of the project shops;
// the terrace takes the ground's height at its centre ──
export const GARDEN_R = 3.9;                           // the garden's reach (pool, paving ring, plinths, benches)
let MGARDEN = null;
function planMuseumGarden() {
  resolveRow();
  const W = (x, z) => mF(-x, z);                       // museum-local → direction (museum +x is the frame's −x)
  const shops = PLAN.projects.filter(p => !ROW_KEYS.includes(p.key)).map(p => [PDIR[p.key], 5.6]);
  shops.push([ROWP.L(0, 4.2), 11.0]);
  for (const [x, z] of [[4.2, -20.4], [-3.8, -20.0], [2.4, -21.4], [6.6, -19.9], [-1.0, -21.6], [-5.6, -19.2]]) {
    const c = W(x, z);
    if (z > -13.0 - GARDEN_R - 1.5) continue;   // the terrace (and its easing) stays clear of the walk and the building
    if (shops.some(([d, r]) => arc(c, d) < r + GARDEN_R + 0.5)) continue;
    let wet = false; for (let a = 0; a < 6.3; a += 0.8) if (isWater(W(x + Math.sin(a) * GARDEN_R, z + Math.cos(a) * GARDEN_R), 0.3)) wet = true;
    if (wet || zoneHit(c, GARDEN_R, zz => !zz.key.startsWith('museum'))) continue;
    flatten(c, GARDEN_R + 0.5, surfH(c), { plane: c, blend: 3.5 });
    reserve(c, GARDEN_R, 'museum-garden');
    return (MGARDEN = [x, z]);
  }
  return null;
}

// ── 1. RESERVE — runs BEFORE the planet is shaped (sites level their ground) ──
const mDir = llv(PLAN.museum.at);
const mF = frame(mDir, TOWN_C);                            // +y local = toward town
export function planTown() {
  planNorth();                                            // the river and the north's ground (north.js)
  reserve(mF(0, -0.3), 4.4, 'museum-plaza');
  reserve(mF(0, -7.0), 8.4, 'museum');
  // the museum stands on a true plane (tangent at its forecourt, so the forecourt is level);
  // the plane only needs to reach past the building, its ramp and the ruts (r 9.5 round its
  // middle). Past that the ground eases back to the plateau over 16 — it used to hold the plane
  // out to r 12 (4.5 above the sphere behind the museum) and drop off in 9, a steep shelf every
  // road out of town's west side climbed (grades of 0.5)
  flatten(mF(0, -6), 9.5, 0.45, { plane: mDir, blend: 16 });
  for (const [k, s] of Object.entries(PLAN.sites)) {
    const c = s.shift ? frame(llv(s.at), TOWN_C)(0, s.shift) : llv(s.at);
    reserve(c, s.r, 'site:' + k); flatten(c, s.r + 1);
    if (k === 'harbour') planHarbour(c, TOWN_C);          // the quay's land: a true plane, its ground kept clear
  }
  const fT = frame(TOWN_C);
  reserve(fT(MALL.zone[0], MALL.zone[1]), MALL.r, 'mall'); flatten(fT(MALL.zone[0], MALL.zone[1]), MALL.r + 2);
  // each project shop gets a wide level yard that eases out gently (its spur road arrives on the flat)
  // (level at the height the ground already has there, not pulled down to the plateau's: a yard
  // on the museum's shoulder dug a hollow, and the roads either side of it rose and fell steeply)
  const RW = resolveRow();
  for (const p of PLAN.projects) {
    const inRowP = ROW_KEYS.includes(p.key), h = Math.max(0.45, surfH(PDIR[p.key]));
    reserve(PDIR[p.key], 4.2, 'lm:' + p.key);
    if (!inRowP) flatten(PDIR[p.key], 6.5, h, { blend: 10 });
    // …and a shop with a car park beside it keeps that ground too, level with its yard (the shop's
    // local x is the frame's −x: the shop faces town). Makers' Row shares one car park instead.
    if (p.lot && !inRowP) { const c = frame(PDIR[p.key], TOWN_C)(-p.lot * 5.7, 2.15); reserve(c, 5.0, 'lot:' + p.key); flatten(c, 4.9, h, { blend: 5 }); }
  }
  // Makers' Row: its shops and car park on one true plane (at the ground's own height there), so
  // nothing on it floats or tilts
  { const c = RW.L(0, 4.2); reserve(c, 10.6, 'lm:row'); flatten(c, 11.4, Math.max(0.45, surfH(c)), { plane: c, blend: 8 }); }
  reserve(llv(PLAN.park.at), PLAN.park.r, 'park'); flatten(llv(PLAN.park.at), PLAN.park.r + 1, undefined, { blend: 6 });
  planMuseumGarden();                                     // last: it keeps clear of everything reserved above
}

export function buildTown(scene) {
  const out = { landmarks: [], sites: {}, museum: null, statics: [], colliders: [] };
  // soft: a person — the car knocks them flying (bump.js) instead of stopping; everything else stops it
  const solid = (d, r, soft = false) => out.colliders.push({ dir: d.clone(), r, soft });
  // street furniture baked into a placed building (benches, lamp posts, planters,
  // post boxes…) left [x, z, r] footprints in its userData.foots (buildings.js `foot`)
  const feet = (g) => { g.updateWorldMatrix(true, false); for (const [x, z, r] of g.userData.foots || []) solid(g.localToWorld(new THREE.Vector3(x, 0, z)).normalize(), r); };
  const add = (obj) => { scene.add(obj); out.statics.push(obj); return obj; };

  // ── 2. ROADS ───────────────────────────────────────────────────────────────
  // the boulevard: a ring round town, bent round anything reserved
  const B = PLAN.town.boulevard, ring = [];
  const fC = frame(TOWN_C);
  for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2; ring.push(fC(Math.cos(a) * B, Math.sin(a) * B)); }
  deflect(ring, { closed: true });
  const ringS = smooth(ring, 2, true);
  deflect(ringS, { closed: true });                          // smoothing must not cut back into a zone
  out.boulevard = buildRoad(scene, ringS, { half: ROAD_MAJOR, closed: true });

  // downtown grid, clipped to the reservation map
  const P = PLAN.town.pitch, CAP = PLAN.town.radius, K = Math.ceil(CAP / P);
  const inTown = (x, y) => Math.hypot(x, y) <= CAP;
  // streets keep 0.6 clear of reserved ground — except the museum plaza, the paved
  // forecourt Main Street is meant to arrive at (0.6 there cuts its last junction)
  const free = (x, y, half) => !zoneHit(fC(x, y), half + 0.6, z => z.key === 'museum-plaza') && !zoneHit(fC(x, y), half + 0.3);
  const lines = [];                                          // each grid line as runs of free samples
  // CITY PLANNING: every street meets another one. The middle cross (i = 0) runs on out to the
  // boulevard and ends IN it (a T junction) — it used to stop 2–3 short, leaving three stubs
  // dead-ending on the grass between the houses; and a street that touches the boulevard (where
  // the ring bends in round the museum) ends there instead of running on top of it
  const blvdD = (d) => { let m = 1e9; for (const p of out.boulevard) { const a = arc(p, d); if (a < m) m = a; } return m; };
  const onBlvd = (d) => blvdD(d) < ROAD_MAJOR * 0.55;
  for (let axis = 0; axis < 2; axis++) {
    for (let i = -K; i <= K; i++) {
      const major = i % 2 === 0, half = major ? ROAD_MAJOR : ROAD_MINOR;
      const reach = i === 0 ? B + 2 : CAP;                   // the cross may run out to the ring
      let run = [], last = null, inside = i !== 0;           // (the cross starts outside the ring)
      const close = () => { if (run.length > 4) lines.push({ pts: run, half }); run = []; };
      for (let j = -K * 6; j <= K * 6; j++) {
        const t = j * P / 4;
        const x = axis ? i * P : t, y = axis ? t : i * P;
        const ok = Math.hypot(x, y) <= reach && free(x, y, half) && !minorCut(axis, i, x, y);
        if (!ok) { close(); last = null; continue; }
        const d = fC(x, y);
        if (onBlvd(d)) {
          if (run.length) { run.push(d); close(); if (i === 0) inside = false; }   // the cross leaves the ring here
          else if (i === 0) inside = true;                                      // …and enters it here
          last = d; continue;
        }
        if (!inside && i === 0) continue;                    // still outside the ring
        if (!run.length && last) run.push(last);             // start on the boulevard we just left
        run.push(d); last = null;
      }
      close();
    }
  }
  // a street whose run stopped one sample short of the street it meets (that sample fell on
  // reserved ground) ends a hair outside it: the gap between the two surfaces showed the kerb
  // under them as a thin strip poking into the road (by the library). Carry each such end on
  // into the other street, to its middle line
  for (const L of lines) for (const e of [0, 1]) {
    const pts = L.pts, end = e ? pts[pts.length - 1] : pts[0], prev = e ? pts[pts.length - 2] : pts[1], step = arc(prev, end);
    let best = null, bd = 1e9;
    for (let s = 0.1; s <= 1.6; s += 0.05) {
      const q = slerpDir(prev, end, 1 + s / step);
      for (const M of lines) {
        if (M === L) continue;
        for (const m of M.pts) { const a = arc(q, m); if (a < M.half && a < bd) { bd = a; best = q; } }
      }
    }
    if (!best) continue;
    let inAlready = false;                                   // (it already ends inside one: leave it)
    for (const M of lines) if (M !== L && M.pts.some(m => arc(end, m) < M.half - 0.05)) inAlready = true;
    if (inAlready) continue;
    if (e) pts.push(best); else pts.unshift(best);
  }
  for (const L of lines) buildRoad(scene, L.pts, { half: L.half, dashed: L.half > 0.9 });

  // spurs: boulevard → each site / project, ending in front of it
  // (via: a point it passes on its way in — a forecourt's spur comes in square to the paving's
  // edge from there, so its square end lies along that edge: no wedge of grass at one corner)
  const spur = (target, stopShort, key, via = null) => {
    let best = out.boulevard[0];
    for (const p of out.boulevard) if (arc(p, target) < arc(best, target)) best = p;
    const total = arc(best, target);
    if (total < stopShort + 1.5) return null;
    const pts = [];
    let lock = Infinity;                           // points from here on (the curve round via and the lead-in) stay put
    if (via && arc(best, via) > 4 && arc(best, via) < total) {
      // in to A, round the corner at via (a quadratic curve A → B, via its control point), then
      // straight from B onto the target
      const dIn = arc(best, via), dOut = arc(via, target), A = slerpDir(best, via, 1 - 2.5 / dIn), B = slerpDir(via, target, 1.5 / dOut);
      const n = Math.max(3, Math.round((dIn - 2.5) / 1.5)), m = Math.max(3, Math.round((dOut - 1.5) / 0.5));
      for (let k = 0; k <= n; k++) pts.push(slerpDir(best, A, k / n));
      lock = pts.length;
      for (let k = 1; k <= 6; k++) { const t = k / 6; pts.push(A.clone().multiplyScalar((1 - t) ** 2).addScaledVector(via, 2 * t * (1 - t)).addScaledVector(B, t * t).normalize()); }
      for (let k = 1; k <= m; k++) pts.push(slerpDir(B, target, k / m));
    } else {
      const n = Math.max(6, Math.round(total / 1.5));
      for (let k = 0; k <= n; k++) pts.push(slerpDir(best, target, (k / n) * (1 - stopShort / total)));
    }
    const mine = z => z.key === key || z.key === key.replace('lm:', 'lot:');     // its own shop and car park
    deflect(pts, { keep: i => i === 0 || i >= lock || i === pts.length - 1, except: mine, clear: 1.8 });
    // smoothing rounds corners back INTO reserved ground: push the smoothed line out again
    const sm = smooth(pts, 2);
    deflect(sm, { keep: i => i === 0 || i >= lock || i === sm.length - 1, except: mine, clear: 1.8 });
    const built = buildRoad(scene, sm, { half: 0.85, dashed: false });
    out.spurs.push({ key, pts: built });
    return built;
  };
  out.spurs = [];
  // every spur is laid NOW, with the rest of the roads, so the onRoad() checks of
  // everything built after (blocks, lamps, the verge trees and bushes) see them —
  // laid later, a spur ran straight over the verge planting it crossed
  // (landscaping: a shop's spur runs onto its cobbled forecourt's front edge — see shopApproach)
  const spurEnds = {}, groundsKeep = [];       // groundsKeep: ground the landscaping has taken (not solid)
  for (const p of PLAN.projects) {
    if (ROW_KEYS.includes(p.key)) continue;               // the row's shops share one spur, below
    // a shop with a cobbled forecourt: its spur runs right onto the forecourt's front edge, centred,
    // MOUTH_LAP under it (it stopped APPROACH_STOP out, and a cobble lane patched the gap)
    const F = hasForecourt(p) && shopPlace(p);
    const pts = F ? spur(F.toDir(0, APPROACH_Z1 - MOUTH_LAP), 0, 'lm:' + p.key, F.toDir(0, APPROACH_Z1 + 3.2))
      : spur(PDIR[p.key], p.style === 'library' ? 4.6 : isProjectShop(p.style) ? APPROACH_STOP : 3.7, 'lm:' + p.key);
    if (pts) spurEnds[p.key] = pts[pts.length - 1].clone();
  }
  // Makers' Row: the spur runs right up to the car park's front edge (ROW.aisle[1]) and just
  // under it, centred on the lot — an entrance, not a road stopping 1.2 short with a wider,
  // offset cobble tongue patched across the gap (makersRow() builds the mouth to this end)
  { const pts = spur(rowPlace().toDir(0, ROW.aisle[1] - ROW_MOUTH_LAP), 0, 'lm:row');
    if (pts) spurEnds.row = pts[pts.length - 1].clone(); }
  for (const [k, s] of Object.entries(PLAN.sites))
    // (the harbour's road runs on onto the quay's paving: it stopped half a metre short, on the grass)
    if (k !== 'airport') spur(llv(s.at), k === 'harbour' ? s.r - 0.7 : s.stop ?? s.r + 0.6, 'site:' + k);   // Cape Far Side: the long road round the planet

  // ── 3. BUILD ───────────────────────────────────────────────────────────────
  // the museum: the scene of the crime, restyled into the drawn world
  {
    const mus = buildMuseum({ lite: false, glowMats: [], artBase: './artworks/', openDoor: true });
    restyle(mus.group);
    ink(mus.group, 'mid', { merge: true });              // (one hull for its static parts)
    settle(mus.group, mDir, 6, 0.1, yawToFace(mDir, TOWN_C));
    add(mus.group);
    // the forecourt disc stands 0.45 proud of the lawn: you walk on its paving
    addFloor(mus.group, (x, z) => Math.hypot(x, z + 0.3) < 3.38 ? 0.45 : null);
    out.museum = { ...mus, dir: mDir, frame: mF };
    for (let z = -3.4; z >= -11; z -= 2.2) for (let x = -5.6; x <= 5.6; x += 2.8) solid(mF(x, z), 1.55);
  }
  // ── landscaping (grounds.js): the museum's grounds — gravel walks round both wings to the
  // back, hedges, a flower strip, low lamps, trees and benches, a sculpture garden round a pool
  // behind the east wing, a rose garden behind the west. Built in the museum's own frame ──
  {
    // free ground: no road or water, and clear of every project building and its cobbled approach
    // (the shop, r 5.6, and the lane out to where its spur stops)
    const mg = out.museum.group; mg.updateMatrixWorld(true);
    const keep = PLAN.projects.map(p => ({ c: PDIR[p.key], e: spurEnds[p.key] || null }));
    { const RW = resolveRow(); keep.push({ c: RW.L(0, 4.2), e: spurEnds.row || null, r: 11.0 }); }
    const segDist = (w, a, b) => {                       // arc distance from w to the great-circle segment a–b (short: chord is fine)
      const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, w.clone().sub(a).dot(ab) / ab.lengthSq()));
      return a.clone().addScaledVector(ab, t).normalize().angleTo(w) * R;
    };
    const ok = (x, z, r) => {
      const w = mg.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
      if (isWater(w, 0.2) || onRoad(w, r + 0.35)) return false;
      return keep.every(({ c, e, r: kr = 5.6 }) => arc(w, c) > kr + r && (!e || segDist(w, c, e) > 1.5 + r));
    };
    const g = add(placeOnPlanet(museumGrounds({ ok, pool: MGARDEN }), mDir, yawToFace(mDir, TOWN_C), { weight: 'fine', sink: 0, drawn: true }));
    feet(g);
    growPlants(scene, g, { seed: (out.grounds?.length || 0) + 1 });   // its planting, on the ground as drawn, in the breeze
    out.grounds = [g];
    out.museumGarden = MGARDEN;                      // museum-local [x, z] of the sculpture garden's terrace (or null)
    groundsKeep.push(...g.userData.keep.map(([x, z, r]) => ({ dir: g.localToWorld(new THREE.Vector3(x, 0, z)).normalize(), r })));
  }
  // ── Main Street: two terraces of shops facing each other across y = 0 ──
  // Units are laid by true arc length along each frontage, so neighbours meet
  // wall to wall, and each is bent onto the planet where it stands.
  out.shops = [];
  const terrace = (t, side) => {                      // side +1: north row (faces −y); −1: south row
    const Y = side * SHOP_Y, N = 60, cum = [0];
    let prev = fC(t.x[0], Y);
    for (let k = 1; k <= N; k++) { const q = fC(t.x[0] + (t.x[1] - t.x[0]) * k / N, Y); cum.push(cum[k - 1] + arc(prev, q)); prev = q; }
    const sc = cum[N] / t.shops.reduce((a, sp) => a + sp.w, 0);
    let acc = 0;
    t.shops.forEach((spec, i) => {
      const w = spec.w * sc, mid = acc + w / 2; acc += w;
      let k = 1; while (k < N && cum[k] < mid) k++;
      const x = t.x[0] + (t.x[1] - t.x[0]) * (k - 1 + (mid - cum[k - 1]) / (cum[k] - cum[k - 1])) / N;
      // local +x runs with frame +x on the north side and against it on the south;
      // the end units carry the pavement round to the side-street kerb
      const lo = i === 0, hi = i === t.shops.length - 1;
      const pave = side > 0 ? [lo ? 0.26 : 0, hi ? 0.26 : 0] : [hi ? 0.26 : 0, lo ? 0.26 : 0];
      const d = fC(x, Y);
      const g = placeOnPlanet(buildShop({ ...spec, w, pave }), d, yawToFace(d, fC(x, 0)), { inked: false });
      out.shops.push({ ...spec, dir: d, root: g });
      feet(g);
      addFloor(g, (lx, lz) => lz > -0.05 && lz < 1.42 && lx > -w / 2 - pave[0] && lx < w / 2 + pave[1] ? 0.07 : null);
      const depth = spec.special === 'library' ? 3.0 : 2.4, n = Math.max(1, Math.round(w / 2));
      for (let c = 0; c < n; c++) solid(fC(x - w / 2 + (c + 0.5) * w / n, side * (SHOP_Y + depth / 2)), Math.min(1.2, Math.max(w / n, depth) / 2 + 0.05));
      if (spec.kind === 'cafe') out.cafeSpot = [x, side * (SHOP_Y - 0.72)];
    });
  };
  for (const t of MAIN_STREET.north) terrace(t, 1);
  for (const t of MAIN_STREET.south) terrace(t, -1);
  // Frame & Co.'s van, in the side street at the corner by the shop (0.35 further into the
  // street than it first was, so its flank clears the corner shop)
  out.vanSpot = [2 * P - 0.2, -(0.5) * P];
  out.vanYaw = yawToFace(fC(...out.vanSpot), fC(out.vanSpot[0], out.vanSpot[1] + 5));
  add(batchPlaced(out.shops.map(sp => sp.root)));      // the shops stay as frames for their floors
  // Main Street's lamps stand at the kerb; bunting is strung across the street
  for (const t of [...MAIN_STREET.north, ...MAIN_STREET.south]) {
    const n = Math.max(1, Math.round((t.x[1] - t.x[0]) / 2.8)), s = MAIN_STREET.north.includes(t) ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const x = t.x[0] + (t.x[1] - t.x[0]) * (k + 0.5) / n, y = s * (SHOP_Y - 1.2);
      if (out.cafeSpot && Math.abs(x - out.cafeSpot[0]) < 1.2 && Math.sign(out.cafeSpot[1]) === s) continue;
      add(settle(lamp(), fC(x, y), 0.2, 0.02));
      solid(fC(x, y), 0.15);
    }
  }
  for (const x of [-4.4, 4.4, -7.2, 7.2, 1.6, -1.6]) add(bunting(fC, x, SHOP_Y));
  // the story's shopfronts: the café (tables out front) and Frame & Co. (the van)
  // downtown behind Main Street: one building per block, towers in the middle
  const cells = new Map();                                   // what got built where: for the gaps below
  for (let i = -K; i < K; i++) for (let j = -K; j < K; j++) {
    const x = (i + 0.5) * P, y = (j + 0.5) * P;
    if (!inTown(x, y) || j === 0 || j === -1) continue;   // Main Street's rows are the terraces
    const d = fC(x, y);
    const room = P - 2 * ROAD_MAJOR - 0.5;                  // a block's buildable width
    if (zoneHit(d, room * 0.75) || onRoad(d, room * 0.45) || inShops(x, y, room * 0.45)) continue;
    const rr = Math.hypot(x, y) / CAP;
    const r = rnd();
    let b;
    if (r < 0.12) { b = park(P / 2 - ROAD_MAJOR - 0.15); }   // clear of the road on every side
    else if (rr < 0.45) b = townBlock({ w: room * 0.9, d: room * 0.9, h: 6 + rnd() * 4 });
    else if (rr < 0.8) b = townBlock({ w: room * 0.9, d: room * 0.85, h: 3.1 + rnd() * 1.7 });
    else b = house({ w: room * 0.92, d: room * 0.76, h: 1.7 });
    // every block faces a street on purpose: the rows behind Main Street turn their backs to
    // the backs of its shops (fronts outward), the next row faces back across the street at
    // them, and so on — fronts face fronts across each street, backs face backs
    const n = j > 0 ? j : -1 - j, away = Math.sign(y) || 1;
    const faceY = n % 2 ? away : -away;
    const pb = add(placeOnPlanet(b, d, yawToFace(d, fC(x, y + 5 * faceY)), { weight: rr < 0.45 ? 'heavy' : 'mid' }));
    if (r >= 0.12) solid(d, room * 0.5);
    else feet(pb);                                            // a park: its tree and bench stop you
    cells.set(i + ',' + j, { x, y, faceY, kind: r < 0.12 ? 'park' : rr < 0.8 ? 'block' : 'house', w: r < 0.12 ? 0 : room * 0.9, d: rr < 0.8 ? room * 0.85 : room * 0.76 });
  }
  // the gaps: where a side street is left out, two blocks' buildings stood ~2.8 apart along
  // the frontage with bare lawn between (and the sides of the buildings behind showing). A
  // narrow infill building closes the row between two blocks; next to a house or a little
  // park, a pocket space instead — a bench, a tree and a planter
  for (const [key, A] of cells) {
    const [i, j] = key.split(',').map(Number), Bn = cells.get((i + 1) + ',' + j);
    if (!Bn || Bn.faceY !== A.faceY) continue;
    const mx = (A.x + Bn.x) / 2, my = A.y, md = fC(mx, my);
    const gap = P - (A.w + Bn.w) / 2;
    if (gap < 1.2 || onRoad(md, 0.5) || zoneHit(md, 0.9) || inShops(mx, my, 0.4)) continue;
    const yaw = yawToFace(md, fC(mx, my + 5 * A.faceY));
    if (A.kind === 'block' && Bn.kind === 'block') {
      const w = Math.min(2.4, gap - 0.3), dd = Math.min(A.d, Bn.d) * 0.92;
      if (onRoad(md, dd * 0.5)) continue;
      add(placeOnPlanet(townBlock({ w, d: dd, h: 2.9 + rnd() * 1.2 }), md, yaw, { weight: 'mid' }));
      solid(md, Math.min(w, dd) * 0.5);
    } else {
      if (onRoad(md, 0.9)) continue;
      feet(add(placeOnPlanet(pocketPark(Math.min(2.2, gap - 0.3)), md, yaw, { weight: 'fine' })));
    }
    (out.infills ??= []).push({ dir: md, front: fC(mx, my + 3 * A.faceY), kind: A.kind === 'block' && Bn.kind === 'block' ? 'block' : 'pocket' });
  }
  // street lamps at junctions, trees along the boulevard verge
  for (let i = -K; i <= K; i++) for (let j = -K; j <= K; j++) {
    if ((i + j) % 2) continue;
    const x = i * P + 1.6, y = j * P + 1.6;
    if (!inTown(x, y) || inShops(x, y, 0.5)) continue;
    const d = fC(x, y);
    if (zoneHit(d, 0.4) || onRoad(d, 0.35)) continue;
    add(settle(lamp(), d, 0.2, 0.02));
    solid(d, 0.15);
  }
  // Maple Plaza: the strip mall out past the boulevard, its lot opening onto it
  {
    const d = fC(...MALL.at), yaw = yawToFace(d, fC(MALL.at[0] - 10, MALL.at[1]));
    // the side roads curve round the lot's ends: find, in the mall's own frame, where their kerbs
    // begin (|x| on side s at depth z) so its corners, verges and end pavements follow them.
    // Every road near it, flattened onto the mall's ground plane (along the radius), as segments
    const kerbU = (() => {
      const probe = settle(new THREE.Group(), d, 0.25, 0.04, yaw); probe.updateMatrixWorld(true);
      const inv = probe.matrixWorld.clone().invert(), c = new THREE.Vector3().applyMatrix4(inv), q = new THREE.Vector3();
      const segs = [];
      for (const rd of ROADS) {
        let prev = null;
        for (const p of rd.pts) {
          if (arc(p, d) > 16) { prev = null; continue; }
          q.copy(p).multiplyScalar(R).applyMatrix4(inv);
          const t = -c.y / (q.y - c.y), cur = [c.x + (q.x - c.x) * t, c.z + (q.z - c.z) * t];
          if (prev) segs.push([prev[0], prev[1], cur[0], cur[1], rd.half + 0.28]);
          prev = cur;
        }
      }
      const inKerb = (x, z) => segs.some(([ax, az, bx, bz, h]) => {
        const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(x - ax - dx * t, z - az - dz * t) < h;
      });
      return (s, z) => {
        for (let u = 4.0; u < 9.5; u += 0.1) if (inKerb(s * u, z)) {
          let lo = u - 0.1, hi = u;
          for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (inKerb(s * m, z)) hi = m; else lo = m; }
          return lo;
        }
        return null;
      };
    })();
    const g = add(placeOnPlanet(stripMall({ kerbU }), d, yaw));
    out.mall = { dir: d, root: g };
    // the drive, built to the boulevard's real carriageway edge: for each x across it, walk out
    // from the lot (in the mall's frame) to where the road's surface begins
    { g.updateWorldMatrix(true, false);
      const { lotEnd } = g.userData.mall, v = new THREE.Vector3();
      const past = (x, z) => { const nr = nearestRoad(g.localToWorld(v.set(x, 0, z)).normalize()); return nr && nr.dist <= nr.half; };
      const edgeZ = (x) => {
        let lo = lotEnd, hi = lotEnd + 6;
        if (!past(x, hi)) return lotEnd + 2.2;                    // no road found: a short apron
        for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (past(x, m)) hi = m; else lo = m; }
        return hi;
      };
      add(placeOnPlanet(mallDrive(edgeZ, lotEnd), d, yaw, { inked: false }));
      // the pylon sign: on the grass between the lot, the drive and the boulevard, facing the
      // road — stood up plumb on its own (not laid onto the ground with the mall), and moved
      // to the nearest spot where its panel clears every kerb and the drive's dropped kerbs
      const [px0, pz0] = g.userData.mall.pylonAt, SW = 0.6;   // half the panel, and a touch
      const dEnd = edgeZ(0), driveHalf = (z) => 1.8 + 0.75 * Math.min(1, Math.max(0, (z - lotEnd) / (dEnd - lotEnd))) ** 2.5 + 0.15;
      const W = (x, z) => g.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
      const clear = (x, z) => z - 0.2 > lotEnd + 0.1 && Math.abs(x) - SW > driveHalf(z + 0.2) + 0.3
        && [-SW, 0, SW].every(dx => !onRoad(W(x + dx, z), 0.28 + 0.3))
        && !out.colliders.some(c => !c.soft && arc(W(x, z), c.dir) < c.r + SW);
      let best = null, bd = 1e9;
      for (let i = -20; i <= 20; i++) for (let k = -12; k <= 12; k++) {
        const x = px0 + i * 0.1, z = pz0 + k * 0.1, dd = Math.hypot(x - px0, z - pz0);
        if (dd < bd && clear(x, z)) { bd = dd; best = [x, z]; }
      }
      if (best) {
        const pd = W(...best), face = W(best[0], best[1] + 5);
        const py = add(placeOnPlanet(mallPylon(), pd, yawToFace(pd, face), { upright: true }));
        feet(py); out.mall.pylon = py; out.mall.pylonAt = best;
      } }
    addFloor(g, g.userData.floor); feet(g);
    for (let k = -2; k <= 2; k++) solid(fC(MALL.at[0] + 1.5, MALL.at[1] + k * 2.3), 1.3);
    for (const k of [-1, 1]) solid(fC(MALL.at[0] + 1.5, MALL.at[1] + k * 5.1), 0.8);
  }
  for (let k = 0; k < out.boulevard.length; k += 7) {
    const p = out.boulevard[k], q = out.boulevard[(k + 1) % out.boulevard.length];
    const side = new THREE.Vector3().crossVectors(p, q.clone().sub(p)).normalize();
    for (const s of [-1, 1]) {
      const d = p.clone().multiplyScalar(R).addScaledVector(side, s * 2.3).normalize();
      // a tree's crown reaches ~1.1 from its trunk: keep it from hanging over any carriageway
      const isTree = rnd() > 0.35;
      if (zoneHit(d, 0.8) || onRoad(d, isTree ? 1.15 : 0.7) || isWater(d) || inShops(...toTown(d), 0.6)) continue;
      add(settle(isTree ? tree() : bush(0.55), d, 0.5, 0.05, rnd() * 6));
      solid(d, 0.35);
    }
  }
  // project buildings, each on its own plaza, each with a spur road
  for (const p of PLAN.projects) {
    const d = PDIR[p.key], inRow = ROW_KEYS.includes(p.key);
    if (isProjectShop(p.style)) {
      // a walk-in shop: the base (floor, low walls, the inside, props) and the upper part (walls
      // above the waist, shopfront, sign, roof), placed at the same spot; the upper part hides
      // while you're inside (tickShops)
      // (the row's two face straight across their car park, square to each other)
      const S = projectShop(p.style), yaw = yawToFace(d, inRow ? resolveRow().L(resolveRow().x[p.key], 40) : TOWN_C);
      const base = add(placeOnPlanet(S.base, d, yaw, { weight: 'mid' })), upper = add(placeOnPlanet(S.upper, d, yaw, { weight: 'mid' }));
      addFloor(base, S.floor);
      for (const [x, z, r] of S.walls) solid(base.localToWorld(new THREE.Vector3(x, 0, z)).normalize(), r);
      const lm = { ...p, lot: null, dir: d, root: base, upper, inside: S.inside };   // (lot: set below only where a car park is built — Makers' Row shares one)
      if (p.lot && !inRow) {
        // the car park: its apron runs in to the spur's real edge (walk out from the lot, in the
        // shop's frame, until the road's surface begins)
        const v = new THREE.Vector3(), s = p.lot;
        const onIt = (x, z) => { const nr = nearestRoad(base.localToWorld(v.set(s * x, 0, z)).normalize()); return nr && nr.dist <= nr.half; };
        const roadX = (z) => { let lo = SHOP_LOT.x0, hi = -0.5; if (onIt(lo, z)) return lo; if (!onIt(hi, z)) return 0.9;
          for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (onIt(m, z)) hi = m; else lo = m; } return lo; };
        const g = add(placeOnPlanet(shopLot(s, roadX), d, yaw, { weight: 'fine' }));
        feet(g);
        lm.lot = { side: s, root: g };
      }
      out.landmarks.push(lm);
      // ── landscaping (grounds.js): a cobbled forecourt the spur runs onto,
      // edging stones, planters, a lamp, a bench, and planting round the shop ──
      if (!inRow && !lm.lot) {                          // (a shop with its own car park beside it has that instead)
        const L = shopPlace(p).toLocal;                  // (exact: the mouth is built to the spur's end)
        let end = spurEnds[p.key] ? L(spurEnds[p.key]) : null;
        if (!end) {                                     // no spur of its own: run the lane to the nearest road
          let bd = 9;
          for (const rd of ROADS) for (const q of rd.pts) { const lp = L(q), dd = Math.hypot(lp.x, lp.z); if (dd < bd && dd > 4) { bd = dd; end = lp; } }
        }
        const W = (x, z) => base.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
        const solids = out.colliders.slice();
        const ok = (x, z, r) => { const w = W(x, z); return !isWater(w, 0.2) && !onRoad(w, r + 0.35) && !solids.some(c => arc(w, c.dir) < c.r + r) && !groundsKeep.some(c => arc(w, c.dir) < c.r + r); };
        const g = add(placeOnPlanet(shopApproach({ ex: end?.x ?? null, ez: end?.z ?? null, ok, shop: [S.base, S.upper], seed: out.landmarks.length }), d, yaw, { weight: 'fine', sink: 0, drawn: true }));
        feet(g);
        growPlants(scene, g, { seed: (out.grounds?.length || 0) + 1 });   // its planting, on the ground as drawn, in the breeze
        (out.grounds ||= []).push(g);
      }
      continue;
    }
    const g = landmark(p);
    settle(g, d, 3.5, 0.08, yawToFace(d, TOWN_C));
    add(g);
    solid(d, 2.1);
    out.landmarks.push({ ...p, dir: d, root: g });
  }
  // ── landscaping (grounds.js): Makers' Row's shared cobbled car park, garden square, apron,
  // planting; plaza.js parks cars in its bays ──
  {
    const { hub, yaw, probe, toLocal } = rowPlace(), solids = out.colliders.slice();
    const W = (x, z) => probe.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
    const e = spurEnds.row ? toLocal(spurEnds.row) : null;          // (exact: the mouth is built to it)
    const ok = (x, z, r) => { const w = W(x, z); return !isWater(w, 0.2) && !onRoad(w, r + 0.35) && !solids.some(c => arc(w, c.dir) < c.r + r); };
    const g = add(placeOnPlanet(makersRow({ ex: e?.x ?? null, ez: e?.z ?? null, ok }), hub, yaw, { weight: 'fine', sink: 0, drawn: true }));
    feet(g);
    growPlants(scene, g, { seed: (out.grounds?.length || 0) + 1 });   // its planting, on the ground as drawn, in the breeze
    (out.grounds ||= []).push(g);
    out.row = { root: g, ...g.userData.row };
  }
  // Lantern Park: lawn, pond, paths, beds, trees, benches (its people are park.js)
  {
    const d = llv(PLAN.park.at), g = add(placeOnPlanet(parkGarden(), d, yawToFace(d, TOWN_C), { weight: 'fine' }));
    feet(g);
    out.park = { dir: d, root: g, ...g.userData.park };
  }
  for (const [k, s] of Object.entries(PLAN.sites)) {
    const d = llv(s.at);
    out.sites[k] = { ...s, dir: d, frame: frame(d, TOWN_C) };
    if (k === 'launchpad') {
      const g = add(placeOnPlanet(capeFarSide(), d, yawToFace(d, TOWN_C), { weight: 'mid' }));
      addFloor(g, g.userData.floor); feet(g);
      for (const [[x, z], r] of g.userData.solids) solid(g.localToWorld(new THREE.Vector3(x, 0, z)).normalize(), r);
      // the story places its moving parts in the site's own frame
      out.cape = { dir: d, root: g, at: (x, z) => g.localToWorld(new THREE.Vector3(x, 0, z)).normalize() };
      continue;
    }
    if (k === 'station') {
      const g = add(placeOnPlanet(station(), d, yawToFace(d, TOWN_C)));
      addFloor(g, g.userData.floor); feet(g);
      // the station's footprint is in its own local frame (x is mirrored in the site frame)
      for (const [[x, z], r] of g.userData.solids) solid(out.sites[k].frame(-x, z), r);
      // the railway: the station's straight closes into a loop round the countryside
      railLoop(g, { tz: STATION_TRACK.z, half: STATION_TRACK.half });
      out.railway = buildRailway(scene);
      // the 7:40, waiting at the platform (placed with the station's own transform)
      const tr = add(placeOnPlanet(parkedTrain(), d, yawToFace(d, TOWN_C), { weight: 'fine' }));
      addFloor(tr, tr.userData.floor);
      const TL = (x, z) => tr.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
      for (const [x, z, r] of tr.userData.solids) solid(TL(x, z), r);
      // the car can't drive through it either (its own small footprints are too fine for the car)
      for (let x = -5.6; x <= 6.2; x += 1.1) out.colliders.push({ dir: TL(x, STATION_TRACK.z), r: 0.75, carOnly: true });
      const inv = tr.matrixWorld.clone().invert(), rm = tr.userData.roofMats;
      out.train = {
        root: tr, roofs: tr.children.filter(m => rm.includes(m.material)),   // the roofs and ceiling lamps: they lift off while you are inside
        // inside a carriage? (a world direction)
        inside: (dir) => { const p = dir.clone().multiplyScalar(R).applyMatrix4(inv); return tr.userData.inside(p.x, p.z); },
        reader: { dir: TL(tr.userData.reader.x, tr.userData.reader.z), facing: TL(tr.userData.reader.x, tr.userData.reader.z + 1) },
      };
      continue;
    }
    if (k === 'harbour') {
      out.harbour = buildHarbour(d, TOWN_C, add, solid);
      continue;
    }
    const g = site(k, out.sites[k].frame);
    if (g) { settle(g, d, s.r * 0.8, 0.06, yawToFace(d, TOWN_C)); add(g);
      if (g.userData.floor) addFloor(g, g.userData.floor); for (const c of g.userData.solids || []) solid(out.sites[k].frame(...c[0]), c[1]); }
  }
  // the north: the river and its bridge, the country club, the driving range, Riverbend Close
  out.north = buildNorth(scene, { add, solid, boulevard: out.boulevard });
  // the roads' verges: street trees out of town, a lamp where each road leaves the ring, a
  // turning circle and a viewpoint at the overlook (after the rail and the north: it sees them all)
  out.roadside = dressRoads(scene, { add, solid, spurs: out.spurs, boulevard: out.boulevard, townC: TOWN_C, ringR: PLAN.town.boulevard, sites: out.sites, colliders: out.colliders });
  // helpers the story uses to place things
  out.townAt = ([x, y]) => fC(x, y);
  out.toTown = toTown;
  out.dirC = TOWN_C;
  out.axes = { side: _sideT, fwd: _fwdT };
  out.siteAt = (k, [x, y]) => out.sites[k].frame(x, y);
  out.solid = solid;
  out.museumFrame = mF;
  // countryside: scattered clumps of trees, never on roads, water or reserved ground
  for (let c = 0; c < 26; c++) {
    const center = llv([(rnd() - 0.5) * 140, (rnd() - 0.5) * 360]);
    if (arc(center, TOWN_C) < PLAN.town.boulevard + 4) continue;
    const f = frame(center);
    const n = 3 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const d = f((rnd() - 0.5) * 7, (rnd() - 0.5) * 7);
      if (isWater(d, -0.2) || zoneHit(d, 1) || onRoad(d, 1.2) || onRail(d, 0.9)) continue;
      add(settle(rnd() > 0.5 ? pine() : tree(), d, 0.5, 0.05, rnd() * 6));
      solid(d, 0.35);
    }
  }
  // walk into a project shop and its upper walls and roof lift away, so you see in
  const _sp = new THREE.Vector3();
  out.tickShops = (dir) => {
    for (const lm of out.landmarks) {
      if (!lm.upper || lm.noLift) continue;
      if (arc(dir, lm.dir) > 6) { lm.upper.visible = true; continue; }
      lm.root.worldToLocal(_sp.copy(dir).multiplyScalar(R));
      lm.upper.visible = !lm.inside(_sp.x, _sp.z);
    }
  };
  // the last word, whatever order things were built in (a road laid later through a verge tree):
  // no standalone plant on a road, a rail or a bridge deck — it goes, and its footprint with it
  let pruned = 0;
  for (const o of [...scene.children]) {
    if (!o.userData.deco) continue;
    const d = o.position.clone().normalize();
    if (!decoBlocked(d, o.userData.deco)) continue;
    scene.remove(o); out.statics.splice(out.statics.indexOf(o) >>> 0, 1); pruned++;
    for (let i = out.colliders.length - 1; i >= 0; i--) if (arc(out.colliders[i].dir, d) < 0.06) out.colliders.splice(i, 1);
  }
  out.prunedPlants = pruned + (placeOnPlanet.pruned || 0);
  return out;
}

// ── the story's other sites: nothing modelled here any more (the harbour is harbour.js;
// Central Station and Cape Far Side are buildings.js) ──
function site() { return null; }

// bunting strung across Main Street from facade to facade, sagging in the middle
function bunting(fC, x, Y) {
  const g = new THREE.Group(), N = 24, line = [], flags = [[], [], [], []];
  const at = (t) => { const d = fC(x, Y - 2 * Y * t); return d.multiplyScalar(radiusAt(d) + 3.75 - 0.45 * Math.sin(Math.PI * t)); };
  for (let k = 0; k <= N; k++) line.push(at(k / N));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), 32, 0.012, 4), paint(PAL.ink, { hatch: 0 })));
  for (let k = 1; k < 14; k++) {
    const t = k / 14, p = at(t), tan = at(t + 0.01).sub(at(t - 0.01)).normalize(), up = p.clone().normalize();
    flags[k % 4].push(...p.clone().addScaledVector(tan, -0.09).toArray(), ...p.clone().addScaledVector(tan, 0.09).toArray(), ...p.clone().addScaledVector(up, -0.2).toArray());
  }
  flags.forEach((f, i) => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(f, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, paint([PAL.accent, PAL.gold, PAL.teal, 0xf6eedb][i], { side: THREE.DoubleSide }));
    m.userData.noInk = true; g.add(m);
  });
  return g;
}

// a small park: lawn, a tree, a bench, all of it inside r (the block's clear radius:
// a 1.55 lawn and a full-size tree spilled half a unit onto the streets round a 4.4 block)
function park(r = 1.1) {
  const g = new THREE.Group(), k = r / 1.1;
  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.05, r, 0.12, 24), paint(PAL.grass));
  lawn.position.y = 0.06; g.add(lawn);
  // seen from the street (the park's front, +z): the tree on the left, the bench to its right,
  // facing the street
  const t = tree({ s: 0.85 * k }); t.position.set(-0.3 * k, 0.1, -0.15 * k); g.add(t);
  const b = bench(); b.position.set(0.35 * k, 0.1, 0.35 * k); b.rotation.y = 0; g.add(b);
  // footprints the walker can't pass (collected by bake into userData.foots)
  const foot = (x, z, r) => { const o = new THREE.Object3D(); o.position.set(x, 0, z); o.userData.foot = r; g.add(o); };
  foot(-0.3 * k, -0.15 * k, 0.2);
  for (const fx of [-0.4, 0, 0.4]) foot(0.35 * k + fx, 0.35 * k, 0.2);
  return ink(g, 'fine');
}

// a pocket space between two buildings: a strip of lawn, a tree at the back, a bench facing
// the street (+z) and a planter of flowers beside it
function pocketPark(w = 2.0) {
  const g = new THREE.Group(), lawnD = 1.5;
  const lawn = new THREE.Mesh(rbox(w, 0.1, lawnD, 0.04), paint(PAL.grass)); lawn.position.y = 0.05; g.add(lawn);
  const t = tree({ s: 0.8 }); t.position.set(-w * 0.22, 0.08, -0.35); g.add(t);
  const b = bench(); b.position.set(w * 0.12, 0.08, 0.3); g.add(b);
  const pl = new THREE.Mesh(rbox(0.42, 0.3, 0.42, 0.04), paint(PAL.terracotta)); pl.position.set(w * 0.38, 0.23, -0.3); g.add(pl);
  const soil = new THREE.Mesh(rbox(0.36, 0.04, 0.36, 0.01), paint(0x8a6a52, { hatch: 0 })); soil.position.set(w * 0.38, 0.38, -0.3); g.add(soil);
  const bu = bush(0.24); bu.position.set(w * 0.38, 0.38, -0.3); g.add(bu);
  for (let k = 0; k < 7; k++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), paint([PAL.accent, PAL.gold, 0xf6eedb, PAL.rose][k % 4], { hatch: 0 }));
    f.position.set(w * 0.38 + Math.sin(k * 2.4) * 0.13, 0.5 + (k % 3) * 0.03, -0.3 + Math.cos(k * 2.4) * 0.13); g.add(f);
  }
  const foot = (x, z, r) => { const o = new THREE.Object3D(); o.position.set(x, 0, z); o.userData.foot = r; g.add(o); };
  foot(-w * 0.22, -0.35, 0.22); foot(w * 0.38, -0.3, 0.26);
  for (const fx of [-0.4, 0, 0.4]) foot(w * 0.12 + fx, 0.3, 0.2);
  return ink(g, 'fine');
}

// ── the library: the bookcase building on a round plaza (the project shops are buildings.js projectShop) ──
function landmark(p) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([[0.001, 0], [3.0, 0], [3.05, 0.08], [3.0, 0.16], [0.001, 0.16]], 40), paint(PAL.kerb)));
  const lib = bookLibrary(); lib.position.y = 0.14; g.add(lib);
  g.add(blobShadow(3.2));
  return ink(g, 'heavy');
}
