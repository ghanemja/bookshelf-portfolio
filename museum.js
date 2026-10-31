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

export function buildMuseum({ lite = false, glowMats = [], artBase = ART, openDoor = false } = {}) {
  const g = new THREE.Group();
  g.name = 'DowntownMuseum';
  const SEG = lite ? 24 : 48;
  let ladder = null;

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

  // ── the empty frames: real museum frames, each with a moulding PROFILE swept round the
  // rectangle (mitred corners: one strip per side, smooth across the profile, creased at the
  // mitre), carved ornament on top, and behind the sight edge the bare stretcher, the dust
  // board and ragged strips of the painted canvas the thief's knife left in the rebate.
  // The gold is a gradient by part: pale burnished highlights on what's raised, the main gilt,
  // a deep ochre in the cove, so it reads in the flat-painted main app (one colour per
  // material) as well as in the lit classic game.
  // style: 'baroque' (Louis XV gilt: rocaille shells, acanthus breaking past the edge, pearls,
  // egg-and-dart) · 'walnut' (dark carved walnut, leaf-and-dart, a gilt slip) ·
  // 'fluted' (Dutch: a wide fluted gilt band, ribbon-and-stick sight edge, corner rosettes)
  // Origin at its centre, face to +Z. w, h: outer size.
  const GOLD_HI = S(0xf8dc8c, { roughness: 0.22, metalness: 0.9 });      // burnished highlights
  const GOLD_LO = S(0xa9741f, { roughness: 0.5, metalness: 0.6 });       // the cove, in shadow
  const WALNUT = S(0x4a2a1a, { roughness: 0.5 }), WALNUT_HI = S(0x7a4a2c, { roughness: 0.45 });
  const RAWWOOD = S(0xc9a46e, { roughness: 0.85 }), DUSTBOARD = S(0x3f2e22, { roughness: 1 });
  // a repeatable little random (so every load tears the same rags)
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // the moulding: prof = [[inset, height], ...], a closed loop (front from the outer edge to
  // the sight edge, then down and back under); a repeated point creases there
  const sweep = (w, h, prof, mat, parent) => {
    const pos = [], idx = [];
    for (const [a, c] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      const base = pos.length / 3;
      for (const [d, z] of prof) {
        const hx = w / 2 - d, hy = h / 2 - d;
        pos.push(a[0] * hx, a[1] * hy, z, c[0] * hx, c[1] * hy, z);
      }
      for (let i = 0; i < prof.length - 1; i++) { const p = base + i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g2.setIndex(idx); g2.computeVertexNormals();
    return add(g2, mat, 0, 0, 0, parent);
  };
  // a smooth run of profile points through control points
  const profile = (ctrl, n = 18) => new THREE.SplineCurve(ctrl.map(([d, z]) => new THREE.Vector2(d, z))).getPoints(n).map(v => [v.x, v.y]);
  // close a front profile into a loop: down the inside, across the back, up the outside
  const closeLoop = (front, back = -0.03) => {
    const f0 = front[0], f1 = front[front.length - 1];
    return [[f0[0], back], f0, f0, ...front.slice(1, -1), f1, f1, [f1[0], back], [f1[0], back], [f0[0], back], [f0[0], back]];
  };
  // points spaced along the four sides at an inset, each with its side's direction
  const alongSides = (w, h, d, step, skip = () => false) => {
    const out = [], hx = w / 2 - d, hy = h / 2 - d;
    for (const [x0, y0, x1, y1] of [[-hx, -hy, hx, -hy], [hx, -hy, hx, hy], [hx, hy, -hx, hy], [-hx, hy, -hx, -hy]]) {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)), ang = Math.atan2(y1 - y0, x1 - x0);
      for (let k = 1; k < n; k++) { const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n; if (!skip(x, y)) out.push([x, y, ang, k]); }
    }
    return out;
  };
  // ornament parts
  const lobe = new THREE.SphereGeometry(1, 9, 6);
  const leafGeo = (() => {                       // an acanthus leaf: lobed edges, bevelled, curled and cupped
    const N = 16, half = (x) => 0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.08)), 0.7) * (0.72 + 0.28 * Math.abs(Math.cos(x * Math.PI * 3.5)));
    const s = new THREE.Shape(); s.moveTo(0, 0);
    for (let i = 1; i <= N; i++) { const x = i / N; s.lineTo(x, half(x)); }
    for (let i = N - 1; i >= 1; i--) { const x = i / N; s.lineTo(x, -half(x)); }
    s.closePath();
    const g2 = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 1, curveSegments: 4 });
    const p = g2.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, p.getZ(i) + 0.1 * Math.sin(Math.PI * x) + 0.4 * Math.pow(x, 4) - 0.6 * y * y); }
    return smooth(g2);
  })();
  const scrollGeo = new THREE.TorusGeometry(1, 0.22, 6, 14, Math.PI * 1.6);
  const leaf = (P, x, y, z, ang, len, mat, tilt = 0.25) => { const m = add(leafGeo, mat, x, y, z, P); m.scale.set(len, len, len * 0.6); m.rotation.set(0, -tilt, ang); return m; };
  const cscroll = (P, x, y, z, ang, r, mat, flip = false) => {
    const m = add(scrollGeo, mat, x, y, z, P); m.scale.setScalar(r); m.rotation.set(flip ? Math.PI : 0, 0, ang);
    add(lobe, mat, x + Math.cos(ang) * r, y + Math.sin(ang) * r * (flip ? -1 : 1), z, P).scale.setScalar(r * 0.32);   // the curl's knob
    return m;
  };
  // a rocaille shell: ribs fanning out from a boss
  const shell = (P, x, y, z, ang, R, ribs, matHi, matLo) => {
    for (let k = 0; k < ribs; k++) {
      const t = k / (ribs - 1) - 0.5, a = ang + t * 2.1, L = R * (0.75 + 0.25 * Math.cos(t * Math.PI));
      const r = add(lobe, k % 2 ? matLo : matHi, x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.5, z + (k % 2 ? -0.004 : 0.004), P);
      r.scale.set(L * 0.52, R * 0.13, R * 0.16); r.rotation.z = a;
    }
    add(lobe, matHi, x, y, z + R * 0.12, P).scale.set(R * 0.3, R * 0.3, R * 0.22);
  };
  // the cut-out canvas: bare stretcher, dust board, ragged painted strips left in the rebate
  const RAG = (() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = '#c9b996'; c.fillRect(0, 0, 256, 64);                                    // primed canvas, aged
    for (let i = 0; i < 70; i++) {                                                            // the painting's edge: oil dabs
      c.fillStyle = ['#2c4a5e', '#3f5f3c', '#55704a', '#2c4a5e', '#b08a3e', '#3a3348'][i % 6];
      c.beginPath(); c.ellipse(rnd() * 256, 14 + rnd() * 50, 10 + rnd() * 18, 4 + rnd() * 6, rnd() * 0.6 - 0.3, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#b9a884'; c.fillRect(0, 0, 256, 10);                                     // the unpainted tacking margin
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
    return S(0xffffff, { map: t, roughness: 0.95, side: THREE.DoubleSide });
  })();
  const emptied = (F, ow, oh, z0) => {
    const T = 0.045, bw = 0.05, hx = ow / 2 + 0.02, hy = oh / 2 + 0.02;                       // stretcher bars, tucked under the sight edge
    for (const [x, y, lw, lh] of [[0, -hy + bw / 2, ow + 0.04, bw], [0, hy - bw / 2, ow + 0.04, bw], [-hx + bw / 2, 0, bw, oh + 0.04], [hx - bw / 2, 0, bw, oh + 0.04]])
      add(rbox(lw, lh, T, 0.008, 1), RAWWOOD, x, y, z0 - T / 2, F);
    add(rbox(bw * 0.9, oh, T * 0.8, 0.008, 1), RAWWOOD, 0, 0, z0 - T * 0.6, F);             // the centre brace
    if (ow > 0.8) add(rbox(ow, bw * 0.9, T * 0.8, 0.008, 1), RAWWOOD, 0, 0, z0 - T * 0.65, F);
    add(new THREE.PlaneGeometry(ow + 0.04, oh + 0.04), DUSTBOARD, 0, 0, z0 - T - 0.004, F);  // the dust board behind
    // the rags: a strip along each inner edge, its inside edge torn, two flaps curling forward
    const ex = ow / 2, ey = oh / 2;
    for (const [x0, y0, x1, y1, nx, ny] of [[-ex, -ey, ex, -ey, 0, 1], [ex, -ey, ex, ey, -1, 0], [ex, ey, -ex, ey, 0, -1], [-ex, ey, -ex, -ey, 1, 0]]) {
      const L = Math.hypot(x1 - x0, y1 - y0), N = Math.max(8, Math.round(L / 0.03));
      const s = new THREE.Shape(); s.moveTo(x0 - nx * 0.02, y0 - ny * 0.02);
      for (let k = 0; k <= N; k++) {
        const t = k / N, dep = 0.014 + rnd() * 0.012 + (rnd() < 0.08 ? 0.02 : 0);
        s.lineTo(x0 + (x1 - x0) * t + nx * dep, y0 + (y1 - y0) * t + ny * dep);
      }
      s.lineTo(x1 - nx * 0.02, y1 - ny * 0.02); s.closePath();
      const sg = new THREE.ShapeGeometry(s), uv = sg.attributes.uv, p = sg.attributes.position;
      for (let i = 0; i < uv.count; i++) {                                                   // the painted edge runs along the strip
        const along = ((p.getX(i) - x0) * (x1 - x0) + (p.getY(i) - y0) * (y1 - y0)) / L;
        const across = (p.getX(i) - x0) * nx + (p.getY(i) - y0) * ny;
        uv.setXY(i, along * 3, 0.15 + across * 12);
      }
      add(sg, RAG, 0, 0, z0 + 0.003, F);
      for (const t of [0.3 + rnd() * 0.4]) {                                                   // a flap peeling forward
        const fl = new THREE.Shape(); fl.moveTo(-0.025, 0); fl.lineTo(0.025, 0); fl.lineTo(0.008, 0.045 + rnd() * 0.02); fl.lineTo(-0.01, 0.035); fl.closePath();
        const m = add(new THREE.ShapeGeometry(fl), RAG, x0 + (x1 - x0) * t + nx * 0.01, y0 + (y1 - y0) * t + ny * 0.01, z0 + 0.004, F);
        m.rotation.set(0, 0, Math.atan2(ny, nx) - Math.PI / 2); m.rotateX(-0.5 - rnd() * 0.4);
      }
    }
  };
  const ornateFrame = (w, h, parent, style = 'baroque') => {
    const F = new THREE.Group(); parent.add(F);
    const b = Math.min(w, h) * 0.18;                                   // the moulding's width
    const ow = w - 2 * b, oh = h - 2 * b;                              // the sight opening
    if (style === 'walnut') {
      // a bold reverse profile in walnut: outer roll, a deep scotia, a carved flat, then the gilt slip
      const front = profile([[0, 0.02], [0.012, 0.075], [0.035, 0.09], [b * 0.38, 0.05], [b * 0.62, 0.065], [b * 0.8, 0.07], [b * 0.84, 0.045]]);
      sweep(w, h, closeLoop(front), WALNUT, F);
      sweep(w, h, closeLoop(profile([[b * 0.84, 0.045], [b * 0.9, 0.065], [b * 0.97, 0.055], [b, 0.02]], 8), 0.0), GOLD, F);   // the gilt slip
      // leaf-and-dart carved round the outer roll
      for (const [x, y, ang, k] of alongSides(w, h, 0.03, 0.045)) {
        const m = add(lobe, WALNUT_HI, x, y, 0.086, F);                                       // a pointed leaf, then a dart
        if (k % 2) { m.scale.set(0.007, 0.02, 0.008); m.rotation.z = ang; } else m.scale.setScalar(0.006);
      }
      // carved acanthus in each corner, a gilt rosette at its heart
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const cx = sx * (w / 2 - b * 0.45), cy = sy * (h / 2 - b * 0.45), out = Math.atan2(sy, sx);
        for (const da of [-2.35, 2.35]) leaf(F, cx, cy, 0.07, out + da, b * 0.62, WALNUT_HI, 0.15);
        leaf(F, cx, cy, 0.075, out, b * 0.45, WALNUT_HI, 0.3);
        add(lobe, GOLD_HI, cx, cy, 0.09, F).scale.set(b * 0.13, b * 0.13, b * 0.09);
      }
      emptied(F, ow, oh, 0.01);
      return F;
    }
    if (style === 'fluted') {
      // a wide gilt band carved into flutes (the grooves ARE the profile, so they mitre at the corners)
      const pts = [[0, 0.03], [0.008, 0.068], [0.02, 0.075]], FL = 6, fw = (b * 0.8 - 0.02) / FL;
      for (let k = 0; k < FL; k++) for (let j = 1; j <= 6; j++) { const t = j / 6; pts.push([0.02 + k * fw + t * fw, 0.075 - 0.018 * Math.sin(Math.PI * t)]); }
      pts.push([b * 0.84, 0.07], [b * 0.86, 0.045]);
      sweep(w, h, closeLoop(pts), GOLD, F);
      sweep(w, h, closeLoop(profile([[b * 0.86, 0.045], [b * 0.92, 0.075], [b * 0.98, 0.06], [b, 0.02]], 8), 0.0), GOLD_HI, F);
      // ribbon-and-stick on the sight bead: a twist of short ribbons, then a stick
      for (const [x, y, ang, k] of alongSides(w, h, b * 0.92, 0.03)) {
        const m = add(lobe, k % 3 ? GOLD_HI : GOLD_LO, x, y, 0.078, F);
        if (k % 3) { m.scale.set(0.011, 0.006, 0.006); m.rotation.z = ang + (k % 3 === 1 ? 0.6 : -0.6); }
        else m.scale.set(0.004, 0.004, 0.006);
      }
      // the corners: a square block with a carved rosette
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const cx = sx * (w / 2 - b * 0.43), cy = sy * (h / 2 - b * 0.43);
        add(rbox(b * 0.86, b * 0.86, 0.03, 0.01, 1), GOLD, cx, cy, 0.075, F);
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; const p = add(lobe, k % 2 ? GOLD_LO : GOLD_HI, cx + Math.cos(a) * b * 0.2, cy + Math.sin(a) * b * 0.2, 0.095, F); p.scale.set(b * 0.16, b * 0.07, 0.012); p.rotation.z = a; }
        add(lobe, GOLD_HI, cx, cy, 0.1, F).scale.set(b * 0.12, b * 0.12, 0.02);
      }
      emptied(F, ow, oh, 0.01);
      return F;
    }
    // Louis XV gilt: outer bead, a swelling top ogee, a deep cove, a raised sight bead
    const front = profile([[0, 0.025], [0.01, 0.06], [0.025, 0.07], [b * 0.32, 0.105], [b * 0.5, 0.085], [b * 0.66, 0.05], [b * 0.8, 0.055], [b * 0.88, 0.075], [b * 0.95, 0.06], [b, 0.025]], 26);
    const iOg = front.findIndex(p => p[0] >= b * 0.5), iCove = front.findIndex(p => p[0] >= b * 0.8);
    sweep(w, h, closeLoop(front.slice(0, iOg + 1)), GOLD, F);                                  // bead + ogee
    sweep(w, h, closeLoop(front.slice(iOg, iCove + 1)), GOLD_LO, F);                           // the cove
    sweep(w, h, closeLoop(front.slice(iCove)), GOLD_HI, F);                                    // the sight bead
    const nearOrn = (x, y, r) => (Math.abs(Math.abs(x) - (w / 2 - b * 0.42)) < r && Math.abs(Math.abs(y) - (h / 2 - b * 0.42)) < r) || Math.abs(x) < r * 0.9 || Math.abs(y) < r * 0.9;
    // egg-and-dart along the top of the ogee
    for (const [x, y, ang, k] of alongSides(w, h, b * 0.32, 0.042, (x, y) => nearOrn(x, y, b * 0.75))) {
      const e = add(lobe, k % 2 ? GOLD_HI : GOLD_LO, x, y, 0.104, F);
      if (k % 2) e.scale.set(0.016, 0.011, 0.01); else e.scale.set(0.003, 0.012, 0.006);
      e.rotation.z = ang;
    }
    // pearls on the sight bead
    const pearl = new THREE.SphereGeometry(1, 6, 4);
    for (const [x, y] of alongSides(w, h, b * 0.88, 0.028)) add(pearl, GOLD_HI, x, y, 0.078, F).scale.setScalar(0.0085);
    // rocaille corners: a shell, acanthus sweeping along both sides and breaking past the outer
    // edge, two C-scrolls: the swirl that makes a frame read as Louis XV
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cx = sx * (w / 2 - b * 0.42), cy = sy * (h / 2 - b * 0.42), out = Math.atan2(sy, sx);
      shell(F, cx + Math.cos(out) * b * 0.06, cy + Math.sin(out) * b * 0.06, 0.11, out, b * 0.5, 7, GOLD_HI, GOLD);
      for (const s2 of [-1, 1]) {
        leaf(F, cx, cy, 0.1, out + s2 * 2.3, b * 0.8, GOLD, 0.18);
        leaf(F, cx + Math.cos(out + s2 * 2.3) * b * 0.5, cy + Math.sin(out + s2 * 2.3) * b * 0.5, 0.098, out + s2 * 2.55, b * 0.45, GOLD_HI, 0.25);
        cscroll(F, cx + Math.cos(out + s2 * 1.4) * b * 0.32, cy + Math.sin(out + s2 * 1.4) * b * 0.32, 0.11, out + s2 * 1.2, b * 0.13, GOLD_HI, s2 < 0);
      }
    }
    // a centre cartouche on each side: a smaller shell flanked by scrolls and leaves
    for (const [x, y, out] of [[0, -h / 2 + b * 0.42, -Math.PI / 2], [0, h / 2 - b * 0.42, Math.PI / 2], [w / 2 - b * 0.42, 0, 0], [-w / 2 + b * 0.42, 0, Math.PI]]) {
      shell(F, x, y, 0.11, out, b * 0.4, 5, GOLD_HI, GOLD);
      for (const s2 of [-1, 1]) {
        cscroll(F, x + Math.cos(out + s2 * 1.57) * b * 0.36, y + Math.sin(out + s2 * 1.57) * b * 0.36, 0.105, out + s2 * 0.4, b * 0.12, GOLD_HI, s2 < 0);
        leaf(F, x + Math.cos(out + s2 * 1.57) * b * 0.15, y + Math.sin(out + s2 * 1.57) * b * 0.15, 0.1, out + s2 * 1.7, b * 0.6, GOLD, 0.2);
      }
    }
    emptied(F, ow, oh, 0.012);
    return F;
  };

  // ── dimensions ──
  const Y0 = 0.66;              // top of the stylobate
  const PZ = 0.45;              // top of the forecourt paving
  const LADDER_Z = -7.5;        // the east-wing ladder (and the rope beside it): between the topiary pots at z -6 and -9
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
    if (openDoor && (i === 2 || i === 3)) continue;   // the main app keeps the doorway clear
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
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const txt = 'THE DOWNTOWN MUSEUM OF ART';
    // shrink to fit: with the wide tracking it used to run off both ends ("HE … AR")
    let fs = 78, ls = 26;
    for (; fs > 30; fs -= 2, ls = fs / 3) {
      c.font = `600 ${fs}px Georgia, "Times New Roman", serif`;
      try { c.letterSpacing = `${ls}px`; } catch { /* older canvas */ }
      if (c.measureText(txt).width + ls <= 1880) break;
    }
    // the tracking trails the last letter too: nudge right by half of it to centre
    const cx = 1024 + ls / 2;
    c.fillStyle = '#fff7e6'; c.fillText(txt, cx + 2, 66);       // carved: light lip below…
    c.fillStyle = '#6b5226'; c.fillText(txt, cx, 62);           // …dark cut above
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

  // the service door, round the back: a plain steel door for deliveries (the thieves'
  // way out — the tyre ruts in the verge behind it are a clue in the main app)
  if (openDoor) {
    const dz = BACK - 0.02, DY = 0.44;                                         // sill on the second step
    const STEEL = S(0x6f7d78, { roughness: 0.5, metalness: 0.35 });
    add(rbox(1.36, 2.28, 0.14, 0.04), TRIM, 0, DY + 1.14, dz);                  // surround
    add(rbox(1.08, 2.06, 0.1, 0.03), STEEL, 0, DY + 1.03, dz - 0.05);          // the door
    add(rbox(1.0, 0.3, 0.03, 0.01), STEEL, 0, DY + 0.22, dz - 0.11);           // kick plate
    add(rbox(0.78, 0.05, 0.05, 0.02), DARK, 0, DY + 1.0, dz - 0.15);           // push bar
    for (const s of [-1, 1]) add(rbox(0.05, 0.12, 0.08, 0.02), DARK, s * 0.36, DY + 1.0, dz - 0.12);
    add(rbox(0.46, 0.16, 0.02, 0.01), TRIM, 0, DY + 1.7, dz - 0.11);           // DELIVERIES plate
    add(rbox(1.6, 0.08, 0.6, 0.03), STONE_D, 0, DY + 2.42, dz - 0.3);          // a little canopy
    for (const s of [-1, 1]) add(rbox(0.05, 0.05, 0.56, 0.02), TRIM, s * 0.72, DY + 2.34, dz - 0.3);
    add(new THREE.SphereGeometry(0.09, 14, 10), LAMP, 0, DY + 2.3, dz - 0.5);  // the light over it
    // a loading ramp down to the verge (the van backed up to it — the ruts end at its foot):
    // a short landing at sill height, then a gentle slope, over the stylobate's back steps
    {
      const RL = 2.7, land = 0.35, rp = new THREE.Shape();
      rp.moveTo(0, -0.06); rp.lineTo(0, DY); rp.lineTo(land, DY); rp.lineTo(RL, 0.03); rp.lineTo(RL, -0.06); rp.closePath();
      const rg = new THREE.ExtrudeGeometry(rp, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
      rg.rotateY(Math.PI / 2); rg.translate(-0.75, 0, 0);                       // shape x runs out from the wall (-z)
      add(rg, STONE_D, 0, 0, dz - 0.07);
      for (const s of [-1, 1]) {                                                  // kerbs along its sides
        const kp = new THREE.Shape(); kp.moveTo(0, DY); kp.lineTo(land, DY + 0.08); kp.lineTo(RL, 0.1); kp.lineTo(RL, 0.0); kp.lineTo(land, DY - 0.02); kp.lineTo(0, DY - 0.02); kp.closePath();
        const kg = new THREE.ExtrudeGeometry(kp, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
        kg.rotateY(Math.PI / 2); kg.translate(s * 0.75 - 0.04, 0, 0);
        add(kg, TRIM, 0, 0, dz - 0.07);
      }
    }
  }

  // ── the two gallery wings: lower, flat-roofed, balustraded, arched windows ──
  const WING_W = 2.5, WING_H = 2.9, WING_X = CW / 2 + WING_W / 2 - 0.05;
  for (const s of [-1, 1]) {
    const wx = s * WING_X;
    add(rbox(WING_W, WING_H, DEPTH - 0.4, 0.08), STONE, wx, Y0 + WING_H / 2, ZC - 0.2);
    add(rbox(WING_W + 0.1, 0.38, DEPTH - 0.3, 0.05), STONE_D, wx, Y0 + 0.19, ZC - 0.2);
    add(rbox(WING_W + 0.3, 0.2, DEPTH - 0.1, 0.07), TRIM, wx, Y0 + WING_H + 0.1, ZC - 0.2);
    // balustrade round the wing's three open sides (front, outer side, back), on the parapet
    // ledge: a post (pedestal + cap) at every corner and both ends, and along the long side; the
    // handrail runs post to post, and the balusters stand evenly between, each on the ledge and
    // under the rail. (The rails used to overshoot the corner, stop short of the other run and
    // hang past the ledge's ends; the front run stood 0.25 out past the ledge, its balusters
    // in the air.)
    const balY = Y0 + WING_H + 0.2, RAIL_Y = balY + 0.42, PW = 0.2, PH = 0.5;
    const hx = (WING_W + 0.3) / 2, hz = (DEPTH - 0.1) / 2, lz = ZC - 0.2;   // the ledge slab
    const xo = wx + s * (hx - 0.13), xi = s * (CW / 2 + PW / 2), zf = lz + hz - 0.13, zb = lz - hz + 0.13;
    const balGeo = lathe([[0.001, 0], [0.07, 0], [0.05, 0.08], [0.09, 0.2], [0.05, 0.32], [0.06, 0.38], [0.001, 0.38]], 8);
    const postGeo = rbox(PW, PH - 0.05, PW, 0.03), capGeo = rbox(PW + 0.06, 0.06, PW + 0.06, 0.02);
    const post = (x, z) => { add(postGeo, TRIM, x, balY + (PH - 0.05) / 2, z); add(capGeo, TRIM, x, balY + PH - 0.03, z); };
    const run = (ax, az, bx, bz) => {                       // post a → post b (axis-aligned)
      const L = Math.hypot(bx - ax, bz - az), along = bx !== ax, len = L - PW + 0.04;
      add(along ? rbox(len, 0.08, 0.1, 0.03) : rbox(0.1, 0.08, len, 0.03), TRIM, (ax + bx) / 2, RAIL_Y, (az + bz) / 2);
      const n = Math.max(1, Math.round((L - PW) / 0.5));
      for (let k = 0; k < n; k++) { const t = (PW / 2 + (k + 0.5) * (L - PW) / n) / L; add(balGeo, TRIM, ax + (bx - ax) * t, balY, az + (bz - az) * t); }
    };
    const sideZ = [zf, zf + (zb - zf) / 3, zf + 2 * (zb - zf) / 3, zb];
    for (const [x, z] of [[xi, zf], [xi, zb], ...sideZ.map(z => [xo, z])]) post(x, z);
    run(xi, zf, xo, zf); run(xi, zb, xo, zb);
    for (let k = 0; k < 3; k++) run(xo, sideZ[k], xo, sideZ[k + 1]);
    // arched gallery windows down the outer wall. The surround is cut to the arch (a square
    // plate stuck out past the curve at both top corners): straight jambs, then a half-round
    // head that meets the arch trim's outer edge (radius 0.43 at the springline, y 0.55)
    const sideX = wx + s * (WING_W / 2 + 0.01);
    const SURR_B = 0.025, surround = new THREE.Shape();
    {
      const hw = 0.43 - SURR_B, yb = -0.75 + SURR_B;              // the bevel adds SURR_B all round
      surround.moveTo(-hw, yb); surround.lineTo(hw, yb); surround.lineTo(hw, 0.55);
      surround.absarc(0, 0.55, hw, 0, Math.PI, false); surround.lineTo(-hw, yb);
    }
    const surroundGeo = extrude(surround, 0.08 - 2 * SURR_B, SURR_B); surroundGeo.translate(0, 0, -(0.08 - 2 * SURR_B) / 2);
    const archGeo = new THREE.TorusGeometry(0.38, 0.05, 8, 24, Math.PI), jambGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8);
    for (let k = 0; k < 3; k++) {
      const z = BACK + 1.6 + k * 2.1;
      const grp = new THREE.Group(); grp.position.set(sideX, Y0 + 1.25, z); grp.rotation.y = s * Math.PI / 2; g.add(grp);
      add(surroundGeo, TRIM, 0, 0, 0, grp);
      add(new THREE.PlaneGeometry(0.66, 1.2), WIN, 0, -0.05, 0.05, grp);
      add(new THREE.CircleGeometry(0.33, 20, 0, Math.PI), WIN, 0, 0.55, 0.05, grp);
      // one frame all the way round: the arch trim carries on down both jambs to a sill,
      // a transom bar across the springline, and the mullion runs sill to transom
      add(archGeo, TRIM, 0, 0.55, 0.05, grp);
      for (const sx of [-1, 1]) add(jambGeo, TRIM, sx * 0.38, -0.05, 0.05, grp);
      add(rbox(0.9, 0.07, 0.12, 0.025), TRIM, 0, -0.67, 0.05, grp);             // sill
      add(rbox(0.7, 0.05, 0.07, 0.015), TRIM, 0, 0.55, 0.08, grp);              // transom
      add(rbox(0.04, 1.2, 0.06, 0.01), TRIM, 0, -0.05, 0.08, grp);            // mullion
    }
  }

  // ── exhibition banners on the wing fronts: the paintings that were stolen ──
  const banners = [['art_cows_in_storm.jpg', 'COWS IN STORM'], ['art_IMG_5262.jpg', 'OPENING NIGHT']];
  banners.forEach(([fn, title], i) => {
    const s = i ? 1 : -1;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 1152;
    const c = cv.getContext('2d');
    c.scale(2, 2);                                     // drawn in 256×576 units, at double resolution
    // every line of lettering fits inside the banner's margins (shrinks to fit, never runs off the edge)
    const fitText = (txt, y, weight, size, family = 'Georgia, serif', maxW = 216) => {
      let px = size; c.font = `${weight} ${px}px ${family}`;
      while (c.measureText(txt).width > maxW && px > 8) { px -= 1; c.font = `${weight} ${px}px ${family}`; }
      c.fillText(txt, 128, y);
    };
    const paint = (img) => {
      c.setTransform(2, 0, 0, 2, 0, 0); c.fillStyle = '#7a1f2b'; c.fillRect(0, 0, 256, 576);
      c.fillStyle = '#e3b44c'; c.fillRect(14, 14, 228, 4); c.fillRect(14, 558, 228, 4);
      c.fillStyle = '#fff4e0'; c.textAlign = 'center';
      fitText('THE DOWNTOWN MUSEUM', 50, '600', 22);
      // the painting in a painted gilt frame: gradient bands, a pearl bead, corner bosses
      const gilt = (x, y, w2, h2) => {
        const F = 18;
        const gr = c.createLinearGradient(x - F, y - F, x + w2 + F, y + h2 + F);
        gr.addColorStop(0, '#fff0b0'); gr.addColorStop(0.35, '#e3b44c'); gr.addColorStop(0.7, '#a8761f'); gr.addColorStop(1, '#f2d27a');
        c.fillStyle = gr; c.fillRect(x - F, y - F, w2 + 2 * F, h2 + 2 * F);
        c.strokeStyle = '#7a5418'; c.lineWidth = 3; c.strokeRect(x - F + 2, y - F + 2, w2 + 2 * F - 4, h2 + 2 * F - 4); c.strokeRect(x - 3, y - 3, w2 + 6, h2 + 6);
        c.fillStyle = '#fff4c8';
        for (let t = 0; t < 1; t += 0.035) for (const [px, py] of [[x - 9 + t * (w2 + 18), y - 9], [x - 9 + t * (w2 + 18), y + h2 + 9], [x - 9, y - 9 + t * (h2 + 18)], [x + w2 + 9, y - 9 + t * (h2 + 18)]]) { c.beginPath(); c.arc(px, py, 2.2, 0, Math.PI * 2); c.fill(); }
        for (const [px, py] of [[x - 9, y - 9], [x + w2 + 9, y - 9], [x - 9, y + h2 + 9], [x + w2 + 9, y + h2 + 9]]) {
          c.fillStyle = '#e3b44c'; c.beginPath(); c.arc(px, py, 11, 0, Math.PI * 2); c.fill(); c.stroke();
          c.fillStyle = '#fff0b0'; c.beginPath(); c.arc(px - 3, py - 3, 4, 0, Math.PI * 2); c.fill();
        }
      };
      if (img) {
        const ar = img.width / img.height, bw = 188, bh = Math.min(280, bw / ar);
        gilt(128 - bw / 2, 92, bw, bh);
        c.drawImage(img, 128 - bw / 2, 92, bw, bh);
      } else { gilt(34, 92, 188, 280); c.fillStyle = '#5a1620'; c.fillRect(34, 92, 188, 280); }
      c.fillStyle = '#fff4e0'; fitText(title, 440, '700', 30);
      c.fillStyle = '#f2d39a'; fitText('45 acrylics · one night only', 478, 'italic', 20);
      fitText('TONIGHT', 530, '600', 18);
    };
    paint(null);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => { paint(img); tex.needsUpdate = true; };
    img.src = artBase + fn;
    const bx = s * WING_X, bz = FRONT + 0.08;
    add(new THREE.PlaneGeometry(1.2, 2.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }),
      bx, Y0 + 1.5, bz);
    const rod = add(new THREE.CylinderGeometry(0.03, 0.03, 1.42, 10), BRONZE, bx, Y0 + 2.88, bz);
    rod.rotation.z = Math.PI / 2;
    for (const e of [-1, 1]) add(new THREE.SphereGeometry(0.05, 10, 8), GOLD, bx + e * 0.72, Y0 + 2.88, bz);
  });

  const shardKeep = [];
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
    // ── how they got in: the pane is smashed out, not cut — jagged teeth of glass
    // stand round the hole; a grappling hook is caught on the rib above it, and a
    // knotted rope runs down the dome, across the roof and over the east wing's
    // parapet to the top of the ladder; shards are scattered on the roofs below.
    const SHARD = new THREE.MeshStandardMaterial({ color: 0xd4eef8, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const onDome = (th, ph, r = DOME_R) => new THREE.Vector3(Math.sin(th) * Math.sin(ph) * r, dy + Math.cos(th) * r, DOME_Z + Math.sin(th) * Math.cos(ph) * r);
    {
      const tri = [], rnd = (k) => (Math.sin(k * 91.7 + 3.1) * 43758.5453) % 1;
      const edge = (n, f) => { for (let k = 0; k < n; k++) f(k / n, (k + 1) / n, Math.abs(rnd(k + n * 7))); };
      const crack = [];                                     // the jagged edge, traced in ink
      const tooth = (a, b, tip) => { tri.push(...a.toArray(), ...b.toArray(), ...tip.toArray()); crack.push([a, tip, b]); };
      const dT = T2 - T1, dP = PHL;
      edge(7, (u0, u1, r) => tooth(onDome(T1, PH0 + u0 * dP), onDome(T1, PH0 + u1 * dP), onDome(T1 + (0.12 + 0.5 * r) * dT, PH0 + (u0 + u1) / 2 * dP)));          // top edge
      edge(7, (u0, u1, r) => tooth(onDome(T2, PH0 + u0 * dP), onDome(T2, PH0 + u1 * dP), onDome(T2 - (0.12 + 0.45 * r) * dT, PH0 + (u0 + u1) / 2 * dP)));          // bottom
      edge(6, (u0, u1, r) => tooth(onDome(T1 + u0 * dT, PH0), onDome(T1 + u1 * dT, PH0), onDome(T1 + (u0 + u1) / 2 * dT, PH0 + (0.1 + 0.45 * r) * dP)));            // left
      edge(6, (u0, u1, r) => tooth(onDome(T1 + u0 * dT, PH0 + dP), onDome(T1 + u1 * dT, PH0 + dP), onDome(T1 + (u0 + u1) / 2 * dT, PH0 + dP - (0.1 + 0.4 * r) * dP)));
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3)); tg.computeVertexNormals();
      const teeth = add(tg, SHARD); teeth.userData.noInk = true; shardKeep.push(teeth);
      const INKM = S(0x2a2230, { roughness: 1 });
      const lines = crack.map(([a, t, b]) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, t, b], false, 'catmullrom', 0), 6, 0.012, 4));
      // hairline cracks running out into the neighbouring panes
      for (const [th, ph, dth, dph] of [[T1, PH0 - 0.02, -0.12, -0.1], [T2, PH0 + PHL + 0.02, 0.1, 0.09], [T1 + 0.2, PH0 + PHL + 0.02, -0.05, 0.14], [T2, PH0 + 0.1, 0.14, -0.04]]) {
        const P = [0, 0.4, 0.7, 1].map((k, i) => onDome(th + dth * k + (i % 2 ? 0.015 : 0), ph + dph * k, DOME_R + 0.012));
        lines.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P, false, 'catmullrom', 0), 12, 0.009, 4));
      }
      add(mergeGeometries(lines.map(l => { l.deleteAttribute('uv'); return l; })), INKM).userData.noInk = true;
      // shards: big ones on the main roof under the hole, more on the wing roof by the ladder
      const sg = new THREE.TetrahedronGeometry(1);
      const holeA = PH0 + PHL / 2, base = onDome(T2, holeA, DOME_R * 1.25);
      for (let k = 0; k < 9; k++) {
        const r = Math.abs(rnd(k + 40)), s2 = 0.09 + 0.12 * r;
        const sh = add(sg, SHARD, base.x + (r - 0.5) * 1.2 + k * 0.08, ROOF_Y + 1.0 - k * 0.04, base.z + (Math.abs(rnd(k + 60)) - 0.5) * 1.0);
        sh.scale.set(s2, s2 * 0.25, s2 * 0.7); sh.rotation.set(k * 0.7, k * 1.3, k * 0.4); shardKeep.push(sh);
      }
      for (let k = 0; k < 6; k++) {
        const r = Math.abs(rnd(k + 80)), s2 = 0.07 + 0.09 * r;
        const sh = add(sg, SHARD, WING_X + 0.4 + (r - 0.3) * 1.2, Y0 + WING_H + 0.24, -8.6 + (Math.abs(rnd(k + 90)) - 0.5) * 1.4);
        sh.scale.set(s2, s2 * 0.25, s2 * 0.7); sh.rotation.set(k, k * 2.1, 0.3); shardKeep.push(sh);
      }
    }
    // the grappling hook, caught over the rib at the BOTTOM edge of the hole (the
    // rope hangs from there, so it never runs across the open pane)
    const holeA = PH0 + PHL / 2;
    const hookAt = onDome(T2 + 0.02, holeA, DOME_R + 0.08);
    {
      const H = new THREE.Group(); H.position.copy(hookAt);
      H.lookAt(new THREE.Vector3(0, dy, DOME_Z)); H.rotateX(Math.PI / 2);
      g.add(H);
      const IRON = S(0x3a3440, { roughness: 0.5, metalness: 0.5 });
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), IRON, 0, 0.12, 0, H);
      for (let k = 0; k < 3; k++) {
        const t = add(new THREE.TorusGeometry(0.11, 0.022, 6, 12, Math.PI * 0.9), IRON, 0, -0.06, 0, H);
        t.rotation.set(0, k * Math.PI * 2 / 3, Math.PI * 0.55);
      }
      add(new THREE.TorusGeometry(0.05, 0.015, 6, 12), IRON, 0, 0.35, 0, H);
    }
    // the rope: over the dome, down the drum, across the roof slope, down to the
    // wing, over its parapet, hanging beside the top of the ladder
    {
      const roofAt = (x) => ROOF_Y + PED_H * Math.max(0, 1 - Math.abs(x) / (PED_W / 2)) + 0.06;
      const pts = [hookAt.clone()];
      for (let k = 1; k <= 4; k++) pts.push(onDome(T2 + 0.02 + (Math.PI / 2 - T2 - 0.02) * k / 4, holeA + 0.08 * k / 4, DOME_R + 0.06));
      const drumX = Math.sin(holeA + 0.08) * 2.12, drumZ = DOME_Z + Math.cos(holeA + 0.08) * 2.12;
      pts.push(new THREE.Vector3(drumX, DRUM_Y + 0.1, drumZ), new THREE.Vector3(drumX + 0.05, roofAt(drumX) + 0.05, drumZ));
      const zEnd = LADDER_Z;
      for (let k = 1; k <= 4; k++) { const x = drumX + (CW / 2 - drumX) * k / 4, z = drumZ + (zEnd - drumZ) * k / 4; pts.push(new THREE.Vector3(x, roofAt(x), z)); }
      // across the wing roof, over the balustrade's handrail (lying on it, just clear of the
      // ladder's +z rail), and down the outside past the ledge, beside the ladder
      const wingTop = Y0 + WING_H + 0.25, rail = WING_X + (WING_W + 0.3) / 2 - 0.13, railTop = Y0 + WING_H + 0.2 + 0.46, ledge = WING_X + (WING_W + 0.3) / 2;
      pts.push(new THREE.Vector3(CW / 2 + 0.25, wingTop + 0.25, zEnd), new THREE.Vector3(CW / 2 + 0.7, wingTop, zEnd),
        new THREE.Vector3(rail - 0.45, wingTop, zEnd + 0.4), new THREE.Vector3(rail - 0.04, railTop + 0.05, zEnd + 0.5),
        new THREE.Vector3(rail + 0.1, railTop - 0.02, zEnd + 0.5), new THREE.Vector3(ledge + 0.1, wingTop - 0.3, zEnd + 0.52),
        new THREE.Vector3(ledge + 0.12, wingTop - 1.2, zEnd + 0.55));   // hangs beside the ladder, clear of the ledge
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const ROPE = S(0xc9a46a, { roughness: 0.95 });
      add(new THREE.TubeGeometry(curve, 160, 0.05, 7), ROPE);
      const knot = new THREE.SphereGeometry(0.085, 10, 8);
      for (let k = 1; k < 9; k++) add(knot, ROPE, ...curve.getPointAt(k / 9).toArray());
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
    // they stand on the lawn just off the forecourt (which ends at r 3.3), not at paving height:
    // the foot sits at the lawn and the post stretches up so the light stays where it was
    const foot = 0.08, post = add(lathe([[0.001, 0], [0.2, 0], [0.2, 0.05], [0.05, 0.1], [0.04, 0.9], [0.09, 0.95], [0.001, 0.97]], 16), DARK, x, foot, z);
    post.scale.y = (PZ + 0.97 - foot) / 0.97;
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
    ornateFrame(1.3, 1.0, easel).position.set(0, 1.15, 0.06);       // (the stretcher, dust board and torn canvas come with it)
    // the little wall-card: stood on the ledge, leaning back on the frame's foot
    add(rbox(0.36, 0.16, 0.02, 0.01), S(0xfff6e6), 0.3, 0.73, 0.1, easel).rotation.x = -0.18;
    // two more of the stolen paintings' frames, carried out and leaned behind it — all empty
    for (const [x, z, ry, fw, fh, style] of [[3.05, 0.0, -0.75, 1.0, 0.78, 'walnut'], [2.7, -0.62, -0.45, 0.72, 0.95, 'fluted']]) {
      const lean = new THREE.Group(); lean.position.set(x, PZ, z); lean.rotation.set(0, ry, 0); g.add(lean);
      const f = ornateFrame(fw, fh, lean, style); f.position.set(0, fh / 2 + 0.02, 0); f.rotation.x = -0.2; f.position.z = -Math.sin(0.2) * fh / 2;
    }
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
    if (openDoor && x === 6.2) continue;                  // the main app's guard booth stands here (museum +x is the town's -x)
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
    // leaning like a real ladder: its rails rest ON the balustrade's handrail — touching its
    // outer top edge — and run on 0.35 past it, the lean (0.3, ~1 in 3.3) steep enough to
    // clear the ledge below, and the feet on the lawn out from the wall. (It stood off the
    // ledge before, touching nothing.)
    const LT = 0.3, RR = 0.035, footY = 0.08;
    const ex = WING_X + (WING_W + 0.3) / 2 - 0.13 + 0.05, ey = Y0 + WING_H + 0.2 + 0.46;   // the handrail's outer top edge
    const ax = ex + RR * Math.cos(LT), ay = ey + RR * Math.sin(LT);          // the rail's axis there, one radius out
    const reach = (ay - footY) / Math.cos(LT), LL = reach + 0.35;
    lad.position.set(ax + reach * Math.sin(LT), footY, LADDER_Z);
    lad.rotation.z = LT;
    g.add(lad);
    ladder = { foot: lad.position.clone(), rest: new THREE.Vector3(ax, ay, LADDER_Z), lean: LT };   // (museum-local: the story's clue sparkles on it)
    const ALU = S(0xb8c0c8, { roughness: 0.35, metalness: 0.7 });
    // (the rails run on 0.12 below the foot: the feet are sunk into the ground, never stood on top of it)
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.035, 0.035, LL + 0.12, 8), ALU, 0, (LL - 0.12) / 2, s * 0.24, lad);
    for (let k = 0; k < Math.floor((LL - 0.35) / 0.33); k++) {
      const r = add(new THREE.CylinderGeometry(0.022, 0.022, 0.48, 6), ALU, 0, 0.25 + k * 0.33, 0, lad);
      r.rotation.x = Math.PI / 2;
    }
  }

  // ── merge static parts per material: one draw per material, not ~400 ──
  const keep = new Set([sculpture, ...shardKeep]);
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
    ladder,
  };
}
