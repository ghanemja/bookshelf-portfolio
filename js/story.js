// ─── THE CASE: things to find, people to ask, a theory to prove ─────────────
// Nothing tells you what a clue means. You walk up to something, look closer,
// and your notebook records what you SAW. People tell you what THEY saw. When
// you think you know, you name someone and back it with two things you found.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { HARBOUR } from './harbour.js';
import { R, arc, settle, frame, yawToFace, radiusAt, groundAt, standAt, onRoad, nearestRoad } from './world.js';
import { PAL, paint, ink, blobShadow, mergeStatic } from './style.js';
import { rbox, lathe, bench, rnd } from './props.js';
import { person, LOOKS } from './human.js';

// the people (and who did it — the game never says so out loud)
export const SUSPECTS = {
  rex:  { name: 'Rex Calloway', role: 'framer, Frame & Co.' },
  pia:  { name: 'Pia Moreno', role: 'bike courier' },
  otto: { name: 'Otto Brandt', role: 'night guard' },
};
export const CULPRIT = 'rex';
// the places worth looking around, for the case board
export const PLACES = [
  { id: 'museum', name: 'the museum' },
  { id: 'main', name: 'Main Street' },
  { id: 'harbour', name: 'the harbour' },
  { id: 'station', name: 'Central Station' },
];

// what you can find. `proves` is hidden: it's only used to judge your theory.
// `where` is the place it's found — the case board counts finds per place.
export const CLUES = [
  { id: 'ladder', where: 'museum', title: 'The ladder',
    text: 'An aluminium ladder against the east wing. The feet have sunk deep into the lawn — whoever came down it was heavy, or carrying something heavy.', proves: [] },
  { id: 'frames', where: 'museum', title: 'The empty frame',
    text: 'The canvas wasn\'t torn out. It was cut — one straight line, close to the stretcher, the way a professional trims a print.', proves: ['rex'] },
  { id: 'ruts', where: 'museum', title: 'Tyre ruts',
    text: 'Behind the service door, deep ruts in the soft verge. Wide tyres, and two side by side at the back — something heavy, with twin rear wheels.', proves: ['rex'] },
  { id: 'van', where: 'main', title: 'The white van',
    text: 'A white van, rear doors not quite shut. Inside: packing foam, corner protectors, and a roll of the museum\'s own grey gallery tape. The side says FRAME & CO.', proves: ['rex'] },
  { id: 'bike', where: 'main', title: 'The courier\'s bike',
    text: 'Paint on the handlebars and the frame — but it\'s dry, cracked, and it has dust in it. Weeks old.', proves: [], clears: 'pia' },
  { id: 'log', where: 'museum', title: 'The guard\'s logbook',
    text: 'Rounds signed at 1:00, 2:00, 3:00 and 4:00 — same pen, same pressure, same slant. As if all four were written at once. A cold coffee beside it, untouched.', proves: [], hint: 'otto' },
  { id: 'crates', where: 'harbour', title: 'Crates at the harbour',
    text: 'Flat crates stamped CATERING — CAPE FAR SIDE. One corner is splintered, and through the gap: gilt. A picture frame.', proves: [] },
  { id: 'ticket', where: 'station', title: 'A cargo ticket',
    text: 'Dropped by the freight door: “Cape Far Side, oversize, flat, 45 items. Account: Frame & Co.”', proves: ['rex'] },
];

// people you can talk to. Each says what they saw — not what it means.
export const PEOPLE = [
  { id: 'vivi', name: 'Director Vivi', colors: [PAL.accent, PAL.ink],
    lines: [
      'You came. Thank heavens. Forty-five canvases, gone in one night — through the dome, of all places.',
      'The police have nothing. I had three people with keys or reasons to be here last night: Otto on the night shift, Pia who brought the last delivery, and Rex — he framed the whole show.',
      'Look around. Talk to them. When you know who, come back and show me why.',
    ] },
  { id: 'otto', name: 'Otto, night guard', colors: [PAL.dusty, PAL.ink],
    lines: [
      'I did my rounds! Every hour, it\'s all in the log.',
      '…Alright. I may have rested my eyes. Once. Maybe twice. But I heard an engine around three — something big, round the back.',
    ] },
  { id: 'pia', name: 'Pia, courier', colors: [PAL.teal, PAL.ink],
    lines: [
      'Me? I dropped the last crate at six and went home. Ask the café, I was here till close.',
      'Funny thing — Rex\'s van went past here at dawn. He never opens before ten.',
    ] },
  { id: 'rex', name: 'Rex, framer', colors: [PAL.mustard, PAL.ink],
    lines: [
      'Terrible business. Terrible. I framed every one of those pieces myself, you know.',
      'Last night? Home. Asleep. The van\'s been parked right here since yesterday.',
    ] },
  // tucked away on the 7:40 at Central Station (it never leaves): optional, a hint, never proof
  { id: 'ezra', name: 'Ezra, retired signalman', colors: [PAL.dusty, PAL.ink], hidden: true,
    lines: [
      'Hm? Oh — sit, sit. Forty years I worked the signals on this line. Now I just ride the 7:40. It doesn\'t go anywhere these days, but the seats are good.',
      'Says here forty-five paintings walked out of the museum. Three in the morning. I don\'t sleep much — I heard something go past the yard about then. Big, boxy, no lights. Not a train. I know trains.',
      'Funny thing. Week ago a fellow bought every empty frame at the junk stall, paid cash, smelled of varnish. Said they were for a client "very far away". Far away. Ha. You can\'t get further than the far side of this little world, can you?',
    ] },
];

// ── props for the case ──
// each rut a thin strip draped over the ground point by point once it's placed (dropRuts):
// laid flat as one long box it sank into the slope behind the museum and only stubs showed
function ruts() { const g = new THREE.Group(); g.userData.rutXs = [-0.9, -0.62, 0.62, 0.9]; return g; }
const RUT_MAT = paint(0x8a6a52, { hatch: 0 });
RUT_MAT.side = THREE.DoubleSide; RUT_MAT.polygonOffset = true; RUT_MAT.polygonOffsetFactor = -6; RUT_MAT.polygonOffsetUnits = -6;
function dropRuts(g, L = 3.4, W = 0.22, N = 48) {
  g.updateWorldMatrix(true, true);
  const inv = g.matrixWorld.clone().invert(), p = new THREE.Vector3();
  for (const x of g.userData.rutXs) {
    const pos = [], idx = [];
    for (let k = 0; k <= N; k++) {
      const z = -L / 2 + L * k / N, taper = Math.min(1, k / 2, (N - k) / 2) * 0.35 + 0.65;   // soft ends
      for (const sx of [-1, 1]) {
        p.set(x + sx * W / 2 * taper, 0, z).applyMatrix4(g.matrixWorld);
        const d = p.clone().normalize();
        pos.push(...d.multiplyScalar(standAt(d) + 0.03).applyMatrix4(inv).toArray());
      }
      if (k < N) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, RUT_MAT); m.userData.noInk = true; m.userData.noGround = true; g.add(m);
  }
}
function van() {
  const g = new THREE.Group(), white = paint(0xf4f1ea), dark = paint(PAL.ink, { hatch: 0 });
  { // ONE shell: a side profile — flat roof, a raked windscreen, the bonnet, a rounded nose —
    // extruded across the van and bevelled, so the cab and bonnet are the body (no seam)
    const pr = new THREE.Shape(), q = (cx, cy, x, y) => pr.quadraticCurveTo(cx, cy, x, y);
    pr.moveTo(-1.3, 0.43); pr.lineTo(2.12, 0.43); q(2.34, 0.43, 2.34, 0.56); pr.lineTo(2.34, 0.72); q(2.33, 0.85, 2.14, 0.88);
    pr.lineTo(1.78, 0.94); q(1.66, 0.96, 1.63, 1.06); pr.lineTo(1.42, 1.56); q(1.36, 1.68, 1.2, 1.68);
    pr.lineTo(-1.3, 1.68); q(-1.5, 1.68, -1.5, 1.5); pr.lineTo(-1.5, 0.6); q(-1.5, 0.43, -1.3, 0.43);
    const bg = new THREE.ExtrudeGeometry(pr, { depth: 1.3, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 5, curveSegments: 12 });
    bg.translate(0, 0, -0.65); bg.rotateY(-Math.PI / 2);
    const bw = mergeVertices(bg.deleteAttribute('uv').deleteAttribute('normal'), 1e-4); bw.computeVertexNormals();
    g.add(new THREE.Mesh(bw, white)); }
  // ── the front: a windscreen set flush in a dark surround, wipers, cab side windows,
  // round headlamps either side of a slatted grille, a bumper, mirrors, a plate ──
  { const glass = paint(0x9fc4cc, { hatch: 0 }), rim = paint(0x4a4552, { hatch: 0 }), steel = paint(0xb9bcc4, { hatch: 0 }), lampM = paint(0xfff1c8, { emissive: 0x6a5a30, hatch: 0 });
    const at = (geo, mat, x, y, z, rx = 0, ry = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, 0); g.add(o); return o; };
    const rake = Math.atan2(1.63 - 1.42, 1.56 - 1.06), nz = Math.cos(rake), ny = Math.sin(rake);   // the screen leans back
    const onScreen = (o, t, out) => { o.position.set(o.position.x, 1.31 + ny * (0.1 + out), 1.525 + nz * (0.1 + out) + t); o.rotation.x = -rake; return o; };
    onScreen(at(rbox(1.3, 0.56, 0.02, 0.08), rim, 0, 0, 0), 0, 0.0);
    onScreen(at(rbox(1.18, 0.46, 0.02, 0.07), glass, 0, 0, 0), 0, 0.012);
    for (const x of [-0.3, 0.25]) { const w = onScreen(at(rbox(0.42, 0.025, 0.02, 0.008), rim, x, 0, 0), 0, 0.025); w.position.y -= 0.17 * nz; w.position.z += 0.17 * ny; w.rotation.z = 0.35; }
    for (const s of [-1, 1]) {
      at(rbox(0.05, 0.42, 0.5, 0.06), rim, s * 0.75, 1.32, 1.12);              // the frame stands proud…
      at(new THREE.PlaneGeometry(0.42, 0.34), glass, s * 0.777, 1.32, 1.12, 0, s * Math.PI / 2).userData.noInk = true;   // …the glass is a pane on its face, inside its edge
      at(new THREE.CylinderGeometry(0.115, 0.115, 0.05, 18).rotateX(Math.PI / 2), steel, s * 0.48, 0.66, 2.43);
      at(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 18).rotateX(Math.PI / 2), lampM, s * 0.48, 0.66, 2.45);
      at(rbox(0.05, 0.05, 0.22, 0.015), rim, s * 0.8, 1.2, 1.52);                    // mirror arm
      at(rbox(0.06, 0.2, 0.13, 0.03), rim, s * 0.86, 1.24, 1.44);                    // mirror
      at(rbox(0.08, 0.06, 0.03, 0.02), paint(0xe8a040, { emissive: 0x5a3010, hatch: 0 }), s * 0.66, 0.52, 2.44);   // indicator
    }
    at(rbox(0.58, 0.24, 0.03, 0.05), rim, 0, 0.66, 2.435);
    for (const y of [0.67, 0.74, 0.81]) at(rbox(0.5, 0.025, 0.02, 0.008), steel, 0, y - 0.08, 2.455);
    at(rbox(1.5, 0.14, 0.2, 0.05), paint(0x4a4552), 0, 0.4, 2.45);
    { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48; const c = cv.getContext('2d');
      c.fillStyle = '#f6f2e6'; c.fillRect(0, 0, 128, 48); c.strokeStyle = '#2a2230'; c.lineWidth = 4; c.strokeRect(2, 2, 124, 44);
      c.fillStyle = '#2a2230'; c.font = '700 26px "Patrick Hand", "Comic Sans MS", cursive'; c.textAlign = 'center'; c.fillText('FRM 4C0', 64, 34);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const pl = at(new THREE.PlaneGeometry(0.3, 0.11), paint(0xffffff, { map: t, hatch: 0 }), 0, 0.41, 2.555); pl.userData.noInk = true; } }
  // FRAME & CO. painted on the side
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const c = cv.getContext('2d'); c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, 256, 96);
  c.fillStyle = '#2a2230'; c.font = '700 40px "Patrick Hand", "Comic Sans MS", cursive'; c.textAlign = 'center'; c.fillText('FRAME & CO.', 128, 60);
  c.strokeStyle = '#2a2230'; c.lineWidth = 4; c.strokeRect(14, 14, 228, 68);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.73), paint(0xffffff, { map: tx, hatch: 0 })); p.position.set(s * 0.77, 1.12, -0.2); p.rotation.y = s * Math.PI / 2; p.userData.noInk = true; g.add(p); }
  const tyre = lathe([[0.15, -0.1], [0.3, -0.1], [0.33, 0], [0.3, 0.1], [0.15, 0.1]], 16).rotateZ(Math.PI / 2);
  const hubM = paint(0xb9bcc4, { hatch: 0 }), capM = paint(0x6f6a78, { hatch: 0 });
  const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.205, 18).rotateZ(Math.PI / 2), cap = new THREE.CylinderGeometry(0.07, 0.07, 0.23, 12).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.72, 1.2], [0.72, 1.2], [-0.72, -1.1], [0.72, -1.1], [-0.52, -1.1], [0.52, -1.1]]) {
    g.add(new THREE.Mesh(tyre, dark).translateX(x).translateY(0.365).translateZ(z));
    g.add(new THREE.Mesh(hub, hubM).translateX(x).translateY(0.365).translateZ(z));           // a steel wheel fills the tyre (no see-through hole)
    g.add(new THREE.Mesh(cap, capM).translateX(x).translateY(0.365).translateZ(z));
  }
  // ── the back: two rear doors (the right one swung open on its hinges), the dark load
  // space with packing foam and the museum's grey tape inside, tail lights, a bumper with a
  // step, a number plate
  const BZ = -1.6, glassM = paint(0x9fc4cc, { hatch: 0 }), steel = paint(0xb9bcc4, { hatch: 0 }), redL = paint(0xd9483a, { emissive: 0x5a1410, hatch: 0 });
  const inside = new THREE.Mesh(rbox(1.24, 1.12, 0.05, 0.04), paint(0x3a3340, { hatch: 0 })); inside.position.set(0, 1.04, BZ + 0.005); g.add(inside);
  const foam = new THREE.Mesh(rbox(0.42, 0.34, 0.2, 0.08, 2), paint(0xece8de)); foam.position.set(0.32, 0.66, BZ - 0.02); foam.rotation.z = 0.08; g.add(foam);
  const tape = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.04, 8, 18), paint(0x8f939c)); tape.position.set(0.12, 0.56, BZ - 0.08); tape.rotation.y = 0.4; g.add(tape);
  const door = (hx, dir, open) => {                    // a door hinged at x = hx, hanging toward the middle
    const hinge = new THREE.Group(); hinge.position.set(hx, 0, BZ - 0.035); hinge.rotation.y = open; g.add(hinge);
    const d = new THREE.Group(); d.position.x = dir * 0.36; hinge.add(d);
    d.add(new THREE.Mesh(rbox(0.7, 1.24, 0.06, 0.03), white).translateY(1.04));
    const w = new THREE.Mesh(rbox(0.5, 0.36, 0.02, 0.06), glassM); w.position.set(dir * -0.02, 1.38, -0.035); d.add(w);
    const h = new THREE.Mesh(rbox(0.05, 0.16, 0.04, 0.015), steel); h.position.set(dir * 0.27, 0.98, -0.05); d.add(h);
    for (const y of [0.62, 1.42]) { const hg = new THREE.Mesh(rbox(0.06, 0.1, 0.05, 0.015), steel); hg.position.set(-dir * 0.33, y, -0.03); d.add(hg); }
    return hinge;
  };
  door(-0.72, 1, 0);                                   // left door: shut
  door(0.72, -1, -1.15);                               // right door: swung wide open, rear doors "not quite shut"
  for (const x of [-0.66, 0.66]) { const l = new THREE.Mesh(rbox(0.12, 0.3, 0.05, 0.02), redL); l.position.set(x, 0.72, BZ - 0.01); g.add(l); }
  const bumper = new THREE.Mesh(rbox(1.56, 0.14, 0.18, 0.05), paint(0x4a4552)); bumper.position.set(0, 0.36, BZ - 0.06); g.add(bumper);
  const step = new THREE.Mesh(rbox(0.6, 0.05, 0.16, 0.02), steel); step.position.set(0, 0.3, BZ - 0.18); g.add(step);
  { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48; const c = cv.getContext('2d');
    c.fillStyle = '#f3e7b5'; c.fillRect(0, 0, 128, 48); c.strokeStyle = '#2a2230'; c.lineWidth = 4; c.strokeRect(2, 2, 124, 44);
    c.fillStyle = '#2a2230'; c.font = '700 26px "Patrick Hand", "Comic Sans MS", cursive'; c.textAlign = 'center'; c.fillText('FRM 4C0', 64, 34);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), paint(0xffffff, { map: t, hatch: 0 })); plate.position.set(0, 0.47, BZ - 0.155); plate.rotation.y = Math.PI; plate.userData.noInk = true; g.add(plate); }
  g.add(blobShadow(1.0, 1.9));
  return ink(g, 'mid');
}
function bikeProp({ against = false } = {}) {
  // Pia's bike: spoked wheels whose tyres touch the ground (origin = the ground), a diamond
  // frame, saddle, bars with grips, a chainring and pedals, a kickstand it leans on — and
  // splashes of old paint on the frame (the clue)
  const g = new THREE.Group(), frameM = paint(PAL.teal), dark = paint(PAL.ink, { hatch: 0 }), steel = paint(0xb9bcc4, { hatch: 0 }), seatM = paint(0x6b4a34);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const bar = (a, b, r = 0.026, mat = frameM) => { const v = new THREE.Vector3().subVectors(b, a); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, v.length(), 8), mat); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); g.add(m); return m; };
  const WR = 0.33, WY = WR + 0.035;                                  // tyre outer radius 0.335 + a hair: sits on the ground
  const RA = V(0, WY, -0.56), FA = V(0, WY, 0.56), BB = V(0, 0.34, -0.02), SC = V(0, 0.8, -0.16), HT = V(0, 0.84, 0.4), HB = V(0, 0.66, 0.45);
  for (const A of [RA, FA]) {
    const ty = new THREE.Mesh(new THREE.TorusGeometry(WR - 0.03, 0.032, 10, 32), dark); ty.position.copy(A); ty.rotation.y = Math.PI / 2; g.add(ty);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WR - 0.07, 0.011, 6, 32), steel); rim.position.copy(A); rim.rotation.y = Math.PI / 2; g.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10).rotateZ(Math.PI / 2), steel); hub.position.copy(A); g.add(hub);
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; const sp = bar(A, A.clone().add(V(0, Math.sin(a) * (WR - 0.075), Math.cos(a) * (WR - 0.075))), 0.004, steel); sp.userData.noInk = true; }
  }
  bar(BB, SC); bar(SC, HT); bar(BB, HB, 0.03); bar(HT, HB, 0.032);          // seat, top, down and head tubes
  bar(RA, BB, 0.018); bar(RA, SC, 0.018);                                  // chain stays, seat stays
  bar(HB, FA, 0.02);                                                        // the fork
  bar(SC, V(0, 0.94, -0.19), 0.016, steel);                                 // seat post…
  { const sd = new THREE.Mesh(rbox(0.12, 0.05, 0.24, 0.025), seatM); sd.position.set(0, 0.96, -0.2); g.add(sd); }   // …and saddle
  bar(HT, V(0, 0.98, 0.37), 0.018, steel);                                  // stem
  { // the bars (turned along the frame when it's leaning on a wall)
    const turn = against ? 1.15 : 0, at = (x) => V(Math.cos(turn) * x, 0.98, 0.37 + 0.02 + Math.sin(turn) * x);
    bar(at(-0.24), at(0.24), 0.015, steel); for (const sx of [-1, 1]) bar(at(sx * 0.16), at(sx * 0.26), 0.022, dark); }
  // drivetrain: chainring, crank arms, pedals
  { const cr = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 20), steel); cr.position.copy(BB).add(V(0.05, 0, 0)); cr.rotation.y = Math.PI / 2; g.add(cr);
    bar(BB.clone().add(V(0.07, 0, 0)), BB.clone().add(V(0.07, -0.13, 0.08)), 0.012, steel); bar(BB.clone().add(V(-0.07, 0, 0)), BB.clone().add(V(-0.07, 0.13, -0.08)), 0.012, steel);
    for (const [x, y, z] of [[0.11, -0.13, 0.08], [-0.11, 0.13, -0.08]]) { const p = new THREE.Mesh(rbox(0.08, 0.02, 0.06, 0.008), dark); p.position.copy(BB).add(V(x, y, z)); g.add(p); }
    bar(RA.clone().add(V(0.05, 0, 0)), BB.clone().add(V(0.05, 0.08, 0)), 0.006, dark).userData.noInk = true; bar(RA.clone().add(V(0.05, 0, 0)), BB.clone().add(V(0.05, -0.08, 0)), 0.006, dark).userData.noInk = true; }
  if (!against) bar(BB.clone().add(V(0.03, 0, -0.08)), V(0.2, 0.0, -0.24), 0.012, steel);  // the kickstand, down to the ground on the lean side
  // splashes of old paint
  for (const [c, y, z] of [[PAL.accent, 0.72, 0.12], [PAL.mustard, 0.55, -0.1], [PAL.dusty, 0.82, 0.25]])
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), paint(c)).translateY(y).translateZ(z).translateX(0.025));
  g.rotation.z = against ? -0.16 : -0.1;                                   // leaning toward +x: on its stand, or on the wall (rolls about the tyres' contact line)
  const out = new THREE.Group(); out.add(g);
  return ink(out, 'fine');
}
function crates() {
  const g = new THREE.Group(), wood = paint(0xc9a06a);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const c = cv.getContext('2d'); c.fillStyle = '#c9a06a'; c.fillRect(0, 0, 256, 128);
  c.fillStyle = '#5a3a24'; c.font = '700 26px "Patrick Hand", cursive'; c.textAlign = 'center';
  c.fillText('CATERING', 128, 52); c.font = '600 20px "Patrick Hand", cursive'; c.fillText('— CAPE FAR SIDE —', 128, 86);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const lab = paint(0xffffff, { map: tx, hatch: 0 });
  // a neat stack of four flat painting crates (two up, two across), square to one another and
  // sat on a pair of timber skids — they used to be twisted and stacked crooked
  const batten = paint(0xa87f4e), CW = 1.5, CH = 1.0, CD = 0.32;
  for (const sx of [-1, 1]) g.add(new THREE.Mesh(rbox(0.12, 0.1, CD + 0.1, 0.02), batten).translateX(sx * 1.25).translateY(0.05));
  for (const sz of [-1, 1]) g.add(new THREE.Mesh(rbox(3.3, 0.1, 0.1, 0.02), batten).translateY(0.05).translateZ(sz * 0.12));
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 ? 1 : -1) * (CW / 2 + 0.02), y = 0.1 + CH / 2 + Math.floor(i / 2) * (CH + 0.02);
    const cr = new THREE.Group(); cr.position.set(x + (i === 3 ? 0.03 : 0), y, 0); g.add(cr);
    cr.add(new THREE.Mesh(rbox(CW, CH, CD, 0.03), wood));
    for (const bx of [-1, 1]) cr.add(new THREE.Mesh(rbox(0.1, CH + 0.02, 0.04, 0.012), batten).translateX(bx * (CW / 2 - 0.05)).translateZ(CD / 2 + 0.01));   // corner battens
    for (const by of [-1, 1]) cr.add(new THREE.Mesh(rbox(CW - 0.2, 0.08, 0.04, 0.012), batten).translateY(by * (CH / 2 - 0.04)).translateZ(CD / 2 + 0.01));
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.52), lab); l.position.z = CD / 2 + 0.035; l.userData.noInk = true; cr.add(l);
  }
  // the splintered top corner of the top-right crate shows gilt underneath
  g.add(new THREE.Mesh(rbox(0.22, 0.16, 0.1, 0.02), paint(PAL.gold)).translateX(1.48).translateY(0.1 + 2 * CH + 0.02 - 0.1).translateZ(CD / 2 - 0.02));
  g.add(blobShadow(1.8, 0.6));
  return ink(g, 'fine');
}
// stand-ins used only for the notebook sketches (things with no prop of their own)
export function sketchProp(id) {
  if (id === 'frames') {             // the empty gilt frame, canvas cut out
    const g = new THREE.Group(), gilt = paint(0xd9a640), back = paint(0x2a2230, { hatch: 0 });
    for (const [w, h, x, y] of [[1.0, 0.14, 0, 0.43], [1.0, 0.14, 0, -0.43], [0.14, 1.0, 0.43, 0], [0.14, 1.0, -0.43, 0]])
      g.add(new THREE.Mesh(rbox(w, h, 0.1, 0.03), gilt).translateX(x).translateY(y));
    g.add(new THREE.Mesh(rbox(0.74, 0.74, 0.02, 0.005), back).translateZ(-0.03));
    const flap = new THREE.Mesh(rbox(0.3, 0.06, 0.012, 0.004), paint(0xb8894a)); flap.position.set(0.22, -0.34, 0.01); flap.rotation.z = 0.5; g.add(flap);
    g.rotation.y = -0.5;
    return ink(g, 'fine');
  }
  if (id === 'log') {                // the guard's logbook, open, a pen across it
    const g = new THREE.Group();
    for (const s of [-1, 1]) { const pg = new THREE.Mesh(rbox(0.42, 0.03, 0.56, 0.01), paint(0xfaf3e2)); pg.position.x = s * 0.22; pg.rotation.z = -s * 0.06; g.add(pg); }
    g.add(new THREE.Mesh(rbox(0.9, 0.025, 0.6, 0.01), paint(0x3a5a8a)).translateY(-0.03));
    for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.005, 0.015), paint(0x5a4e5e, { hatch: 0 })); l.position.set(0.22, 0.03, -0.18 + i * 0.12); l.userData.noInk = true; g.add(l); }
    const pen = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.4, 3, 6), paint(0x2a2230, { hatch: 0 })); pen.rotation.set(Math.PI / 2, 0, 0.6); pen.position.set(-0.1, 0.05, 0.05); g.add(pen);
    return ink(g, 'fine');
  }
  return null;
}

function booth() {
  // the guard's booth: a little hut on a sunken concrete plinth (so its foot stays flush on a
  // slope), corner posts, a framed window with a sliding pane, a SECURITY board, a side door,
  // a roof with an overhang and a beacon; the logbook lies open on the sill
  const g = new THREE.Group(), wall = paint(PAL.dusty), trim = paint(PAL.cream), dk = paint(0x3f5872), glass = paint(0x9fc4cc, { hatch: 0 });
  const m = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); g.add(o); return o; };
  m(rbox(1.5, 0.42, 1.5, 0.06), paint(0xc9c2b4), 0, 0.03, 0);                    // plinth: 0.18 of it below the ground
  m(rbox(1.3, 1.85, 1.3, 0.12), wall, 0, 1.15, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m(rbox(0.14, 1.85, 0.14, 0.04), trim, sx * 0.62, 1.15, sz * 0.62);
  m(rbox(1.36, 0.1, 1.36, 0.03), trim, 0, 0.3, 0);                                // skirting
  // the window, the sliding pane half open
  m(rbox(1.0, 0.72, 0.08, 0.04), trim, 0, 1.42, 0.64);
  m(rbox(0.88, 0.6, 0.04, 0.02), paint(0x3a3340, { hatch: 0 }), 0, 1.42, 0.65);   // the dark inside
  m(rbox(0.46, 0.58, 0.03, 0.02), glass, 0.2, 1.42, 0.69);
  m(rbox(0.04, 0.6, 0.05, 0.015), trim, -0.02, 1.42, 0.7);
  // SECURITY board over the window
  { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d');
    c.fillStyle = '#2a2230'; c.fillRect(0, 0, 256, 64); c.fillStyle = '#f2d27a'; c.font = '700 40px "Patrick Hand", "Comic Sans MS", cursive'; c.textAlign = 'center'; c.fillText('SECURITY', 128, 46);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    m(rbox(0.82, 0.2, 0.05, 0.02), paint(0x2a2230, { hatch: 0 }), 0, 1.92, 0.65);
    const sg = m(new THREE.PlaneGeometry(0.76, 0.17), paint(0xffffff, { map: t, hatch: 0 }), 0, 1.92, 0.68); sg.userData.noInk = true; }
  // a side door with a knob and a little step
  m(rbox(0.06, 1.35, 0.62, 0.03), dk, 0.66, 0.98, -0.05);
  m(new THREE.SphereGeometry(0.035, 8, 6), paint(PAL.gold, { hatch: 0 }), 0.7, 0.95, 0.16);
  m(rbox(0.3, 0.06, 0.7, 0.02), paint(0xc9c2b4), 0.82, 0.22, -0.05);
  // roof: an overhanging slab, a cap, a beacon
  m(rbox(1.62, 0.14, 1.62, 0.06), trim, 0, 2.15, 0);
  m(rbox(1.3, 0.1, 1.3, 0.04), paint(0x3f5872), 0, 2.27, 0);
  m(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 14), paint(0x2a2230, { hatch: 0 }), 0, 2.36, 0);
  m(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint(0xe8604c, { emissive: 0x5a1410, hatch: 0 }), 0, 2.4, 0);
  m(rbox(1.08, 0.06, 0.3, 0.02), trim, 0, 1.03, 0.78);                            // the sill
  { // the guard's logbook, lying open on the sill: a red cover, two cream pages with ruled lines, a pen across it
    const B = new THREE.Group(); B.position.set(0.05, 1.07, 0.8); B.rotation.y = -0.18; g.add(B);
    B.add(new THREE.Mesh(rbox(0.5, 0.025, 0.3, 0.01), paint(0x9a3b4a)));
    for (const sx of [-1, 1]) {
      const pg = new THREE.Mesh(rbox(0.23, 0.02, 0.27, 0.008), paint(0xfaf3e2)); pg.position.set(sx * 0.118, 0.02, 0); pg.rotation.z = -sx * 0.08; B.add(pg);
      for (let k = 0; k < 4; k++) { const ln = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.008), paint(0x8a8392, { hatch: 0 })); ln.position.set(sx * 0.12, 0.033 + (sx > 0 ? -0.004 : -0.004), -0.08 + k * 0.05); ln.rotation.z = -sx * 0.08; ln.userData.noInk = true; B.add(ln); }
    }
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), paint(0x3f5872)); pen.rotation.set(0, 0.6, Math.PI / 2); pen.position.set(0.1, 0.05, 0.02); B.add(pen);
  }
  g.add(blobShadow(0.9));
  return ink(g, 'mid');
}
function ticket() {
  const g = new THREE.Group();
  const t = new THREE.Mesh(rbox(0.5, 0.02, 0.28, 0.01), paint(0xf4e6b8));
  t.position.y = 0.03; t.rotation.y = 0.4; g.add(t);
  return ink(g, 'fine');
}
function cafe() {
  // two bistro tables on the pavement under the café's awning
  const g = new THREE.Group();
  for (const x of [-0.5, 0.5]) {
    const t = new THREE.Group();
    t.add(new THREE.Mesh(lathe([[0.001, 0], [0.18, 0], [0.04, 0.06], [0.03, 0.62], [0.26, 0.64], [0.26, 0.69], [0.001, 0.69]], 16), paint(PAL.cream)));
    t.position.set(x, 0.07, 0); g.add(t);
    for (const s of [-1, 1]) {
      const ch = new THREE.Group();
      ch.add(new THREE.Mesh(lathe([[0.001, 0], [0.13, 0], [0.13, 0.04], [0.03, 0.06], [0.03, 0.38], [0.15, 0.4], [0.15, 0.44], [0.001, 0.44]], 14), paint(0x4f8a7e)));
      const back = new THREE.Mesh(rbox(0.26, 0.24, 0.03, 0.012), paint(0x4f8a7e)); back.position.set(0, 0.58, -0.13); ch.add(back);
      ch.position.set(x, 0.07, s * 0.36); ch.rotation.y = s > 0 ? Math.PI : 0; g.add(ch);
    }
    const cup = new THREE.Mesh(lathe([[0.001, 0], [0.035, 0], [0.045, 0.06], [0.001, 0.06]], 10), paint(0xf6eedb)); cup.position.set(x + 0.06, 0.76, 0.02); g.add(cup);
  }
  return ink(g, 'fine');
}

// ── place the case in the world ──
// spots: { museum frame, town frame, sites } — resolved by main.js
export function buildCase(scene, W) {
  const items = [];                                   // inspectables + people: {dir, radius, kind, id}
  // (each prop baked to a mesh per kind of paint + its hull once it's set down: the van was ~60 draws)
  const place = (obj, d, yaw = 0) => { settle(obj, d, 0.6, 0.03, yaw); mergeStatic(obj, [], { vc: true }); scene.add(obj); return obj; };
  const mF = W.museumFrame;
  // at the museum
  // the ladder is the museum's own, leaning on the east wing's balustrade with the rope beside it
  // (a second one was stood here, upright and off the wall, on the WEST side — mF's x is the
  // museum's −x); you look at it from in front of its feet, and the sparkle sits on its rails
  { const lg = W.museum.group, L = W.museum.ladder; lg.updateMatrixWorld(true);
    const d = lg.localToWorld(new THREE.Vector3(L.foot.x + 0.6, 0, L.foot.z)).normalize();
    const mid = L.foot.clone().lerp(L.rest, 0.42); mid.x += 0.12;                     // just proud of the rails
    items.push({ kind: 'clue', id: 'ladder', dir: d, glintAt: lg.localToWorld(mid) }); }
  { const d = mF(-2.2, 0.6), gd = mF(-2.2, 0.85);                                          // sparkle just over the easel's top (the frame fills 1.1–2.1 above the paving, the legs reach 2.4)
    items.push({ kind: 'clue', id: 'frames', dir: d, glintAt: gd.clone().multiplyScalar(groundAt(gd) + 2.25) }); }          // the easel's empty frame (museum +x is the town frame's -x: +2.2 was the sculpture)
  { const d = mF(0, -15.7); const r = ruts();   // from the foot of the loading ramp out to the verge
    place(r, d, yawToFace(d, mF(0, -20))); dropRuts(r); items.push({ kind: 'clue', id: 'ruts', dir: d, obj: r }); }
  { const d = mF(-7.1, -2.0); const b = booth(); place(b, d, yawToFace(d, mF(-7.1, 4)));   // window toward town: you see it as you walk up
    b.updateWorldMatrix(true, true); const L = (x, y, z) => b.localToWorld(new THREE.Vector3(x, y, z));
    items.push({ kind: 'clue', id: 'log', dir: L(0, 0, 1.25).normalize(), obj: b, glintAt: L(0.05, 1.32, 0.95) }); W.solid(d, 0.8); }   // the sparkle sits over the logbook   // on the lawn beside the steps, clear of the junction
  // downtown: the van outside Frame & Co., the café with Pia's bike
  let vanObj = null;
  { const d = W.townAt(W.vanSpot); const v = van(); vanObj = v; place(v, d, W.vanYaw + Math.PI);   /* turned round: the open back faces the way you walk up */ v.updateWorldMatrix(true, true); items.push({ kind: 'clue', id: 'van', at: d.clone(), dir: v.localToWorld(new THREE.Vector3(0, 0, -2.2)).normalize(), reach: 1.5, obj: v, glintAt: v.localToWorld(new THREE.Vector3(0, 1.15, -1.8)) }); W.solid(d, 1.1); }   // looked at from behind its open back doors (the sparkle there too), well clear of Rex at its side
  { const d = W.townAt(W.cafeSpot); const c = cafe(); place(c, d, yawToFace(d, W.townAt([W.cafeSpot[0], 0]))); W.solid(d, 0.55);
    // leaning on the café's end wall, at the corner, along the side of the building
    const cafeShop = W.shops.find(sp => sp.kind === 'cafe'), [cx] = W.toTown(cafeShop.dir), wallX = cx + cafeShop.w / 2, sY = Math.sign(W.cafeSpot[1]);
    const bx = wallX + 0.24, by = W.cafeSpot[1] + sY * 1.25;
    const bd = W.townAt([bx, by]); const b = bikeProp({ against: true }); place(b, bd, yawToFace(bd, W.townAt([bx, by + 5])));
    b.updateWorldMatrix(true, true);                                           // its lean side (+x) must face the wall
    if ((W.toTown(b.localToWorld(new THREE.Vector3(1, 0, 0)).normalize())[0] - bx) * (wallX - bx) < 0) b.rotateY(Math.PI);
    items.push({ kind: 'clue', id: 'bike', dir: bd, obj: b }); }
  // the harbour crates and the station ticket
  // the crates stand on the quay's west end, clear of the boathouse and the walk to the pier, label to the road
  { const d = W.siteAt('harbour', HARBOUR.crates), f = W.siteAt('harbour', HARBOUR.cratesFace); const c = crates(); place(c, d, yawToFace(d, f)); c.position.setLength(standAt(d));   /* on the quay's top, not the terrain under it */
    c.updateWorldMatrix(true, true);
    items.push({ kind: 'clue', id: 'crates', dir: d, obj: c, glintAt: c.localToWorld(new THREE.Vector3(0, 2.5, 0.2)) });   // the sparkle over the stack, not inside it
    for (const x of [-0.85, 0.85]) W.solid(c.localToWorld(new THREE.Vector3(x, 0, 0)).normalize(), 0.75); }
  { const d = W.siteAt('station', [-2.6, 1.6]); const t = ticket(); place(t, d); items.push({ kind: 'clue', id: 'ticket', dir: d, obj: t }); }
  // people
  const at = { vivi: mF(-1.4, 1.6), otto: mF(-5.1, 0.45), pia: W.townAt([W.cafeSpot[0] - 1.35, W.cafeSpot[1] - 0.25]), rex: null };
  // Rex waits on the street corner by his van, on the pavement in plain view
  at.rex = W.townAt([W.vanSpot[0] - 1.3, W.vanSpot[1] + 0.5]);
  // Ezra reads on the far bench of the parked train's second carriage, facing the door
  if (W.train) at.ezra = W.train.reader.dir;
  for (const p of PEOPLE) {
    const d = at[p.id]; if (!d) continue;
    const m = person(LOOKS[p.id]);
    const facing = p.id === 'ezra' ? W.train.reader.facing : mF(0, 6);
    settle(m, d, 0.25, 0, yawToFace(d, facing)); m.position.setLength(standAt(d)); scene.add(m);   // people stand ON the ground/road (no sink)
    items.push({ kind: 'person', id: p.id, dir: d, obj: m, seated: !!LOOKS[p.id].stance && LOOKS[p.id].stance === 'reading', hidden: !!p.hidden });
    W.solid(d, 0.35, true);
  }
  // a faint, hand-drawn glint over anything you haven't looked at yet
  for (const it of items) {
    if (it.hidden) continue;                          // someone you have to find for yourself
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(it.kind), transparent: true, depthWrite: false }));
    s.scale.setScalar(0.7);
    if (it.glintAt) s.position.copy(it.glintAt);
    else s.position.copy(it.dir).multiplyScalar(groundAt(it.dir) + (it.kind === 'person' ? 1.75 : 1.6));
    scene.add(s);
    it.glint = s;
  }
  return items;
}
const _glints = {};
function glintTex(kind) {
  if (_glints[kind]) return _glints[kind];
  // drawn like the world: loose, thin, double-traced ink over a paper-and-gouache fill —
  // never a crisp vector icon. Big canvas so it stays soft-edged, not blurry, up close.
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const c = cv.getContext('2d');
  let seed = kind === 'person' ? 11 : 29;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wob = (k = 1) => (rnd() - 0.5) * 1.6 * k;
  // a shape outline as points (closed), traced as ink twice, slightly off each time
  const ink = (pts, w, a, closed = true) => {
    c.strokeStyle = `rgba(42,34,48,${a})`; c.lineWidth = w; c.lineCap = c.lineJoin = 'round';
    const P = pts.map(([x, y]) => [x + wob(), y + wob()]); if (closed) P.push(P[0], P[1]);
    c.beginPath(); c.moveTo((P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2);
    for (let i = 1; i < P.length - 1; i++) c.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
    c.stroke();
  };
  const fill = (pts, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); };
  const grain = (pts) => {                       // paper tooth + a soft wash darker to one side
    c.save(); c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.clip();
    const g = c.createLinearGradient(40, 40, 220, 220); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(120,96,110,0.18)');
    c.fillStyle = g; c.fillRect(0, 0, N, N);
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(90,70,80,${0.03 + rnd() * 0.05})`; c.fillRect(rnd() * N, rnd() * N, 1.5, 1.5); }
    // a few pencil hatch strokes in the shadow corner, like the world's shading
    c.strokeStyle = 'rgba(42,34,48,0.12)'; c.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) { const o = 150 + i * 9; c.beginPath(); c.moveTo(o, 230); c.lineTo(o + 60, 170); c.stroke(); }
    c.restore();
  };
  if (kind === 'person') {             // a speech bubble, sketched
    // one continuous outline: round body, and a curved tail drawn out of it at the lower left
    const body = [];
    const a0 = Math.PI * 0.62, a1 = Math.PI * 0.78;                  // where the tail leaves and rejoins
    for (let i = 0; i <= 36; i++) {
      const a = a1 + i / 36 * (Math.PI * 2 - (a1 - a0));
      body.push([128 + Math.cos(a) * 88, 108 + Math.sin(a) * 62]);
    }
    body.push([128 + Math.cos(a0) * 88, 108 + Math.sin(a0) * 62], [86, 192], [60, 226], [72, 184]);
    fill(body, '#f7f0df'); grain(body);
    ink(body, 4.5, 0.85); ink(body, 2, 0.4);
    for (const x of [92, 128, 164]) {                    // three brushy dots
      c.fillStyle = 'rgba(42,34,48,0.88)'; c.beginPath(); c.ellipse(x + wob(), 108 + wob(), 9 + wob(0.6), 8 + wob(0.6), wob(0.2), 0, 7); c.fill();
    }
  } else {                              // a sparkle: a four-point star with soft curved arms + a small one
    const star = (cx, cy, R, r) => { const p = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2 - Math.PI / 2; const k = Math.pow(Math.abs(Math.cos(2 * a)), 5.5); p.push([cx + Math.cos(a) * (r + (R - r) * k), cy + Math.sin(a) * (r + (R - r) * k)]); } return p; };
    const big = star(120, 132, 98, 30), small = star(200, 58, 34, 11);
    for (const p of [big, small]) { fill(p, '#ffe7a0'); grain(p); ink(p, 4, 0.85); ink(p, 1.8, 0.4); }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  _glints[kind] = t; return t;
}

// judge a theory: a suspect + two pieces of evidence
export function judge(suspect, ids) {
  const clues = ids.map(id => CLUES.find(c => c.id === id));
  const support = clues.filter(c => c.proves.includes(suspect)).length;
  if (suspect === CULPRIT && support >= 2)
    return { ok: true, text: `Vivi reads your notes twice. “${clues.map(c => c.title.replace(/^(The|A) /, 'The ').replace(/\.$/, '')).join('. ')}… Rex. He framed them — then he took them.” She's already dialling. “If those canvases are crated for Cape Far Side, they leave tonight.”` };
  if (suspect === 'pia' && ids.includes('bike'))
    return { ok: false, text: '“That paint is weeks old,” Vivi says. “If anything, that clears her.”' };
  if (suspect === 'otto')
    return { ok: false, text: '“Otto slept on the job — I\'ll have words. But a sleeping guard doesn\'t carry forty-five canvases down a ladder.”' };
  if (suspect === CULPRIT)
    return { ok: false, text: '“Maybe,” Vivi says slowly. “But that doesn\'t prove it. I need something that puts him there.”' };
  return { ok: false, text: '“That doesn\'t prove anything,” Vivi says. “Keep looking.”' };
}
