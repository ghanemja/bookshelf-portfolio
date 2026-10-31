// ─── ROADSIDE: the planting and furniture that make the roads read as planned ─────────
// The country roads out of town used to be bare strips across the grass. Here every road
// beyond the boulevard gets a verge: street trees at an even spacing, staggered side to side,
// with the odd clipped bush between them; a lamp marks each place a road leaves the
// boulevard; and the Summit Overlook — a road that ran out to nothing — ends in a proper
// turning circle with a viewpoint (a bench, a coin telescope, a board, a lamp).
// It runs after the railway and the north are built, so it sees every road, rail and zone.
// Its own little random stream keeps the rest of the town's random scenery where it was.
import * as THREE from 'three';
import { R, arc, slerpDir, zoneHit, onRoad, isWater, settle, yawToFace, buildRoad, ROADS, deflect, smooth, decoBlocked } from './world.js';
import { PAL, paint, ink, mergeStatic } from './style.js';
import { tree, bush, lamp, bench, rbox, lathe } from './props.js';
import { onRail } from './rail.js';

let _s = 9137;
const rand = () => { _s = (_s * 16807) % 2147483647; return (_s - 1) / 2147483646; };

// a coin-operated telescope on a post (a viewpoint's landmark)
function telescope() {
  const g = new THREE.Group(), dark = paint(PAL.ink, { hatch: 0 }), brass = paint(0xe4b84f);
  const m = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); g.add(o); return o; };
  m(lathe([[0.001, 0], [0.18, 0], [0.18, 0.05], [0.06, 0.1], [0.05, 0.85], [0.08, 0.9], [0.001, 0.92]], 12), dark, 0, 0, 0);
  const head = new THREE.Group(); head.position.set(0, 1.0, 0); head.rotation.x = -0.25; g.add(head);
  const tube = new THREE.Mesh(lathe([[0.001, -0.35], [0.09, -0.35], [0.1, -0.3], [0.11, 0.25], [0.14, 0.3], [0.14, 0.38], [0.001, 0.38]], 14), brass);
  tube.rotation.x = Math.PI / 2; head.add(tube);
  const box = new THREE.Mesh(rbox(0.22, 0.2, 0.16, 0.04), dark); box.position.set(0, -0.12, 0); head.add(box);
  return ink(g, 'fine');
}
// a painted board on two legs
function viewBoard(text) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d'); c.fillStyle = '#f3eee4'; c.fillRect(0, 0, 512, 256);
  c.strokeStyle = '#2a2230'; c.lineWidth = 8; c.strokeRect(10, 10, 492, 236);
  c.fillStyle = '#2a2230'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '600 64px "Patrick Hand", cursive'; c.fillText(text, 256, 100);
  c.font = '400 38px "Patrick Hand", cursive'; c.fillText('the whole town, from up here', 256, 175);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group(), wood = paint(PAL.bark);
  for (const x of [-0.5, 0.5]) { const l = new THREE.Mesh(rbox(0.07, 1.1, 0.07, 0.02), wood); l.position.set(x, 0.55, 0); g.add(l); }
  const b = new THREE.Mesh(rbox(1.2, 0.62, 0.05, 0.02), wood); b.position.set(0, 1.05, 0); g.add(b);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.54), paint(0xffffff, { map: t, hatch: 0 })); f.position.set(0, 1.05, 0.03); g.add(f);
  return ink(g, 'fine');
}

// spurs: [{ key, pts }] from town.js; boulevard: its centre-line points; townC: the town's centre
export function dressRoads(scene, { add, solid, spurs, boulevard, townC, ringR, sites, colliders = [] }) {
  const out = { trees: 0, lamps: 0, lanes: [], blocked: [] };
  // ── country lanes: the town's roads used to be all spokes, each a dead end at its one place.
  // A lane joins two spokes where they come close, so you can drive a loop through the country:
  // YarnFlow's road on round to the road north over the Riverbend bridge ──
  const nearestOn = (pts, d) => { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const a = arc(p, d); if (a < bd) { bd = a; bi = i; } }); return bi; };
  const lane = (A, B, bend = 0.25) => {
    // a gentle bow between them (a quadratic curve, its control pushed off the straight line)
    const mid = slerpDir(A, B, 0.5), t = B.clone().sub(A).normalize(), side = new THREE.Vector3().crossVectors(mid, t).normalize();
    const ctrl = mid.clone().multiplyScalar(R).addScaledVector(side, arc(A, B) * bend).normalize();
    const n = Math.max(8, Math.round(arc(A, B) / 1.1)), pts = [];
    for (let k = 0; k <= n; k++) { const u = k / n; pts.push(slerpDir(slerpDir(A, ctrl, u), slerpDir(ctrl, B, u), u)); }
    deflect(pts, { keep: (i) => i === 0 || i === pts.length - 1, clear: 1.6 });
    const sm = smooth(pts, 2);
    deflect(sm, { keep: (i) => i === 0 || i === sm.length - 1, clear: 1.6 });
    for (const c of colliders) if (!c.soft && sm.some(p => arc(p, c.dir) < 0.75 + c.r - 0.2)) out.blocked.push(c);
    const built = buildRoad(scene, sm, { half: 0.75, dashed: false });
    out.lanes.push(built);
    return built;
  };
  {
    const yarn = spurs.find(sp => sp.key === 'lm:yarnflow');
    // the bridge's south approach: the open road that starts at the boulevard and ends on the bridge deck
    const bridgeRoad = ROADS.find(r => !r.closed && r.pts.length > 8 && r.half > 0.9 && r.half < 1.0 && arc(r.pts[0], townC) < ringR + 1.5 && arc(r.pts[r.pts.length - 1], townC) > ringR + 4);
    if (yarn && bridgeRoad) {
      const Y = yarn.pts, A = Y[Math.max(1, Y.length - 7)];                  // off YarnFlow's road, short of its yard
      const Bp = bridgeRoad.pts, B = Bp[Math.min(Bp.length - 2, nearestOn(Bp, A) + 2)];
      lane(A, B, -0.18);
    }
  }
  // ── the verges: every open road whose middle lies out past the boulevard ──
  const country = ROADS.filter(r => !r.closed && r.pts.length > 6 && arc(r.pts[Math.floor(r.pts.length / 2)], townC) > ringR + 1.5);
  for (const r of country) {
    const P = r.pts, cum = [0];
    for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + arc(P[k - 1], P[k]));
    const L = cum[cum.length - 1];
    if (L < 8) continue;
    const at = (s) => { let k = 1; while (k < cum.length - 1 && cum[k] < s) k++; const t = (s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]); return { d: slerpDir(P[k - 1], P[k], Math.min(1, Math.max(0, t))), k }; };
    const G = new THREE.Group();
    let side = rand() > 0.5 ? 1 : -1;
    // keep the ends clear: a junction's sight lines, and the destination's own forecourt
    for (let s = 3.2; s < L - 4.0; s += 2.9) {
      side = -side;
      const { d, k } = at(s), q = P[Math.min(P.length - 1, k + 1)], p0 = P[Math.max(0, k - 1)];
      const tang = q.clone().sub(p0).normalize(), lat = new THREE.Vector3().crossVectors(d, tang).normalize();
      const isTree = rand() > 0.22, off = r.half + (isTree ? 1.55 : 1.0) + rand() * 0.3;
      const v = d.clone().multiplyScalar(R).addScaledVector(lat, side * off).addScaledVector(tang, (rand() - 0.5) * 0.6).normalize();
      // a crown reaches ~1.1 from its trunk: it never overhangs a carriageway, a rail, water or a site
      if (zoneHit(v, 0.6) || onRoad(v, isTree ? 1.3 : 1.0) || decoBlocked(v, isTree ? 0.9 : 0.6) || isWater(v, -0.15) || onRail(v, 1.2)) continue;
      const o = isTree ? tree({ s: 0.85 + rand() * 0.3 }) : bush(0.5 + rand() * 0.15);
      settle(o, v, 0.5, 0.05, rand() * 6);
      G.add(o); solid(v, isTree ? 0.35 : 0.3);
      out.trees++;
    }
    if (G.children.length) { add(mergeStatic(G)); }
  }
  // ── a lamp at the corner of every road that leaves the boulevard: on the verge 0.45 out from the
  // spur's carriageway edge (it stood 0.6 out, on the grass), clear of the boulevard's edge too ──
  const kerbGap = (d) => { let m = 1e9; for (const rd of ROADS) for (const q of rd.pts) { const e = arc(d, q) - rd.half; if (e < m) m = e; } return m; };
  for (const sp of spurs) {
    const P = sp.pts; if (!P || P.length < 4) continue;
    const a = P[0], b = P[3], tang = b.clone().sub(a).normalize(), lat = new THREE.Vector3().crossVectors(a, tang).normalize();
    const half = ROADS.find(r => r.pts === P)?.half ?? 0.85;
    let done = false;
    for (const along of [2.4, 2.9, 3.4]) {
      for (const s of [1, -1]) {
        const v = a.clone().multiplyScalar(R).addScaledVector(tang, along).addScaledVector(lat, s * (half + 0.45)).normalize();
        const g = kerbGap(v);
        if (g < 0.37 || zoneHit(v, 0.3) || isWater(v) || onRail(v, 0.6) || colliders.some(c => !c.soft && arc(v, c.dir) < c.r + 0.3)) continue;
        add(settle(lamp(), v, 0.2, 0.02)); solid(v, 0.15); out.lamps++;
        done = true; break;                                     // one corner is enough
      }
      if (done) break;
    }
  }
  // ── the Summit Overlook: a turning circle at the road's end, and something to look at ──
  const ov = spurs.find(sp => sp.key === 'site:overlook'), site = sites.overlook;
  if (ov && site) {
    const P = ov.pts, end = P[P.length - 1], prev = P[P.length - 4];
    const tang = end.clone().sub(prev).normalize();
    const c = end.clone().multiplyScalar(R).addScaledVector(tang, 1.0).normalize();
    // a disc of road: a ring whose half-width is its radius (no hole), the turning circle
    const f = (x, y) => { const lat = new THREE.Vector3().crossVectors(c, tang).normalize(); return c.clone().multiplyScalar(R).addScaledVector(lat, x).addScaledVector(tang, y).normalize(); };
    const ring = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; ring.push(f(Math.cos(a) * 0.95, Math.sin(a) * 0.95)); }
    buildRoad(scene, ring, { half: 0.95, closed: true, dashed: false });
    out.turnaround = c;
    // the viewpoint beyond it, looking out the way the road was heading
    const look = f(0, 8);
    const put = (o, x, y, face = look, r = 0.3) => { const d = f(x, y); add(settle(o, d, 0.4, 0.03, yawToFace(d, face))); if (r) solid(d, r); return d; };
    put(bench(), -1.1, 3.1, look, 0.45);
    put(bench(), 1.1, 3.1, look, 0.45);
    put(telescope(), 0, 3.6, look, 0.2);
    put(viewBoard('Summit Overlook'), 2.6, 2.2, f(0, -4), 0.3);
    put(lamp(), -2.5, 2.0, look, 0.15);
    for (const [x, y] of [[-3.2, 3.6], [3.2, 3.9], [-2.2, 4.6], [2.4, 4.8]]) put(bush(0.55), x, y, look, 0.3);
  }
  return out;
}
