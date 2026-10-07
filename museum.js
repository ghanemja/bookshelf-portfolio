// ─── THE DOWNTOWN MUSEUM — the scene of the crime ───────────────────────────
// A proper civic museum, modelled (not stacked): a fluted Greek-revival
// portico on a three-tier stylobate, a gabled temple body flanked by two
// lower gallery wings, and a ribbed glass rotunda dome with ONE pane missing —
// that's how the thief got in. Out front: the paved forecourt, police tape,
// blinking beacons, searchlights after dark, an empty gilded frame on an easel.
//
// Everything is smooth-shaded with real bevels (RoundedBox, lathed profiles,
// bevelled extrusions) so it reads curved in Classic, and clean silhouettes so
// the boil hull + inked edge pass draw it well in Sketchbook / Wasteland.
// Static parts are merged per material at the end to keep draw calls low.
//
// Local frame: +Y up, +Z faces the road. The origin is the forecourt where the
// player arrives; the building stands behind it (−Z).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const ART = './artworks/';

export function buildMuseum({ lite = false, glowMats = [] } = {}) {
  const g = new THREE.Group();
  g.name = 'DowntownMuseum';
  const SEG = lite ? 24 : 48;

  // ── materials: smooth, a little satin; nothing flat-shaded ──
  const S = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, flatShading: false, ...o });
  const STONE = S(0xf2e8d5);                    // limestone
  const STONE_D = S(0xd8cab0, { roughness: 0.8 });   // steps, shadowed bands
  const TRIM = S(0xfffaf0, { roughness: 0.6 });      // cornices, frames
  const ROOF = S(0x7d8f99, { roughness: 0.55, metalness: 0.25 });   // lead/zinc
  const PATINA = S(0x5fae9a, { roughness: 0.45, metalness: 0.35 });  // copper ribs
  const BRONZE = S(0x7a4f28, { roughness: 0.38, metalness: 0.65 });
  const GOLD = S(0xe3b44c, { roughness: 0.28, metalness: 0.85 });
  const HEDGE = S(0x4f8f4c, { roughness: 0.9 });
  const POT = S(0xb9764a, { roughness: 0.75 });
  const DARK = S(0x2d2138, { roughness: 0.6 });
  const GLASS = new THREE.MeshStandardMaterial({
    color: 0xa9d8ec, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.42,
    emissive: 0xffd9a0, emissiveIntensity: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  // gallery windows: warm and lit from inside after dark
  const WIN = new THREE.MeshStandardMaterial({ color: 0x3d5566, roughness: 0.15, metalness: 0.4, emissive: 0xffcf86, emissiveIntensity: 0 });
  const LAMP = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffdc9a, emissiveIntensity: 0.4, roughness: 0.3 });
  glowMats.push(WIN, LAMP);

  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  // bevel resolution follows size: a big slab's edge is seen up close and
  // needs a round profile; a door panel's 2cm edge only needs one chamfer step
  const rbox = (w, h, d, r = 0.06, seg) => {
    const s2 = seg ?? (Math.max(w, h, d) > 2.5 ? 2 : 1);
    return new RoundedBoxGeometry(w, h, d, lite ? 1 : s2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  };
  // smooth a non-indexed / seamed geometry: weld, then recompute normals
  const smooth = (geo, keepUV = false) => {
    if (!keepUV) geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    const w = mergeVertices(geo, 1e-4);
    w.computeVertexNormals();
    return w;
  };
  const lathe = (pts, seg = SEG) => smooth(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));
  const extrude = (shape, depth, bevel = 0.05, keepUV = false) => smooth(new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: lite ? 1 : 3, curveSegments: lite ? 12 : 24,
  }), keepUV);

  // ── dimensions ──
  const Y0 = 0.66;              // top of the stylobate
  const PZ = 0.45;              // top of the forecourt paving
  const COL_Z = -3.6;           // portico column line
  const FRONT = -3.9;           // temple-body / wing front wall
  const BACK = -11.3;
  const ZC = (FRONT + BACK) / 2, DEPTH = FRONT - BACK;
  const CW = 7.8;               // temple body width
  const COL_H = 3.3, COL_R = 0.27;
  const ENT_Y = Y0 + 0.16 + COL_H + 0.12;   // top of the capitals = underside of the entablature
  const ROOF_Y = ENT_Y + 0.36 + 0.5 + 0.2;  // top of the cornice
  const PED_W = 8.9, PED_H = 1.5;

  // ── foundation + three-tier stylobate (the steps wrap the whole building) ──
  add(rbox(13.6, 3.0, 9.2, 0.04, 1), STONE_D, 0, -1.4, -7.0);
  for (let i = 0; i < 3; i++) {
    add(rbox(13.6 - 0.6 * i, 0.22, 9.2 - 0.6 * i, 0.07), i === 2 ? STONE : STONE_D, 0, 0.11 + 0.22 * i, -7.0);
  }

  // ── the portico: six fluted columns with Ionic-ish bases and capitals ──
  const colGeo = (() => {
    const r = COL_R, h = COL_H, P = [];
    P.push([0.001, 0], [r * 1.34, 0], [r * 1.38, 0.05], [r * 1.32, 0.1], [r * 1.18, 0.13], [r * 1.12, 0.17],
      [r * 1.18, 0.21], [r * 1.12, 0.26], [r * 1.0, 0.31]);
    const s0 = 0.31, s1 = h - 0.36, N = 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      P.push([r * (1 - 0.13 * t * t + 0.035 * Math.sin(Math.PI * t)), s0 + (s1 - s0) * t]);   // entasis
    }
    const rt = r * 0.87;
    P.push([rt * 1.1, h - 0.32], [rt * 1.12, h - 0.28], [rt * 1.02, h - 0.25],   // astragal
      [rt * 1.08, h - 0.2], [r * 1.18, h - 0.13], [r * 1.36, h - 0.07], [r * 1.4, h - 0.03], [0.001, h - 0.03]);
    const geo = new THREE.LatheGeometry(P.map(([x, y]) => new THREE.Vector2(x, y)), lite ? 20 : 32);
    if (!lite) {                                   // 8 shallow flutes, sampled 4× each
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < s0 + 0.04 || y > s1 - 0.02) continue;
        const a = Math.atan2(p.getX(i), p.getZ(i));
        const k = 1 - 0.05 * Math.pow(0.5 + 0.5 * Math.cos(a * 8), 2);
        p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
      }
    }
    return smooth(geo);
  })();
  const plinthGeo = rbox(0.8, 0.16, 0.8, 0.04);
  const abacusGeo = rbox(0.84, 0.12, 0.84, 0.04);
  const voluteGeo = (() => {
    const v = new THREE.CylinderGeometry(0.1, 0.1, 0.74, 14, 1);
    v.rotateX(Math.PI / 2);
    return v;
  })();
  for (let i = 0; i < 6; i++) {
    const x = -3.25 + i * 1.3;
    add(plinthGeo, STONE, x, Y0 + 0.08, COL_Z);
    add(colGeo, STONE, x, Y0 + 0.16, COL_Z);
    add(abacusGeo, TRIM, x, ENT_Y - 0.06, COL_Z);
    // Ionic volutes: a scroll bolster either side, its spiral end facing out
    for (const sx of [-1, 1]) add(voluteGeo, TRIM, x + sx * 0.3, ENT_Y - 0.2, COL_Z);
  }

  // ── entablature: architrave, frieze (with the carved inscription), cornice ──
  const entD = BACK - 0.1 - (COL_Z + 0.45);
  const entZ = (BACK - 0.1 + COL_Z + 0.45) / 2;
  add(rbox(8.4, 0.36, -entD, 0.05), STONE, 0, ENT_Y + 0.18, entZ);
  add(rbox(8.3, 0.5, -entD - 0.08, 0.04), STONE_D, 0, ENT_Y + 0.36 + 0.25, entZ);
  add(rbox(8.9, 0.2, -entD + 0.4, 0.07), TRIM, 0, ROOF_Y - 0.1, entZ);
  const frontEnt = entZ - entD / 2;   // front face of the architrave (z)
  {
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 124;
    const c = cv.getContext('2d');
    c.fillStyle = '#d8cab0'; c.fillRect(0, 0, 2048, 124);
    c.font = '600 78px Georgia, "Times New Roman", serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    try { c.letterSpacing = '26px'; } catch { /* older canvas */ }
    const txt = 'THE DOWNTOWN MUSEUM OF ART';
    c.fillStyle = '#fff7e6'; c.fillText(txt, 1026, 66);       // carved: light lip below…
    c.fillStyle = '#6b5226'; c.fillText(txt, 1024, 62);       // …dark cut above
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    add(new THREE.PlaneGeometry(8.0, 0.48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }),
      0, ENT_Y + 0.36 + 0.25, frontEnt - 0.03);
  }

  // ── gabled roof + pediment (tympanum, raking cornice, gold medallion) ──
  const tri = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath(); return s; };
  const roofLen = -entD + 0.4;
  const roof = add(new THREE.ExtrudeGeometry(tri(PED_W, PED_H), { depth: roofLen, bevelEnabled: false }), [STONE_D, ROOF],
    0, ROOF_Y, entZ - roofLen / 2);
  roof.geometry.computeVertexNormals();
  {
    const frame = tri(PED_W + 0.3, PED_H + 0.22);
    const hole = new THREE.Path(), hw = PED_W - 1.3, hh = PED_H - 0.42;
    hole.moveTo(-hw / 2, 0.2); hole.lineTo(0, 0.2 + hh); hole.lineTo(hw / 2, 0.2); hole.closePath();
    frame.holes.push(hole);
    const fz = entZ + roofLen / 2;
    add(extrude(frame, 0.14, 0.05), TRIM, 0, ROOF_Y - 0.04, fz - 0.06);
    const backFrame = add(extrude(frame, 0.14, 0.05), TRIM, 0, ROOF_Y - 0.04, entZ - roofLen / 2 - 0.1);
    backFrame.rotation.y = Math.PI;
    // the medallion: a gilded painter's palette in a laurel ring
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    const gr = c.createRadialGradient(110, 100, 10, 128, 128, 128);
    gr.addColorStop(0, '#fff1b8'); gr.addColorStop(0.55, '#e3b44c'); gr.addColorStop(1, '#9a6b1f');
    c.fillStyle = gr; c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7a5418';
    c.beginPath(); c.ellipse(128, 132, 74, 58, -0.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f6d777';
    c.beginPath(); c.ellipse(124, 126, 70, 54, -0.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7a5418'; c.beginPath(); c.arc(160, 150, 13, 0, Math.PI * 2); c.fill();
    [['#c0392b', 88, 104], ['#2e86de', 116, 90], ['#27ae60', 148, 100], ['#f1c40f', 90, 140]].forEach(([col, x, y]) => {
      c.fillStyle = col; c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.fill();
    });
    const mt = new THREE.CanvasTexture(cv); mt.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.CircleGeometry(0.42, 40), new THREE.MeshStandardMaterial({ map: mt, roughness: 0.35, metalness: 0.6 }),
      0, ROOF_Y + 0.62, fz + 0.03);
    add(new THREE.TorusGeometry(0.45, 0.045, 10, 48), GOLD, 0, ROOF_Y + 0.62, fz + 0.03);
  }

  // ── temple body: the great hall behind the columns ──
  add(rbox(CW, ENT_Y - Y0, DEPTH, 0.08), STONE, 0, Y0 + (ENT_Y - Y0) / 2, ZC);
  // rusticated base course + pilasters along the sides
  add(rbox(CW + 0.14, 0.42, DEPTH + 0.14, 0.06), STONE_D, 0, Y0 + 0.21, ZC);
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
    add(rbox(0.12, ENT_Y - Y0 - 0.5, 0.42, 0.04), TRIM, s * (CW / 2 + 0.05), Y0 + (ENT_Y - Y0) / 2 + 0.2, BACK + 0.8 + k * 1.45);
  }
  // the great bronze doors under an arched, glowing fanlight
  {
    const dz = FRONT + 0.02;
    add(rbox(1.62, 2.66, 0.16, 0.05), TRIM, 0, Y0 + 1.33, dz);                 // surround
    add(rbox(1.3, 2.0, 0.14, 0.03), BRONZE, 0, Y0 + 1.0, dz + 0.05);            // leaves
    add(rbox(0.03, 1.96, 0.16, 0.01), DARK, 0, Y0 + 1.0, dz + 0.06);            // the gap
    for (const s of [-1, 1]) {                                                  // pulls + panels
      add(new THREE.SphereGeometry(0.045, 12, 8), GOLD, s * 0.1, Y0 + 1.0, dz + 0.14);
      for (const yy of [0.55, 1.4]) add(rbox(0.46, 0.62, 0.04, 0.02), BRONZE, s * 0.33, Y0 + yy, dz + 0.13);
    }
    const fan = add(new THREE.CircleGeometry(0.62, 32, 0, Math.PI), WIN, 0, Y0 + 2.02, dz + 0.1);
    fan.scale.y = 0.85;
    const arch = add(new THREE.TorusGeometry(0.66, 0.06, 10, 32, Math.PI), TRIM, 0, Y0 + 2.02, dz + 0.1);
    arch.scale.y = 0.85;
    // two flanking niches, lit
    for (const s of [-1, 1]) {
      add(rbox(0.9, 2.0, 0.1, 0.04), TRIM, s * 2.3, Y0 + 1.45, dz);
      add(rbox(0.7, 1.75, 0.08, 0.03), WIN, s * 2.3, Y0 + 1.4, dz + 0.04);
    }
  }

  // ── the two gallery wings: lower, flat-roofed, balustraded, arched windows ──
  const WING_W = 2.5, WING_H = 2.9, WING_X = CW / 2 + WING_W / 2 - 0.05;
  for (const s of [-1, 1]) {
    const wx = s * WING_X;
    add(rbox(WING_W, WING_H, DEPTH - 0.4, 0.08), STONE, wx, Y0 + WING_H / 2, ZC - 0.2);
    add(rbox(WING_W + 0.1, 0.38, DEPTH - 0.3, 0.05), STONE_D, wx, Y0 + 0.19, ZC - 0.2);
    add(rbox(WING_W + 0.3, 0.2, DEPTH - 0.1, 0.07), TRIM, wx, Y0 + WING_H + 0.1, ZC - 0.2);
    // balustrade: top rail + dumpy balusters
    const balY = Y0 + WING_H + 0.2;
    add(rbox(0.1, 0.08, DEPTH - 0.4, 0.03), TRIM, wx + s * (WING_W / 2 + 0.05), balY + 0.42, ZC - 0.2);
    add(rbox(WING_W + 0.2, 0.08, 0.1, 0.03), TRIM, wx, balY + 0.42, FRONT + 0.0);
    const balGeo = lathe([[0.001, 0], [0.07, 0], [0.05, 0.08], [0.09, 0.2], [0.05, 0.32], [0.06, 0.38], [0.001, 0.38]], 8);
    for (let k = 0; k < 12; k++) add(balGeo, TRIM, wx + s * (WING_W / 2 + 0.05), balY, BACK + 0.6 + k * 0.58);
    for (let k = 0; k < 4; k++) add(balGeo, TRIM, wx - 0.9 + k * 0.6, balY, FRONT);
    // arched gallery windows down the outer wall
    const sideX = wx + s * (WING_W / 2 + 0.01);
    for (let k = 0; k < 3; k++) {
      const z = BACK + 1.6 + k * 2.1;
      const grp = new THREE.Group(); grp.position.set(sideX, Y0 + 1.25, z); grp.rotation.y = s * Math.PI / 2; g.add(grp);
      add(rbox(0.86, 1.5, 0.08, 0.03), TRIM, 0, 0, 0, grp);
      add(new THREE.PlaneGeometry(0.66, 1.2), WIN, 0, -0.05, 0.05, grp);
      add(new THREE.CircleGeometry(0.33, 20, 0, Math.PI), WIN, 0, 0.55, 0.05, grp);
      add(new THREE.TorusGeometry(0.38, 0.05, 6, 12, Math.PI), TRIM, 0, 0.55, 0.05, grp);
      add(rbox(0.04, 1.2, 0.06, 0.01), TRIM, 0, -0.05, 0.08, grp);            // mullion
    }
  }

  // ── exhibition banners on the wing fronts: the paintings that were stolen ──
  const banners = [['art_cows_in_storm.jpg', 'COWS IN STORM'], ['art_IMG_5262.jpg', 'OPENING NIGHT']];
  banners.forEach(([fn, title], i) => {
    const s = i ? 1 : -1;
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 576;
    const c = cv.getContext('2d');
    const paint = (img) => {
      c.fillStyle = '#7a1f2b'; c.fillRect(0, 0, 256, 576);
      c.fillStyle = '#e3b44c'; c.fillRect(14, 14, 228, 4); c.fillRect(14, 558, 228, 4);
      c.fillStyle = '#fff4e0'; c.font = '600 22px Georgia, serif'; c.textAlign = 'center';
      c.fillText('THE DOWNTOWN MUSEUM', 128, 50);
      if (img) {
        const ar = img.width / img.height, bw = 208, bh = Math.min(300, bw / ar);
        c.fillStyle = '#e3b44c'; c.fillRect(128 - bw / 2 - 6, 80 - 6, bw + 12, bh + 12);
        c.drawImage(img, 128 - bw / 2, 80, bw, bh);
      } else { c.fillStyle = '#5a1620'; c.fillRect(24, 80, 208, 300); }
      c.fillStyle = '#fff4e0'; c.font = '700 30px Georgia, serif';
      c.fillText(title, 128, 440);
      c.font = 'italic 20px Georgia, serif'; c.fillStyle = '#f2d39a';
      c.fillText('45 acrylics · one night only', 128, 478);
      c.font = '600 18px Georgia, serif'; c.fillText('TONIGHT', 128, 530);
    };
    paint(null);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => { paint(img); tex.needsUpdate = true; };
    img.src = ART + fn;
    const bx = s * WING_X, bz = FRONT + 0.08;
    add(new THREE.PlaneGeometry(1.2, 2.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }),
      bx, Y0 + 1.5, bz);
    const rod = add(new THREE.CylinderGeometry(0.03, 0.03, 1.42, 10), BRONZE, bx, Y0 + 2.88, bz);
    rod.rotation.z = Math.PI / 2;
    for (const e of [-1, 1]) add(new THREE.SphereGeometry(0.05, 10, 8), GOLD, bx + e * 0.72, Y0 + 2.88, bz);
  });

  // ── the rotunda: drum, ribbed glass dome with ONE pane missing, lantern ──
  const DOME_Z = ZC + 0.4, DRUM_Y = ROOF_Y + 0.85, DOME_R = 1.85;
  {
    add(new THREE.CylinderGeometry(2.0, 2.05, 1.3, SEG), STONE, 0, DRUM_Y, DOME_Z);
    add(new THREE.TorusGeometry(2.04, 0.08, 6, 32), TRIM, 0, DRUM_Y + 0.66, DOME_Z).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(2.08, 0.07, 6, 32), TRIM, 0, DRUM_Y - 0.6, DOME_Z).rotation.x = Math.PI / 2;
    for (let k = 0; k < 16; k++) {           // drum windows + pilasters
      const a = k / 16 * Math.PI * 2;
      const w = add(rbox(0.3, 0.6, 0.08, 0.03), WIN, Math.sin(a) * 2.03, DRUM_Y + 0.05, DOME_Z + Math.cos(a) * 2.03);
      w.rotation.y = a;
      const p = add(rbox(0.1, 1.1, 0.1, 0.03), TRIM, Math.sin(a + 0.196) * 2.06, DRUM_Y, DOME_Z + Math.cos(a + 0.196) * 2.06);
      p.rotation.y = a;
    }
    const dy = DRUM_Y + 0.7;
    // glass in three bands; the middle band skips one pane facing the road
    const PH0 = Math.PI * 0.18, PHL = Math.PI / 6;    // the broken pane's longitude span
    const T1 = 0.55, T2 = 1.05;                        // its latitude band (from the pole)
    const ws = lite ? 24 : 40, hs = lite ? 5 : 8;
    add(new THREE.SphereGeometry(DOME_R, ws, hs, 0, Math.PI * 2, 0, T1), GLASS, 0, dy, DOME_Z);
    add(new THREE.SphereGeometry(DOME_R, ws, hs, PH0 + PHL, Math.PI * 2 - PHL, T1, T2 - T1), GLASS, 0, dy, DOME_Z);
    add(new THREE.SphereGeometry(DOME_R, ws, hs, 0, Math.PI * 2, T2, Math.PI / 2 - T2), GLASS, 0, dy, DOME_Z);
    // copper ribs: 12 meridians + two parallels
    const ribs = [];
    for (let k = 0; k < 12; k++) {
      const t = new THREE.TorusGeometry(DOME_R + 0.01, 0.045, 6, lite ? 10 : 18, Math.PI / 2);
      t.rotateY(-Math.PI / 2);              // quarter arc in the YZ plane, equator → pole
      t.rotateY(k / 12 * Math.PI * 2);
      ribs.push(t);
    }
    for (const th of [T1, T2]) {
      const t = new THREE.TorusGeometry(Math.sin(th) * DOME_R + 0.01, 0.04, 6, SEG);
      t.rotateX(Math.PI / 2); t.translate(0, Math.cos(th) * DOME_R, 0);
      ribs.push(t);
    }
    add(mergeGeometries(ribs.map(r => { r.deleteAttribute('uv'); return r; })), PATINA, 0, dy, DOME_Z);
    // lantern + finial
    const top = dy + DOME_R;
    add(new THREE.CylinderGeometry(0.34, 0.38, 0.5, 24), TRIM, 0, top + 0.2, DOME_Z);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 24), LAMP, 0, top + 0.3, DOME_Z);
    add(lathe([[0.001, 0], [0.42, 0], [0.4, 0.06], [0.22, 0.28], [0.08, 0.5], [0.001, 0.56]], 24), PATINA, 0, top + 0.45, DOME_Z);
    add(new THREE.SphereGeometry(0.11, 16, 12), GOLD, 0, top + 1.08, DOME_Z);
    // the thief's rope, hanging from the empty pane down onto the roof
    const holeA = PH0 + PHL / 2, holeT = (T1 + T2) / 2;
    const hx = Math.sin(holeT) * Math.sin(holeA) * DOME_R, hz = Math.sin(holeT) * Math.cos(holeA) * DOME_R;
    const hy = dy + Math.cos(holeT) * DOME_R;
    const rope = new THREE.CatmullRomCurve3([
      new THREE.Vector3(hx * 0.95, hy + 0.05, DOME_Z + hz * 0.95),
      new THREE.Vector3(hx * 1.35, hy - 0.4, DOME_Z + hz * 1.35),
      new THREE.Vector3(hx * 1.9, ROOF_Y + 0.75, DOME_Z + hz * 1.9),
      new THREE.Vector3(hx * 2.3, ROOF_Y + 0.25, DOME_Z + hz * 2.4),
    ]);
    add(new THREE.TubeGeometry(rope, 24, 0.035, 6), S(0xc9a46a, { roughness: 0.95 }));
    // glass shards glinting on the roof below the hole
    for (let k = 0; k < 5; k++) {
      const sh = add(new THREE.TetrahedronGeometry(0.09 + k * 0.015), GLASS, hx * 1.7 + (k - 2) * 0.18, ROOF_Y + 0.85 - k * 0.05, DOME_Z + hz * 1.7 + (k % 2) * 0.2);
      sh.rotation.set(k, k * 2, k * 0.5);
    }
  }

  // ── forecourt: a round paved plaza with a compass-rose mosaic ──
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    c.fillStyle = '#e9dcc3'; c.fillRect(0, 0, 512, 512);
    c.strokeStyle = 'rgba(120,96,70,0.28)'; c.lineWidth = 2;
    for (let r = 40; r < 256; r += 34) { c.beginPath(); c.arc(256, 256, r, 0, Math.PI * 2); c.stroke(); }
    for (let k = 0; k < 32; k++) {
      const a = k / 32 * Math.PI * 2;
      c.beginPath(); c.moveTo(256 + Math.cos(a) * 40, 256 + Math.sin(a) * 40); c.lineTo(256 + Math.cos(a) * 256, 256 + Math.sin(a) * 256); c.stroke();
    }
    c.fillStyle = '#b8894a';
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2, L = k % 2 ? 90 : 150;
      c.beginPath();
      c.moveTo(256 + Math.cos(a) * L, 256 + Math.sin(a) * L);
      c.lineTo(256 + Math.cos(a + 0.35) * 26, 256 + Math.sin(a + 0.35) * 26);
      c.lineTo(256, 256);
      c.lineTo(256 + Math.cos(a - 0.35) * 26, 256 + Math.sin(a - 0.35) * 26);
      c.closePath(); c.fill();
    }
    c.strokeStyle = '#b8894a'; c.lineWidth = 6; c.beginPath(); c.arc(256, 256, 176, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.arc(256, 256, 248, 0, Math.PI * 2); c.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    add(new THREE.CylinderGeometry(3.3, 3.4, 0.5, 64), [STONE_D, top, STONE_D], 0, PZ - 0.25, -0.3);
    add(new THREE.CylinderGeometry(3.4, 3.5, 2.6, 32, 1, true), STONE_D, 0, -1.4, -0.3);   // skirt below grade
    add(new THREE.TorusGeometry(3.32, 0.07, 6, 48), TRIM, 0, PZ, -0.3).rotation.x = Math.PI / 2;
  }

  // ── the crime scene: stanchions + police tape across the steps ──
  {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = '#ffd400'; c.fillRect(0, 0, 1024, 64);
    c.fillStyle = '#141414'; c.fillRect(0, 0, 1024, 6); c.fillRect(0, 58, 1024, 6);
    c.font = '900 34px Impact, "Arial Black", sans-serif'; c.textBaseline = 'middle';
    c.fillText('POLICE LINE — DO NOT CROSS — ', 8, 33);
    c.fillText('POLICE LINE — DO NOT CROSS — ', 520, 33);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    const tapeMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.5 });
    const postGeo = lathe([[0.001, 0], [0.18, 0], [0.18, 0.04], [0.06, 0.08], [0.045, 0.2], [0.045, 1.0], [0.07, 1.04], [0.07, 1.1], [0.001, 1.12]], 16);
    const xs = [-4.2, -1.5, 1.5, 4.2], z = -2.0, y0 = PZ;
    xs.forEach(x => add(postGeo, BRONZE, x, y0, z));
    for (let i = 0; i < xs.length - 1; i++) {
      const L = xs[i + 1] - xs[i];
      const geo = new THREE.PlaneGeometry(L, 0.11, 12, 1);
      const p = geo.attributes.position, uv = geo.attributes.uv;
      for (let k = 0; k < p.count; k++) {
        const u = p.getX(k) / L + 0.5;
        p.setY(k, p.getY(k) - Math.sin(u * Math.PI) * 0.12);      // sag
        p.setZ(k, Math.sin(u * Math.PI * 3) * 0.02);              // flutter
        uv.setX(k, u * L / 2.4);
      }
      geo.computeVertexNormals();
      add(geo, tapeMat, (xs[i] + xs[i + 1]) / 2, y0 + 1.02, z);
    }
  }

  // ── beacons (blink red/blue) + searchlights (sweep after dark) ──
  const beaconMats = [
    new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff1122, emissiveIntensity: 1, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0x3377ff, emissive: 0x1144ff, emissiveIntensity: 1, roughness: 0.3 }),
  ];
  const beaconGeo = new THREE.CapsuleGeometry(0.11, 0.12, 6, 14);
  [[-3.3, 1.4], [3.3, 1.4]].forEach(([x, z], i) => {
    add(lathe([[0.001, 0], [0.2, 0], [0.2, 0.05], [0.05, 0.1], [0.04, 0.9], [0.09, 0.95], [0.001, 0.97]], 16), DARK, x, PZ, z);
    add(beaconGeo, beaconMats[i], x, PZ + 1.08, z);
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff1c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const beams = [];
  for (const s of [-1, 1]) {
    const base = new THREE.Group(); base.position.set(s * 5.3, 0.05, -0.5); g.add(base);
    add(new THREE.CylinderGeometry(0.32, 0.38, 0.16, 24), DARK, 0, 0.08, 0, base);        // turntable
    for (const e of [-1, 1]) add(rbox(0.06, 0.62, 0.14, 0.025), DARK, e * 0.3, 0.45, 0, base);   // yoke
    const head = new THREE.Group(); head.position.y = 0.62; base.add(head);
    add(lathe([[0.001, -0.3], [0.2, -0.3], [0.24, -0.2], [0.26, 0.2], [0.29, 0.26], [0.28, 0.3], [0.001, 0.3]], 24), BRONZE, 0, 0, 0, head);
    add(new THREE.CircleGeometry(0.25, 24), LAMP, 0, 0.305, 0, head).rotation.x = -Math.PI / 2;
    const cone = new THREE.CylinderGeometry(1.6, 0.24, 18, 24, 1, true);
    cone.translate(0, 9.3, 0);
    const beam = add(cone, beamMat, 0, 0, 0, head);
    beam.userData.noCollide = true; beam.userData.noClick = true; beam.userData.gpSkip = true; beam.castShadow = false;
    beam.raycast = () => {};
    beams.push({ head, s });
  }

  // ── the empty frame on the forecourt easel: 45 of these inside, all empty ──
  {
    const ez = 0.6, ex = 2.2;
    const easel = new THREE.Group(); easel.position.set(ex, PZ, ez); easel.rotation.y = -0.45; g.add(easel);
    const WOOD = S(0x8a5a35, { roughness: 0.7 });
    for (const s of [-1, 1]) { const l = add(new THREE.CylinderGeometry(0.04, 0.05, 2.0, 10), WOOD, s * 0.42, 0.95, 0, easel); l.rotation.z = s * 0.14; }
    const back = add(new THREE.CylinderGeometry(0.035, 0.045, 2.0, 10), WOOD, 0, 0.9, -0.38, easel); back.rotation.x = -0.36;
    add(rbox(1.1, 0.06, 0.16, 0.02), WOOD, 0, 0.62, 0.04, easel);
    const fr = new THREE.Shape(); fr.moveTo(-0.62, -0.48); fr.lineTo(0.62, -0.48); fr.lineTo(0.62, 0.48); fr.lineTo(-0.62, 0.48); fr.closePath();
    const hole = new THREE.Path(); hole.moveTo(-0.48, -0.34); hole.lineTo(-0.48, 0.34); hole.lineTo(0.48, 0.34); hole.lineTo(0.48, -0.34); hole.closePath();
    fr.holes.push(hole);
    add(extrude(fr, 0.06, 0.04), GOLD, 0, 1.15, 0.06, easel);
    // backing board, bare — the canvas has been cut clean out
    add(new THREE.PlaneGeometry(0.98, 0.7), S(0x5a4632, { roughness: 1 }), 0, 1.15, 0.05, easel);
    add(rbox(0.36, 0.16, 0.02, 0.01), S(0xfff6e6), 0, 0.42, 0.14, easel);   // the little wall-card
  }

  // ── a smooth gilded sculpture on a plinth (the one thing they couldn't lift) ──
  const sculpture = (() => {
    const px = -2.3, pz = 0.6;
    add(lathe([[0.001, 0], [0.42, 0], [0.42, 0.06], [0.34, 0.12], [0.3, 0.9], [0.38, 0.96], [0.4, 1.02], [0.001, 1.02]], 32), STONE, px, PZ, pz);
    const k = add(new THREE.TorusKnotGeometry(0.34, 0.1, lite ? 64 : 100, lite ? 8 : 12, 2, 3), GOLD, px, PZ + 1.5, pz);
    return k;
  })();

  // ── lamps, topiary, planters ──
  const lampGeo = lathe([[0.001, 0], [0.16, 0], [0.16, 0.08], [0.08, 0.14], [0.06, 0.3], [0.045, 0.32], [0.04, 2.0], [0.07, 2.04], [0.07, 2.08], [0.001, 2.1]], 16);
  for (const [x, z] of [[-3.9, -1.0], [3.9, -1.0], [-6.2, -2.0], [6.2, -2.0]]) {
    add(lampGeo, DARK, x, 0.15, z);
    add(new THREE.SphereGeometry(0.2, 14, 10), LAMP, x, 2.42, z);
    add(new THREE.CylinderGeometry(0.1, 0.13, 0.08, 16), DARK, x, 2.24, z);
  }
  const potGeo = lathe([[0.001, 0], [0.3, 0], [0.36, 0.42], [0.4, 0.46], [0.001, 0.46]], 20);
  for (const s of [-1, 1]) {
    for (const z of [-2.8, -6.0, -9.0]) {
      const x = s * 7.15;
      add(potGeo, POT, x, -0.05, z);
      add(new THREE.SphereGeometry(0.42, 14, 10), HEDGE, x, 0.82, z);
    }
    // a clipped hedge along the front of each wing
    add(rbox(2.0, 0.5, 0.45, 0.14, 2), HEDGE, s * WING_X, Y0 + 0.25, FRONT + 0.4);
  }

  // ── the ladder: someone propped it to the east wing roof ──
  {
    const lad = new THREE.Group();
    lad.position.set(WING_X + WING_W / 2 + 0.55, Y0, -8.6);
    lad.rotation.z = 0.2;
    g.add(lad);
    const ALU = S(0xb8c0c8, { roughness: 0.35, metalness: 0.7 });
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.035, 0.035, 3.5, 8), ALU, 0, 1.75, s * 0.24, lad);
    for (let k = 0; k < 10; k++) {
      const r = add(new THREE.CylinderGeometry(0.022, 0.022, 0.48, 6), ALU, 0, 0.25 + k * 0.33, 0, lad);
      r.rotation.x = Math.PI / 2;
    }
  }

  // ── merge static parts per material: one draw per material, not ~400 ──
  const keep = new Set([sculpture]);
  g.traverse(o => { if (o.material === beamMat || beaconMats.includes(o.material)) keep.add(o); });
  for (const b of beams) b.head.traverse(o => keep.add(o));
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map();
  g.traverse(o => {
    if (!o.isMesh || keep.has(o) || Array.isArray(o.material) || o.material.map) return;
    if (o.material === GLASS) return;     // keep the transparent shell separate
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    if (!geo.index) {
      const n = geo.attributes.position.count, idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!buckets.has(o.material)) buckets.set(o.material, { geos: [], meshes: [] });
    const b = buckets.get(o.material); b.geos.push(geo); b.meshes.push(o);
  });
  for (const [mat, b] of buckets) {
    if (b.meshes.length < 2) continue;
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    for (const m of b.meshes) m.parent.remove(m);
    const mm = new THREE.Mesh(merged, mat);
    mm.userData._gpForce = true;          // large merged parts still get the boil hull
    g.add(mm);
  }
  // drop now-empty helper groups
  const empties = [];
  g.traverse(o => { if (o !== g && o.isGroup && o.children.length === 0) empties.push(o); });
  for (const e of empties) e.parent.remove(e);

  // ── per-frame life ──
  const tick = (t, dayK) => {
    const night = 1 - dayK;
    GLASS.emissiveIntensity = 0.35 * night;
    // beacons alternate, a quick double-flash each
    const ph = (t * 1.6) % 1;
    const flashA = (ph < 0.12 || (ph > 0.22 && ph < 0.34)) ? 1 : 0.08;
    const flashB = (ph > 0.5 && ph < 0.62) || (ph > 0.72 && ph < 0.84) ? 1 : 0.08;
    beaconMats[0].emissiveIntensity = 0.3 + 2.4 * flashA;
    beaconMats[1].emissiveIntensity = 0.3 + 2.4 * flashB;
    beamMat.opacity = 0.11 * THREE.MathUtils.smoothstep(night, 0.25, 0.8);
    for (const b of beams) {
      b.head.rotation.z = b.s * (0.32 + Math.sin(t * 0.45 + b.s) * 0.22);
      b.head.rotation.x = Math.sin(t * 0.33 + b.s * 2) * 0.28 - 0.08;
    }
  };

  return {
    group: g,
    sculpture,
    tick,
    npcLocal: new THREE.Vector3(0.9, PZ, -1.2),       // the director waits at the foot of the steps
    gemY: DRUM_Y + 0.7 + DOME_R + 1.9,
    gemZ: DOME_Z,
    footCenterZ: -7.0, footRadius: 7.6,
  };
}
