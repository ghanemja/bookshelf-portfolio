// ─── MAPLE PLAZA'S LIFE: parked cars, and shoppers in and out of the shops ────
// The strip mall (buildings.js stripMall) hands over its shop doors and bays in its own
// frame (userData.mall). Here:
//   • a few cars sit nose-in in the bays — each a level frame with the car seated on its
//     four tyres (like your parked car), solid, so you can't walk or drive through them;
//   • three shoppers walk a loop: from the aisle (by their car), up an EMPTY bay (never
//     between parked cars), along the covered walk to a shop door — in through it (gone a
//     while) — out again, back down to the aisle, a pause by the car, round again.
// They are their own people (AGENTS.md: own build, face, hair, outfit; the critic's scale),
// stop for you like the other walkers, the car bumps them like anyone, and they're only
// animated while you're near.
import * as THREE from 'three';
import { arc, slerpDir, standAt, alignToSurface, yawToFace, LOTS } from './world.js';
import { buildCar, fitToGround } from './player.js';
import { person } from './human.js';
import { poseFolk } from './folk.js';
import { paint, ink } from './style.js';

const NEAR = 20;                      // farther than this: not drawn, not animated
const CARS = [                        // bay index → body colour (bays 2 and 4 stay empty: the shoppers' way in)
  [0, 0x6f9fc0], [1, 0xe1b95c], [3, 0x7fb3a8],
];
const SHOPPERS = [
  { id: 'nell', name: 'Nell', pitch: 340, line: 'My SHOPPING!', shop: 1, bay: 2, side: 0.58, car: 1, bag: 0xe8604c,
    look: { folk: true, skin: 'rose', hair: 0xb06a3a, hairStyle: 'bob', outfit: 'coat', top: 0x7fb3a8, accent: 0xf3ead7,
      bottom: 0x4a4458, shoes: 0x3a2a30, height: 0.97, build: 0.95,
      face: { shape: { jaw: 0.35, chin: 0.45, cheeks: 0.55, long: 0.05, skull: 0.5, brow: 0.4 }, nose: 'snub', noseSize: 0.95,
        eyes: 'round', brows: 'raised', hair: 'bob', blush: 0.7 } } },
  { id: 'gus', name: 'Gus', pitch: 150, line: 'Mind the DONUTS!', shop: 2, bay: 2, side: 0.58, car: 0, bag: 0xf6c6d0,
    look: { folk: true, skin: 'deep', hair: 0x1d1716, hairStyle: 'bald', beard: true, top: 0xd58b63, sleeve: 'short',
      bottom: 0x3f5872, shoes: 0xf1ece0, height: 1.03, build: 1.12, belly: 0.55, hat: 'cap', hatColor: 0x3e6b52,
      face: { shape: { jaw: 0.7, chin: 0.3, cheeks: 0.6, long: 0.0, skull: 0.55, brow: 0.6 }, nose: 'round', noseSize: 1.1,
        eyes: 'round', brows: 'flat', blush: 0.3 } } },
  { id: 'ines', name: 'Ines', pitch: 400, line: 'That was a RENTAL!', shop: 3, bay: 4, side: -0.58, car: 3, bag: 0x8f7ae8,
    look: { folk: true, skin: 'tan', hair: 0x2a1d17, hairStyle: 'curls', outfit: 'dress', top: 0xe1b95c, bottom: 0xe1b95c,
      shoes: 0x6a4a3a, height: 0.95, build: 0.9, glasses: true,
      face: { shape: { jaw: 0.25, chin: 0.55, cheeks: 0.4, long: 0.15, skull: 0.5, brow: 0.35 }, nose: 'straight', noseSize: 0.95,
        eyes: 'round', eyeSize: 1.05, brows: 'raised', lashes: true, glasses: true, hair: 'curls', blush: 0.5 } } },
];

// a paper shopping bag with rope handles, held in the fist
function bag(col) {
  const g = new THREE.Group(), m = paint(col);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.05), m); b.position.y = -0.085; g.add(b);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 5, 10, Math.PI), paint(0x2a2230, { hatch: 0 })); h.position.y = -0.03; g.add(h);
  return ink(g, 'fine');
}

// Makers' Row's parking court (grounds.js makersRow): six bays off a central aisle, three a side,
// nose-in toward the hedges; three taken (a free bay each side, and one by the mouth, for the
// player's car). The court and its mouth are paved, so the car may drive off the spur into it
// and manoeuvre freely (not the pavement or the lawns beside it)
function parkRow(scene, town) {
  const row = town.row; if (!row) return;
  const root = row.root; root.updateWorldMatrix(true, false);
  const L = (x, z) => root.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
  { const inv = root.matrixWorld.clone().invert(), p = new THREE.Vector3(), r = root.position.length();
    LOTS.push((d) => { p.copy(d).multiplyScalar(r).applyMatrix4(inv);
      return (p.z > row.z0 - 0.2 && p.z < row.z1 && Math.abs(p.x) < row.half) || (p.z >= row.z1 - 0.1 && p.z < row.z1 + 1.2 && Math.abs(p.x) < row.aisle + 0.3); }); }
  // bays: [0..2] on −x, [3..5] on +x, each from the pavement end out toward the mouth
  [[0, 0xd8573f], [2, 0x6f9fc0], [4, 0xf3eee4]].forEach(([bi, col]) => {
    const b = row.bays[bi]; if (!b) return;
    const frame = new THREE.Group(), body = buildCar({ body: col });
    frame.add(body); frame.userData.noGround = true;
    const d = L(b.x, b.z);                                          // nose (b.fx, b.fz): toward the bay's wheel stop
    frame.position.copy(d).multiplyScalar(standAt(d));
    alignToSurface(frame, d, yawToFace(d, L(b.x + b.fx * 3, b.z + b.fz * 3)));
    scene.add(frame);
    fitToGround(body, frame);
    frame.updateWorldMatrix(true, false);
    for (const z of [-0.6, 0.6]) town.colliders.push({ dir: frame.localToWorld(new THREE.Vector3(0, 0, z)).normalize(), r: 0.75 });
  });
}

export function createPlaza({ scene, town, game, player }) {
  parkRow(scene, town);
  const mall = town.mall, info = mall?.root?.userData?.mall;
  if (!info) return { update() {} };
  const root = mall.root; root.updateWorldMatrix(true, false);
  const L = (x, z) => root.localToWorld(new THREE.Vector3(x, 0, z)).normalize();
  // the lot and its drive are paved: the car may leave the boulevard into them (the drive's
  // box reaches over the road's edge, so turning in isn't held back at the kerb)
  { const inv = root.matrixWorld.clone().invert(), p = new THREE.Vector3(), r = root.position.length();
    LOTS.push((d) => { p.copy(d).multiplyScalar(r).applyMatrix4(inv);
      return (p.z > 1.5 && p.z < info.lotEnd && Math.abs(p.x) < info.lotHalf) || (p.z >= info.lotEnd - 0.1 && p.z < info.lotEnd + 4.6 && Math.abs(p.x) < 2.6); }); }

  // ── parked cars ──
  const cars = CARS.map(([bi, col]) => {
    const b = info.bays[bi];
    const frame = new THREE.Group(), body = buildCar({ body: col });
    frame.add(body); frame.userData.noGround = true;
    // nose in: the car's +z (its nose) toward the shops; the bumper stops short of the wheel stop
    const cz = b.stopZ + 0.12 + 1.42, d = L(b.x, cz);
    frame.position.copy(d).multiplyScalar(standAt(d));
    alignToSurface(frame, d, yawToFace(d, L(b.x, cz - 3)));
    scene.add(frame);
    fitToGround(body, frame);
    frame.updateWorldMatrix(true, false);
    for (const z of [-0.6, 0.6]) town.colliders.push({ dir: frame.localToWorld(new THREE.Vector3(0, 0, z)).normalize(), r: 0.75 });
    return { frame, bay: bi };
  });

  // ── shoppers ──
  const list = SHOPPERS.map((S, i) => {
    const b = info.bays[S.bay], door = info.doors[S.shop], car = info.bays[S.car];
    const lane = b.x + S.side;                                   // up the empty bay, clear of its wheel stop
    // the loop, in the mall's frame: [x, z, pause-after (s), 'in' = gone through the door]
    const pts = [
      [car.x + 0.3, info.aisleZ, 2.5 + i],                          // by their car
      [lane, info.aisleZ, 0],
      [lane, info.walkZ + 0.25, 0],                                 // up the empty bay to the kerb
      [door.x, info.walkZ, 0],                                      // along the covered walk
      [door.x, door.z + 0.12, 5 + 2 * i, 'in'],                     // in at the door…
      [door.x, info.walkZ, 0],                                      // …and out
      [lane, info.walkZ + 0.25, 0],
      [lane, info.aisleZ, 0],
    ].map(([x, z, wait, tag]) => ({ d: L(x, z), wait, tag }));
    const segs = pts.map((p, k) => arc(p.d, pts[(k + 1) % pts.length].d));
    const obj = person(S.look);
    const h = obj.userData.human;
    if (h) { const bg = bag(S.bag); bg.rotation.y = Math.PI / 2; h.J.gripR.add(bg); }
    scene.add(obj);
    const s = { ...S, obj, pts, segs, k: (i * 3) % pts.length, u: 0, wait: 0, inside: false, paused: false, dir: pts[0].d.clone(), speed: 0.85 + 0.12 * i };
    place(s, 0, 0);
    game.bumps.add(obj, { pitch: S.pitch, line: S.line, home: () => s.dir.clone(),
      onAway: () => { s.paused = true; }, onBack: () => { s.paused = false; } });
    return s;
  });

  function place(s, dt, k) {
    const A = s.pts[s.k], B = s.pts[(s.k + 1) % s.pts.length];
    const d = slerpDir(A.d, B.d, s.u);
    s.dir.copy(d);
    s.obj.position.copy(d).multiplyScalar(standAt(d));
    // walking: face the way; waiting by the car or at the door: face the next leg
    if (arc(A.d, B.d) > 1e-5) alignToSurface(s.obj, d, yawToFace(d, B.d));
    const h = s.obj.userData.human;
    if (h) poseFolk(h, dt, k);
  }

  return {
    list, cars,
    update(dt) {
      if (game.G.state === 'cold') { for (const s of list) s.obj.visible = false; return; }   // 3:07 a.m.: closed
      const here = player.st.dir;
      for (const s of list) {
        const busy = game.bumps.busy?.(s.obj);
        const far = arc(here, s.dir) > NEAR;
        s.obj.visible = !s.inside && (!far || busy);
        if (far || busy || s.paused) continue;
        if (s.wait > 0) {
          s.wait -= dt;
          if (s.wait <= 0 && s.inside) s.inside = false;              // back out of the shop
          place(s, dt, 0); continue;
        }
        // someone coming through on foot: stop and let them pass
        if (player.st.mode === 'walk' && arc(here, s.dir) < 1.2) { place(s, dt, 0); continue; }
        // your car (driving, or parked in their bay) in the way ahead: wait for it to go
        const car = player.st.mode === 'jeep' ? here : game.jeepSpot(), next = s.pts[(s.k + 1) % s.pts.length].d;
        if (arc(car, s.dir) < 1.9 && arc(car, next) < arc(s.dir, next) + 0.3) { place(s, dt, 0); continue; }
        const seg = s.segs[s.k] || 1e-3;
        s.u += s.speed * dt / seg;
        if (s.u >= 1) {
          s.u = 0; s.k = (s.k + 1) % s.pts.length;
          const P = s.pts[s.k];
          s.wait = P.wait;
          if (P.tag === 'in') s.inside = true;                       // through the door: gone a while
        }
        place(s, dt, 0.55);
      }
    },
  };
}
