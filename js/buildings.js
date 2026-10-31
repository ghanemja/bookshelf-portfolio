// ─── TOWN ARCHITECTURE: Main Street, Maple Plaza, Central Station ───────────
// Buildings modelled to the museum's standard, not stacked boxes: shopfronts
// with pilasters, consoles, fascias and stallrisers; real window frames with
// glazing bars, sills and hoods; cornices on brackets; mansards with dormers;
// shaped gables; striped scalloped awnings; blade signs on iron brackets.
// Window displays and lettering are hand-painted (canvas), the way a sign
// writer would do them.
//
// Every builder returns a Group with its origin on the ground at the middle of
// the street front, +Z facing the street. `placeOnPlanet()` then sets it down
// and BENDS it to the planet's curvature, so a long platform or a parking lot
// lies on the ground end to end instead of floating off a radius-40 world.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { PAL, paint, ink, blobShadow } from './style.js';
import { settle, radiusAt, drawnGroundAt, pruneDeco } from './world.js';
import { windowWall, pick, rnd, tree, bush, bench as parkBench, lamp } from './props.js';

// ── geometry kit ─────────────────────────────────────────────────────────────
// bevel resolution follows size; a glazing bar or rail is too thin for a bevel to read
const rb = (w, h, d, r = 0.04, seg) => Math.min(w, h, d) <= 0.05 && seg == null ? new THREE.BoxGeometry(w, h, d)
  : new RoundedBoxGeometry(w, h, d, seg ?? (Math.min(w, h, d) > 0.6 ? 2 : 1), Math.max(1e-3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
function weld(geo, keepUV = false) {
  if (!keepUV) geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const w = mergeVertices(geo, 1e-4);
  w.computeVertexNormals();
  return w;
}
const lathe = (pts, seg = 20) => weld(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));
const extrude = (shape, depth, bevel = 0.015, curve = 16, keepUV = false) => weld(new THREE.ExtrudeGeometry(shape, {
  depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevel > 0.018 ? 2 : 1, curveSegments: curve }), keepUV);
const shape = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
// a profile drawn in (out, up) and run along X for `len` — cornices, consoles, mansards
function prism(prof, len, bevel = 0.01) {
  const g = extrude(shape(prof), len, bevel, 8);
  g.rotateY(-Math.PI / 2);                 // extrusion → −X, profile "out" → +Z
  g.translate(len / 2, 0, 0);
  return g;
}
// an opening: a rectangle with an optional semicircular head, in absolute coords
function opening(w, y0, ySpring, arch, path = new THREE.Shape()) {
  path.moveTo(-w / 2, y0); path.lineTo(w / 2, y0); path.lineTo(w / 2, ySpring);
  if (arch) path.absarc(0, ySpring, w / 2, 0, Math.PI, false);
  else path.lineTo(-w / 2, ySpring);
  path.lineTo(-w / 2, y0);
  return path;
}
// UVs from position, so a stripe or paving texture keeps its real-world size
function uvFrom(geo, ax = 'x', bx = 'y', s = 1) {
  const p = geo.attributes.position, uv = geo.attributes.uv || new THREE.BufferAttribute(new Float32Array(p.count * 2), 2);
  const get = { x: (i) => p.getX(i), y: (i) => p.getY(i), z: (i) => p.getZ(i) };
  for (let i = 0; i < p.count; i++) uv.setXY(i, get[ax](i) / s, get[bx](i) / s);
  geo.setAttribute('uv', uv);
  return geo;
}
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const css = (hex) => '#' + new THREE.Color(hex).getHexString();

// a builder bound to a group: put/box/flat place meshes in that group's frame
function kit(g = new THREE.Group()) {
  const put = (geo, mat, x = 0, y = 0, z = 0, rot = null) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    g.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, r = 0.035, rot) => put(rb(w, h, d, r), mat, x, y, z, rot);
  const flat = (w, h, mat, x, y, z, rot) => { const m = put(new THREE.PlaneGeometry(w, h), mat, x, y, z, rot); m.userData.noInk = true; return m; };
  const sub = (x = 0, y = 0, z = 0, ry = 0) => { const s = new THREE.Group(); s.position.set(x, y, z); s.rotation.y = ry; g.add(s); return kit(s); };
  // a footprint the walker can't pass through (a bench, a post box): an empty marker
  // that bake() collects into userData.foots as [x, z, r] in the placed group's frame
  const foot = (x, z, r) => { const o = new THREE.Object3D(); o.position.set(x, 0, z); o.userData.foot = r; g.add(o); return o; };
  return { g, put, box, flat, sub, foot };
}

// ── hand-painted textures (redrawn once the bundled fonts arrive) ───────────
const REDRAW = [];
function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const run = () => { c.clearRect(0, 0, w, h); c.lineJoin = c.lineCap = 'round'; draw(c, w, h, rng(w * 7 + h)); t.needsUpdate = true; };
  run(); REDRAW.push(run);
  return t;
}
if (typeof document !== 'undefined' && document.fonts?.load) {
  Promise.all(['700 40px "Caveat"', '600 40px "Caveat"', '400 40px "Patrick Hand"'].map(f => document.fonts.load(f)))
    .then(() => REDRAW.forEach(f => f())).catch(() => {});
}
function rng(seed) { let s = (Math.floor(seed) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const INK = '#2a2230';
const HAND = '"Patrick Hand", "Comic Sans MS", cursive', SCRIPT = '"Caveat", "Patrick Hand", cursive';
function fitText(c, text, font, size, maxW) {
  let s = size;
  do { c.font = font.replace('$', s); s -= 2; } while (c.measureText(text).width > maxW && s > 8);
}
// sign lettering: a painted board, a pinstripe border, and the name
function signTex(text, { bg = '#2a2230', fg = '#f6eedb', gold = false, font = '700 $px ' + SCRIPT, w = 512, h = 96, border = true } = {}) {
  return canvasTex(w, h, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    if (border) { c.strokeStyle = fg; c.globalAlpha = 0.55; c.lineWidth = 3; c.strokeRect(9, 9, w - 18, h - 18); c.globalAlpha = 1; }
    fitText(c, text, font, h * 0.7, w * 0.86);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (gold) {
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillText(text, w / 2 + 2, h / 2 + 4);
      const gr = c.createLinearGradient(0, h * 0.2, 0, h * 0.8);
      gr.addColorStop(0, '#fbe6a6'); gr.addColorStop(0.5, '#e4b84f'); gr.addColorStop(1, '#b8862e');
      c.fillStyle = gr;
    } else c.fillStyle = fg;
    c.fillText(text, w / 2, h / 2 + 2);
  });
}
const signMat = (text, o) => paint(0xffffff, { map: signTex(text, o), hatch: 0 });

// glass: a cool wash with a reflected sky band and two painted glints
function glassBase(c, w, h, tone = '#6f84a4') {
  const g = c.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, '#9fb3c9'); g.addColorStop(0.45, tone); g.addColorStop(1, '#55678a');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function glints(c, w, h) {
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(3, w * 0.025);
  c.beginPath(); c.moveTo(w * 0.12, h * 0.42); c.lineTo(w * 0.3, h * 0.08); c.stroke();
  c.lineWidth = Math.max(2, w * 0.012);
  c.beginPath(); c.moveTo(w * 0.22, h * 0.5); c.lineTo(w * 0.36, h * 0.24); c.stroke();
}
function blob(c, x, y, rx, ry, fill, stroke = INK, lw = 3) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}
function rect(c, x, y, w, h, fill, lw = 3) {
  c.fillStyle = fill; c.fillRect(x, y, w, h); c.strokeStyle = INK; c.lineWidth = lw; c.strokeRect(x, y, w, h);
}
function arcText(c, text, cx, cy, r, size, color = '#f2d27a') {
  c.save(); c.font = `700 ${size}px ${SCRIPT}`; c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
  const span = Math.min(Math.PI * 0.8, text.length * size * 0.5 / r), a0 = -Math.PI / 2 - span / 2;
  [...text].forEach((ch, i) => {
    const a = a0 + span * (i + 0.5) / text.length;
    c.save(); c.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.rotate(a + Math.PI / 2); c.fillText(ch, 0, 0); c.restore();
  });
  c.restore();
}
function lettering(c, text, x, y, size, color = '#f6eedb', font = SCRIPT) {
  c.font = `700 ${size}px ${font}`; c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y);
}

// what each shop puts in its window — painted inside the glass
const DISPLAY = {
  books(c, w, h, r) {
    c.fillStyle = '#3b3346'; c.fillRect(0, h * 0.3, w, h * 0.7);
    for (let s = 0; s < 3; s++) {
      const y = h * (0.42 + s * 0.2);
      c.fillStyle = '#8a6448'; c.fillRect(0, y + h * 0.15, w, 6);
      for (let x = 6; x < w - 10;) {
        const bw = 9 + r() * 12, bh = h * (0.1 + r() * 0.05);
        rect(c, x, y + h * 0.15 - bh, bw, bh, ['#e8604c', '#e4b84f', '#7fb3a8', '#b7a3c6', '#f1e4c8', '#93abc0'][Math.floor(r() * 6)], 2);
        x += bw + 1;
        if (s === 2 && x > w * 0.6 && x < w * 0.7) {             // the shop cat, asleep on the bottom shelf
          blob(c, x + 22, y + h * 0.15 - 12, 22, 12, '#e09a52'); blob(c, x + 42, y + h * 0.15 - 20, 10, 9, '#e09a52');
          x += 60;
        }
      }
    }
    arcText(c, 'BOOKS · MAPS · PRINTS', w / 2, h * 0.72, h * 0.62, h * 0.11);
  },
  bakery(c, w, h, r) {
    c.fillStyle = '#f3e3c8'; c.fillRect(0, h * 0.62, w, h * 0.38);
    rect(c, w * 0.12, h * 0.6, w * 0.76, 8, '#f1e4c8', 2);
    // a tiered cake on a stand
    rect(c, w * 0.18, h * 0.42, w * 0.18, h * 0.16, '#f6eedb'); rect(c, w * 0.21, h * 0.3, w * 0.12, h * 0.12, '#dc9e9a');
    blob(c, w * 0.27, h * 0.28, 6, 6, '#e8604c');
    // loaves, a plait, a pretzel
    blob(c, w * 0.5, h * 0.55, w * 0.08, h * 0.06, '#d39a5a'); blob(c, w * 0.66, h * 0.55, w * 0.07, h * 0.055, '#c4874a');
    c.strokeStyle = '#a8692e'; c.lineWidth = 7; c.beginPath(); c.ellipse(w * 0.82, h * 0.48, w * 0.05, h * 0.06, 0, 0, Math.PI * 2); c.stroke();
    lettering(c, 'fresh bread daily', w / 2, h * 0.15, h * 0.13, '#f2d27a');
  },
  cafe(c, w, h, r) {
    c.fillStyle = 'rgba(60,50,60,0.55)'; c.fillRect(0, h * 0.35, w, h * 0.65);
    // pendant lamps glowing inside
    for (const x of [0.25, 0.55, 0.82]) { c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(w * x, 0); c.lineTo(w * x, h * 0.3); c.stroke(); blob(c, w * x, h * 0.33, 12, 9, '#ffd98a'); }
    // a cake dome and a cup on the counter
    rect(c, 0, h * 0.72, w, 8, '#8a6448', 2);
    blob(c, w * 0.3, h * 0.66, w * 0.07, h * 0.07, 'rgba(230,240,250,0.7)');
    rect(c, w * 0.6, h * 0.62, w * 0.06, h * 0.09, '#f6eedb', 2); blob(c, w * 0.63, h * 0.715, w * 0.06, 4, '#f6eedb', INK, 2);
    arcText(c, 'COFFEE · TEA · CAKE', w / 2, h * 0.95, h * 0.72, h * 0.12);
  },
  flowers(c, w, h, r) {
    for (let k = 0; k < 4; k++) {
      const x = w * (0.15 + k * 0.23), y = h * (0.75 - (k % 2) * 0.08);
      for (let f = 0; f < 9; f++) blob(c, x + (r() - 0.5) * w * 0.15, y - h * 0.12 - r() * h * 0.2, 7 + r() * 5, 7 + r() * 5, ['#e8604c', '#e4b84f', '#dc9e9a', '#f6eedb', '#b7a3c6'][Math.floor(r() * 5)], INK, 2);
      rect(c, x - w * 0.06, y, w * 0.12, h * 0.16, '#93abc0');
    }
    lettering(c, 'fresh flowers', w / 2, h * 0.14, h * 0.13, '#fff4d6');
  },
  yarn(c, w, h, r) {
    for (let k = 0; k < 7; k++) {
      const x = w * (0.1 + (k % 4) * 0.26), y = h * (0.55 + Math.floor(k / 4) * 0.25), rr = h * 0.08;
      const col = ['#e8604c', '#e4b84f', '#7fb3a8', '#b7a3c6', '#dc9e9a', '#f6eedb', '#93abc0'][k];
      blob(c, x, y, rr, rr, col);
      c.strokeStyle = 'rgba(42,34,48,0.55)'; c.lineWidth = 2;
      for (let a = 0; a < 3; a++) { c.beginPath(); c.ellipse(x, y, rr * 0.9, rr * 0.35, a * 1.05, 0, Math.PI * 2); c.stroke(); }
    }
    c.strokeStyle = '#8a6448'; c.lineWidth = 5; c.beginPath(); c.moveTo(w * 0.62, h * 0.2); c.lineTo(w * 0.9, h * 0.5); c.moveTo(w * 0.9, h * 0.2); c.lineTo(w * 0.62, h * 0.5); c.stroke();
    lettering(c, 'wool & notions', w * 0.35, h * 0.16, h * 0.12, '#fff4d6');
  },
  grocer(c, w, h, r) {
    for (let k = 0; k < 3; k++) {
      const x = w * (0.05 + k * 0.32), y = h * 0.6;
      rect(c, x, y, w * 0.28, h * 0.25, '#c8a47c');
      for (let f = 0; f < 7; f++) blob(c, x + w * 0.04 + r() * w * 0.2, y - 2 + r() * 8, 10, 10, ['#e8604c', '#f0a040', '#86a868'][k], INK, 2);
    }
    lettering(c, 'fruit & veg', w / 2, h * 0.2, h * 0.14, '#fff4d6');
  },
  icecream(c, w, h, r) {
    c.fillStyle = 'rgba(255,240,245,0.35)'; c.fillRect(0, h * 0.55, w, h * 0.45);
    for (let k = 0; k < 4; k++) {
      const x = w * (0.16 + k * 0.23), y = h * 0.62;
      c.beginPath(); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.lineTo(x, y + h * 0.25); c.closePath(); c.fillStyle = '#e0b070'; c.fill(); c.strokeStyle = INK; c.lineWidth = 3; c.stroke();
      blob(c, x, y - 8, 17, 14, ['#f6c6d0', '#f6eedb', '#a8d8c0', '#8a6448'][k]);
    }
    lettering(c, 'ice cream', w / 2, h * 0.2, h * 0.15, '#fff4d6');
  },
  barber(c, w, h, r) {
    rect(c, w * 0.15, h * 0.2, w * 0.3, h * 0.38, '#cfe3ea');               // the mirror
    rect(c, w * 0.2, h * 0.6, w * 0.2, h * 0.08, '#e8604c'); rect(c, w * 0.27, h * 0.68, w * 0.06, h * 0.22, '#93abc0');
    lettering(c, 'haircuts', w * 0.7, h * 0.32, h * 0.15, '#fff4d6');
    lettering(c, 'shaves', w * 0.7, h * 0.52, h * 0.13, '#f2d27a');
  },
  toys(c, w, h, r) {
    // a rocket, a bear, a balloon
    c.beginPath(); c.moveTo(w * 0.2, h * 0.25); c.quadraticCurveTo(w * 0.28, h * 0.4, w * 0.26, h * 0.75); c.lineTo(w * 0.14, h * 0.75); c.quadraticCurveTo(w * 0.12, h * 0.4, w * 0.2, h * 0.25);
    c.fillStyle = '#f6eedb'; c.fill(); c.strokeStyle = INK; c.lineWidth = 3; c.stroke(); blob(c, w * 0.2, h * 0.45, 6, 6, '#93abc0');
    blob(c, w * 0.55, h * 0.62, w * 0.09, h * 0.13, '#c4874a'); blob(c, w * 0.55, h * 0.42, w * 0.07, h * 0.09, '#c4874a');
    blob(c, w * 0.5, h * 0.35, 7, 7, '#c4874a'); blob(c, w * 0.6, h * 0.35, 7, 7, '#c4874a');
    blob(c, w * 0.82, h * 0.3, w * 0.07, h * 0.1, '#e8604c'); c.beginPath(); c.moveTo(w * 0.82, h * 0.4); c.lineTo(w * 0.8, h * 0.8); c.stroke();
    lettering(c, 'toys & games', w / 2, h * 0.9, h * 0.11, '#fff4d6');
  },
  frames(c, w, h, r) {
    c.fillStyle = '#efe6d6'; c.fillRect(0, 0, w, h);                     // a gallery: white walls inside
    const fr = (x, y, fw, fh, inner) => { rect(c, x, y, fw, fh, '#d9a640', 3); c.fillStyle = inner; c.fillRect(x + 8, y + 8, fw - 16, fh - 16); c.strokeRect(x + 8, y + 8, fw - 16, fh - 16); };
    fr(w * 0.08, h * 0.2, w * 0.26, h * 0.42, '#efe6d6');                 // empty
    fr(w * 0.4, h * 0.14, w * 0.24, h * 0.3, '#9cc3c9');
    c.fillStyle = '#86a868'; c.fillRect(w * 0.4 + 8, h * 0.32, w * 0.24 - 16, h * 0.12 - 8);
    fr(w * 0.7, h * 0.24, w * 0.22, h * 0.36, '#efe6d6');                 // empty
    lettering(c, 'bespoke framing', w / 2, h * 0.82, h * 0.12, '#8a6448');
  },
  post(c, w, h, r) {
    for (let k = 0; k < 5; k++) rect(c, w * (0.08 + k * 0.17), h * (0.55 + (k % 2) * 0.08), w * 0.14, h * 0.1, '#f6eedb', 2);
    rect(c, w * 0.6, h * 0.25, w * 0.3, h * 0.22, '#c8a47c');
    lettering(c, 'stamps · parcels', w * 0.33, h * 0.3, h * 0.12, '#fff4d6');
  },
  cinema(c, w, h, r) {
    c.fillStyle = '#3b3346'; c.fillRect(0, 0, w, h);
    const poster = (x, title, bg) => {
      rect(c, x, h * 0.08, w * 0.4, h * 0.84, bg, 4);
      blob(c, x + w * 0.2, h * 0.42, w * 0.11, h * 0.16, '#f6eedb');
      lettering(c, title, x + w * 0.2, h * 0.78, h * 0.1, INK);
    };
    poster(w * 0.06, 'the heist', '#e4b84f'); poster(w * 0.54, 'moonlight', '#93abc0');
  },
  laundry(c, w, h, r) {
    c.fillStyle = 'rgba(240,244,250,0.4)'; c.fillRect(0, h * 0.3, w, h * 0.7);
    for (let k = 0; k < 4; k++) { const x = w * (0.13 + k * 0.25); rect(c, x - w * 0.1, h * 0.42, w * 0.2, h * 0.5, '#f6eedb'); blob(c, x, h * 0.66, w * 0.07, w * 0.07, '#93abc0'); }
    lettering(c, 'wash · dry · fold', w / 2, h * 0.17, h * 0.13, '#fff4d6');
  },
  pizza(c, w, h, r) {
    c.beginPath(); c.moveTo(w * 0.2, h * 0.3); c.lineTo(w * 0.5, h * 0.85); c.lineTo(w * 0.8, h * 0.3); c.quadraticCurveTo(w * 0.5, h * 0.15, w * 0.2, h * 0.3);
    c.fillStyle = '#f0c060'; c.fill(); c.strokeStyle = INK; c.lineWidth = 4; c.stroke();
    for (let k = 0; k < 5; k++) blob(c, w * (0.35 + r() * 0.3), h * (0.35 + r() * 0.25), 9, 9, '#d8573f', INK, 2);
    lettering(c, 'by the slice', w / 2, h * 0.92, h * 0.1, '#fff4d6');
  },
  donuts(c, w, h, r) {
    for (let k = 0; k < 6; k++) {
      const x = w * (0.15 + (k % 3) * 0.35), y = h * (0.4 + Math.floor(k / 3) * 0.3);
      blob(c, x, y, w * 0.11, h * 0.1, '#d39a5a'); blob(c, x, y - 3, w * 0.09, h * 0.075, ['#f6c6d0', '#8a6448', '#f6eedb'][k % 3], null);
      blob(c, x, y, w * 0.03, h * 0.03, '#55678a');
    }
    lettering(c, 'hot & fresh', w / 2, h * 0.12, h * 0.12, '#fff4d6');
  },
  video(c, w, h, r) {
    c.fillStyle = '#3b3346'; c.fillRect(0, 0, w, h);
    for (let s = 0; s < 3; s++) for (let x = 8; x < w - 20; x += 22) rect(c, x, h * (0.2 + s * 0.26), 18, h * 0.2, ['#e8604c', '#93abc0', '#e4b84f', '#b7a3c6'][Math.floor(r() * 4)], 2);
    lettering(c, 'new releases', w / 2, h * 0.1, h * 0.1, '#f2d27a');
  },
  plain(c, w, h) { c.fillStyle = 'rgba(60,50,60,0.4)'; c.fillRect(0, h * 0.4, w, h * 0.6); },
};
const _disp = {};
function displayMat(kind) {
  if (!_disp[kind]) _disp[kind] = paint(0xffffff, { hatch: 0, map: canvasTex(256, 192, (c, w, h, r) => {
    glassBase(c, w, h);
    (DISPLAY[kind] || DISPLAY.plain)(c, w, h, r);
    glints(c, w, h);
  }) });
  return _disp[kind];
}
// upper-floor glass: curtains tied back, sometimes a plant on the sill
const _up = {};
function upperGlass(v = 0) {
  if (!_up[v]) _up[v] = paint(0xffffff, { hatch: 0, map: canvasTex(96, 144, (c, w, h) => {
    glassBase(c, w, h, '#62769a');
    const cur = ['#f6eedb', '#dc9e9a', '#e4b84f', '#a8b994'][v % 4];
    for (const s of [0, 1]) {
      c.beginPath();
      const x0 = s ? w : 0, x1 = s ? w * 0.68 : w * 0.32;
      c.moveTo(x0, 0); c.lineTo(x1, 0); c.quadraticCurveTo(x1 + (s ? 10 : -10), h * 0.45, s ? w * 0.86 : w * 0.14, h * 0.62);
      c.lineTo(x0, h * 0.7); c.closePath(); c.fillStyle = cur; c.fill(); c.strokeStyle = INK; c.lineWidth = 3; c.stroke();
    }
    if (v % 3 === 1) { blob(c, w * 0.5, h * 0.82, 14, 12, '#86a868'); rect(c, w * 0.42, h * 0.86, w * 0.16, h * 0.14, '#d58b63', 2); }
    glints(c, w, h);
  }) });
  return _up[v];
}
const _str = {};
function stripeMat(a, b) {
  const k = a + ':' + b;
  if (!_str[k]) {
    const t = canvasTex(64, 8, (c) => { c.fillStyle = css(a); c.fillRect(0, 0, 32, 8); c.fillStyle = css(b); c.fillRect(32, 0, 32, 8); }, true);
    _str[k] = paint(0xffffff, { map: t });
  }
  return _str[k];
}
let _pave;
function paveMat() {
  if (!_pave) _pave = paint(0xffffff, { hatch: 0.6, map: canvasTex(128, 128, (c, w, h, r) => {
    c.fillStyle = '#e9dfc8'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,100,90,0.35)'; c.lineWidth = 2;
    for (let k = 0; k <= 4; k++) { c.beginPath(); c.moveTo(0, k * 32 + (r() - 0.5) * 2); c.lineTo(w, k * 32 + (r() - 0.5) * 2); c.stroke(); }
    for (let row = 0; row < 4; row++) for (let k = 0; k < 3; k++) { const x = k * 48 + (row % 2) * 24; c.beginPath(); c.moveTo(x, row * 32); c.lineTo(x, row * 32 + 32); c.stroke(); }
  }, true) });
  return _pave;
}

// ── shared parts ────────────────────────────────────────────────────────────
const DARK = () => paint(PAL.ink, { hatch: 0 });
const GLOW = () => paint(0xfff1c8, { emissive: 0xffd98a, hatch: 0 });
const CORNICE = [[-0.04, 0], [0.03, 0], [0.04, 0.03], [0.07, 0.05], [0.11, 0.09], [0.15, 0.14], [0.19, 0.17], [0.2, 0.2], [0.2, 0.24], [-0.04, 0.24]];
const BAND = [[-0.03, 0], [0.04, 0], [0.06, 0.03], [0.06, 0.06], [0.04, 0.08], [-0.03, 0.08]];
const CONSOLE = [[0, 0], [0.02, 0], [0.05, 0.06], [0.06, 0.13], [0.1, 0.19], [0.11, 0.24], [0, 0.24]];
const BRACKET = [[0, 0], [0.03, 0.02], [0.06, 0.07], [0.11, 0.11], [0.16, 0.13], [0.16, 0.17], [0, 0.17]];

// a framed window on the facade plane (z = 0 of the kit): glass, a bevelled
// frame (round-headed if `arch`), glazing bars, a sill, a hood or keystone
function windowAt(K, { x = 0, y, w, h, arch = false, frame, glass, cols = 2, rows = 2, hood = 'lintel', box = null, z = 0, t = 0.055 }) {
  const spring = arch ? h - w / 2 : h;
  if (arch) {
    const geo = new THREE.ShapeGeometry(opening(w, 0, spring, true), 16);
    uvFrom(geo, 'x', 'y', 1);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + w / 2) / w, uv.getY(i) / h);
    K.put(geo, glass, x, y, z + 0.012).userData.noInk = true;
  } else K.flat(w, h, glass, x, y + h / 2, z + 0.012);
  const ring = opening(w + 2 * t, -t, arch ? spring : h + t, arch);
  ring.holes.push(opening(w, 0, spring, arch, new THREE.Path()));
  K.put(extrude(ring, 0.04, 0.012, 20), frame, x, y, z);
  const barH = arch ? h - 0.04 : h;
  for (let k = 1; k < cols; k++) K.box(0.03, barH, 0.03, frame, x - w / 2 + w * k / cols, y + barH / 2, z + 0.03, 0.01);
  for (let k = 1; k < rows; k++) K.box(w, 0.03, 0.03, frame, x, y + spring * k / rows, z + 0.03, 0.01);
  K.box(w + 0.2, 0.055, 0.14, frame, x, y - t - 0.025, z + 0.06, 0.02);
  if (hood === 'lintel') K.box(w + 0.24, 0.08, 0.09, frame, x, y + h + t + 0.045, z + 0.045, 0.025);
  else if (hood === 'key') K.box(0.11, 0.18, 0.08, frame, x, y + h + t * 0.4, z + 0.05, 0.02);
  else if (hood === 'cornice') K.put(prism(BAND, w + 0.26), frame, x, y + h + t, z);
  if (box) flowerBox(K, x, y - t - 0.12, z + 0.1, w + 0.1, box);
}
const _puff = new THREE.IcosahedronGeometry(1, 1);   // small and inked: facets never read
function flowerBox(K, x, y, z, w, col) {
  K.box(w, 0.13, 0.15, paint(col), x, y, z, 0.03);
  const n = Math.max(3, Math.round(w / 0.12));
  for (let k = 0; k < n; k++) {
    const fx = x - w / 2 + (k + 0.5) * w / n;
    K.put(_puff.clone().scale(0.07, 0.06, 0.07), paint(PAL.leaf), fx, y + 0.09, z);
    if (k % 2 === 0) K.put(_puff.clone().scale(0.04, 0.04, 0.04), paint([PAL.accent, PAL.rose, PAL.gold, 0xf6eedb][k % 4]), fx + 0.02, y + 0.15, z + 0.03);
  }
}
function planter(K, x, z, col = PAL.terracotta, s = 1) {
  K.foot(x, z, 0.19 * s);
  K.put(lathe([[0.001, 0], [0.13 * s, 0], [0.17 * s, 0.26 * s], [0.19 * s, 0.3 * s], [0.001, 0.3 * s]], 16), paint(col), x, 0.07, z);
  K.put(lathe([[0.001, 0], [0.01, 0], [0.012, 0.32 * s], [0.001, 0.33 * s]], 6), paint(PAL.bark), x, 0.33 * s, z);
  K.put(_puff.clone().scale(0.22 * s, 0.22 * s, 0.22 * s), paint(PAL.leaf), x, 0.37 * s + 0.22 * s, z);
}
function aBoard(K, x, z, text, col = PAL.ink) {
  const s = K.sub(x, 0.07, z, 0.25);
  s.foot(0, 0, 0.2);
  for (const sg of [-1, 1]) {
    s.box(0.38, 0.62, 0.035, paint(PAL.bark), 0, 0.3, sg * 0.1, 0.012, [-sg * 0.16, 0, 0]);
    s.flat(0.3, 0.46, signMat(text, { bg: css(col), fg: '#f6eedb', w: 128, h: 192, font: '700 $px ' + SCRIPT }), 0, 0.32, sg * 0.125, [-sg * 0.16, sg < 0 ? Math.PI : 0, 0]);
  }
}
function bench(K, x, z, ry = 0, col = PAL.bark, y = 0.07) {
  const s = K.sub(x, y, z, ry);
  for (const fx of [-0.3, 0, 0.3]) s.foot(fx, -0.02, 0.17);   // seat + back, end to end
  s.box(0.9, 0.06, 0.3, paint(col), 0, 0.36, 0, 0.02);
  s.box(0.9, 0.22, 0.05, paint(col), 0, 0.55, -0.13, 0.02, [-0.15, 0, 0]);
  for (const sx of [-0.38, 0.38]) s.box(0.05, 0.36, 0.28, DARK(), sx, 0.18, 0, 0.015);
}
function lampPost(K, x, z, h = 2.1) {
  K.foot(x, z, 0.1);
  K.put(lathe([[0.001, 0], [0.1, 0], [0.1, 0.08], [0.05, 0.18], [0.035, h - 0.1], [0.06, h - 0.04], [0.001, h]], 12), DARK(), x, 0.05, z);
  K.put(lathe([[0.001, 0], [0.08, 0.02], [0.13, 0.14], [0.1, 0.3], [0.03, 0.36], [0.001, 0.38]], 14), GLOW(), x, h + 0.02, z);
  K.put(lathe([[0.001, 0], [0.15, 0], [0.04, 0.1], [0.001, 0.16]], 14), DARK(), x, h + 0.36, z);
}

// a blade sign on a wrought-iron bracket, with a small sculpted emblem
function bladeSign(K, x, y, kind, side = 1) {
  const s = K.sub(x, y, 0, 0), dk = DARK();
  s.box(0.08, 0.2, 0.03, dk, 0, 0, 0.015, 0.01);
  s.box(0.03, 0.03, 0.56, dk, 0, 0.05, 0.28, 0.008);
  s.box(0.024, 0.024, 0.44, dk, 0, -0.1, 0.2, 0.008, [-0.62, 0, 0]);
  s.put(new THREE.TorusGeometry(0.055, 0.011, 6, 16, Math.PI * 1.4), dk, 0, -0.02, 0.4, [0, Math.PI / 2, 0]);
  for (const z of [0.18, 0.46]) s.box(0.012, 0.09, 0.012, dk, 0, 0.0, z, 0.004);
  emblem(s.sub(0, -0.26, 0.32, Math.PI / 2 * side), kind);
}
function emblem(K, kind) {
  const P = (c) => paint(c);
  if (kind === 'cup') {
    K.put(lathe([[0.001, 0], [0.09, 0], [0.12, 0.17], [0.11, 0.17], [0.08, 0.02], [0.001, 0.02]], 20), P(0xf6eedb), 0, -0.1, 0);
    K.put(new THREE.TorusGeometry(0.05, 0.016, 8, 16), P(0xf6eedb), 0.12, -0.02, 0);
    K.put(lathe([[0.001, 0], [0.17, 0], [0.17, 0.02], [0.001, 0.03]], 20), P(PAL.teal), 0, -0.12, 0);
    K.put(lathe([[0.001, 0], [0.1, 0], [0.09, 0.03], [0.001, 0.03]], 16), P(0x6b4a34), 0, 0.03, 0);
  } else if (kind === 'book') {
    for (const sg of [-1, 1]) K.box(0.2, 0.26, 0.03, P(sg < 0 ? PAL.accent : 0x3f5872), sg * 0.09, 0, 0, 0.012, [0, sg * 0.35, 0]);
    for (const sg of [-1, 1]) K.box(0.17, 0.23, 0.03, P(0xf6eedb), sg * 0.085, 0, 0.02, 0.01, [0, sg * 0.35, 0]);
  } else if (kind === 'croissant') {
    K.put(new THREE.TorusGeometry(0.12, 0.055, 10, 18, Math.PI * 1.2).scale(1, 0.8, 1), P(0xd39a5a), 0, -0.04, 0, [0, 0, Math.PI * 0.9]);
  } else if (kind === 'flower') {
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; K.put(_puff.clone().scale(0.07, 0.07, 0.03), P(PAL.rose), Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0); }
    K.put(_puff.clone().scale(0.05, 0.05, 0.04), P(PAL.gold), 0, 0, 0.02);
    K.box(0.02, 0.2, 0.02, P(PAL.leaf), 0, -0.18, 0, 0.008);
  } else if (kind === 'yarn') {
    K.put(new THREE.SphereGeometry(0.12, 10, 7), P(PAL.rose), 0, 0, 0);
    for (let k = 0; k < 3; k++) K.put(new THREE.TorusGeometry(0.12, 0.012, 6, 24), P(shade(PAL.rose, 0.8)), 0, 0, 0, [k * 0.9, k * 0.6, 0]);
    for (const sg of [-1, 1]) K.box(0.016, 0.34, 0.016, P(PAL.bark), sg * 0.04, 0.06, 0.1, 0.006, [0, 0, sg * 0.5]);
  } else if (kind === 'apple') {
    K.put(new THREE.SphereGeometry(0.13, 10, 7).scale(1, 0.9, 1), P(0xd8573f), 0, 0, 0);
    K.box(0.015, 0.08, 0.015, P(PAL.bark), 0, 0.13, 0, 0.005);
    K.put(_puff.clone().scale(0.06, 0.025, 0.035), P(PAL.leaf), 0.05, 0.14, 0, [0, 0, -0.4]);
  } else if (kind === 'cone') {
    K.put(lathe([[0.001, -0.22], [0.1, 0], [0.001, 0]], 16), P(0xe0b070), 0, 0, 0);
    K.put(new THREE.SphereGeometry(0.1, 10, 7), P(0xf6c6d0), 0, 0.06, 0);
    K.put(new THREE.SphereGeometry(0.085, 10, 7), P(0xa8d8c0), 0, 0.18, 0);
  } else if (kind === 'frame') {
    const sh = shape([[-0.15, -0.12], [0.15, -0.12], [0.15, 0.12], [-0.15, 0.12]]);
    sh.holes.push(new THREE.Path([[-0.09, -0.06], [0.09, -0.06], [0.09, 0.06], [-0.09, 0.06]].map(([a, b]) => new THREE.Vector2(a, b))));
    K.put(extrude(sh, 0.03, 0.012), P(PAL.gold), 0, 0, -0.015);
  } else if (kind === 'envelope') {
    K.box(0.3, 0.2, 0.03, P(0xf6eedb), 0, 0, 0, 0.012);
    K.put(extrude(shape([[-0.14, 0.09], [0.14, 0.09], [0, -0.02]]), 0.005, 0.005), P(0xe6d9bc), 0, 0, 0.016);
    K.put(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12), P(PAL.accent), 0, 0.0, 0.03, [Math.PI / 2, 0, 0]);
  } else if (kind === 'balloon') {
    K.put(new THREE.SphereGeometry(0.13, 10, 7).scale(1, 1.15, 1), P(PAL.accent), 0, 0.04, 0);
    K.box(0.09, 0.07, 0.09, P(PAL.bark), 0, -0.2, 0, 0.015);
    for (const sx of [-0.035, 0.035]) K.box(0.008, 0.12, 0.008, DARK(), sx, -0.12, 0, 0.003);
  } else if (kind === 'scissors') {
    for (const sg of [-1, 1]) {
      K.box(0.03, 0.26, 0.012, P(0xc9ccd6), 0, 0.03, 0, 0.006, [0, 0, sg * 0.32]);
      K.put(new THREE.TorusGeometry(0.04, 0.012, 6, 14), P(PAL.accent), sg * 0.06, -0.12, 0);
    }
  }
}

// ── a shop: two or three storeys, a full shopfront, an upper floor, a roof ──
const GF = 1.85, UF = 1.2, PAVE = 1.42;
export function shopUnit(o) {
  const K = kit();
  const w = o.w, d = o.d ?? 2.4, st = o.storeys ?? 2, H = GF + UF * (st - 1);
  const wall = paint(o.wall), trim = paint(o.trim ?? PAL.cream), front = paint(o.front);
  K.box(w, H, d, wall, 0, H / 2, -d / 2, 0.04);
  K.box(w + 0.03, 0.16, d + 0.02, paint(shade(o.wall, 0.78)), 0, 0.08, -d / 2, 0.03);
  if (st > 1) for (const s of [-1, 1]) K.box(0.11, H - GF, 0.05, trim, s * (w / 2 - 0.055), GF + (H - GF) / 2, 0.02, 0.015);
  shopfront(K, o, w, front, trim);
  // upper floors
  for (let s = 1; s < st; s++) {
    const y = GF + (s - 1) * UF + 0.3, top = s === st - 1;
    if (o.up === 'bay' && top) {
      bayWindow(K, 0, y, Math.min(1.0, w * 0.5), 0.78, wall, trim, o.glass ?? s);
      if (w > 1.9) for (const sx of [-1, 1]) windowAt(K, { x: sx * (w / 2 - 0.3), y: y + 0.05, w: 0.3, h: 0.62, frame: trim, glass: upperGlass(s + 1), cols: 1, rows: 2 });
      continue;
    }
    const n = o.upN ?? (w >= 2.1 ? 3 : 2), ww = o.up === 'arch' ? 0.4 : 0.42, hh = o.up === 'arch' ? 0.76 : 0.68;
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + (k + 0.5) * w / n;
      windowAt(K, { x, y, w: ww, h: hh, arch: o.up === 'arch', frame: trim, glass: upperGlass(k + s + (o.glass ?? 0)),
        cols: 2, rows: o.up === 'arch' ? 1 : 2, hood: o.up === 'arch' ? 'key' : (o.hood ?? 'lintel'), box: o.flowers && s === 1 ? o.flowers : null });
    }
  }
  // end-of-terrace walls get windows too
  for (const sd of o.ends || []) {
    const S = K.sub(sd * w / 2, 0, -d / 2, sd * Math.PI / 2);
    for (let s = 1; s < st; s++) windowAt(S, { x: 0, y: GF + (s - 1) * UF + 0.3, w: 0.4, h: 0.66, frame: trim, glass: upperGlass(s + 2), hood: o.hood ?? 'lintel' });
    windowAt(S, { x: -0.35 * sd, y: 0.55, w: 0.6, h: 0.8, frame: front, glass: displayMat(o.kind), cols: 2, rows: 1, hood: null });
  }
  roofTop(K, o, w, d, H, wall, trim);
  // the pavement in front, out to the kerb
  const pl = o.pave?.[0] ?? 0, pr = o.pave?.[1] ?? 0;
  const pv = uvFrom(rb(w + pl + pr + 0.02, 0.07, PAVE + 0.02, 0.02), 'x', 'z', 0.75);
  K.put(pv, paveMat(), (pr - pl) / 2, 0.035, PAVE / 2);
  if (o.extras) o.extras(K, w);
  return K.g;
}

function shopfront(K, o, w, front, trim) {
  const top = GF - 0.33, xL = -w / 2 + 0.15, xR = w / 2 - 0.15, doorW = 0.52;
  for (const s of [-1, 1]) {
    K.box(0.14, top + 0.02, 0.1, front, s * (w / 2 - 0.08), (top + 0.02) / 2, 0.05, 0.02);
    K.put(prism(CONSOLE, 0.15), front, s * (w / 2 - 0.08), top - 0.06, 0.02);
  }
  K.box(w - 0.04, 0.32, 0.1, front, 0, GF - 0.17, 0.06, 0.03);
  K.flat(w - 0.46, 0.23, signMat(o.name, o.sign ?? {}), 0, GF - 0.17, 0.112);
  K.put(prism(CORNICE.map(([a, b]) => [a * 0.6, b * 0.7]), w + 0.08), trim, 0, GF - 0.01, 0.06);
  // openings: a door to one side (or the middle), display windows elsewhere
  const ds = o.door ?? 1, segs = [];
  if (ds === 0) { const ww = (xR - xL - doorW) / 2; segs.push([xL, xL + ww, 'w'], [xL + ww, xR - ww, 'd'], [xR - ww, xR, 'w']); }
  else if (ds > 0) segs.push([xL, xR - doorW, 'w'], [xR - doorW, xR, 'd']);
  else segs.push([xL, xL + doorW, 'd'], [xL + doorW, xR, 'w']);
  const disp = displayMat(o.kind);
  for (const [x0, x1, t] of segs) {
    const cx = (x0 + x1) / 2, ww = x1 - x0;
    K.box(0.06, top - 0.3, 0.08, front, x0 + 0.03, (top + 0.3) / 2, 0.04, 0.015);
    K.box(0.06, top - 0.3, 0.08, front, x1 - 0.03, (top + 0.3) / 2, 0.04, 0.015);
    if (t === 'w') {
      K.box(ww, 0.38, 0.08, front, cx, 0.19, 0.04, 0.02);
      K.box(ww - 0.16, 0.2, 0.02, paint(shade(o.front, 1.18)), cx, 0.2, 0.085, 0.01);
      K.box(ww + 0.02, 0.05, 0.14, front, cx, 0.4, 0.06, 0.015);
      K.flat(ww - 0.06, top - 0.42, disp, cx, (top + 0.42) / 2, 0.02);
      K.box(ww, 0.05, 0.07, front, cx, top, 0.045, 0.015);
      K.box(ww, 0.04, 0.05, front, cx, top - 0.26, 0.04, 0.012);
      const n = Math.max(1, Math.round(ww / 0.55));
      for (let k = 1; k < n; k++) K.box(0.035, top - 0.68, 0.045, front, x0 + ww * k / n, (top - 0.26 + 0.42) / 2, 0.035, 0.01);
      for (let k = 1; k < n * 2; k++) K.box(0.025, 0.22, 0.04, front, x0 + ww * k / (n * 2), top - 0.13, 0.035, 0.008);
    } else {
      const dc = paint(o.doorCol ?? shade(o.front, 0.8));
      K.box(ww - 0.1, 1.1, 0.05, dc, cx, 0.62, 0.06, 0.015);
      K.box(ww - 0.26, 0.3, 0.02, paint(shade(o.doorCol ?? shade(o.front, 0.8), 1.2)), cx, 0.32, 0.09, 0.01);
      K.flat(ww - 0.26, 0.4, upperGlass(3), cx, 0.86, 0.088);
      K.put(new THREE.SphereGeometry(0.028, 10, 7), paint(PAL.gold), cx + (ds >= 0 ? -1 : 1) * (ww / 2 - 0.13), 0.6, 0.1);
      K.box(ww - 0.06, 0.045, 0.06, front, cx, 1.19, 0.06, 0.012);
      K.flat(ww - 0.12, top - 1.24, upperGlass(2), cx, (top + 1.22) / 2, 0.03);
      K.box(ww + 0.16, 0.07, 0.28, paint(PAL.kerb), cx, 0.1, 0.14, 0.02);
    }
  }
  if (o.awning) awning(K, w - 0.24, top - 0.02, o.awning);
  if (o.blade) bladeSign(K, (ds > 0 ? -1 : 1) * (w / 2 - 0.22), GF + 0.42, o.blade, ds > 0 ? -1 : 1);
}

// a striped retractable awning with a scalloped valance and iron arms
function awning(K, aw, hy, [a, b], L = 0.72, th = 0.34) {
  const mat = stripeMat(a, b), dk = DARK();
  const slab = uvFrom(rb(aw, 0.035, L, 0.012), 'x', 'y', 0.5);
  K.put(slab, mat, 0, hy - (L / 2) * Math.sin(th), 0.1 + (L / 2) * Math.cos(th), [th, 0, 0]);
  const n = Math.max(3, Math.round(aw / 0.2)), sw = aw / n;
  const sc = new THREE.Shape(); sc.moveTo(-aw / 2, 0); sc.lineTo(aw / 2, 0); sc.lineTo(aw / 2, -0.07);
  for (let k = 0; k < n; k++) sc.absarc(aw / 2 - sw * (k + 0.5), -0.07, sw / 2, 0, Math.PI, true);
  sc.lineTo(-aw / 2, 0);
  const val = uvFrom(extrude(sc, 0.015, 0.006, 6, true), 'x', 'y', 0.5);
  const yE = hy - L * Math.sin(th), zE = 0.1 + L * Math.cos(th);
  K.put(val, mat, 0, yE + 0.005, zE - 0.012);
  for (const s of [-1, 1]) {
    K.box(0.025, 0.025, 0.42 * 1.25, dk, s * (aw / 2 - 0.04), hy - 0.3, 0.32, 0.008, [-0.75, 0, 0]);
    K.box(0.03, aw > 0 ? 0.1 : 0.1, 0.03, dk, s * (aw / 2 - 0.04), hy - 0.48, 0.02, 0.01);
  }
}

function bayWindow(K, x, y, bw, bh, wall, trim, gv) {
  const dpt = 0.32, g = upperGlass(gv);
  K.box(bw + 0.08, 0.1, dpt + 0.1, trim, x, y - 0.06, dpt / 2, 0.03);
  K.box(bw * 0.6, 0.16, dpt * 0.7, trim, x, y - 0.17, dpt * 0.4, 0.04);
  K.box(bw * 0.3, 0.12, dpt * 0.45, trim, x, y - 0.3, dpt * 0.3, 0.04);
  K.box(bw + 0.12, 0.1, dpt + 0.14, trim, x, y + bh + 0.06, dpt / 2, 0.03);
  K.box(bw - 0.02, bh, dpt - 0.02, wall, x, y + bh / 2, dpt / 2 - 0.01, 0.02);
  K.flat(bw - 0.14, bh - 0.08, g, x, y + bh / 2, dpt + 0.001);
  for (const s of [-1, 1]) K.flat(dpt - 0.1, bh - 0.08, g, x + s * (bw / 2 + 0.001), y + bh / 2, dpt / 2, [0, s * Math.PI / 2, 0]);
  for (const s of [-1, 1]) K.box(0.05, bh, 0.05, trim, x + s * (bw / 2 - 0.025), y + bh / 2, dpt - 0.02, 0.012);
  for (const s of [-1, 1]) K.box(0.03, bh - 0.06, 0.03, trim, x + s * bw / 6, y + bh / 2, dpt + 0.01, 0.01);
  K.box(bw - 0.1, 0.03, 0.03, trim, x, y + bh * 0.62, dpt + 0.01, 0.01);
}

function roofTop(K, o, w, d, H, wall, trim) {
  const roofMat = paint(o.roofCol ?? PAL.roofSlate), deck = paint(0x9a93a0);
  const kind = o.roof ?? 'parapet';
  if (kind === 'parapet' || kind === 'deco') {
    K.put(prism(CORNICE, w + 0.08), trim, 0, H, 0);
    const nb = Math.max(3, Math.round(w / 0.42));
    for (let k = 0; k < nb; k++) K.put(prism(BRACKET, 0.07), trim, -w / 2 + 0.12 + k * (w - 0.24) / (nb - 1), H - 0.17, 0);
    K.box(w, 0.3, 0.13, wall, 0, H + 0.39, -0.06, 0.03);
    K.box(w + 0.05, 0.06, 0.18, trim, 0, H + 0.56, -0.06, 0.02);
    K.box(w - 0.04, 0.06, d - 0.2, deck, 0, H + 0.03, -d / 2 - 0.06, 0.02);
    if (kind === 'deco') {
      for (const [sx, hh] of [[0, 0.62], [-w * 0.3, 0.38], [w * 0.3, 0.38]]) {
        K.box(w * 0.22, hh, 0.14, wall, sx, H + 0.54 + hh / 2, -0.06, 0.03);
        K.box(w * 0.22 + 0.05, 0.05, 0.18, trim, sx, H + 0.56 + hh, -0.06, 0.02);
      }
    } else {
      const ped = new THREE.Shape(); ped.moveTo(-w * 0.2, 0); ped.lineTo(w * 0.2, 0); ped.quadraticCurveTo(w * 0.2, 0.26, 0, 0.27); ped.quadraticCurveTo(-w * 0.2, 0.26, -w * 0.2, 0);
      K.put(extrude(ped, 0.1, 0.015), wall, 0, H + 0.58, -0.11);
      K.put(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 18), trim, 0, H + 0.7, 0.0, [Math.PI / 2, 0, 0]);
    }
    chimney(K, w * 0.28, H, -d + 0.35);
  } else if (kind === 'mansard') {
    K.put(prism(CORNICE, w + 0.08), trim, 0, H, 0);
    const mh = 0.78, prof = [[0.02, 0], [-0.3, mh], [-(d - 0.55), mh], [-(d - 0.05), 0]];
    K.put(prism(prof, w + 0.02), roofMat, 0, H + 0.22, 0);
    K.box(w + 0.04, 0.06, d - 0.75, paint(shade(o.roofCol ?? PAL.roofSlate, 0.85)), 0, H + 0.22 + mh, -d / 2 + 0.1, 0.02);
    const nd = w > 1.9 ? 2 : 1;
    for (let k = 0; k < nd; k++) {
      const x = -w / 2 + (k + 0.5) * w / nd, y0 = H + 0.36;
      K.box(0.48, 0.52, 0.42, trim, x, y0 + 0.26, -0.16, 0.03);
      const D = K.sub(x, 0, 0.05);
      windowAt(D, { y: y0 + 0.08, w: 0.3, h: 0.36, frame: trim, glass: upperGlass(k + 1), cols: 2, rows: 1, hood: null, t: 0.04 });
      K.put(new THREE.CylinderGeometry(0.27, 0.27, 0.5, 18, 1, false, -Math.PI / 2, Math.PI), roofMat, x, y0 + 0.52, -0.16, [-Math.PI / 2, 0, 0]);
    }
    chimney(K, -w * 0.3, H + 0.8, -d + 0.45);
  } else if (kind === 'gable' || kind === 'dutch') {
    K.put(prism(BAND, w + 0.1), trim, 0, H, 0);
    const gh = kind === 'gable' ? w * 0.42 : w * 0.34;
    const tri = shape([[-w / 2, 0], [w / 2, 0], [0, gh]]);
    K.put(extrude(tri, d - 0.05, 0.012), wall, 0, H, -d + 0.05);
    const th = Math.atan2(gh, w / 2), L = (w / 2) / Math.cos(th) + 0.2;
    for (const s of [-1, 1]) {
      const cx = s * (w / 4 + Math.cos(th) * 0.08) + s * Math.sin(th) * 0.05, cy = H + gh / 2 - Math.sin(th) * 0.08 + Math.cos(th) * 0.05;
      K.box(L, 0.08, d + 0.18, roofMat, cx, cy, -d / 2, 0.03, [0, 0, -s * th]);
    }
    K.box(0.1, 0.1, d + 0.2, paint(shade(o.roofCol ?? PAL.roofSlate, 0.8)), 0, H + gh + 0.05, -d / 2, 0.03);
    if (kind === 'dutch') {
      const dutch = (W, G) => {
        const s = new THREE.Shape();
        s.moveTo(-W / 2, 0); s.lineTo(-W / 2, G * 0.18);
        s.quadraticCurveTo(-W * 0.48, G * 0.48, -W * 0.28, G * 0.52);
        s.quadraticCurveTo(-W * 0.18, G * 0.56, -W * 0.18, G * 0.74);
        s.absarc(0, G * 0.74, W * 0.18, Math.PI, 0, true);
        s.quadraticCurveTo(W * 0.18, G * 0.56, W * 0.28, G * 0.52);
        s.quadraticCurveTo(W * 0.48, G * 0.48, W / 2, G * 0.18);
        s.lineTo(W / 2, 0); s.lineTo(-W / 2, 0);
        return s;
      };
      const G = gh * 1.45;
      K.put(extrude(dutch(w + 0.1, G + 0.08), 0.1, 0.015, 20), trim, 0, H + 0.06, -0.14);
      K.put(extrude(dutch(w, G), 0.12, 0.015, 20), wall, 0, H + 0.06, -0.1);
      windowAt(K.sub(0, 0, 0.03), { y: H + 0.3, w: 0.32, h: 0.5, arch: true, frame: trim, glass: upperGlass(1), cols: 2, rows: 1, hood: 'key', t: 0.045 });
    } else {
      K.put(new THREE.TorusGeometry(0.16, 0.035, 8, 24), trim, 0, H + gh * 0.42, 0.03);
      K.put(new THREE.CircleGeometry(0.15, 20), upperGlass(2), 0, H + gh * 0.42, 0.012).userData.noInk = true;
      for (const s of [-1, 1]) K.box(0.045, 0.04, 0.04, trim, 0, H + gh * 0.42, 0.04, 0.01, [0, 0, s * Math.PI / 4]);
    }
  }
}
function chimney(K, x, y, z) {
  K.box(0.34, 0.62, 0.26, paint(0xb8664e), x, y + 0.31, z, 0.03);
  K.box(0.4, 0.07, 0.32, paint(PAL.kerb), x, y + 0.62, z, 0.02);
  for (const sx of [-0.08, 0.08]) K.put(lathe([[0.001, 0], [0.06, 0], [0.05, 0.12], [0.065, 0.16], [0.001, 0.16]], 12), paint(PAL.terracotta), x + sx, y + 0.65, z);
}

// ── Main Street's specials ──────────────────────────────────────────────────
// the public library: a little Carnegie temple on a podium, with a cupola
export function library(o) {
  const K = kit();
  const w = o.w, d = 3.0, stone = paint(0xf2e8d5), dstone = paint(0xd8cab0), trim = paint(0xfffaf0);
  const P = 0.42, BH = 2.3, bodyZ = -0.55;
  K.box(w, P, d, dstone, 0, P / 2, -d / 2, 0.04);
  for (let k = 0; k < 3; k++) { const dz = 0.68 - k * 0.22; K.box(2.1, P / 3 * (k + 1), dz, stone, 0, P / 6 * (k + 1), dz / 2 - 0.02, 0.03); }
  K.box(w - 0.2, BH, d - 0.65, stone, 0, P + BH / 2, bodyZ - (d - 0.65) / 2, 0.04);
  // the portico: four columns with bases and capitals
  const colH = 1.85;
  const col = lathe([[0.001, 0], [0.15, 0], [0.15, 0.06], [0.12, 0.1], [0.11, 0.18], [0.095, colH - 0.16], [0.11, colH - 0.1], [0.16, colH - 0.04], [0.16, colH], [0.001, colH]], 18);
  for (const x of [-0.93, -0.31, 0.31, 0.93]) K.put(col.clone(), trim, x, P, -0.2);
  const eY = P + colH;
  K.box(2.4, 0.3, 0.72, stone, 0, eY + 0.15, -0.28, 0.03);
  K.flat(1.9, 0.18, signMat('PUBLIC LIBRARY', { bg: '#f2e8d5', fg: '#5a4e5e', border: false, font: '400 $px ' + HAND }), 0, eY + 0.15, 0.081);
  K.put(prism(CORNICE.map(([a, b]) => [a * 0.6, b * 0.6]), 2.5), trim, 0, eY + 0.3, 0.06);
  const pg = shape([[-1.25, 0], [1.25, 0], [0, 0.58]]);
  K.put(extrude(pg, 0.6, 0.02), stone, 0, eY + 0.45, -0.62);
  const th = Math.atan2(0.58, 1.25), L = 1.25 / Math.cos(th) + 0.12;
  for (const s of [-1, 1]) K.box(L, 0.07, 0.72, trim, s * 0.62, eY + 0.45 + 0.29 + 0.03, -0.3, 0.02, [0, 0, -s * th]);
  emblem(K.sub(0, eY + 0.66, 0.0), 'book');
  // door and windows behind the columns
  const F = K.sub(0, P, bodyZ);
  // the entrance (it was a flat slab stuck on the lower half of an arched window): an arched
  // doorway — a dark reveal, a stone surround with a keystone, a fanlight in the arch, and
  // double panelled doors with brass knobs set back in it
  {
    const DW = 0.56, R = DW / 2, SP = 0.98, door = paint(0x3f5872), doorL = paint(0x4f6a8a), brass = paint(PAL.gold, { hatch: 0 });
    const arch = new THREE.Shape(); arch.moveTo(-R, 0); arch.lineTo(R, 0); arch.lineTo(R, SP); arch.absarc(0, SP, R, 0, Math.PI, false); arch.lineTo(-R, 0);
    F.put(extrude(arch, 0.03, 0.005), DARK(), 0, 0, 0.0);                                         // the dark reveal
    for (const sx of [-1, 1]) F.box(0.08, SP, 0.08, trim, sx * (R + 0.04), SP / 2, 0.045, 0.015);  // jambs
    F.put(new THREE.TorusGeometry(R + 0.04, 0.045, 8, 24, Math.PI), trim, 0, SP, 0.045);          // the arch
    F.box(0.1, 0.14, 0.1, trim, 0, SP + R + 0.05, 0.05, 0.02);                                    // keystone
    const fan = new THREE.Shape(); fan.moveTo(R - 0.02, 0); fan.absarc(0, 0, R - 0.02, 0, Math.PI, false); fan.lineTo(R - 0.02, 0);
    F.put(extrude(fan, 0.02, 0.005), upperGlass(3), 0, SP, 0.03);                                 // fanlight
    for (let k = 1; k < 4; k++) { const a = k / 4 * Math.PI; F.box(0.02, R - 0.04, 0.015, trim, Math.cos(a) * (R / 2 - 0.01), SP + Math.sin(a) * (R / 2 - 0.01), 0.055, 0.005, [0, 0, a - Math.PI / 2]); }
    F.box(DW, 0.045, 0.05, trim, 0, SP, 0.05, 0.01);                                              // transom
    for (const sx of [-1, 1]) {
      const cx = sx * DW / 4;
      F.box(DW / 2 - 0.015, SP - 0.03, 0.04, door, cx, (SP - 0.03) / 2, 0.035, 0.01);             // a leaf
      for (const y of [0.26, 0.68]) F.box(DW / 2 - 0.1, 0.3, 0.02, doorL, cx, y, 0.06, 0.008);    // its raised panels
      F.put(new THREE.SphereGeometry(0.022, 10, 7), brass, sx * 0.045, 0.5, 0.07);                // knob
    }
    F.box(DW, 0.06, 0.012, brass, 0, 0.04, 0.058, 0.004);                                        // kick plate
  }
  for (const s of [-1, 1]) windowAt(F, { x: s * 0.62, y: 0.35, w: 0.32, h: 1.0, arch: true, frame: trim, glass: upperGlass(s + 2), cols: 2, rows: 3, hood: 'key' });
  for (const sd of [-1, 1]) {
    const S = K.sub(sd * (w / 2 - 0.1), P, bodyZ - (d - 0.65) / 2, sd * Math.PI / 2);
    for (const x of [-0.6, 0.6]) windowAt(S, { x, y: 0.4, w: 0.38, h: 1.15, arch: true, frame: trim, glass: upperGlass(1), cols: 2, rows: 3, hood: 'key' });
  }
  const BK = K.sub(0, P, bodyZ - (d - 0.65), Math.PI);
  for (const x of [-1.0, 0, 1.0]) windowAt(BK, { x, y: 0.45, w: 0.4, h: 1.1, arch: true, frame: trim, glass: upperGlass(x + 2), cols: 2, rows: 3, hood: 'key' });
  // cornice, hipped roof, cupola
  const rY = P + BH, rz = bodyZ - (d - 0.65) / 2;
  const cor = K.sub(0, rY, bodyZ); cor.put(prism(CORNICE, w - 0.12), trim, 0, 0, 0);
  K.put(hipRoof(w - 0.06, d - 0.55, 0.7, 1), paint(PAL.roofSlate), 0, rY + 0.2, rz);
  const cy = rY + 0.75;
  K.put(lathe([[0.001, 0], [0.42, 0], [0.42, 0.06], [0.36, 0.08], [0.36, 0.5], [0.42, 0.54], [0.42, 0.6], [0.001, 0.6]], 24), trim, 0, cy, rz);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; K.box(0.05, 0.36, 0.05, stone, Math.cos(a) * 0.37, cy + 0.28, rz + Math.sin(a) * 0.37, 0.01); }
  K.put(lathe([[0.001, 0], [0.42, 0], [0.4, 0.14], [0.32, 0.3], [0.18, 0.42], [0.001, 0.46]], 24), paint(0x5fae9a), 0, cy + 0.6, rz);
  K.put(lathe([[0.001, 0], [0.04, 0], [0.02, 0.2], [0.06, 0.24], [0.001, 0.32]], 10), paint(PAL.gold), 0, cy + 1.04, rz);
  // lamp standards at the steps, a book-return box
  for (const s of [-1, 1]) lampPost(K, s * 1.25, 0.4, 1.5);
  K.box(0.32, 0.5, 0.26, paint(0x3f5872), 1.55, 0.32, 0.7, 0.05); K.foot(1.55, 0.7, 0.18);
  K.flat(0.2, 0.08, signMat('BOOK RETURN', { bg: '#3f5872', w: 256, h: 96, border: false, font: '400 $px ' + HAND }), 1.55, 0.45, 0.832);
  const pv = uvFrom(rb(w + (o.pave?.[0] ?? 0) + (o.pave?.[1] ?? 0) + 0.02, 0.07, PAVE + 0.02, 0.02), 'x', 'z', 0.75);
  K.put(pv, paveMat(), ((o.pave?.[1] ?? 0) - (o.pave?.[0] ?? 0)) / 2, 0.035, PAVE / 2);
  return K.g;
}

// the Bijou: an Art Deco cinema with a bulb-lit marquee and a tall blade sign
export function cinema(o) {
  const w = o.w;
  const g = shopUnit({ ...o, storeys: 3, roof: 'deco', door: 0, kind: 'cinema', up: 'arch', upN: 2, awning: null, blade: null });
  const K = kit(g);
  const H = GF + UF * 2, wall = paint(o.wall), acc = paint(o.front), glow = GLOW();
  for (const sx of [-(w / 2 - 0.17), w / 2 - 0.17]) K.box(0.14, H - GF + 0.5, 0.12, acc, sx, GF + (H - GF + 0.5) / 2, 0.06, 0.03);
  for (const y of [GF + 0.15, GF + 0.23]) K.box(w - 0.1, 0.03, 0.04, acc, 0, y, 0.03, 0.01);
  // marquee
  const my = GF - 0.05, mz = 0.48;
  K.box(w + 0.2, 0.42, 0.9, paint(0xd8573f), 0, my, mz, 0.05);
  K.box(w + 0.26, 0.06, 0.96, paint(PAL.gold), 0, my + 0.23, mz, 0.02);
  K.flat(w - 0.05, 0.28, signMat('NOW SHOWING ★ THE VANISHING GALLERY', { bg: '#f6eedb', fg: '#2a2230', font: '400 $px ' + HAND, w: 768, h: 96 }), 0, my, mz + 0.452);
  for (const s of [-1, 1]) K.flat(0.7, 0.28, signMat('BIJOU', { bg: '#f6eedb', fg: '#d8573f', w: 256, h: 96 }), s * (w / 2 + 0.102), my, mz, [0, s * Math.PI / 2, 0]);
  const bulbs = [];
  const nb = Math.round((w + 0.2) / 0.12);
  for (let k = 0; k <= nb; k++) bulbs.push([-((w + 0.2) / 2) + k * (w + 0.2) / nb, my - 0.22, mz + 0.45]);
  for (const s of [-1, 1]) for (let k = 0; k <= 7; k++) bulbs.push([s * ((w + 0.2) / 2), my - 0.22, mz - 0.45 + k * 0.9 / 7]);
  const bg = mergeGeometries(bulbs.map(([x, y, z]) => new THREE.SphereGeometry(0.032, 8, 6).translate(x, y, z)));
  const bm = K.put(bg, glow); bm.userData.noInk = true;
  // the tall blade: BIJOU down both faces, bulbs up the edge
  const by = GF + 1.35;
  K.box(0.12, 1.9, 0.56, paint(PAL.teal), 0, by, 0.4, 0.04);
  K.box(0.16, 0.08, 0.6, paint(PAL.gold), 0, by + 0.97, 0.4, 0.02);
  const vt = canvasTex(96, 384, (c, W, Hh) => {
    c.fillStyle = '#7fb3a8'; c.fillRect(0, 0, W, Hh);
    c.font = `700 70px ${SCRIPT}`; c.fillStyle = '#f6eedb'; c.textAlign = 'center'; c.textBaseline = 'middle';
    [...'BIJOU'].forEach((ch, i) => c.fillText(ch, W / 2, 42 + i * 75));
  });
  for (const s of [-1, 1]) K.flat(0.4, 1.7, paint(0xffffff, { map: vt, hatch: 0 }), s * 0.062, by, 0.42, [0, s * Math.PI / 2, 0]);
  const eb = [];
  for (let k = 0; k < 14; k++) eb.push(new THREE.SphereGeometry(0.03, 8, 6).translate(0, by - 0.9 + k * 1.8 / 13, 0.7));
  const em = K.put(mergeGeometries(eb), glow); em.userData.noInk = true;
  // poster cases either side of the doors
  for (const s of [-1, 1]) {
    K.box(0.36, 0.56, 0.05, paint(PAL.gold), s * (w / 2 - 0.42), 0.95, 0.12, 0.015);
    K.flat(0.3, 0.5, displayMat('cinema'), s * (w / 2 - 0.42), 0.95, 0.147);
  }
  return g;
}

// ── Main Street: the line-up, museum end (−x) → far end, in town-frame x ──
// `x` is each terrace's frontage; shops share walls. `ends` are the unit's
// exposed side walls in its OWN frame (+x is frame +x on the north row,
// frame −x on the south row, since the two rows face each other).
export const MAIN_STREET = {
  north: [
    { x: [-7.22, -1.58], shops: [
      { kind: 'books', name: 'Dog-Eared Books', w: 2.0, wall: 0x93abc0, front: 0x3f5872, trim: 0xf6eedb, roof: 'mansard', up: 'bay', blade: 'book', sign: { gold: true, bg: '#2f3f55' }, ends: [-1],
        extras: (K, w) => { trolley(K, -w * 0.22, 0.75); } },
      { kind: 'bakery', name: 'Rise & Shine Bakery', w: 1.75, wall: 0xf3d9a0, front: 0xdc9e9a, trim: 0xfffaf0, roof: 'gable', roofCol: PAL.roofRed, awning: [0xdc9e9a, 0xfffaf0], blade: 'croissant', door: -1, flowers: PAL.terracotta, sign: { bg: '#fff4e0', fg: '#b85a5a' },
        extras: (K, w) => { aBoard(K, w * 0.3, 0.55, 'warm loaves', 0x6b4a34); } },      // by the window: Pia stands out front of here
      { kind: 'cafe', name: 'Bean There Café', w: 1.9, wall: 0xf1e4c8, front: 0x4f8a7e, trim: 0xfffaf0, roof: 'dutch', awning: [0x4f8a7e, 0xf6eedb], blade: 'cup', door: -1, flowers: 0x4f8a7e, ends: [1], sign: { gold: true, bg: '#2f5a52' },
        extras: (K, w) => { aBoard(K, w * 0.38, 1.12, 'flat white 2.5', 0x2a2230); planter(K, -w / 2 + 0.2, 0.3, 0x4f8a7e, 0.85); } },
    ] },
    { x: [1.58, 7.22], shops: [
      { kind: 'cinema', name: 'THE BIJOU', w: 2.3, wall: 0xf1e4c8, front: 0x7fb3a8, trim: 0xfffaf0, special: 'cinema', ends: [-1], sign: { bg: '#2a2230', fg: '#f2d27a' } },
      { kind: 'flowers', name: 'Petal & Stem', w: 1.6, wall: 0xa8b994, front: 0x3e6b52, trim: 0xf6eedb, roof: 'parapet', awning: [0x3e6b52, 0xf6eedb], blade: 'flower', door: 1, upN: 2, flowers: PAL.bark, sign: { bg: '#f6eedb', fg: '#3e6b52' },
        extras: (K, w) => { flowerStand(K, -w * 0.12, 0.62); } },
      { kind: 'yarn', name: 'Stitch & Thread', w: 1.74, wall: 0xdc9e9a, front: 0x8f7ae8, trim: 0xfffaf0, roof: 'gable', roofCol: PAL.roofSlate, up: 'arch', blade: 'yarn', door: 1, ends: [1], sign: { bg: '#f6eedb', fg: '#6a55c4' },
        extras: (K, w) => { planter(K, w / 2 - 0.2, 0.3, 0x8f7ae8, 0.8); } },
    ] },
    { x: [10.38, 12.3], shops: [
      { kind: 'grocer', name: 'Green Grocer', w: 1.92, wall: 0xf1e4c8, front: 0x5f8f4c, trim: 0xfffaf0, roof: 'parapet', awning: [0x5f8f4c, 0xf6eedb], blade: 'apple', door: 1, ends: [-1, 1], sign: { bg: '#f6eedb', fg: '#3f6f3a' },
        extras: (K, w) => { produce(K, -w * 0.18, 0.6); } },
    ] },
  ],
  south: [
    { x: [-7.22, -1.58], shops: [
      { kind: 'library', name: 'Public Library', w: 3.5, special: 'library' },
      { kind: 'icecream', name: 'Two Scoops', w: 2.14, wall: 0xf6d6dc, front: 0x6fbfa8, trim: 0xfffaf0, roof: 'dutch', awning: [0xe58fa3, 0xfffaf0], blade: 'cone', door: 1, ends: [-1], flowers: 0x6fbfa8, sign: { bg: '#fff4f6', fg: '#d0607a' },
        extras: (K, w) => { bench(K, -w * 0.15, 0.95, 0, 0x6fbfa8); } },
    ] },
    { x: [1.58, 7.22], shops: [
      { kind: 'barber', name: "Sharp's Barbers", w: 1.6, wall: 0xc77b62, front: 0x2f3f55, trim: 0xf6eedb, roof: 'parapet', blade: 'scissors', door: 1, upN: 2, ends: [1], sign: { bg: '#2f3f55', fg: '#f6eedb' },
        extras: (K, w) => { barberPole(K, w / 2 - 0.16, 0.95); } },
      { kind: 'toys', name: "Tinker's Toys", w: 1.9, wall: 0xe1b95c, front: 0xd8573f, trim: 0xfffaf0, roof: 'mansard', roofCol: 0x6f7d92, awning: [0xd8573f, 0xf6eedb], blade: 'balloon', door: -1, sign: { bg: '#fff4e0', fg: '#d8573f' },
        extras: (K, w) => { balloons(K, w * 0.32, 0.95); } },
      { kind: 'frames', name: 'FRAME & CO.', w: 2.14, wall: 0xb7a3c6, front: 0x2a2230, trim: 0xf6eedb, roof: 'parapet', up: 'arch', blade: 'frame', door: 1, ends: [-1], sign: { gold: true, bg: '#2a2230', font: '400 $px ' + HAND },
        extras: (K, w) => { easel(K, -w * 0.25, 0.75); } },
    ] },
    { x: [10.38, 12.3], shops: [
      { kind: 'post', name: 'Post Office', w: 1.92, wall: 0xf1e4c8, front: 0xc23f36, trim: 0xfffaf0, roof: 'gable', roofCol: PAL.roofRed, up: 'sash', blade: 'envelope', door: 0, ends: [-1, 1], sign: { bg: '#c23f36', fg: '#f6eedb' },
        extras: (K, w) => { pillarBox(K, w / 2 - 0.25, 0.95); } },
    ] },
  ],
};
export function buildShop(spec) {
  if (spec.special === 'library') return library(spec);
  if (spec.special === 'cinema') return cinema(spec);
  return shopUnit(spec);
}

// ── pavement props ──────────────────────────────────────────────────────────
function trolley(K, x, z) {
  const s = K.sub(x, 0.07, z, 0.2);
  for (const fx of [-0.17, 0.17]) s.foot(fx, 0, 0.17);
  // the box rests on its axles; four wheels on the ground, each with a hub
  s.box(0.62, 0.32, 0.3, paint(PAL.bark), 0, 0.34, 0, 0.03);
  for (let k = 0; k < 7; k++) s.box(0.06, 0.16 + (k % 3) * 0.03, 0.2, paint([PAL.accent, PAL.gold, PAL.teal, PAL.lilac, 0xf6eedb][k % 5]), -0.25 + k * 0.083, 0.57, 0, 0.01, [0, 0, (k % 2) * 0.12]);
  for (const sx of [-0.22, 0.22]) {
    s.put(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 8).rotateX(Math.PI / 2), DARK(), sx, 0.1, 0);
    for (const sz of [-0.165, 0.165]) {
      s.put(new THREE.TorusGeometry(0.08, 0.02, 6, 14), DARK(), sx, 0.1, sz);
      s.put(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10).rotateX(Math.PI / 2), paint(PAL.gold), sx, 0.1, sz);
    }
  }
  s.box(0.03, 0.4, 0.03, DARK(), 0.33, 0.54, -0.12, 0.01, [0, 0, -0.3]);
}
function flowerStand(K, x, z) {
  const s = K.sub(x, 0.07, z, 0);
  for (const fx of [-0.3, 0, 0.3]) s.foot(fx, -0.1, 0.2);
  for (let t = 0; t < 2; t++) s.box(0.95, 0.06, 0.28, paint(PAL.bark), 0, 0.22 + t * 0.26, -t * 0.22, 0.015);
  for (const sx of [-0.43, 0.43]) s.box(0.04, 0.5, 0.5, paint(PAL.bark), sx, 0.25, -0.1, 0.01);
  for (let t = 0; t < 2; t++) for (let k = 0; k < 4; k++) {
    const bx = -0.33 + k * 0.22, by = 0.25 + t * 0.26, bz = -t * 0.22;
    s.put(lathe([[0.001, 0], [0.07, 0], [0.09, 0.16], [0.001, 0.16]], 12), paint(0xb0bcc8), bx, by, bz);
    s.put(_puff.clone().scale(0.1, 0.09, 0.1), paint(PAL.leaf), bx, by + 0.22, bz);
    s.put(_puff.clone().scale(0.06, 0.06, 0.06), paint([PAL.accent, PAL.rose, PAL.gold, 0xf6eedb, PAL.lilac][(k + t * 2) % 5]), bx + 0.03, by + 0.29, bz + 0.03);
  }
}
function produce(K, x, z) {
  const s = K.sub(x, 0.07, z, 0);
  for (const fx of [-0.4, 0, 0.4]) s.foot(fx, 0, 0.2);
  for (let k = 0; k < 3; k++) {
    s.box(0.36, 0.2, 0.3, paint(0xc8a47c), -0.4 + k * 0.4, 0.42, 0, 0.02, [0.3, 0, 0]);
    const col = [0xd8573f, 0xf0a040, PAL.leafLight][k];
    for (let f = 0; f < 6; f++) s.put(new THREE.SphereGeometry(0.055, 10, 7), paint(col), -0.48 + k * 0.4 + (f % 3) * 0.08, 0.55 + (f > 2 ? 0.02 : 0), -0.05 + (f > 2 ? 0.08 : 0));
  }
  for (const sx of [-0.6, 0.6]) s.box(0.04, 0.42, 0.3, paint(PAL.bark), sx, 0.21, 0, 0.01);
}
function barberPole(K, x, z) {
  const t = canvasTex(32, 128, (c, w, h) => {
    c.fillStyle = '#f6eedb'; c.fillRect(0, 0, w, h);
    for (let k = -2; k < 8; k++) { c.fillStyle = k % 2 ? '#d8573f' : '#3f5872'; c.beginPath(); c.moveTo(0, k * 24); c.lineTo(w, k * 24 + 16); c.lineTo(w, k * 24 + 28); c.lineTo(0, k * 24 + 12); c.fill(); }
  }, true);
  const pole = new THREE.CylinderGeometry(0.06, 0.06, 0.56, 16);
  K.put(pole, paint(0xffffff, { map: t, hatch: 0 }), x, 1.08, 0.16);
  for (const y of [0.78, 1.38]) K.put(new THREE.SphereGeometry(0.075, 10, 7), paint(PAL.gold), x, y, 0.16);
  K.box(0.04, 0.04, 0.14, DARK(), x, 1.08, 0.07, 0.01);
}
function balloons(K, x, z) {
  for (const [dx, dy, col] of [[-0.12, 1.55, PAL.accent], [0.1, 1.68, PAL.gold], [0.0, 1.42, PAL.teal]]) {
    K.put(new THREE.SphereGeometry(0.13, 10, 7).scale(1, 1.15, 1), paint(col), x + dx, dy, z);
    K.box(0.006, dy - 0.75, 0.006, DARK(), x + dx * 0.5, (dy + 0.75) / 2 - 0.08, z, 0.002, [0, 0, dx * 0.4]);
  }
  K.foot(x, z, 0.16);
  K.box(0.06, 0.72, 0.06, paint(PAL.bark), x, 0.43, z, 0.015);
  K.box(0.36, 0.06, 0.36, paint(PAL.bark), x, 0.1, z, 0.015);
}
function easel(K, x, z) {
  const s = K.sub(x, 0.07, z, -0.3);
  s.foot(0, -0.06, 0.18);
  for (const sx of [-0.15, 0.15]) s.box(0.035, 1.05, 0.035, paint(PAL.bark), sx, 0.52, 0, 0.01, [0, 0, -sx * 0.5]);
  s.box(0.035, 1.0, 0.035, paint(PAL.bark), 0, 0.5, -0.18, 0.01, [-0.3, 0, 0]);
  s.box(0.42, 0.04, 0.08, paint(PAL.bark), 0, 0.42, 0.02, 0.01);
  const fr = shape([[-0.2, 0], [0.2, 0], [0.2, 0.32], [-0.2, 0.32]]);
  fr.holes.push(new THREE.Path([[-0.15, 0.05], [0.15, 0.05], [0.15, 0.27], [-0.15, 0.27]].map(([a, b]) => new THREE.Vector2(a, b))));
  s.put(extrude(fr, 0.03, 0.01), paint(PAL.gold), 0, 0.45, 0.02, [-0.08, 0, 0]);
}
function pillarBox(K, x, z) {
  K.foot(x, z, 0.19);
  K.put(lathe([[0.001, 0], [0.19, 0], [0.19, 0.08], [0.15, 0.1], [0.15, 0.95], [0.18, 1.0], [0.18, 1.04], [0.14, 1.12], [0.06, 1.17], [0.001, 1.18]], 22), paint(0xc23f36), x, 0.07, z);
  K.box(0.18, 0.035, 0.04, DARK(), x, 0.92, z + 0.15, 0.01);
  K.flat(0.12, 0.08, signMat('POST', { bg: '#c23f36', w: 128, h: 64, border: false }), x, 0.78, z + 0.152);
}

// ── downtown behind Main Street: mid-rises and towers, dressed properly ────
// drawn window sheets (cheap) inside a modelled frame: rusticated shop base,
// quoins, a band at every floor, a bracketed cornice all round, a parapet,
// and on the towers a setback crown with a water tank or a spire
export function townBlock(o = {}) {
  const K = kit();
  const w = o.w ?? 2.6, d = o.d ?? 2.6, h = o.h ?? 6;
  const col = o.color ?? pick([PAL.cream, PAL.terracotta, PAL.dusty, PAL.sage, PAL.mustard, PAL.rose, PAL.lilac]);
  const trim = paint(PAL.kerb), wall = paint(col), dk = DARK();
  const bw = w * 0.94, bd = d * 0.94;
  const base = windowWall(w, 1.4, d, col, 'shop'); base.position.y = 0.7; K.g.add(base);
  const body = windowWall(bw, h - 1.4, bd, col, 'flat'); body.position.y = 1.4 + (h - 1.4) / 2; K.g.add(body);
  K.box(w + 0.06, 0.12, d + 0.06, paint(shade(col, 0.78)), 0, 0.06, 0, 0.03);
  K.box(w + 0.1, 0.14, d + 0.1, trim, 0, 1.42, 0, 0.05);
  for (let y = 1.4 + 1.7; y < h - 0.5; y += 1.7) K.box(bw + 0.05, 0.06, bd + 0.05, trim, 0, y, 0, 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(0.16, h - 1.5, 0.16, trim, sx * bw / 2, 1.45 + (h - 1.5) / 2, sz * bd / 2, 0.03);
  // the parapet, then the cornice and brackets on all four faces capping it: the cornice is
  // the roofline (it used to sit under a band of bare parapet, so the trim read as too low)
  for (let k = 0; k < 4; k++) {
    const along = k % 2 ? bd : bw, F = K.sub(Math.sin(k * Math.PI / 2) * bw / 2, h + 0.04, Math.cos(k * Math.PI / 2) * bd / 2, k * Math.PI / 2);
    F.put(prism(CORNICE, along + 0.4), trim, 0, 0, 0);
    const nb = Math.max(2, Math.round(along / 0.55));
    for (let b = 0; b < nb; b++) F.put(prism(BRACKET, 0.07), trim, -along / 2 + 0.2 + b * (along - 0.4) / (nb - 1), -0.17, 0);
  }
  K.box(bw, 0.26, bd, wall, 0, h + 0.13, 0, 0.03);
  K.box(bw - 0.02, 0.04, bd - 0.02, paint(shade(col, 0.82)), 0, h + 0.27, 0, 0.01);   // the flat roof, inside the cornice
  if (h > 4.5) {
    const cw = w * 0.56, cd = d * 0.56;
    K.box(cw, 0.85, cd, wall, 0, h + 0.68, 0, 0.06);
    K.put(prism(BAND, cw + 0.12), trim, 0, h + 1.08, cd / 2);
    K.box(cw + 0.14, 0.1, cd + 0.14, trim, 0, h + 1.16, 0, 0.03);
    if (rnd() > 0.45) {                                   // a timber water tank on iron legs
      const tx = w * 0.12, tz = -d * 0.08, ty = h + 1.2;
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) K.box(0.05, 0.5, 0.05, dk, tx + lx * 0.2, ty + 0.25, tz + lz * 0.2, 0.01);
      K.put(lathe([[0.001, 0], [0.32, 0], [0.33, 0.55], [0.001, 0.55]], 16), paint(0xa8764e), tx, ty + 0.5, tz);
      for (const y of [0.12, 0.42]) K.put(new THREE.TorusGeometry(0.33, 0.018, 4, 18), dk, tx, ty + 0.5 + y, tz, [Math.PI / 2, 0, 0]);
      K.put(lathe([[0.001, 0], [0.37, 0], [0.001, 0.32]], 16), paint(PAL.roofSlate), tx, ty + 1.05, tz);
    } else K.put(lathe([[0.001, 0], [0.24, 0], [0.24, 0.12], [0.2, 0.16], [0.2, 0.55], [0.04, 1.0], [0.001, 1.05]], 14), paint(PAL.roofSlate), 0, h + 1.2, 0);
  } else {
    K.box(0.4, 0.25, 0.3, paint(0xb8b2bd), w * 0.18, h + 0.38, -d * 0.12, 0.03);   // a rooftop vent
  }
  // street level: a proper doorway (it was a flat slab stuck on the shop window), a step and
  // a striped awning. A trim surround stands just proud of the wall; inside it a dark reveal
  // hides the drawn window behind, and the panelled door sits back in it, flush with the wall:
  // a glazed upper half, two raised panels below, a brass knob, a kick plate, a fanlight over
  // it. All of it sits on the base's front face (z = d/2)
  {
    const dx = w * 0.3, fz = d / 2, DW = 0.5, DH = 1.02, door = paint(shade(col, 0.62)), doorL = paint(shade(col, 0.74));
    const D = K.sub(dx, 0.12, fz);
    D.box(DW + 0.06, DH + 0.28, 0.03, dk, 0, (DH + 0.28) / 2, 0.005, 0.01);                // the dark reveal (the drawn window can't show round it)
    for (const s of [-1, 1]) D.box(0.07, DH + 0.24, 0.07, trim, s * (DW / 2 + 0.035), (DH + 0.24) / 2, 0.03, 0.015);   // jambs
    D.box(DW + 0.24, 0.08, 0.09, trim, 0, DH + 0.28, 0.035, 0.02);                          // lintel
    D.box(DW + 0.3, 0.035, 0.11, trim, 0, DH + 0.335, 0.04, 0.012);                         // its cap
    D.flat(DW - 0.04, 0.17, upperGlass(2), 0, DH + 0.13, 0.03);                             // fanlight
    D.box(DW + 0.02, 0.04, 0.05, trim, 0, DH + 0.025, 0.03, 0.01);                          // transom bar
    D.box(DW, DH, 0.04, door, 0, DH / 2, 0.025, 0.012);                                     // the door, set back in the frame
    D.flat(DW - 0.16, DH * 0.38, upperGlass(3), 0, DH * 0.7, 0.047);                        // its glazed upper half
    D.box(DW - 0.12, 0.035, 0.02, doorL, 0, DH * 0.49, 0.05, 0.008);                        // lock rail
    for (const s of [-1, 1]) D.box(DW / 2 - 0.1, DH * 0.3, 0.02, doorL, s * DW / 4.4, DH * 0.27, 0.05, 0.008);   // two raised panels
    D.box(DW - 0.06, 0.07, 0.015, paint(PAL.gold, { hatch: 0 }), 0, 0.05, 0.05, 0.005);   // kick plate
    D.put(new THREE.SphereGeometry(0.026, 10, 7), paint(PAL.gold), -DW / 2 + 0.08, DH * 0.5, 0.07);
    K.box(DW + 0.4, 0.12, 0.3, trim, dx, 0.06, fz + 0.13, 0.02);                           // the step
  }
  const S = K.sub(-w * 0.12, 0, d / 2);
  awning(S, w * 0.56, 1.32, [pick([PAL.accent, PAL.teal, PAL.mustard, PAL.rose, 0x3f5872]), 0xf6eedb], 0.5, 0.36);
  K.g.add(blobShadow(w * 0.8, d * 0.8));
  return K.g;
}

// ── Maple Plaza: a one-storey strip mall on its own parking lot ─────────────
const MALL_UNITS = [
  { name: 'Suds Laundry', kind: 'laundry', col: 0x93abc0, sign: '#3f5872', w: 2.2 },
  { name: 'Slice of Heaven', kind: 'pizza', col: 0xe8604c, sign: '#b84a36', w: 2.2 },
  { name: 'Holey Donuts', kind: 'donuts', col: 0xf6c6d0, sign: '#d0607a', w: 2.6, tall: true },
  { name: 'Rewind Video', kind: 'video', col: 0x8f7ae8, sign: '#5a48b0', w: 2.2 },
];
export function stripMall(o = {}) {
  const K = kit();
  const units = MALL_UNITS;
  const W = units.reduce((a, u) => a + u.w, 0), D = 3.0, H = 2.1;
  const wall = paint(0xf1e4c8), trim = paint(0xfffaf0), dk = DARK(), metal = paint(0x6f6a78);
  const tower = 0.8;
  // towers bookend the row
  for (const s of [-1, 1]) {
    const tx = s * (W / 2 + tower / 2);
    K.box(tower, H + 1.0, D + 0.2, paint(0xd58b63), tx, (H + 1.0) / 2, -D / 2, 0.05);
    K.put(hipRoof(D + 0.4, tower + 0.2, 0.6, 1), paint(PAL.roofRed), tx, H + 1.0, -D / 2, [0, Math.PI / 2, 0]);
    windowAt(K.sub(tx, 0, 0.1), { y: H + 0.15, w: 0.34, h: 0.55, arch: true, frame: trim, glass: upperGlass(2), cols: 1, rows: 1, hood: 'key' });
  }
  K.box(W, H, D, wall, 0, H / 2, -D / 2, 0.05);
  K.box(W + tower * 2, 0.16, D + 0.25, paint(0xd8cab0), 0, 0.08, -D / 2, 0.03);
  let x = -W / 2;
  for (const u of units) {
    const cx = x + u.w / 2;
    // parapet sign panel (the donut shop's rises into an arch)
    const ph = u.tall ? 0.95 : 0.6;
    if (u.tall) {
      const ar = new THREE.Shape(); ar.moveTo(-u.w / 2, 0); ar.lineTo(u.w / 2, 0); ar.lineTo(u.w / 2, ph * 0.55); ar.quadraticCurveTo(0, ph * 1.3, -u.w / 2, ph * 0.55); ar.lineTo(-u.w / 2, 0);
      K.put(extrude(ar, 0.16, 0.02), wall, cx, H, -0.12);
    } else K.box(u.w - 0.04, ph, 0.16, wall, cx, H + ph / 2, -0.06, 0.03);
    K.box(u.w + 0.02, 0.06, 0.2, trim, cx, H + (u.tall ? 0.02 : ph + 0.02), -0.06, 0.02);
    K.flat(u.w - 0.4, 0.34, signMat(u.name, { bg: u.sign, fg: '#fff8ea' }), cx, H + 0.3, u.tall ? 0.08 : 0.031);
    // storefront: full-height glazing in slim mullions, a door
    K.flat(u.w - 0.2, 1.45, displayMat(u.kind), cx, 0.95, 0.02);
    for (let k = 0; k <= 3; k++) K.box(0.05, 1.5, 0.06, metal, cx - (u.w - 0.2) / 2 + k * (u.w - 0.2) / 3, 0.95, 0.04, 0.012);
    K.box(u.w - 0.18, 0.05, 0.06, metal, cx, 1.68, 0.04, 0.012);
    K.box(u.w - 0.18, 0.18, 0.07, metal, cx, 0.17, 0.04, 0.012);
    K.box(0.5, 1.15, 0.04, paint(u.col), cx + u.w * 0.25, 0.75, 0.07, 0.012);
    K.box(0.04, 0.3, 0.04, metal, cx + u.w * 0.25 - 0.15, 0.8, 0.12, 0.01);
    x += u.w;
    if (x < W / 2 - 0.01) K.box(0.14, H, 0.12, trim, x, H / 2, 0.02, 0.02);
  }
  // giant donut on the roof of the donut shop
  const dx = -W / 2 + units[0].w + units[1].w + units[2].w / 2;
  K.put(new THREE.TorusGeometry(0.42, 0.2, 14, 28), paint(0xd39a5a), dx, H + 1.25, -0.2);
  K.put(new THREE.TorusGeometry(0.42, 0.205, 14, 28, Math.PI * 2).scale(1, 1, 0.55), paint(0xf6c6d0), dx, H + 1.25, -0.12);
  for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; K.box(0.05, 0.016, 0.016, paint([PAL.gold, PAL.teal, 0xf6eedb][k % 3]), dx + Math.cos(a) * 0.42, H + 1.25 + Math.sin(a) * 0.42, 0.0, 0.004, [0, 0, a + k]); }
  K.box(0.08, 0.5, 0.08, dk, dx, H + 0.62, -0.2, 0.02);
  // the covered walk: a flat canopy on slim columns
  const cz = 0.75;
  K.box(W + 0.1, 0.12, 1.5, paint(0xe8ddc6), 0, H - 0.18, cz, 0.04);
  K.box(W + 0.14, 0.18, 0.08, paint(0x7fb3a8), 0, H - 0.2, cz + 0.76, 0.03);
  for (let k = 0; k <= 4; k++) {
    const px = -W / 2 + 0.1 + k * (W - 0.2) / 4;
    K.put(lathe([[0.001, 0], [0.08, 0], [0.08, 0.06], [0.045, 0.1], [0.045, H - 0.32], [0.08, H - 0.28], [0.08, H - 0.24], [0.001, H - 0.24]], 12), trim, px, 0, cz + 0.6);
  }
  K.box(W + tower * 2, 0.08, 1.6, paint(0xe2d6bd), 0, 0.04, 0.75, 0.02);
  // parking lot: asphalt, painted bays, wheel stops, planted end islands, lamps — and its ends
  // finished like a real strip-mall corner. Each side road curves round the lot (o.kerbU(s, z):
  // where that road's kerb begins, |x| on side s at depth z, in this frame). Out from the road:
  // its kerb, a grass verge of one even width (VG), then a pavement that follows the kerb line
  // all the way — along the tower's end wall it runs out from the building line, along the lot
  // it runs beside the lot's own kerb. The lot is square to the building (its sides on the
  // building line, X0) and only bends in, parallel to the road, where the road closes in at its
  // front corners (it used to be a rectangle with cut corners: ragged wedges of grass and bare
  // ground between it, a loose slab of an island, the end of the walk and the road's kerb).
  const LD = 4.6, lotZ = 1.55, lotEnd = lotZ + LD;
  const X0 = W / 2 + tower, KB = 0.15, VG = 0.35, SW = 0.85, zB = -D / 2 - (D + 0.25) / 2, DRV = 1.95;
  const kerbAt = (s, z) => o.kerbU?.(s, z) ?? X0 + VG + SW + 0.6;
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; };
  const zs = [];
  for (let z = zB; z < lotEnd + KB - 1e-6; z += 0.2) zs.push(z);
  for (const z of [lotZ - 1e-3, lotZ, lotEnd, lotEnd + KB]) { for (let i = zs.length - 1; i >= 0; i--) if (Math.abs(zs[i] - z) < 0.05) zs.splice(i, 1); zs.push(z); }
  zs.sort((a, b) => a - b);
  const SIDE = {};
  for (const s of [-1, 1]) {
    const k = zs.map(z => kerbAt(s, z));
    const lot = k.map(kk => smin(X0, kk - VG - SW, 0.6));               // the lot's edge (inside face of its kerb)
    SIDE[s] = { k, lot, out: k.map(kk => kk - VG) };                    // …and the pavement's outer edge
  }
  const lerpAt = (arr, z) => {                                          // sample a per-z array
    if (z <= zs[0]) return arr[0];
    for (let i = 1; i < zs.length; i++) if (z <= zs[i]) { const t = (z - zs[i - 1]) / Math.max(1e-6, zs[i] - zs[i - 1]); return arr[i - 1] + (arr[i] - arr[i - 1]) * t; }
    return arr[arr.length - 1];
  };
  const lotU = (s, z) => lerpAt(SIDE[s].lot, Math.min(lotEnd, Math.max(lotZ, z)));
  const lotZs = zs.filter(z => z >= lotZ && z <= lotEnd);
  // a flat slab from an outline [[x, z]…], y0 → y1, its top shaded flat like the ground
  const slab = (poly, y0, y1, mat) => {
    const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); geo.translate(0, y0, 0);
    const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) > 0.5) n.setXYZ(i, 0, 1, 0);
    return K.put(geo, mat, 0, 0, 0);
  };
  const kerbM = paint(PAL.kerb), paveM = paint(0xe2d6bd), asph = paint(0x8a8392, { hatch: 0 });
  // the asphalt (asphalt meets asphalt at the drive: no drawn edge)
  slab([...lotZs.map(z => [lotU(1, z), z]), ...lotZs.slice().reverse().map(z => [-lotU(-1, z), z])], 0, 0.05, asph).userData.noInk = true;
  // (the drive out to the boulevard is mallDrive(), built to the road's real edge once it's placed)
  const PAVE = {};
  for (const s of [-1, 1]) {
    // the lot's kerb: up its side and across its front to the drive's dropped kerb, offset
    // outward with mitred corners
    const kl = [...lotZs.map(z => [s * lotU(s, z), z]), [s * DRV, lotEnd]];
    const segN = [];
    for (let i = 0; i < kl.length - 1; i++) {
      const dx = kl[i + 1][0] - kl[i][0], dz = kl[i + 1][1] - kl[i][1], l = Math.hypot(dx, dz) || 1;
      segN.push(s > 0 ? [dz / l, -dx / l] : [-dz / l, dx / l]);
    }
    const outer = kl.map((p, i) => {
      const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
      let nx = a[0] + b[0], nz = a[1] + b[1]; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const m = KB / Math.max(0.5, nx * b[0] + nz * b[1]);
      return [p[0] + nx * m, p[1] + nz * m];
    });
    slab([...kl, ...outer.reverse()], 0, 0.1, kerbM);
    // the pavement: from the building line (beside the tower) or the lot's edge (under its kerb)
    // out to the verge, from the back of the tower to the front of the lot's kerb. Where the
    // road crowds the building it simply ends, square across, at a sensible width
    const S = SIDE[s], inner = zs.map(z => z < lotZ ? X0 : lotU(s, z));
    const ok = zs.map((z, i) => S.out[i] - inner[i] >= 0.35);
    let a = zs.findIndex(z => z >= lotZ), b = a;
    if (ok[a]) {
      while (a > 0 && ok[a - 1]) a--;
      while (b < zs.length - 1 && ok[b + 1]) b++;
      const run = zs.slice(a, b + 1).map((z, j) => [z, inner[a + j], S.out[a + j]]);
      const poly = [];
      for (let j = 0; j < run.length; j++) {
        const [z, u] = run[j];
        if (j && run[j - 1][0] < lotZ && z >= lotZ) poly.push([s * run[j - 1][1], z]);   // the step from the tower's face to the lot's edge
        poly.push([s * u, z]);
      }
      for (let j = run.length - 1; j >= 0; j--) poly.push([s * run[j][2], run[j][0]]);
      slab(poly, 0, 0.08, paveM);
      PAVE[s] = { z0: zs[a], z1: zs[b], inner: (z) => z < lotZ ? X0 : lotU(s, z), out: (z) => lerpAt(S.out, z) };
    }
  }
  // one row of car-sized bays along the shops (nose in, a wheel stop at the kerb end); the
  // front row is gone, so the drive from the boulevard opens straight into the aisle
  const line = paint(0xf6eedb, { hatch: 0 });
  const NB = 5, bayX0 = -4.4, bayW = 8.8 / NB, bayZ0 = lotZ + 0.15, bayD = 3.0;
  const bays = [];
  for (let k = 0; k <= NB; k++) K.box(0.05, 0.012, bayD, line, bayX0 + k * bayW, 0.055, bayZ0 + bayD / 2, 0.004).userData.noInk = true;
  for (let k = 0; k < NB; k++) {
    const bx = bayX0 + (k + 0.5) * bayW;
    K.box(0.6, 0.08, 0.1, paint(0xd8cab0), bx, 0.09, bayZ0 + 0.2, 0.02);
    bays.push({ x: bx, z: bayZ0 + bayD / 2, stopZ: bayZ0 + 0.2 });
  }
  // the end islands: a kerbed bed the depth of the bays, from just past the last bay's line out
  // to the lot's kerb (from the walk's edge to the aisle), a shrub, a little tree and a lamp
  const IU = -bayX0 + 0.08, IZ0 = lotZ, IZ1 = bayZ0 + bayD, bed = paint(PAL.grassDeep);
  const isZs = [IZ0, ...lotZs.filter(z => z > IZ0 && z < IZ1), IZ1];
  for (const s of [-1, 1]) {
    slab([...isZs.map(z => [s * IU, z]), ...isZs.slice().reverse().map(z => [s * lotU(s, z), z])], 0, 0.1, kerbM);
    const bz = isZs.filter(z => z > IZ0 + 0.1 && z < IZ1 - KB);
    const bedZs = [IZ0 + 0.1, ...bz, IZ1 - KB];
    slab([...bedZs.map(z => [s * (IU + KB), z]), ...bedZs.slice().reverse().map(z => [s * (lotU(s, z) - 0.02), z])], 0.09, 0.115, bed).userData.noInk = true;
    const iu = (IU + lotU(s, (IZ0 + IZ1) / 2)) / 2, zc = (IZ0 + IZ1) / 2 - 0.2;
    K.put(_puff.clone().scale(0.34, 0.3, 0.34), paint(PAL.leaf), s * iu, 0.42, zc - 0.5);
    K.put(lathe([[0.001, 0], [0.06, 0], [0.04, 0.35], [0.001, 0.36]], 8), paint(PAL.bark), s * iu, 0.1, zc + 0.35);
    K.put(_puff.clone().scale(0.38, 0.32, 0.38), paint(PAL.leaf), s * iu, 0.6, zc + 0.35);
    lampPost(K, s * iu, IZ1 - 0.4, 2.4);
  }
  // (the pylon sign is mallPylon(), stood up on its own on the verge by the drive: laid onto
  // the ground vertex by vertex with the rest of the mall, a tall post leant and sheared)
  bench(K, -W * 0.18, 0.5, 0, PAL.bark, 0.08); bench(K, W * 0.3, 0.5, 0, PAL.bark, 0.08);
  const half = W / 2 + tower, lotHalf = X0;
  K.g.userData.floor = (x, z) => {
    const s = x < 0 ? -1 : 1, u = Math.abs(x);
    if (z > -0.05 && z < lotZ && u < half) return 0.08;                              // the covered walk
    if (z >= lotZ && z < lotEnd && u < lotU(s, z)) return u > IU && z < IZ1 ? 0.11 : 0.05;   // the lot (an island)
    if (z >= lotZ && z < lotEnd + KB && u >= DRV && u < lotU(s, z) + KB) return 0.1;     // its kerb
    const P = PAVE[s];
    if (P && z >= P.z0 && z <= P.z1 && u >= P.inner(z) && u <= P.out(z)) return 0.08; // the end pavement
    return null;
  };
  // for the plaza's life (js/plaza.js): the shop doors, the bays, the aisle
  let ux = -W / 2;
  K.g.userData.mall = { bays, aisleZ: lotZ + LD - 0.75, walkZ: 1.05, lotEnd, lotHalf, pylonAt: [-3.4, lotEnd + 0.85],
    doors: units.map(u => { const d = { name: u.name, x: ux + u.w / 2 + u.w * 0.25, z: 0.12 }; ux += u.w; return d; }) };
  return K.g;
}

// Maple Plaza's pylon sign: MAPLE PLAZA over the tenant boards, a leaf on top. Its own little
// object, origin at the foot between its posts, facing +z: town.js stands it upright on the
// verge beside the drive (placeOnPlanet with upright: true), clear of the kerbs.
export function mallPylon() {
  const py = kit();
  for (const sx of [-0.32, 0.32]) { py.box(0.14, 2.6, 0.14, paint(0xd58b63), sx, 1.3, 0, 0.03); py.foot(sx, 0, 0.12); }
  py.foot(0, 0, 0.12);
  py.box(1.1, 0.5, 0.22, paint(0x3e6b52), 0, 2.55, 0, 0.05);
  py.flat(0.95, 0.38, signMat('Maple Plaza', { bg: '#3e6b52', fg: '#f6eedb' }), 0, 2.55, 0.112);
  MALL_UNITS.forEach((u, i) => { py.box(0.9, 0.2, 0.1, paint(0xf6eedb), 0, 2.08 - i * 0.24, 0, 0.02); py.flat(0.82, 0.16, signMat(u.name, { bg: '#f6eedb', fg: u.sign, border: false, w: 384, h: 72 }), 0, 2.08 - i * 0.24, 0.052); });
  const leaf = new THREE.Shape(); leaf.moveTo(0, -0.2); leaf.quadraticCurveTo(0.25, 0.0, 0.0, 0.25); leaf.quadraticCurveTo(-0.25, 0.0, 0, -0.2);
  py.put(extrude(leaf, 0.05, 0.015), paint(0xe8604c), 0, 3.05, -0.03);
  return py.g;
}

// Maple Plaza's drive: from the lot's front edge (z = lotEnd, in the mall's frame) out to the
// boulevard, built to the road's real carriageway edge — edgeZ(x) gives it, in the same frame.
// A bell-mouth: it flares as it meets the road, rises from the lot's height to just under the
// road's surface (no step, no slab poking over the kerb or the verge), and a dropped kerb runs
// down each side to meet the road's own kerb. Place it with the mall's d + yaw.
export function mallDrive(edgeZ, lotEnd) {
  const K = kit(), asph = paint(0x8a8392, { hatch: 0 }), kerb = paint(PAL.kerb, { hatch: 0 }), line = paint(0xf6eedb, { hatch: 0 });
  const NU = 10, NV = 12, z0 = lotEnd - 0.03;
  const halfW = (v) => 1.8 + 0.75 * v ** 2.5;
  // lot (0.05) → over the road's kerb band (0.07) → just under the road's surface (≈0.10), which
  // it runs a little way beneath (the road's edge is a chord between its samples: no gap to see)
  const lift = (v) => { const r = Math.min(1, 1.2 * v); return 0.051 + 0.045 * r * r * (3 - 2 * r) - 0.01 * Math.max(0, (v - 0.9) / 0.1); };
  const at = (u, v) => { const x = u * halfW(v); return [x, lift(v), z0 + v * (edgeZ(x) + 0.1 - z0)]; };
  const strip = (pts, idx, mat, flatUp = false) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (flatUp) { const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); }   // shaded like the flat lot and road
    K.put(g, mat, 0, 0, 0).userData.noInk = true;
  };
  { // the slab: a grid, so it lays onto the curve and the rise is smooth
    const pts = [], idx = [];
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) pts.push(...at(i / NU * 2 - 1, j / NV));
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    strip(pts, idx, asph, true);
  }
  for (const s of [-1, 1]) { // dropped kerbs down both sides: a top 0.15 wide, a skirt to below the verge (covers the slab's edge)
    const pts = [], idx = [];
    for (let j = 0; j <= NV; j++) {
      const v = j / NV, [x, y, z] = at(s, v), o = 0.15 * s;
      pts.push(x - 0.02 * s, y + 0.012, z, x + o, y + 0.012, z, x + o, 0.0, z);
    }
    for (let j = 0; j < NV; j++) {
      const a = j * 3, b = a + 3;
      const f = (p, q, r) => s > 0 ? idx.push(p, q, r) : idx.push(p, r, q);
      f(a, b, a + 1); f(a + 1, b, b + 1); f(a + 1, b + 1, a + 2); f(a + 2, b + 1, b + 2);
    }
    strip(pts, idx, kerb);
  }
  // lane arrows: in on the left, out on the right
  const arrow = new THREE.Shape();
  arrow.moveTo(-0.09, -0.45); arrow.lineTo(0.09, -0.45); arrow.lineTo(0.09, 0.1); arrow.lineTo(0.22, 0.1); arrow.lineTo(0, 0.42); arrow.lineTo(-0.22, 0.1); arrow.lineTo(-0.09, 0.1); arrow.closePath();
  for (const [ax, dirn] of [[-0.85, -1], [0.85, 1]]) {
    const v = 0.4, [, y, z] = at(ax / halfW(v), v);
    K.put(new THREE.ShapeGeometry(arrow), line, ax, y + 0.008, z, [-Math.PI / 2, 0, dirn > 0 ? Math.PI : 0]).userData.noInk = true;
  }
  return K.g;
}

// ── a little car park beside a project shop, in the SHOP's frame (front +z, toward town) ──
// On side `s` (±1): an aisle along the shop's flank, three nose-in bays beyond it, and an
// apron at the front that runs in to the spur road's edge — roadX(z) gives where the road's
// surface begins (from the shop's middle line), so the apron tucks just under it, no gap.
// Asphalt with painted bays, wheel stops, a kerb round the outside, a lamp and a P sign.
export const SHOP_LOT = { x0: 3.15, x1: 8.3, z0: -2.1, z1: 6.4, aisle: 5.15, apron: [3.3, 6.4], bays: [-0.9, 1.3, 3.5], bayW: 2.2 };   // (the apron's wide enough to turn in off the spur)
export function shopLot(s, roadX) {
  const K = kit(), L = SHOP_LOT, asph = paint(PAL.road, { hatch: 0 }), line = paint(0xf6eedb, { hatch: 0 }), kerb = paint(PAL.kerb);
  const TOP = 0.085;
  // the asphalt: one outline (lot + apron), extruded thin and laid flat (+x is side s)
  const [a0, a1] = L.apron, N = 6, sh = new THREE.Shape();
  const P = (x, z) => new THREE.Vector2(s * x, -z);            // shape y = −z, so rotateX(−π/2) lays it flat
  const pts = [P(L.x0, L.z0), P(L.x1, L.z0), P(L.x1, L.z1)];
  for (let k = 0; k <= N; k++) { const z = a1 - (a1 - a0) * k / N; pts.push(P(Math.min(L.x0, roadX(z) - 0.15), z)); }
  pts.push(P(L.x0, a0));
  if (s < 0) pts.reverse();
  sh.setFromPoints(pts);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); geo.translate(0, TOP - 0.06, 0);
  { const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) > 0.5) n.setXYZ(i, 0, 1, 0); }
  K.put(geo, asph, 0, 0, 0).userData.noInk = true;
  // the bays: lines between them, a wheel stop at the head of each
  const bx0 = L.aisle, bx1 = L.x1 - 0.2, bayD = bx1 - bx0;
  for (let k = 0; k <= L.bays.length; k++) {
    const z = L.bays[0] - L.bayW / 2 + k * L.bayW;
    K.box(bayD, 0.012, 0.06, line, s * (bx0 + bayD / 2), TOP + 0.004, z, 0.004).userData.noInk = true;
  }
  for (const z of L.bays) K.box(0.12, 0.08, 0.7, kerb, s * (bx1 - 0.35), TOP + 0.04, z, 0.02);
  // an arrow down the aisle, in from the apron
  const ar = new THREE.Shape();
  ar.moveTo(-0.09, -0.45); ar.lineTo(0.09, -0.45); ar.lineTo(0.09, 0.1); ar.lineTo(0.22, 0.1); ar.lineTo(0, 0.42); ar.lineTo(-0.22, 0.1); ar.lineTo(-0.09, 0.1); ar.closePath();
  K.put(new THREE.ShapeGeometry(ar), line, s * (L.x0 + L.aisle) / 2, TOP + 0.006, 1.6, [-Math.PI / 2, 0, 0]).userData.noInk = true;
  // a kerb round the outside (not across the aisle's mouth or the apron)
  K.box(0.16, 0.1, L.z1 - L.z0, kerb, s * (L.x1 + 0.02), TOP + 0.02, (L.z0 + L.z1) / 2, 0.03);
  K.box(L.x1 - L.x0 + 0.18, 0.1, 0.16, kerb, s * (L.x0 + L.x1) / 2, TOP + 0.02, L.z0 - 0.02, 0.03);
  K.box(L.x1 - L.aisle, 0.1, 0.16, kerb, s * (L.aisle + L.x1) / 2, TOP + 0.02, L.z1 + 0.02, 0.03);
  // a lamp at the far corner, and a P sign at the apron
  lampPost(K, s * (L.x1 - 0.35), L.z0 + 0.35, 2.3);
  const sg = K.sub(s * (L.x0 - 0.35), 0, L.z1 + 0.25, 0);
  sg.foot(0, 0, 0.1);
  sg.box(0.06, 1.5, 0.06, DARK(), 0, 0.75, 0, 0.02);
  sg.box(0.46, 0.46, 0.05, paint(0x3f6fb0), 0, 1.6, 0, 0.04);
  sg.flat(0.38, 0.38, signMat('P', { bg: '#3f6fb0', fg: '#f6eedb', w: 128, h: 128, font: '700 $px ' + HAND }), 0, 1.6, 0.027);
  return K.g;
}

// the station's track in its own frame: along x at z, ±half (the loop in rail.js joins it there)
export const STATION_TRACK = { z: -5.55, half: 7.0, platformEdge: -4.7, platformTop: 0.5 };
// ── Central Station: a brick booking hall with a clock tower, a platform
// under a fretted canopy, and track out the back ───────────────────────────
export function station() {
  const K = kit();
  const brick = paint(0xc77b62), stone = paint(0xf1e4c8), trim = paint(0xfffaf0), slate = paint(PAL.roofSlate),
    iron = paint(0x3e6b52), dk = DARK();
  const MW = 4.4, WW = 1.7, D = 2.8, H = 2.7, WH = 2.15, front = 0.5;
  const bz = front - D / 2;
  // forecourt paving in front
  K.put(uvFrom(rb(9.4, 0.06, 2.9, 0.02, 2), 'x', 'z', 0.75), paveMat(), 0, 0.03, front + 1.45);
  // the main hall and its two wings, on a stone plinth
  K.box(MW, H, D, brick, 0, H / 2, bz, 0.05);
  for (const s of [-1, 1]) K.box(WW, WH, D - 0.3, brick, s * (MW / 2 + WW / 2), WH / 2, bz - 0.15, 0.05);
  K.box(MW + WW * 2 + 0.06, 0.28, D + 0.06, stone, 0, 0.14, bz, 0.03);
  K.box(MW + 0.04, 0.1, D + 0.04, stone, 0, 1.55, bz, 0.02);
  // quoins on every outside corner
  for (const [qx, qh] of [[-MW / 2, H], [MW / 2, H], [-(MW / 2 + WW), WH], [MW / 2 + WW, WH]]) {
    for (let y = 0.35, k = 0; y < qh - 0.15; y += 0.22, k++) K.box(k % 2 ? 0.16 : 0.24, 0.16, 0.05, stone, qx - Math.sign(qx) * (k % 2 ? 0.08 : 0.12), y, front + 0.02 - (Math.abs(qx) > MW / 2 + 0.1 ? 0.3 : 0), 0.015);
  }
  // cornices
  K.put(prism(CORNICE, MW + 0.1), trim, 0, H, front);
  for (const s of [-1, 1]) { const S = K.sub(s * (MW / 2 + WW / 2), WH, front - 0.3); S.put(prism(CORNICE.map(([a, b]) => [a * 0.8, b * 0.8]), WW + 0.08), trim, 0, 0, 0); }
  // roofs: hipped slate on the hall, the wings
  K.put(hipRoof(MW + 0.2, D + 0.2, 1.0, 1), slate, 0, H + 0.2, bz);
  for (const s of [-1, 1]) K.put(hipRoof(WW + 0.1, D - 0.1, 0.7, 1), slate, s * (MW / 2 + WW / 2), WH + 0.18, bz - 0.15);
  // the clock tower over the entrance
  const TW = 1.35, TH = 5.2, tz = front + 0.22 - TW / 2;
  K.box(TW, TH, TW, brick, 0, TH / 2, tz, 0.05);
  K.box(TW + 0.06, 0.12, TW + 0.06, stone, 0, H + 0.1, tz, 0.02);
  const tc = K.sub(0, TH, tz + TW / 2); tc.put(prism(CORNICE.map(([a, b]) => [a * 0.8, b * 0.8]), TW + 0.08), trim, 0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const F = K.sub(Math.sin(k * Math.PI / 2) * (TW / 2), 0, tz + Math.cos(k * Math.PI / 2) * (TW / 2), k * Math.PI / 2);
    F.put(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 32), trim, 0, TH - 0.62, 0.02, [Math.PI / 2, 0, 0]);
    F.put(new THREE.CircleGeometry(0.4, 32), paint(0xffffff, { map: clockTex(), hatch: 0 }), 0, TH - 0.62, 0.065).userData.noInk = true;
    windowAt(F, { y: H + 0.5, w: 0.36, h: 0.8, arch: true, frame: trim, glass: upperGlass(k), cols: 2, rows: 2, hood: 'key' });
  }
  K.put(new THREE.SphereGeometry(0.035, 8, 6), dk, 0, TH - 0.62, tz + TW / 2 + 0.1);
  K.put(lathe([[0.001, 0], [0.98, 0], [0.5, 0.75], [0.12, 1.25], [0.001, 1.3]], 4), paint(0x5fae9a), 0, TH + 0.2, tz, [0, Math.PI / 4, 0]);
  K.put(lathe([[0.001, 0], [0.05, 0], [0.025, 0.35], [0.06, 0.4], [0.001, 0.55]], 10), paint(PAL.gold), 0, TH + 1.45, tz);
  const vane = K.sub(0, TH + 1.8, tz, 0.6);
  vane.box(0.5, 0.03, 0.02, dk, 0, 0, 0, 0.008);
  vane.put(extrude(shape([[0.25, -0.08], [0.38, 0], [0.25, 0.08]]), 0.01, 0.004), dk, 0, 0, -0.005);
  // an arched doorway (they were flat green slabs stuck on the lower half of arched windows):
  // a dark reveal filling the opening, a stone surround (jambs, arch, keystone), a fanlight
  // with glazing bars over a transom, and double panelled doors in station green, set back
  // in it with brass knobs and a kick plate. (x, base) on the wall face of F, DW wide, h tall
  const doorGreen = paint(0x3e6b52), doorPanel = paint(0x4f7f63), brass = paint(PAL.gold, { hatch: 0 });
  const archDoor = (F, x, DW, h, t) => {
    const R = DW / 2, SP = h - R;
    const arch = new THREE.Shape(); arch.moveTo(-R, 0); arch.lineTo(R, 0); arch.lineTo(R, SP); arch.absarc(0, SP, R, 0, Math.PI, false); arch.lineTo(-R, 0);
    F.put(extrude(arch, 0.03, 0.005), dk, x, 0, 0);                                                 // the dark reveal
    for (const sx of [-1, 1]) F.box(t, SP, 0.08, stone, x + sx * (R + t / 2), SP / 2, 0.045, 0.015);  // jambs
    F.put(new THREE.TorusGeometry(R + t / 2, t / 2, 8, 28, Math.PI), stone, x, SP, 0.045);          // the arch
    F.box(t + 0.04, 0.17, 0.1, stone, x, SP + R + t * 0.6, 0.05, 0.02);                              // keystone
    const fan = new THREE.Shape(); fan.moveTo(R - 0.02, 0); fan.absarc(0, 0, R - 0.02, 0, Math.PI, false); fan.lineTo(R - 0.02, 0);
    F.put(extrude(fan, 0.02, 0.005), upperGlass(3), x, SP, 0.03);                                   // fanlight
    for (let k = 1; k < 4; k++) { const a = k / 4 * Math.PI; F.box(0.022, R - 0.04, 0.015, stone, x + Math.cos(a) * (R / 2 - 0.01), SP + Math.sin(a) * (R / 2 - 0.01), 0.055, 0.005, [0, 0, a - Math.PI / 2]); }
    F.box(DW, 0.05, 0.05, stone, x, SP, 0.05, 0.01);                                                // transom
    for (const sx of [-1, 1]) {
      const cx = x + sx * DW / 4;
      F.box(DW / 2 - 0.015, SP - 0.03, 0.04, doorGreen, cx, (SP - 0.03) / 2, 0.035, 0.01);          // a leaf
      for (const y of [0.27, 0.7]) F.box(DW / 2 - 0.1, SP * 0.3, 0.02, doorPanel, cx, SP * y, 0.06, 0.008);  // raised panels
      F.put(new THREE.SphereGeometry(0.024, 10, 7), brass, x + sx * 0.05, SP * 0.49, 0.072);        // knob
    }
    F.box(DW, 0.08, 0.012, brass, x, 0.04, 0.058, 0.004);                                           // kick plate
  };
  // the entrance, the name above; it stands on two stone steps up from the forecourt
  const E = K.sub(0, 0.28, front + 0.22);
  archDoor(E, 0, 0.8, 1.75, 0.09);
  E.box(1.1, 0.12, 0.3, stone, 0, -0.06, 0.13, 0.02);
  E.box(1.32, 0.13, 0.52, stone, 0, -0.175, 0.24, 0.02);
  K.flat(TW - 0.12, 0.22, signMat('CENTRAL STATION', { bg: '#f1e4c8', fg: '#2a2230', border: false, font: '400 $px ' + HAND }), 0, 2.38, front + 0.225);
  // tall arched windows across the hall, smaller ones on the wings
  for (const sx of [-1.45, 1.45]) windowAt(K.sub(sx, 0, front), { y: 0.55, w: 0.62, h: 1.65, arch: true, frame: stone, glass: upperGlass(sx > 0 ? 1 : 2), cols: 3, rows: 3, hood: 'key', t: 0.07 });
  for (const s of [-1, 1]) for (const dx of [-0.4, 0.4]) windowAt(K.sub(s * (MW / 2 + WW / 2) + dx, 0, front - 0.3), { y: 0.55, w: 0.38, h: 1.05, arch: true, frame: stone, glass: upperGlass(2), cols: 2, rows: 2, hood: 'key' });
  // the platform side: doors through the hall, windows on the wings
  const BK = K.sub(0, 0.5, bz - D / 2, Math.PI);
  for (const sx of [-0.9, 0.9]) archDoor(BK, sx, 0.62, 1.55, 0.07);
  for (const s of [-1, 1]) for (const dx of [-0.4, 0.4]) windowAt(K.sub(s * (MW / 2 + WW / 2) + dx, 0.75, bz - D / 2, Math.PI), { y: 0, w: 0.38, h: 1.05, arch: true, frame: stone, glass: upperGlass(1), cols: 2, rows: 2, hood: 'key' });
  // the platform behind, under a canopy with a fretted valance
  const pz0 = bz - D / 2, PD = 2.4, PL = 12.4, PH = 0.5;
  K.box(PL, PH, PD, paint(PAL.kerb), 0, PH / 2, pz0 - PD / 2, 0.04);
  K.box(PL, 0.06, 0.18, paint(0xf0d060), 0, PH + 0.005, pz0 - PD + 0.12, 0.01).userData.noInk = true;
  for (const s of [-1, 1]) K.put(wedge(1.2, PH, PD), paint(PAL.kerb), s * (PL / 2 + 0.6), 0, pz0 - PD / 2, [0, s > 0 ? 0 : Math.PI, 0]);
  const CH = 2.45, cz = pz0 - PD + 0.4;
  K.box(PL - 0.6, 0.1, PD - 0.1, paint(0xe8ddc6), 0, PH + CH, pz0 - (PD - 0.1) / 2, 0.03, [-0.05, 0, 0]);
  const fret = new THREE.Shape(); const fw = PL - 0.6, nT = Math.round(fw / 0.16);
  fret.moveTo(-fw / 2, 0); fret.lineTo(fw / 2, 0); fret.lineTo(fw / 2, -0.06);
  for (let k = 0; k < nT; k++) { const x0 = fw / 2 - k * fw / nT; fret.lineTo(x0 - fw / nT / 2, -0.24); fret.lineTo(x0 - fw / nT, -0.06); }
  fret.lineTo(-fw / 2, 0);
  K.put(extrude(fret, 0.02, 0.006, 4), trim, 0, PH + CH - 0.07, pz0 - PD + 0.02);
  for (let k = 0; k < 6; k++) {
    const x = -5.0 + k * 2.0;
    K.put(lathe([[0.001, 0], [0.1, 0], [0.1, 0.1], [0.05, 0.16], [0.04, CH - 0.25], [0.07, CH - 0.18], [0.08, CH - 0.1], [0.001, CH - 0.1]], 12), iron, x, PH, cz);
    for (const s of [-1, 1]) {
      const br = new THREE.Shape(); br.moveTo(0, 0); br.lineTo(0.5, 0); br.quadraticCurveTo(0.08, -0.06, 0, -0.5); br.lineTo(0, 0);
      br.holes.push(new THREE.Path().absarc(0.14, -0.14, 0.07, 0, Math.PI * 2, true));
      K.put(extrude(br, 0.02, 0.006, 10), iron, x, PH + CH - 0.1, cz - 0.01, [0, s < 0 ? Math.PI : 0, 0]);
    }
  }
  for (const x of [-3, 1, 4]) bench(K, x, pz0 - 0.55, Math.PI, PAL.bark, PH);
  const sg = K.sub(-1.0, PH, pz0 - PD + 0.45);
  for (const sx of [-0.55, 0.55]) sg.box(0.06, 1.55, 0.06, iron, sx, 0.78, 0, 0.015);
  sg.box(1.3, 0.32, 0.06, paint(0x2f5a8a), 0, 1.45, 0, 0.03);
  for (const s of [1, -1]) sg.flat(1.2, 0.24, signMat('CENTRAL', { bg: '#2f5a8a', fg: '#f6eedb', font: '400 $px ' + HAND }), 0, 1.45, s * 0.032, [0, s > 0 ? 0 : Math.PI, 0]);
  // a hanging double-faced clock under the canopy
  const hc = K.sub(2.6, PH + CH - 0.4, pz0 - PD / 2);
  hc.box(0.02, 0.3, 0.02, dk, 0, 0.2, 0, 0.006);
  hc.put(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24), iron, 0, 0, 0, [Math.PI / 2, 0, 0]);
  for (const s of [1, -1]) hc.put(new THREE.CircleGeometry(0.17, 24), paint(0xffffff, { map: clockTex(), hatch: 0 }), 0, 0, s * 0.052, [0, s > 0 ? 0 : Math.PI, 0]).userData.noInk = true;
  // track: ballast, sleepers, two rails — the straight of the railway loop (rail.js
  // carries the line on from both ends, so no buffer stops)
  const tz2 = STATION_TRACK.z, TL = STATION_TRACK.half * 2;
  K.box(TL, 0.12, 1.5, paint(0xb8ab98), 0, 0.06, tz2, 0.04);
  const sl = [];
  for (let x = -TL / 2 + 0.2; x < TL / 2 - 0.1; x += 0.42) sl.push(rb(0.16, 0.06, 1.2, 0.015).translate(x, 0.14, tz2));
  K.put(mergeGeometries(sl), paint(PAL.bark));
  for (const s of [-1, 1]) K.box(TL - 0.2, 0.08, 0.06, paint(0x8d8996), 0, 0.21, tz2 + s * 0.4, 0.015);
  // forecourt life: lamps, a bench, a taxi sign
  for (const s of [-1, 1]) lampPost(K, s * 3.6, front + 1.2, 2.0);
  bench(K, -2.4, front + 0.4, 0);
  const tx = K.sub(3.0, 0, front + 2.3);
  tx.foot(0, 0, 0.08);
  tx.box(0.05, 1.3, 0.05, dk, 0, 0.65, 0, 0.01);
  tx.box(0.5, 0.2, 0.04, paint(PAL.gold), 0, 1.35, 0, 0.02);
  tx.flat(0.44, 0.15, signMat('TAXI', { bg: '#e4b84f', fg: '#2a2230', w: 192, h: 64, border: false }), 0, 1.35, 0.022);
  K.g.userData.floor = (x, z) => {
    if (Math.abs(x) < 0.55 && z > front + 0.22 && z < front + 0.5) return 0.28;   // the entrance steps
    if (Math.abs(x) < 0.66 && z > front + 0.22 && z < front + 0.72) return 0.17;
    if (z > front && z < front + 2.9 && Math.abs(x) < 4.7) return 0.06;
    if (z < pz0 && z > pz0 - PD) {
      if (Math.abs(x) <= PL / 2) return PH;
      if (Math.abs(x) <= PL / 2 + 1.2) return PH * (1 - (Math.abs(x) - PL / 2) / 1.2);
    }
    return null;
  };
  // footprint (local x, local z) → radius; the platform and track stay walkable
  K.g.userData.solids = [[[-1.45, bz], 1.5], [[0, bz], 1.45], [[1.45, bz], 1.5], [[-(MW / 2 + WW / 2), bz - 0.15], 1.15], [[MW / 2 + WW / 2, bz - 0.15], 1.15]];
  return K.g;
}
let _clock;
function clockTex() {
  if (!_clock) _clock = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#fbf6ea'; c.beginPath(); c.arc(64, 64, 63, 0, Math.PI * 2); c.fill();
    c.strokeStyle = INK; c.lineWidth = 4;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; c.beginPath(); c.moveTo(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); c.lineTo(64 + Math.sin(a) * (k % 3 ? 56 : 59), 64 - Math.cos(a) * (k % 3 ? 56 : 59)); c.stroke(); }
    // stopped at 3:07 — the minute the paintings went
    const hand = (a, l, lw) => { c.lineWidth = lw; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.sin(a) * l, 64 - Math.cos(a) * l); c.stroke(); };
    hand((3 + 7 / 60) / 12 * Math.PI * 2, 30, 7); hand(7 / 60 * Math.PI * 2, 46, 4);
    c.fillStyle = INK; c.beginPath(); c.arc(64, 64, 5, 0, Math.PI * 2); c.fill();
  });
  return _clock;
}
// a ramp: a right-triangle prism (length along +x, rising toward −x)
function wedge(len, h, d) {
  const g = extrude(shape([[-len / 2, 0], [len / 2, 0], [-len / 2, h]]), d, 0.01, 4);
  g.translate(0, 0, -d / 2);
  return g;
}
// a hipped roof: rectangle w × d, height h, ridge along X (`k` < 1 shortens the ridge)
export function hipRoof(w, d, h, k = 1) {
  const a = w / 2, b = d / 2, r = Math.max(0, a - b * k);
  const A = [-a, 0, -b], B = [a, 0, -b], C = [a, 0, b], D = [-a, 0, b], E = [-r, h, 0], F = [r, h, 0];
  const tris = [D, C, F, D, F, E, B, A, E, B, E, F, C, B, F, A, D, E, A, B, C, A, C, D];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Cape Far Side: the cargo launch site where the story ends ───────────────
// Static ground (pad, gantry, tanks, floodlights, sign) goes through
// placeOnPlanet like everything else; the parts that move — the rocket, the
// crates' lids, the console's screen and button, the smoke — are built here
// and placed by the game in the site's frame (origin = pad centre, +Z = the
// road you arrive by).
export const CAPE = {
  rocket: [0, 0, -1.6], gantry: [2.15, 0, -1.6], gantryTop: 5.25, console: [3.4, 0, 2.1], rex: [-1.5, 0, 1.6],
  van: [-5.6, 0, 3.8], crates: [-3.0, 0, 0.4], police: [1.6, 0, 5.2],
};
export function capeFarSide() {
  const K = kit();
  const conc = paint(0xd8d2c6), dk = DARK(), red = paint(0xd8573f), white = paint(0xf3eee4), steel = paint(0x8d8996);
  // the pad: a raised concrete disc with a hazard ring and a painted target
  const [rx, , rz] = CAPE.rocket;
  K.put(lathe([[0.001, 0], [3.4, 0], [3.4, 0.1], [3.3, 0.16], [0.001, 0.16]], 40), conc, rx, 0, rz);
  const haz = canvasTex(256, 16, (c, w, h) => { for (let k = 0; k < 16; k++) { c.fillStyle = k % 2 ? '#2a2230' : '#e4b84f'; c.beginPath(); c.moveTo(k * 16, 0); c.lineTo(k * 16 + 16, 0); c.lineTo(k * 16 + 8, h); c.lineTo(k * 16 - 8, h); c.fill(); } }, true);
  haz.repeat.set(8, 1);
  const ring = new THREE.RingGeometry(2.7, 3.15, 64, 1); ring.rotateX(-Math.PI / 2);
  { const uv = ring.attributes.uv, pos = ring.attributes.position; for (let i = 0; i < uv.count; i++) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); uv.setXY(i, (a / (Math.PI * 2) + 0.5), Math.hypot(pos.getX(i), pos.getZ(i)) > 2.9 ? 1 : 0); } }
  K.put(ring, paint(0xffffff, { map: haz, hatch: 0 }), rx, 0.17, rz).userData.noInk = true;
  const tgt = new THREE.RingGeometry(0.95, 1.1, 40); tgt.rotateX(-Math.PI / 2);
  K.put(tgt, paint(0xf3eee4, { hatch: 0 }), rx, 0.17, rz).userData.noInk = true;
  // the gantry: a lattice tower with a ladder, a platform and a swing arm to the rocket
  const [gx, , gz] = CAPE.gantry, GH = 6.0, gw = 0.95;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(0.09, GH, 0.09, red, gx + sx * gw / 2, GH / 2 + 0.16, gz + sz * gw / 2, 0.02);
  for (let y = 0.6; y < GH; y += 0.75) {
    for (const [ax, az, len, ry] of [[0, -gw / 2, gw, 0], [0, gw / 2, gw, 0], [-gw / 2, 0, gw, Math.PI / 2], [gw / 2, 0, gw, Math.PI / 2]]) {
      K.box(len, 0.06, 0.06, red, gx + ax, y + 0.16, gz + az, 0.015, [0, ry, 0]);
      K.box(len * 1.38, 0.04, 0.04, red, gx + ax, y + 0.16 + 0.37, gz + az, 0.01, [0, ry, (ry ? 1 : -1) * 0.68 * (Math.round(y / 0.75) % 2 ? 1 : -1)]);
    }
  }
  K.box(gw + 0.4, 0.08, gw + 0.4, steel, gx, CAPE.gantryTop, gz, 0.02);
  for (const sx of [-1, 1]) K.box(0.04, 0.5, gw + 0.4, dk, gx + sx * (gw / 2 + 0.2), CAPE.gantryTop + 0.25, gz, 0.01);
  K.box(gw + 0.4, 0.04, 0.04, dk, gx, CAPE.gantryTop + 0.48, gz - gw / 2 - 0.2, 0.01);
  for (const y of [3.4, 4.6]) K.box(1.5, 0.12, 0.3, steel, gx - 1.05, y, gz, 0.03);                  // swing arms
  for (const sz of [-0.18, 0.18]) K.box(0.04, GH - 0.3, 0.04, dk, gx + gw / 2 + 0.06, (GH - 0.3) / 2 + 0.16, gz + sz, 0.01);   // the ladder
  for (let y = 0.4; y < GH - 0.2; y += 0.28) K.box(0.03, 0.03, 0.36, dk, gx + gw / 2 + 0.06, y + 0.16, gz, 0.008);
  // fuel tanks, floodlights, the sign by the road
  for (const [x, z] of [[-3.9, -1.0], [-3.9, -2.4]]) {
    K.put(lathe([[0.001, 0], [0.5, 0], [0.55, 0.15], [0.55, 1.5], [0.4, 1.8], [0.001, 1.85]], 24), white, x, 0, z);
    K.put(new THREE.TorusGeometry(0.555, 0.04, 6, 24), red, x, 1.0, z, [Math.PI / 2, 0, 0]);
  }
  for (const [x, z] of [[-3.4, -4.4], [4.2, -4.0]]) {
    for (const sx of [-1, 1]) K.box(0.05, 3.6, 0.05, steel, x + sx * 0.12, 1.8, z, 0.01);
    for (let y = 0.5; y < 3.5; y += 0.6) K.box(0.28, 0.03, 0.03, steel, x, y, z, 0.01);
    K.box(0.9, 0.36, 0.2, dk, x, 3.75, z, 0.04);
    for (const lx of [-0.24, 0, 0.24]) K.put(new THREE.CircleGeometry(0.1, 14), GLOW(), x + lx, 3.75, z + 0.11).userData.noInk = true;
  }
  const S = K.sub(6.0, 0, 4.0, -0.5);              // off to the side: it used to stand right in front of the launch desk
  for (const sx of [-0.7, 0.7]) S.box(0.08, 1.6, 0.08, paint(PAL.bark), sx, 0.8, 0, 0.02);
  S.box(1.7, 0.6, 0.06, white, 0, 1.35, 0.02, 0.03);
  S.flat(1.6, 0.5, signMat('CAPE FAR SIDE · cargo launch', { bg: '#f3eee4', fg: '#2a2230', w: 640, h: 192, font: '400 $px ' + HAND }), 0, 1.35, 0.056);
  // the launch console's desk (screen + button are live, see launchConsole())
  const [cx, , cz] = CAPE.console, C = K.sub(cx, 0, cz, Math.atan2(cx - rx, cz - rz));   // the operator faces the rocket
  C.box(1.1, 0.85, 0.6, paint(0x6f7d92), 0, 0.43, 0, 0.05);
  C.box(1.16, 0.08, 0.66, white, 0, 0.87, 0, 0.03);
  K.g.userData.floor = (x, z) => Math.hypot(x - rx, z - rz) < 3.35 ? 0.16 : null;
  K.g.userData.solids = [[[gx, gz], 0.75], [[-3.9, -1.7], 1.2], [[cx, cz], 0.55]];
  return K.g;
}
// the cargo rocket: a fat cream body, red bands, fins, portholes, a nozzle
export function cargoRocket() {
  const g = new THREE.Group(), K = kit(g);
  const cream = paint(0xf3ead7), red = paint(0xd8573f), dk = DARK();
  K.put(lathe([[0.001, 0.3], [0.48, 0.3], [0.6, 0.7], [0.62, 3.2], [0.55, 3.9], [0.36, 4.6], [0.14, 5.1], [0.001, 5.25]], 28), cream, 0, 0, 0);
  for (const y of [1.1, 2.6]) K.put(new THREE.TorusGeometry(0.62, 0.05, 6, 28), red, 0, y, 0, [Math.PI / 2, 0, 0]);
  K.put(lathe([[0.001, 0], [0.36, 0], [0.42, 0.06], [0.3, 0.3], [0.001, 0.32]], 20), dk, 0, 0, 0);
  for (let k = 0; k < 3; k++) {
    const fin = extrude(shape([[0, 0], [0.75, -0.25], [0.7, 0.35], [0, 1.25]]), 0.07, 0.025);
    const m = K.put(fin, red, 0, 0.35, 0); m.rotation.y = k * Math.PI * 2 / 3;
    m.geometry.translate(0.5, 0, -0.035);
  }
  for (const y of [3.3, 2.1]) {
    K.put(new THREE.TorusGeometry(0.15, 0.035, 6, 18), dk, 0, y, 0.6);
    K.put(new THREE.CircleGeometry(0.13, 18), upperGlass(2), 0, y, 0.6).userData.noInk = true;
  }
  K.flat(0.3, 1.0, paint(0xffffff, { hatch: 0, map: canvasTex(96, 320, (c, w, h) => {
    c.fillStyle = '#f3ead7'; c.fillRect(0, 0, w, h); c.font = `700 52px ${SCRIPT}`; c.fillStyle = '#d8573f'; c.textAlign = 'center';
    [...'CARGO'].forEach((ch, i) => c.fillText(ch, w / 2, 56 + i * 60));
  }) }), 0.0, 1.6, -0.625, [0, Math.PI, 0]);
  return ink(g, 'heavy');
}
// the console's live parts: a screen that shows the count, a big red button under a flip cover
export function launchConsole() {
  const g = new THREE.Group(), K = kit(g);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (text, col = '#7fe0a8') => { const c = cv.getContext('2d'); c.fillStyle = '#1c2430'; c.fillRect(0, 0, 256, 128); c.font = `700 64px ${SCRIPT}`; c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 128, 66); tex.needsUpdate = true; };
  draw('ARMED', '#f2d27a');
  const dark = paint(0x3a3340);
  K.box(0.7, 0.42, 0.08, paint(0x3a3340), 0, 1.15, -0.2, 0.03, [-0.35, 0, 0]);
  K.flat(0.62, 0.34, paint(0xffffff, { map: tex, hatch: 0 }), 0, 1.16, -0.155, [-0.35, 0, 0]);
  K.put(lathe([[0.001, 0], [0.13, 0], [0.13, 0.06], [0.001, 0.06]], 20), dark, 0.32, 0.9, 0.12);
  const btn = K.put(lathe([[0.001, 0], [0.09, 0], [0.11, 0.05], [0.08, 0.1], [0.001, 0.11]], 20), paint(0xe2483a, { emissive: 0x7a1710 }), 0.32, 0.96, 0.12);
  K.put(new THREE.CylinderGeometry(0.125, 0.13, 0.12, 20, 1, true), dark, 0.32, 1.03, 0.12);   // guard collar
  const cover = K.box(0.27, 0.02, 0.27, paint(0xe4b84f, { opacity: 0.7 }), 0.32, 1.1, 0.12, 0.01);
  ink(g, 'mid');
  g.userData = { draw, btn, cover };
  return g;
}
// a crate for one painting, its front a lid that can pop off to show the canvas
export function paintingCrate(i) {
  const g = new THREE.Group(), K = kit(g);
  const wood = paint(0xc8a47c), dkw = paint(0x9a744e);
  K.box(1.2, 0.95, 0.2, wood, 0, 0.5, -0.04, 0.02);
  const lid = new THREE.Group(); g.add(lid);
  const L = kit(lid);
  L.box(1.2, 0.95, 0.04, wood, 0, 0.5, 0.08, 0.015);
  for (const y of [0.18, 0.82]) L.box(1.22, 0.1, 0.05, dkw, 0, y, 0.11, 0.015);
  L.box(0.1, 0.9, 0.05, dkw, -0.55, 0.5, 0.11, 0.015, [0, 0, 0.0]);
  L.flat(0.9, 0.3, signMat('CATERING — CAPE FAR SIDE', { bg: '#c8a47c', fg: '#3a2a20', border: false, w: 512, h: 128, font: '400 $px ' + HAND }), 0, 0.5, 0.136);
  const art = K.flat(0.98, 0.74, paint(0x5a4632), 0, 0.5, 0.065);
  ink(g, 'fine');
  g.userData = { lid, art, i };
  return g;
}

// ── finishing: merge per material, bend onto the planet, ink ─────────────────
// Bake every mesh into the group's frame and merge by material, so a shop
// costs a handful of draws instead of hundreds.
// plain gouache (paint() with a flat colour — no texture, no glow, opaque) differs from part to
// part only by its colour: those parts bake together, the colour carried per vertex, into one
// mesh per kind of paint (hatch, side, ramp) instead of one per colour. A shop that was ~20
// draws is ~3, and it looks the same (the toon shader multiplies the vertex colour in exactly
// where the material's colour went). Materials some code still reaches for afterwards (the
// train's roofs, which lift off) keep their own mesh.
const _SOFT = () => paint(0xffffff, { soft: true }).gradientMap;
function plainPaint(m, keep) {
  return m && m.isMeshToonMaterial && m.userData.hatch != null && !m.map && !m.vertexColors && !m.transparent && (m.opacity ?? 1) === 1 &&
    !(m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) && !keep.has(m);
}
function bake(g, roots = [g]) {
  g.updateMatrixWorld(true);
  const inv = g.matrixWorld.clone().invert(), buckets = new Map(), m4 = new THREE.Matrix4();
  const keepMats = new Set([g, ...roots].flatMap(r => r.userData?.roofMats || []));
  for (const r of roots) r.updateMatrixWorld(true);
  const foots = [], fp = new THREE.Vector3();
  for (const r of roots) r.traverse(o => {
    if (o.userData.foot) { fp.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv); foots.push([fp.x, fp.z, o.userData.foot]); return; }
    if (!o.isMesh || o.userData.isInk) return;
    const geo = o.geometry.clone().applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
    const noInk = !!o.userData.noInk, M = o.material, vc = plainPaint(M, keepMats);
    const key = (vc ? `vc|${M.side}|${M.userData.hatch}|${M.gradientMap === _SOFT() ? 's' : ''}` : M.uuid) + (noInk ? ':n' : '');
    if (!buckets.has(key)) buckets.set(key, { mat: vc ? paint(0xffffff, { vertexColors: true, hatch: M.userData.hatch, side: M.side, soft: M.gradientMap === _SOFT() }) : M, noInk, geos: [] });
    for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal' && !(n === 'uv' && M.map) && !(n === 'color' && M.vertexColors)) geo.deleteAttribute(n);
    if (vc) { const c = M.color, n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
    if (o.material.map && !geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    for (const k of Object.keys(geo.morphAttributes)) delete geo.morphAttributes[k];
    buckets.get(key).geos.push(geo);
  });
  const ud = g.userData;
  if (foots.length) ud.foots = foots;
  const out = new THREE.Group();
  out.userData = ud;
  for (const { mat, noInk, geos } of buckets.values()) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.userData.noInk = noInk;
    out.add(m);
  }
  return out;
}
// lay every vertex onto the ground under it: on level ground that is the
// planet's curve (a flat slab would float at its ends); where the terrain
// rises or dips (the museum's levelled plane runs into Main Street) it
// follows that too, the way the road ribbons do. The ground is sampled on a
// small grid in the building's frame and read back bilinearly.
// Long faces (a platform top, a parking lot) are split first: this only
// moves vertices, and a slab with none in its middle would stay flat there.
const _tess = new TessellateModifier(1.6, 6);
// (landscaping laid on the drawn ground: fine enough that its paving bends with every facet of the
// planet mesh — ~0.75 between vertices — or the ground pokes up through a long flat triangle)
const _tessFine = new TessellateModifier(0.35, 12);
function conform(g, sink, groundAt = radiusAt) {
  g.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const m of g.children) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
  const exact = groundAt !== radiusAt;
  const S = exact ? 0.15 : 0.3, x0 = box.min.x - S, z0 = box.min.z - S;
  const nx = Math.ceil((box.max.x - x0) / S) + 2, nz = Math.ceil((box.max.z - z0) / S) + 2;
  const grid = new Float32Array(nx * nz), v = new THREE.Vector3(), inv = g.matrixWorld.clone().invert();
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    v.set(x0 + i * S, 0, z0 + k * S).applyMatrix4(g.matrixWorld).normalize();
    v.multiplyScalar(groundAt(v)).applyMatrix4(inv);
    let y = v.y;
    // (exact: find the ground straight below the grid point along the group's OWN up — the
    // radial line through it leans away from the group's up further out, and on a slope the
    // height it reads belongs to a point beside this one)
    if (exact) for (let it = 0; it < 3; it++) {
      v.set(x0 + i * S, y, z0 + k * S).applyMatrix4(g.matrixWorld);
      const r = v.length(), dg = groundAt(v.clone().normalize()) - r;
      v.applyMatrix4(inv);
      y += dg / Math.max(0.5, Math.cos(Math.atan2(Math.hypot(x0 + i * S, z0 + k * S), r)));
    }
    grid[i * nz + k] = y;
  }
  const at = (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / S)), fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / S));
    const i = Math.floor(fx), k = Math.floor(fz), u = fx - i, w = fz - k;
    return (grid[i * nz + k] * (1 - u) + grid[(i + 1) * nz + k] * u) * (1 - w) + (grid[i * nz + k + 1] * (1 - u) + grid[(i + 1) * nz + k + 1] * u) * w;
  };
  for (const m of g.children) {
    m.geometry = (exact ? _tessFine : _tess).modify(m.geometry);
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + at(p.getX(i), p.getZ(i)) - sink);
    p.needsUpdate = true;
    m.geometry.computeBoundingSphere();
    m.geometry.computeBoundingBox();
  }
}
// set a built group down at direction d facing `yaw`, bent and (unless it'll be
// batched with its neighbours) inked; returns the placed group
// (drawn: lay it onto the planet mesh as drawn rather than the exact terrain — landscaping, so
// paving and planting never hover where the ground curves between the mesh's vertices)
export function placeOnPlanet(raw, d, yaw, { weight = 'mid', sink = 0.04, inked = true, drawn = false, upright = false } = {}) {
  // its plants (trees, bushes, planters) are checked where they'll stand: none on a road or rail
  settle(raw, d, 0.25, sink, yaw); placeOnPlanet.pruned = (placeOnPlanet.pruned || 0) + pruneDeco(raw);
  const g = bake(raw);
  // (upright: a small tall thing — a sign, a post — stands plumb on the lowest ground under its
  // feet instead; laid on vertex by vertex, its top would lean with the slope and the curve)
  settle(g, d, upright ? 0.45 : 0.25, sink, yaw);
  if (!upright) conform(g, sink, drawn ? drawnGroundAt : radiusAt);
  if (!upright) g.userData.conform = sink;     // floors on it read heights above the terrain
  // (its hulls merge into one draw — unless parts of it are shown/hidden on their own: the
  // train's roofs lift off while you're inside)
  return inked ? ink(g, weight, { merge: !g.userData.roofMats }) : g;
}
// batch placed buildings that share materials (a street of shops) into one
// mesh per material in world space: a street costs what one shop used to
export function batchPlaced(groups, weight = 'mid') {
  const g = bake(new THREE.Group(), groups);
  for (const m of g.children) { m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox(); }
  return ink(g, weight, { merge: true });
}

// ── Lantern Park: a round town park (where a dome and a spur road used to be) ─────────
// A lawn with a pond in the middle (a stone rim, lily pads, a little spout), a gravel ring
// path round it and four paths out to the edge, flower beds between them, trees, benches
// facing the water and two lamps. Local frame: y up; it all lies within r 4.7. The people
// (a reader on a bench, strollers on the ring) are park.js. userData.ring / benches tell
// park.js where to walk and sit; foots stop the walker at the pond, trees and benches.
export const PARK = { R: 4.7, POND: 1.25, RING: 2.85, PATH: 0.62 };
export function parkGarden() {
  const K = kit(), R = rng(9127), { R: PR, POND, RING, PATH } = PARK;
  const lawn = paint(PAL.meadow), gravel = paint(0xe2d3b0, { hatch: 0 }), stone = paint(0xcfc4ae), soil = paint(0x8a6a52, { hatch: 0 });
  const water = paint(PAL.water, { hatch: 0 }), pad = paint(0x6f9a5a, { hatch: 0 });
  // (lawn and gravel ride well above the terrain: laid on at their vertices, the coarse ground
  // between them bulged through)
  for (const m of [lawn, gravel]) { m.polygonOffset = true; m.polygonOffsetFactor = m === gravel ? -4 : -2; m.polygonOffsetUnits = m.polygonOffsetFactor; }
  const flat = (geo, mat, y) => { geo.rotateX(-Math.PI / 2); const m = K.put(geo, mat, 0, y, 0); m.userData.noInk = true; return m; };
  flat(new THREE.CircleGeometry(PR, 64, 0, Math.PI * 2), lawn, 0.07);
  // the gravel: the ring round the pond, and four paths out to the edge (N, S, E, W)
  flat(new THREE.RingGeometry(RING - PATH / 2, RING + PATH / 2, 72, 2), gravel, 0.1);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, len = PR - RING, cx = Math.sin(a) * (RING + len / 2), cz = Math.cos(a) * (RING + len / 2);
    const g = new THREE.PlaneGeometry(PATH, len + 0.2, 1, 4); g.rotateX(-Math.PI / 2); g.rotateY(a);
    const m = K.put(g, gravel, cx, 0.1, cz); m.userData.noInk = true;
  }
  // the pond: a raised stone rim, the water a touch below it, lily pads, a spout in the middle
  K.put(lathe([[POND - 0.02, 0], [POND + 0.2, 0], [POND + 0.22, 0.2], [POND + 0.12, 0.26], [POND - 0.04, 0.24], [POND - 0.05, 0.05]], 48), stone, 0, 0, 0);
  flat(new THREE.CircleGeometry(POND, 48), water, 0.17);
  for (let k = 0; k < 6; k++) {
    const a = R() * Math.PI * 2, r = 0.45 + R() * 0.6, g = new THREE.CircleGeometry(0.12 + R() * 0.06, 12, 0.3, Math.PI * 2 - 0.6);
    g.rotateZ(R() * 6); flat(g, pad, 0.18).position.set(Math.sin(a) * r, 0.18, Math.cos(a) * r);
  }
  K.put(lathe([[0.001, 0], [0.22, 0], [0.24, 0.12], [0.12, 0.2], [0.09, 0.5], [0.2, 0.56], [0.001, 0.6]], 18), stone, 0, 0.12, 0);
  for (let k = 0; k < 5; k++) {                                         // the spout's water: a little splash of drops
    const a = k / 5 * Math.PI * 2;
    K.put(new THREE.SphereGeometry(0.06, 8, 6), paint(0xd8eef0, { hatch: 0 }), Math.sin(a) * 0.16, 0.66 + (k % 2) * 0.06, Math.cos(a) * 0.16).userData.noInk = true;
  }
  K.foot(0, 0, POND + 0.3);
  // flower beds between the paths: a stone kerb, soil, and dots of colour
  const COLS = [0xe8604c, 0xe1b95c, 0xf6eedb, 0xdc9e9a, 0x8f7ae8];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4, r = RING + 1.0, bx = Math.sin(a) * r, bz = Math.cos(a) * r;
    K.put(lathe([[0.62, 0], [0.7, 0], [0.7, 0.14], [0.62, 0.14]], 28), stone, bx, 0, bz);
    K.put(lathe([[0.001, 0.1], [0.62, 0.1], [0.6, 0.14], [0.001, 0.15]], 28), soil, bx, 0, bz);
    for (let f = 0; f < 14; f++) {
      const fa = R() * Math.PI * 2, fr = Math.sqrt(R()) * 0.5;
      K.put(new THREE.SphereGeometry(0.06, 8, 6), paint(COLS[(f + k) % COLS.length], { hatch: 0 }), bx + Math.sin(fa) * fr, 0.2 + R() * 0.05, bz + Math.cos(fa) * fr);
    }
    const b = bush(0.32); b.position.set(bx, 0.12, bz); K.g.add(b);
    K.foot(bx, bz, 0.72);
  }
  // trees round the edge, between the beds and the paths
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + Math.PI / 8, r = PR - 0.6 + (k % 2) * 0.15;
    const t = tree({ s: 0.85 + R() * 0.3 }); t.position.set(Math.sin(a) * r, 0, Math.cos(a) * r); t.rotation.y = R() * 6; K.g.add(t);
    K.foot(Math.sin(a) * r, Math.cos(a) * r, 0.3);
  }
  // benches just inside the ring, facing the pond, one in each quarter
  const benches = [];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4, r = RING - PATH / 2 - 0.42;
    const b = parkBench(); b.position.set(Math.sin(a) * r, 0.0, Math.cos(a) * r); b.rotation.y = a + Math.PI; K.g.add(b);
    K.foot(Math.sin(a) * r, Math.cos(a) * r, 0.42);
    benches.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, a });
  }
  for (const a of [0.13, Math.PI + 0.13]) {                           // at two of the path entrances
    const r = RING + PATH / 2 + 0.2, l = lamp(); l.position.set(Math.sin(a) * r, 0, Math.cos(a) * r); K.g.add(l);
    K.foot(Math.sin(a) * r, Math.cos(a) * r, 0.15);
  }
  K.g.userData.park = { ring: RING, benches };
  return K.g;
}

// ── The Library (Janelle's bookshelf project): the building IS a bookcase. A brick
// reading-room behind a giant timber bookcase front, its shelves stacked with house-sized
// books (spines, gilt bands, title labels, one leaning, a bookend), the door set into the
// bottom shelf under an arched fanlight, an open book on the roof for a sign ──
export function bookLibrary() {
  const K = kit(), R = rng(4471);
  const W = 3.4, D = 2.2, H = 2.75, FZ = 1.0;                 // body; its front face at z = FZ
  const brick = paint(0xb8664a), wood = paint(0x8a5a3a), woodD = paint(0x6e452c), trim = paint(0xfffaf0), dk = DARK();
  // the reading room: brick body, stone plinth, a cornice, a slate hipped roof
  K.box(W + 0.12, 0.18, D + 0.12, paint(0xd8cab0), 0, 0.09, FZ - D / 2, 0.04);
  K.box(W, H, D, brick, 0, H / 2 + 0.1, FZ - D / 2, 0.06);
  const cor = K.sub(0, H + 0.05, FZ - D + 0.02, Math.PI); cor.put(prism(CORNICE, W), trim, 0, 0, 0);
  for (const sd of [-1, 1]) {
    const S = K.sub(sd * W / 2, 0.1, FZ - D / 2, sd * Math.PI / 2);
    for (const x of [-0.5, 0.5]) windowAt(S, { x, y: 0.75, w: 0.4, h: 1.2, arch: true, frame: trim, glass: upperGlass(2), cols: 2, rows: 3, hood: 'key' });
    S.put(prism(CORNICE, D), trim, 0, H - 0.05, 0);
  }
  K.put(hipRoof(W + 0.1, D + 0.1, 0.75, 1), paint(PAL.roofSlate), 0, H + 0.28, FZ - D / 2);
  // the bookcase front: sides, plinth, two shelves, a crowned top with the name board
  const CW = W + 0.3, CD = 0.5, CZ = FZ + CD / 2 - 0.05, TOP = H + 0.35, SH = [0.22, 1.5];
  for (const s of [-1, 1]) K.box(0.16, TOP, CD, wood, s * (CW / 2 - 0.08), TOP / 2, CZ, 0.04);
  K.box(CW, 0.22, CD + 0.06, woodD, 0, 0.11, CZ + 0.03, 0.04);
  K.box(CW - 0.1, 0.1, CD, wood, 0, SH[1] - 0.05, CZ, 0.03);
  K.box(CW - 0.2, 0.06, 0.04, woodD, 0, SH[1] - 0.12, CZ + CD / 2, 0.015);   // shelf lip
  K.box(CW + 0.16, 0.42, CD + 0.12, wood, 0, TOP + 0.05, CZ + 0.02, 0.05);
  K.put(prism(CORNICE.map(([a, b]) => [a * 0.8, b * 0.8]), CW + 0.3), woodD, 0, TOP + 0.26, CZ + CD / 2 + 0.04);
  K.flat(CW * 0.7, 0.3, signMat('THE LIBRARY', { gold: true, bg: '#5a3826', font: '700 $px ' + SCRIPT, w: 768, h: 112 }), 0, TOP + 0.05, CZ + CD / 2 + 0.085);
  K.box(CW - 0.32, TOP - SH[1] - 0.25, 0.04, paint(0x4a2e22), 0, (TOP + SH[1]) / 2 - 0.1, FZ + 0.01, 0.01);   // shadowed back of the case
  K.box(CW - 0.32, SH[1] - SH[0] - 0.12, 0.04, paint(0x4a2e22), 0, (SH[0] + SH[1]) / 2 - 0.05, FZ + 0.01, 0.01);
  // a giant book: rounded spine, two gilt bands, a cream title label
  const COLS = [0xc4553e, 0x3f5872, 0x5f8a5a, 0xe2b04a, 0x8f6aa8, 0xd97f6a, 0x2f6f6a, 0x9a3b4a, 0x4f7fb0];
  const book = (x, y, bw, bh, lean = 0) => {
    const c = COLS[Math.floor(R() * COLS.length)], B = K.sub(x, y, CZ + 0.02);
    B.g.rotation.z = lean;
    B.box(bw, bh, CD - 0.12, paint(c), 0, bh / 2, 0, Math.min(0.05, bw * 0.22));
    const band = paint(PAL.gold, { hatch: 0 }), bz = (CD - 0.12) / 2 + 0.005;
    for (const t of [0.1, 0.9]) B.box(bw + 0.01, 0.035, 0.03, band, 0, bh * t, bz - 0.01, 0.01);
    B.box(bw * 0.62, bh * 0.28, 0.02, paint(0xf6eedb), 0, bh * 0.55, bz, 0.008);
    B.box(bw * 0.4, 0.02, 0.012, dk, 0, bh * 0.58, bz + 0.012, 0.004);
    B.box(bw * 0.3, 0.02, 0.012, dk, 0, bh * 0.5, bz + 0.012, 0.004);
    return bw;
  };
  const fill = (x0, x1, y, hMax, leanEnd = 0) => {
    let x = x0;
    while (x < x1 - 0.12) {
      const bw = Math.min(x1 - x, 0.16 + R() * 0.12), bh = hMax * (0.72 + R() * 0.28);
      if (x1 - x - bw < 0.12) { book(x + bw / 2, y, bw, bh); break; }
      book(x + bw / 2, y, bw, bh); x += bw + 0.012;
    }
    if (leanEnd) {                                              // one book leaning on the last, and a bookend
      book(x1 + leanEnd * 0.06, y, 0.17, hMax * 0.9, -leanEnd * 0.32);
    }
  };
  const inner = CW / 2 - 0.18;
  // top shelf: a full run of books, a couple leaning, a brass bookend
  fill(-inner, inner - 0.55, SH[1], TOP - SH[1] - 0.4, 1);
  K.box(0.06, 0.4, 0.3, paint(PAL.gold, { hatch: 0 }), inner - 0.06, SH[1] + 0.2, CZ, 0.02);
  K.box(0.24, 0.05, 0.3, paint(PAL.gold, { hatch: 0 }), inner - 0.15, SH[1] + 0.025, CZ, 0.015);
  // bottom shelf: books either side of the door
  const DW = 0.92;
  fill(-inner, -DW / 2 - 0.12, SH[0], SH[1] - SH[0] - 0.2);
  fill(DW / 2 + 0.12, inner, SH[0], SH[1] - SH[0] - 0.2);
  // the door: a framed doorway with an arched fanlight, double panelled doors, brass knobs
  const DZ = FZ + 0.03;
  for (const s of [-1, 1]) K.box(0.1, 1.15, 0.12, trim, s * (DW / 2 + 0.02), 0.2 + 0.575, DZ + 0.04, 0.02);
  K.box(DW + 0.14, 0.1, 0.14, trim, 0, 1.36, DZ + 0.04, 0.02);
  const fan = new THREE.Shape(); fan.moveTo(DW / 2 - 0.02, 0); fan.absarc(0, 0, DW / 2 - 0.02, 0, Math.PI, false); fan.lineTo(DW / 2 - 0.02, 0);
  K.put(extrude(fan, 0.04, 0.01), paint(0xf2d48a, { hatch: 0 }), 0, 1.0, DZ);
  for (let k = 1; k < 4; k++) { const a = k / 4 * Math.PI; K.box(0.025, DW / 2 - 0.06, 0.02, trim, Math.cos(a) * (DW / 4 - 0.01), 1.0 + Math.sin(a) * (DW / 4 - 0.01), DZ + 0.06, 0.006, [0, 0, a - Math.PI / 2]); }
  const arcG = new THREE.TorusGeometry(DW / 2, 0.05, 6, 20, Math.PI); K.put(arcG, trim, 0, 1.0, DZ + 0.05);
  K.box(DW - 0.04, 0.05, 0.06, trim, 0, 1.0, DZ + 0.03, 0.01);
  for (const s of [-1, 1]) {
    K.box(DW / 2 - 0.04, 0.78, 0.06, paint(0x3f5872), s * (DW / 4 - 0.01), 0.6, DZ + 0.02, 0.02);
    for (const y of [0.42, 0.78]) K.box(DW / 2 - 0.16, 0.26, 0.03, paint(0x34496a), s * (DW / 4 - 0.01), y, DZ + 0.06, 0.015);
    K.put(new THREE.SphereGeometry(0.03, 8, 6), paint(PAL.gold, { hatch: 0 }), s * 0.06, 0.6, DZ + 0.08);
  }
  K.box(DW + 0.4, 0.08, 0.36, paint(0xd8cab0), 0, 0.26, CZ + CD / 2 + 0.12, 0.03);    // the step
  // on the roof: a giant open book, pages fanned, a ribbon marker
  const OB = K.sub(0, H + 0.85, FZ - D / 2 + 0.05);
  for (const s of [-1, 1]) {
    const pg = shape([[0, 0], [s * 0.62, 0.1], [s * 0.66, 0.16], [s * 0.04, 0.08]]);
    const cover = OB.put(extrude(pg, 0.9, 0.02), paint(0x9a3b4a), 0, 0, -0.45);
    const leaf = new THREE.Shape(); leaf.moveTo(0, 0.06); leaf.quadraticCurveTo(s * 0.3, 0.3, s * 0.6, 0.2); leaf.lineTo(s * 0.6, 0.13); leaf.quadraticCurveTo(s * 0.3, 0.2, 0, 0.0);
    OB.put(extrude(leaf, 0.8, 0.015), paint(0xfaf3e2), 0, 0.02, -0.4);
    cover.userData._gpForce = true;
  }
  OB.box(0.04, 0.3, 0.02, paint(PAL.accent, { hatch: 0 }), 0.05, -0.08, 0.44, 0.005);
  OB.g.rotation.x = -0.35;
  lampPost(K, -2.15, 1.45, 1.5); lampPost(K, 2.15, 1.45, 1.5);
  return bake(K.g);                                           // one mesh per material: ~400 parts → a few dozen draws
}

// ── Janelle's project shops (the shops of ghanemja.github.io's Main Street) ─────────
// Each is a little walk-in shop themed on one project. It comes in two parts placed at
// the same spot: BASE (plinth, floor, the back and side walls up to waist height, everything
// inside, the props outside) stays; UPPER (the walls above the waist, the whole shopfront, the
// sign, the roof) is hidden while you're inside, so the camera looks down into the shop like
// a diorama instead of at a wall. Local frame: +Z faces the road (the door), y up.
const SH = { W: 5.6, D: 4.6, H: 3.0, LOW: 1.15, DOOR: 1.4, DOORH: 2.3, FY: 0.16, T: 0.2 };
function wrapText(c, text, maxW) {
  const out = []; let line = '';
  for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out;
}
// an information board: a title and a few lines of hand lettering
function boardMat(title, body, { bg = '#f6eedb', fg = INK, accent = '#e8604c', w = 512, h = 384 } = {}) {
  return paint(0xffffff, { hatch: 0, map: canvasTex(w, h, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = fg; c.globalAlpha = 0.6; c.lineWidth = 5; c.strokeRect(12, 12, w - 24, h - 24); c.globalAlpha = 1;
    c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = accent;
    fitText(c, title, '700 $px ' + SCRIPT, Math.round(h * 0.17), w - 60); c.fillText(title, w / 2, h * 0.07);
    c.fillStyle = fg; c.textAlign = 'left'; c.font = `400 ${Math.round(h * 0.075)}px ${HAND}`;
    let y = h * 0.3;
    for (const ln of wrapText(c, body, w - 70)) { c.fillText(ln, 35, y); y += h * 0.09; }
  }) });
}
// ── the cosy bits every shop interior shares ──
const WINDOW_GLOW = paint(0xfff0cc, { hatch: 0, emissive: 0xe8c890 });
const BEAM = paint(0x7a5236);
// a soft pool of lamplight on the floor (additive: it warms whatever it falls on)
const poolMat = (col = 0xffc980, op = 0.22) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
const POOL = poolMat(0xffc980, 0.13), POOL_DIM = poolMat(0xffb060, 0.09);
function lightPool(K, x, z, r = 0.9, mat = POOL) {
  const m = K.put(new THREE.CircleGeometry(r, 28), mat, x, SH.FY + 0.035, z, [-Math.PI / 2, 0, 0]); m.userData.noInk = true;
  const m2 = K.put(new THREE.CircleGeometry(r * 0.55, 24), mat, x, SH.FY + 0.04, z, [-Math.PI / 2, 0, 0]); m2.userData.noInk = true;
}
// a pendant lamp hanging from a beam: cord, a shade, a glowing bulb and its pool on the floor
function pendant(K, x, z, { shade = paint(0xe1b95c), y = 2.2, glow = 0xffd98a, pool = true } = {}) {
  K.box(0.02, SH.H - 0.14 - y, 0.02, DARK(), x, (SH.H - 0.14 + y) / 2, z, 0.005);
  K.put(lathe([[0.04, 0.22], [0.06, 0.2], [0.2, 0.02], [0.24, 0], [0.22, -0.02], [0.05, 0.16]], 18), shade, x, y - 0.2, z);
  K.put(new THREE.SphereGeometry(0.075, 12, 8), paint(0xfff6dc, { hatch: 0, emissive: glow }), x, y - 0.2, z).userData.noInk = true;
  if (pool) lightPool(K, x, z, 1.0);
}
// a rug: an oval (or a runner) with a border, painted
function rug(K, x, z, w, d, { a = '#a94848', b = '#e1b95c', c = '#f6eedb', oval = true, ry = 0 } = {}) {
  const mat = paint(0xffffff, { hatch: 0, map: canvasTex(256, 192, (g, W, H) => {
    g.fillStyle = a; if (oval) { g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 - 2, H / 2 - 2, 0, 0, 7); g.fill(); } else g.fillRect(0, 0, W, H);
    g.strokeStyle = b; g.lineWidth = 10; if (oval) { g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 - 18, H / 2 - 18, 0, 0, 7); g.stroke(); } else g.strokeRect(14, 14, W - 28, H - 28);
    g.fillStyle = c; for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(W / 2 + (i - 3) * 26, H / 2, 7, 0, 7); g.fill(); }
    g.strokeStyle = c; g.lineWidth = 3; if (oval) { g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 - 34, H / 2 - 34, 0, 0, 7); g.stroke(); }
  }) });
  // (an oval rug: the canvas corners are floor-coloured paint, so cut the plane to the ellipse)
  const geo = oval ? new THREE.CircleGeometry(0.5, 40) : new THREE.PlaneGeometry(1, 1);
  if (oval) { const uv = geo.attributes.uv, P = geo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, P.getX(i) + 0.5, P.getY(i) + 0.5); }
  const m = K.put(geo, mat, x, SH.FY + 0.025, z, [-Math.PI / 2, 0, ry]); m.scale.set(w, d, 1); m.userData.noInk = true;
  return m;
}
// a potted plant: a terracotta pot and a leafy clump
function plant(K, x, z, s = 1, leaf = paint(0x6f9a5a)) {
  K.put(lathe([[0.001, 0], [0.16 * s, 0], [0.2 * s, 0.3 * s], [0.22 * s, 0.32 * s], [0.001, 0.32 * s]], 14), paint(0xc4703e), x, SH.FY, z);
  for (let k = 0; k < 5; k++) { const a = k * 1.3; K.put(new THREE.SphereGeometry(0.16 * s, 10, 8), leaf, x + Math.cos(a) * 0.1 * s, SH.FY + (0.45 + (k % 2) * 0.15) * s, z + Math.sin(a) * 0.1 * s).scale.set(1, 1.3, 1); }
}
// a wall shelf on the back wall (y up the wall), its brackets underneath; returns the shelf top y
function wallShelf(K, x, y, w, mat = paint(0x8a6448), z = -SH.D / 2 + SH.T + 0.17) {
  K.box(w, 0.05, 0.32, mat, x, y, z, 0.015);
  for (const s of [-1, 1]) K.box(0.04, 0.2, 0.22, mat, x + s * (w / 2 - 0.12), y - 0.12, z - 0.04, 0.01);
  return y + 0.025;
}

// the shell every shop shares; returns where the walls are (for the walker's colliders)
function shopShell(B, U, { wall, trim, floor, stone = paint(0xd8cab0), glass = upperGlass(1), name, sign = {}, sideWin = true }) {
  const { W, D, H, LOW, DOOR, DOORH, FY, T } = SH, lowH = LOW - FY, upH = H - LOW;
  B.box(W + 0.36, FY, D + 0.36, stone, 0, FY / 2, 0, 0.04);                       // plinth
  B.box(W - 2 * T, 0.02, D - 2 * T, floor, 0, FY + 0.01, 0, 0.005);                 // the shop floor
  // the back and side walls stand full height whatever happens (inside, a room camera looks in
  // from the shopfront, which lifts away with the roof — see shopinterior.js)
  B.box(W, lowH, T, wall, 0, FY + lowH / 2, -D / 2 + T / 2); B.box(W, upH, T, wall, 0, LOW + upH / 2, -D / 2 + T / 2);
  for (const s of [-1, 1]) {
    B.box(T, lowH, D, wall, s * (W / 2 - T / 2), FY + lowH / 2, 0);
    B.box(T, upH, D, wall, s * (W / 2 - T / 2), LOW + upH / 2, 0);
  }
  // the waist rail: a trim band where the cutaway stops, so the low walls read as finished
  B.box(W + 0.06, 0.07, T + 0.06, trim, 0, LOW, -D / 2 + T / 2, 0.02);
  for (const s of [-1, 1]) B.box(T + 0.06, 0.07, D + 0.06, trim, s * (W / 2 - T / 2), LOW, 0, 0.02);
  // shopfront: piers either side of the door, each with a display window above the stall riser
  const pw = (W - DOOR) / 2, px = DOOR / 2 + pw / 2, fz = D / 2 - T / 2;
  for (const s of [-1, 1]) {
    U.box(pw, lowH, T, wall, s * px, FY + lowH / 2, fz);
    U.box(pw + 0.04, 0.07, T + 0.1, trim, s * px, LOW, fz, 0.02);
    U.box(pw, upH, T, wall, s * px, LOW + upH / 2, fz);
    U.box(pw - 0.36, 1.0, 0.08, trim, s * px, 1.82, D / 2 + 0.01, 0.03);
    U.flat(pw - 0.5, 0.86, glass, s * px, 1.82, D / 2 + 0.08);
    U.box(0.05, 0.86, 0.04, trim, s * px, 1.82, D / 2 + 0.1, 0.01);               // a glazing bar
  }
  U.box(DOOR + 0.02, H - DOORH, T, wall, 0, DOORH + (H - DOORH) / 2, fz);
  for (const s of [-1, 1]) {                                                        // door frame
    U.box(0.12, lowH, T + 0.08, trim, s * (DOOR / 2 + 0.02), FY + lowH / 2, fz, 0.03);
    U.box(0.12, DOORH - LOW, T + 0.08, trim, s * (DOOR / 2 + 0.02), LOW + (DOORH - LOW) / 2, fz, 0.03);
  }
  U.box(DOOR + 0.28, 0.12, T + 0.1, trim, 0, DOORH + 0.06, fz, 0.03);
  if (sideWin) for (const s of [-1, 1]) {
    B.box(0.08, 0.9, 1.3, trim, s * (W / 2 + 0.01), 1.85, -0.4, 0.03);
    B.flat(1.15, 0.76, glass, s * (W / 2 + 0.055), 1.85, -0.4, [0, s * Math.PI / 2, 0]);
    // …and from inside: a deep sill, a frame and a warm daylit pane
    const ix = s * (W / 2 - T - 0.005);
    B.box(0.1, 0.92, 1.32, trim, ix, 1.85, -0.4, 0.03);
    B.flat(1.12, 0.74, WINDOW_GLOW, ix - s * 0.056, 1.85, -0.4, [0, -s * Math.PI / 2, 0]);
    B.box(0.22, 0.05, 1.36, trim, ix - s * 0.08, 1.4, -0.4, 0.015);
    B.box(0.03, 0.74, 0.04, trim, ix - s * 0.06, 1.85, -0.4, 0.01);
  }
  // ceiling beams: the room has a top when the roof lifts off
  for (const z of [-1.45, 0, 1.45]) B.box(W - 2 * T, 0.14, 0.16, BEAM, 0, H - 0.07, z, 0.03);
  U.box(W + 0.24, 0.16, D + 0.24, trim, 0, H + 0.08, 0, 0.05);                      // cornice
  if (name) {                                                                       // the fascia sign
    U.box(W * 0.78, 0.52, 0.08, trim, 0, H - 0.3, D / 2 + 0.05, 0.03);
    U.flat(W * 0.78 - 0.1, 0.44, signMat(name, { bg: '#2a2230', fg: '#f6eedb', gold: true, w: 640, h: 96, ...sign }), 0, H - 0.3, D / 2 + 0.12);
  }
  B.box(DOOR + 0.8, 0.1, 0.62, stone, 0, 0.05, D / 2 + 0.48, 0.03);                // the stoop
  // colliders: the walls as a row of posts, a gap at the door (the car can't fit: r 0.42)
  const walls = [];
  for (let x = -W / 2 + 0.25; x <= W / 2 - 0.2; x += 0.5) { walls.push([x, -D / 2 + 0.1, 0.42]); if (Math.abs(x) > DOOR / 2 + 0.3) walls.push([x, D / 2 - 0.1, 0.42]); }
  for (let z = -D / 2 + 0.6; z <= D / 2 - 0.5; z += 0.5) for (const s of [-1, 1]) walls.push([s * (W / 2 - 0.1), z, 0.42]);
  return { walls, fz };
}
// a freestanding info stand inside (two legs, a tilted board)
function infoStand(K, x, z, ry, mat, frame = DARK()) {
  const S = K.sub(x, 0, z, ry);
  for (const s of [-1, 1]) S.box(0.06, 1.2, 0.06, frame, s * 0.5, SH.FY + 0.6, 0, 0.02);
  const b = S.sub(0, SH.FY + 1.25, 0); b.g.rotation.x = -0.18;
  b.box(1.16, 0.84, 0.05, frame, 0, 0, -0.03, 0.02);
  b.flat(1.08, 0.76, mat, 0, 0, 0.03);
  return S;
}

// ── the six shops ──
function shopBehaviors(B, U) {                 // The Proving Ground: a test hangar, NVIDIA green
  const green = paint(0x76b900), dark = paint(0x3a3f47), steel = paint(0x9aa3ad), crate = paint(0xc8a47c), dk = DARK();
  const { walls } = shopShell(B, U, { wall: dark, trim: green, floor: paint(0xcfd3d6), name: 'BEHAVIOR SEARCH', sign: { bg: '#2a2f36', fg: '#b8f05a', gold: false } });
  // the barrel roof of a test hangar, ribbed
  const roofG = new THREE.CylinderGeometry(SH.D / 2 + 0.16, SH.D / 2 + 0.16, SH.W + 0.3, 36, 1, false, 0, Math.PI);
  roofG.rotateZ(Math.PI / 2);                    // axis along x; theta 0..π is the half above
  const roof = U.put(roofG, steel, 0, SH.H + 0.16, 0); roof.scale.y = 0.55;
  for (const x of [-2.2, -1.1, 0, 1.1, 2.2]) {
    const rib = U.put(new THREE.TorusGeometry(SH.D / 2 + 0.18, 0.05, 6, 28, Math.PI), green, x, SH.H + 0.16, 0, [0, Math.PI / 2, 0]); rib.scale.y = 0.55;
  }
  U.flat(2.4, 0.4, signMat('the proving ground', { bg: '#3a3f47', fg: '#e8f0dc', font: '400 $px ' + HAND, border: false, w: 512, h: 86 }), 0, SH.H + 0.5, SH.D / 2 + 0.19);
  // outside: the tilt ramp the objects slide down, a crate mid-slide and a ball rolling off
  const R = B.sub(SH.W / 2 + 1.35, 0, 0.6, 0);
  R.box(0.9, 0.08, 2.6, steel, 0, 0.7, 0, 0.02, [0.42, 0, 0]);
  for (const [z, h] of [[-1.0, 1.15], [0.2, 0.62]]) for (const s of [-1, 1]) R.box(0.07, h, 0.07, dk, s * 0.38, h / 2, z, 0.02);
  R.box(0.36, 0.36, 0.36, crate, 0, 0.98, -0.3, 0.04, [0.42, 0, 0]);
  R.put(new THREE.SphereGeometry(0.17, 18, 12), paint(0xe8604c), 0.1, 0.17, 1.55);
  // the drop rig: a frame with an object hanging ready to fall
  const Dg = B.sub(-SH.W / 2 - 1.2, 0, 0.4, 0);
  for (const s of [-1, 1]) Dg.box(0.08, 2.4, 0.08, green, s * 0.5, 1.2, 0, 0.02);
  Dg.box(1.1, 0.08, 0.1, green, 0, 2.4, 0, 0.02);
  Dg.box(0.02, 0.5, 0.02, dk, 0, 2.12, 0, 0.005);
  Dg.put(lathe([[0.001, 0], [0.16, 0], [0.18, 0.28], [0.13, 0.32], [0.001, 0.32]], 16), paint(0xf6eedb), 0, 1.55, 0);
  Dg.put(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24), paint(0xe1b95c), 0, 0.03, 0);
  // inside: the probe bench — a ramp with test objects lined up, a pusher, a results screen
  const T = B.sub(0, 0, -1.25, 0), fy = SH.FY;
  T.box(3.4, 0.08, 0.9, paint(0xe6e2da), 0, fy + 0.78, 0, 0.03);
  for (const [x, z] of [[-1.55, -0.35], [1.55, -0.35], [-1.55, 0.35], [1.55, 0.35]]) T.box(0.07, 0.78, 0.07, dk, x, fy + 0.39, z, 0.02);
  T.box(1.3, 0.05, 0.6, steel, -0.8, fy + 0.98, 0, 0.015, [0, 0, 0.3]);
  const objs = [[lathe([[0.001, 0], [0.09, 0], [0.1, 0.18], [0.001, 0.18]], 14), paint(0xdc9e9a), 0], [new THREE.SphereGeometry(0.1, 14, 10), paint(0xe8604c), 0.1],
    [lathe([[0.001, 0], [0.12, 0], [0.001, 0.26]], 14), paint(0xe1b95c), 0], [rb(0.18, 0.18, 0.18, 0.03), paint(0x7fb3a8), 0.09], [new THREE.TorusGeometry(0.09, 0.035, 8, 16), paint(0xb7a3c6), 0.125]];
  objs.forEach(([geo, mat, lift], i) => T.put(geo, mat, 0.2 + i * 0.32, fy + 0.82 + lift, 0.05));
  T.box(0.5, 0.12, 0.12, green, 1.55, fy + 0.95, 0.05, 0.03);                         // the pusher
  // results screen on a stand: bars of how far each thing slid
  const scr = B.sub(-1.6, 0, 0.6, 0.5);
  scr.box(0.06, 1.3, 0.06, dk, 0, fy + 0.65, 0, 0.02);
  scr.box(1.0, 0.66, 0.06, dk, 0, fy + 1.55, 0, 0.02);
  scr.flat(0.92, 0.58, paint(0xffffff, { hatch: 0, emissive: 0x1a2a10, map: canvasTex(256, 160, (c, w, h) => {
    c.fillStyle = '#1d232a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b8f05a'; c.font = `700 22px ${HAND}`; c.fillText('slid / rolled / tipped', 14, 26);
    [0.8, 0.45, 0.62, 0.25, 0.9, 0.35].forEach((v, i) => { c.fillStyle = i % 2 ? '#76b900' : '#b8f05a'; c.fillRect(20 + i * 38, h - 16 - v * 100, 26, v * 100); });
  }) }), 0, fy + 1.55, 0.06);
  infoStand(B, 1.55, 0.75, -0.5, boardMat('Behavior Search', 'Every one of NVIDIA’s 2,166 SimReady objects got the same pokes: pushed low, pushed high, tilted, dropped. Search them by how they move.', { accent: '#5a8c00' }));
  // ── the lab feel: hazard tape round the bench, a pegboard of test rigs, a server rack, cage lamps ──
  rug(B, 0, -1.2, 3.9, 1.35, { a: '#2a2f36', b: '#e1b95c', c: '#2a2f36', oval: false });
  { const pz = -SH.D / 2 + SH.T + 0.02, peg = paint(0xc8b48a);
    B.box(3.6, 1.0, 0.04, peg, 0, 2.05, pz + 0.02, 0.01);
    const R2 = rng(91);
    for (let i = 0; i < 9; i++) { const x = -1.5 + i * 0.37; B.box(0.04, 0.04, 0.08, dk, x, 2.4, pz + 0.06, 0.005);
      if (i % 3 === 0) B.put(new THREE.TorusGeometry(0.1, 0.02, 6, 16), steel, x, 2.22, pz + 0.07);
      else if (i % 3 === 1) B.box(0.06, 0.34, 0.03, paint([0xe8604c, 0x76b900, 0xe1b95c][i % 3]), x, 2.18, pz + 0.07, 0.01);
      else B.put(new THREE.SphereGeometry(0.07 + R2() * 0.03, 10, 8), paint([0x7fb3a8, 0xdc9e9a, 0xb7a3c6][i % 3]), x, 2.24, pz + 0.1); }
    B.flat(1.1, 0.26, signMat('TEST RIGS', { bg: '#2a2f36', fg: '#b8f05a', font: '700 $px ' + HAND, border: false, w: 256, h: 60 }), 0, 1.68, pz + 0.05); }
  { const rk = B.sub(2.35, 0, -0.25, -Math.PI / 2);
    rk.box(0.7, 1.9, 0.5, dark, 0, SH.FY + 0.95, 0, 0.03);
    for (let k = 0; k < 6; k++) rk.box(0.62, 0.22, 0.04, paint(0x22272e), 0, SH.FY + 0.3 + k * 0.27, 0.25, 0.01);
    for (let k = 0; k < 4; k++) rk.put(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), paint(0x22272e), 0.36, SH.FY + 1.7 - k * 0.12, 0.05 - k * 0.06, [Math.PI / 2, 0, 0]); }
  for (const [x, z] of [[-1.1, 0.1], [1.0, -0.9]]) pendant(B, x, z, { shade: green, y: 2.3, glow: 0xe8ffc8 });
  plant(B, -2.35, -1.85, 0.9, paint(0x5a8c00));
  walls.push(...[[-1.2, -1.25, 0.45], [0, -1.25, 0.45], [1.2, -1.25, 0.45], [-1.6, 0.6, 0.25], [1.55, 0.75, 0.3], [2.35, -0.25, 0.4]]);                          // the furniture is solid
  return walls;
}
function shopQR(B, U) {                        // The Map Room: a QR facade and a compass on the roof
  const navy = paint(0x2f4a6b), cream = paint(0xf3ead7), red = paint(0xd8573f), dk = DARK();
  const qrMat = paint(0xffffff, { hatch: 0, map: canvasTex(256, 256, (c, w, h, r) => {
    c.fillStyle = '#f6f1e6'; c.fillRect(0, 0, w, h); const n = 21, s = w / n;
    c.fillStyle = '#2a2230';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (r() > 0.52) c.fillRect(i * s, j * s, s + 0.5, s + 0.5);
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      c.fillStyle = '#f6f1e6'; c.fillRect((fx - 1) * s, (fy - 1) * s, 9 * s, 9 * s);
      c.fillStyle = '#2a2230'; c.fillRect(fx * s, fy * s, 7 * s, 7 * s); c.fillStyle = '#f6f1e6'; c.fillRect((fx + 1) * s, (fy + 1) * s, 5 * s, 5 * s);
      c.fillStyle = '#2a2230'; c.fillRect((fx + 2) * s, (fy + 2) * s, 3 * s, 3 * s);
    }
  }) });
  const { walls } = shopShell(B, U, { wall: cream, trim: navy, floor: paint(0xd9c29a), name: 'QR COMPASS', sign: { bg: '#2f4a6b', fg: '#f6eedb' } });
  // QR panels on the sides and on the stall risers under the windows
  for (const s of [-1, 1]) U.flat(1.2, 1.2, qrMat, s * (SH.W / 2 + 0.06), 1.9, 1.3, [0, s * Math.PI / 2, 0]);
  for (const s of [-1, 1]) { U.box(0.9, 0.9, 0.04, navy, s * 1.75, 0.66, SH.D / 2 + 0.02, 0.02); U.flat(0.8, 0.8, qrMat, s * 1.75, 0.66, SH.D / 2 + 0.07); }
  // a flat roof with the compass rose painted on it and a big needle on a mast
  U.box(SH.W - 0.1, 0.06, SH.D - 0.1, paint(0xd8cab0), 0, SH.H + 0.19, 0, 0.02);
  U.flat(2.6, 2.6, paint(0xffffff, { hatch: 0, map: canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#d8cab0'; c.fillRect(0, 0, w, h); c.translate(w / 2, h / 2);
    c.strokeStyle = '#2f4a6b'; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, 118, 0, 7); c.stroke();
    for (let k = 0; k < 8; k++) { c.rotate(Math.PI / 4); c.fillStyle = k % 2 ? '#2f4a6b' : '#d8573f'; c.beginPath(); c.moveTo(0, -112); c.lineTo(14, 0); c.lineTo(-14, 0); c.fill(); }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }) }), 0, SH.H + 0.23, 0, [-Math.PI / 2, 0, 0]);
  U.box(0.08, 1.4, 0.08, dk, 0, SH.H + 0.9, 0, 0.02);
  const needle = U.sub(0, SH.H + 1.6, 0, 0.6);
  needle.put(new THREE.OctahedronGeometry(0.5, 0), red, 0.45, 0, 0).scale.set(1, 0.18, 0.18);
  needle.put(new THREE.OctahedronGeometry(0.5, 0), cream, -0.45, 0, 0).scale.set(1, 0.18, 0.18);
  needle.put(new THREE.SphereGeometry(0.1, 12, 8), paint(0xe4b84f), 0, 0, 0);
  // inside: the map table — seven regions on a tiled slab, tiny company models, pixels falling into a code
  const fy = SH.FY, tb = B.sub(0, 0, -0.75, 0);
  tb.box(3.2, 0.12, 1.8, paint(0x8a6448), 0, fy + 0.78, 0, 0.04);
  for (const [x, z] of [[-1.45, -0.75], [1.45, -0.75], [-1.45, 0.75], [1.45, 0.75]]) tb.box(0.1, 0.78, 0.1, paint(0x6e452c), x, fy + 0.39, z, 0.02);
  const cols = [0x7fb3a8, 0xe1b95c, 0xdc9e9a, 0xb7a3c6, 0xa8b994, 0x93abc0, 0xd58b63], R = rng(77);
  cols.forEach((col, i) => {
    const x = -1.2 + (i % 4) * 0.8 + (i > 3 ? 0.4 : 0), z = i > 3 ? 0.4 : -0.35;
    tb.box(0.72, 0.08, 0.68, paint(col), x, fy + 0.88, z, 0.02);
    for (let k = 0; k < 3; k++) { const h = 0.08 + R() * 0.22; tb.box(0.1, h, 0.1, paint([0xf6eedb, 0x2a2230, 0xe8604c][k % 3]), x - 0.2 + k * 0.2, fy + 0.92 + h / 2, z + (R() - 0.5) * 0.3, 0.015); }
  });
  for (let k = 0; k < 6; k++) tb.box(0.07, 0.07, 0.07, k % 2 ? cream : dk, 1.3 - (k % 3) * 0.1, fy + 1.15 + k * 0.12, 0.62, 0.01);
  // a globe on a stand
  const gl = B.sub(-2.0, 0, 0.9, 0);
  gl.put(lathe([[0.001, 0], [0.22, 0], [0.05, 0.08], [0.04, 0.9], [0.001, 0.9]], 14), paint(0x6e452c), 0, fy, 0);
  gl.put(new THREE.SphereGeometry(0.3, 20, 14), paint(0x8fc3c9), 0, fy + 1.15, 0);
  gl.put(new THREE.TorusGeometry(0.34, 0.02, 6, 24), paint(0xe4b84f), 0, fy + 1.15, 0, [0, 0, 0.4]);
  infoStand(B, 1.7, 1.0, -0.6, boardMat('QR Compass', 'America’s biggest companies on a 3D map, each a little model. Tap one and it breaks into pixels that land on its QR code.', { accent: '#2f4a6b' }));
  // ── the explorer's den: a wall map, map rolls in a bin, a compass-rose rug, lantern light ──
  { const pz = -SH.D / 2 + SH.T + 0.02;
    B.box(3.9, 1.12, 0.06, paint(0x6e452c), 0, 2.1, pz + 0.02, 0.02);
    B.flat(3.75, 1.0, paint(0xffffff, { hatch: 0, map: canvasTex(512, 136, (c, w, h, r) => {
      c.fillStyle = '#efe2c2'; c.fillRect(0, 0, w, h); const cols = ['#7fb3a8', '#e1b95c', '#dc9e9a', '#b7a3c6', '#a8b994', '#93abc0', '#d58b63'];
      cols.forEach((col, i) => { c.fillStyle = col; c.beginPath(); const cx = 40 + i * 68, cy = 60 + (i % 2) * 18; for (let k = 0; k <= 10; k++) { const a = k / 10 * 7, rr = 26 + r() * 14; c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7); } c.fill(); });
      c.strokeStyle = '#2f4a6b'; c.globalAlpha = 0.35; c.lineWidth = 1; for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } c.globalAlpha = 1;
      c.fillStyle = '#2f4a6b'; c.font = '700 18px ' + HAND; c.fillText('the seven regions', 10, 128);
    }) }), 0, 2.1, pz + 0.06); }
  { const bin = B.sub(2.35, 0, -1.75, 0);
    bin.put(lathe([[0.001, 0], [0.24, 0], [0.26, 0.55], [0.001, 0.55]], 14), paint(0x8a6448), 0, SH.FY, 0);
    const R2 = rng(13);
    for (let k = 0; k < 6; k++) bin.put(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), paint([0xefe2c2, 0xe1d3b0, 0xf6eedb][k % 3]), (R2() - 0.5) * 0.25, SH.FY + 0.6, (R2() - 0.5) * 0.25, [(R2() - 0.5) * 0.4, 0, (R2() - 0.5) * 0.4]); }
  rug(B, 0, 1.35, 2.3, 1.2, { a: '#2f4a6b', b: '#e1b95c', c: '#d8573f' });
  for (const [x, z] of [[-1.0, -0.75], [1.0, -0.75]]) pendant(B, x, z, { shade: paint(0xc9a14a), y: 2.25 });
  plant(B, -2.35, -1.85, 1.0);
  walls.push(...[[-1.05, -0.75, 0.62], [0, -0.75, 0.62], [1.05, -0.75, 0.62], [-2.0, 0.9, 0.3], [1.7, 1.0, 0.3], [2.35, -1.75, 0.3], [-2.35, -1.85, 0.25]]);                          // the furniture is solid
  return walls;
}
function shopYarn(B, U) {                      // Pattern Haberdashery: a giant yarn ball on the roof
  const rose = paint(0xe7b2ad), cream = paint(0xf6eedb), plum = paint(0x8a4f6e), dk = DARK();
  const { walls } = shopShell(B, U, { wall: rose, trim: cream, floor: paint(0xd9b48f), name: 'YarnFlow', sign: { bg: '#8a4f6e', fg: '#f6eedb' }, glass: upperGlass(2) });
  // a striped awning over the shopfront
  const aw = paint(0xffffff, { hatch: 0, side: THREE.DoubleSide, map: canvasTex(128, 32, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f6eedb' : '#c4607e'; c.fillRect(i * 16, 0, 16, h); } }) });
  const awG = new THREE.PlaneGeometry(SH.W - 0.3, 0.9, 1, 1); awG.rotateX(-1.0);
  U.put(awG, aw, 0, 2.17, SH.D / 2 + 0.38);
  U.box(SH.W - 0.3, 0.12, 0.05, paint(0xc4607e), 0, 1.88, SH.D / 2 + 0.75, 0.02);
  // pitched roof (plum slates), the yarn ball sat on its ridge, two needles through it
  const pr = shape([[-(SH.D / 2 + 0.3), 0], [SH.D / 2 + 0.3, 0], [0, 1.25]]);
  const roofG = extrude(pr, SH.W + 0.3, 0.04); roofG.translate(0, 0, -(SH.W + 0.3) / 2); roofG.rotateY(Math.PI / 2);
  U.put(roofG, plum, 0, SH.H + 0.16, 0);
  // the ball rests on both slopes: its centre stands r/cos(pitch) over the ridge (it used to sit
  // 0.34 over it, half sunk in the slates)
  const run = SH.D / 2 + 0.3, rise = 1.25, ridge = SH.H + 0.16 + rise + 0.04, cosP = run / Math.hypot(run, rise);
  const roofY = (z) => ridge - rise * Math.abs(z) / run;              // the slates' top at z
  const ballY = ridge + (0.85 + 0.035) / cosP - 0.03, yarn = paint(0x7fb3a8);
  U.put(new THREE.SphereGeometry(0.85, 28, 18), yarn, 0.6, ballY, 0);
  for (let k = 0; k < 7; k++) U.put(new THREE.TorusGeometry(0.86, 0.035, 6, 36), paint(0x5f948a), 0.6, ballY, 0, [k * 0.45, k * 0.7, 0]);
  for (const s of [-1, 1]) U.put(new THREE.CylinderGeometry(0.04, 0.025, 2.4, 10), paint(0xe4b84f), 0.6 + s * 0.2, ballY + 0.5, 0, [0, 0, s * 0.5]);
  // the loose end trails down the roof
  const tr = new THREE.CatmullRomCurve3([[0.35, ballY - 0.72, 0.42], [-0.7, roofY(0.9) + 0.05, 0.9], [-1.5, roofY(1.6) + 0.05, 1.6], [-2.2, roofY(2.4) + 0.05, 2.4]].map(p => new THREE.Vector3(...p)));
  U.put(new THREE.TubeGeometry(tr, 24, 0.04, 6), yarn, 0, 0, 0);
  // inside: baskets of yarn, a mannequin in a striped scarf, a giant hook
  const fy = SH.FY, R = rng(31), yc = [0xe8604c, 0xe1b95c, 0x7fb3a8, 0xb7a3c6, 0xdc9e9a, 0xa8b994, 0x93abc0];
  for (const [bx, bz] of [[-1.9, -1.4], [-0.8, -1.55], [1.9, -1.4]]) {
    B.put(lathe([[0.001, 0], [0.42, 0], [0.48, 0.42], [0.44, 0.44], [0.001, 0.44]], 18), paint(0xc8a47c), bx, fy, bz);
    for (let k = 0; k < 5; k++) B.put(new THREE.SphereGeometry(0.17, 14, 10), paint(yc[Math.floor(R() * yc.length)]), bx + (R() - 0.5) * 0.45, fy + 0.5 + (k > 2 ? 0.12 : 0), bz + (R() - 0.5) * 0.45);
  }
  const mq = B.sub(0.7, 0, -1.35, 0);
  mq.put(lathe([[0.001, 0], [0.2, 0], [0.04, 0.06], [0.03, 0.75], [0.001, 0.75]], 12), dk, 0, fy, 0);
  mq.put(lathe([[0.001, 0], [0.2, 0.02], [0.26, 0.3], [0.2, 0.55], [0.24, 0.7], [0.08, 0.8], [0.001, 0.8]], 18), cream, 0, fy + 0.75, 0);
  const sc = paint(0xffffff, { hatch: 0, map: canvasTex(64, 16, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#e1b95c' : '#c4607e'; c.fillRect(i * 8, 0, 8, h); } }) });
  mq.put(new THREE.TorusGeometry(0.17, 0.06, 8, 18), sc, 0, fy + 1.45, 0, [Math.PI / 2, 0, 0]);
  mq.box(0.12, 0.55, 0.04, paint(0xc4607e), 0.1, fy + 1.15, 0.2, 0.02, [0.1, 0, 0.1]);
  infoStand(B, -1.6, 0.6, 0.5, boardMat('YarnFlow', 'Pick a pattern — a scarf, a coaster, an amigurumi ball — and watch it get made row by row, stitch by stitch, in 3D.', { accent: '#8a4f6e' }));
  B.put(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 10), paint(0xe4b84f), -SH.W / 2 + 0.42, fy + 0.8, -0.75, [0, 0, -0.16]);   // the giant hook, leant on the side wall (by the door it filled the room camera's foreground)
  // ── the cosy bit: a wall of yarn cubbies, granny-square bunting, a reading chair under a lamp ──
  const wood = paint(0xa77a52), woodD = paint(0x7a5236);
  { // cubbies across the back wall above the baskets: 7 × 3 pigeonholes, every one stuffed with yarn
    const z = -SH.D / 2 + SH.T + 0.18, x0 = -2.4, cw = 0.68, y0 = 1.2, ch = 0.42;
    B.box(cw * 7 + 0.08, 0.06, 0.36, woodD, 0, y0 - 0.03, z, 0.015);
    for (let r = 1; r <= 3; r++) B.box(cw * 7 + 0.08, 0.04, 0.36, wood, 0, y0 + r * ch - 0.02, z, 0.01);
    for (let c = 0; c <= 7; c++) B.box(0.04, ch * 3, 0.36, wood, x0 + c * cw, y0 + ch * 1.5, z, 0.01);
    const R2 = rng(57);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) {
      const n = 1 + Math.floor(R2() * 2.4);
      for (let k = 0; k < n; k++) B.put(new THREE.SphereGeometry(0.12 + R2() * 0.03, 12, 9), paint(yc[Math.floor(R2() * yc.length)]), x0 + c * cw + 0.22 + k * 0.2 - (n - 1) * 0.05, y0 + r * ch + 0.14, z + (R2() - 0.5) * 0.08);
    }
  }
  { // granny-square bunting, beam to beam across the room, sagging
    const gsq = (i) => paint(0xffffff, { hatch: 0, side: THREE.DoubleSide, map: canvasTex(48, 48, (c, w, h) => {
      const cols = ['#e8604c', '#e1b95c', '#7fb3a8', '#b7a3c6', '#dc9e9a', '#f6eedb'];
      for (let k = 0; k < 4; k++) { c.fillStyle = cols[(i + k) % cols.length]; c.fillRect(k * 6, k * 6, w - k * 12, h - k * 12); }
      c.strokeStyle = '#2a2230'; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
    }) });
    for (const [z0, z1, x] of [[-1.45, 1.45, -1.3], [-1.45, 1.45, 1.3]]) {
      for (let k = 0; k <= 12; k++) {
        const t = k / 12, z = z0 + (z1 - z0) * t, y = SH.H - 0.2 - 0.45 * Math.sin(Math.PI * t);
        if (k > 0 && k < 12 && k % 2 === 0) B.flat(0.18, 0.18, gsq(k + (x > 0 ? 3 : 0)), x, y - 0.12, z, [0, Math.PI / 2, Math.PI / 4]);
        if (k < 12) { const t2 = (k + 1) / 12, y2 = SH.H - 0.2 - 0.45 * Math.sin(Math.PI * t2), zz = z0 + (z1 - z0) * t2; B.put(new THREE.CylinderGeometry(0.008, 0.008, Math.hypot(zz - z, y2 - y), 4), paint(0xc4607e), x, (y + y2) / 2, (z + zz) / 2, [Math.atan2(zz - z, y2 - y), 0, 0]); }
      }
    }
  }
  { // the reading chair: a squashy armchair with a granny-square throw, a side table and a lamp
    const ch = B.sub(1.95, 0, 0.75, -0.9), fyy = SH.FY, velvet = paint(0x6f8f7a);
    ch.box(0.8, 0.32, 0.72, velvet, 0, fyy + 0.3, 0, 0.1);
    ch.box(0.8, 0.62, 0.18, velvet, 0, fyy + 0.68, -0.3, 0.09);
    for (const s2 of [-1, 1]) ch.box(0.16, 0.44, 0.72, velvet, s2 * 0.38, fyy + 0.48, 0, 0.07);
    for (const [x, z] of [[-0.32, -0.28], [0.32, -0.28], [-0.32, 0.28], [0.32, 0.28]]) ch.box(0.06, 0.14, 0.06, woodD, x, fyy + 0.07, z, 0.015);
    ch.box(0.62, 0.05, 0.72, paint(0xffffff, { hatch: 0, map: canvasTex(64, 64, (c, w, h) => { const cols = ['#e8604c', '#e1b95c', '#7fb3a8', '#c4607e']; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = cols[(i + j) % 4]; c.fillRect(i * 16, j * 16, 16, 16); c.fillStyle = '#f6eedb'; c.fillRect(i * 16 + 5, j * 16 + 5, 6, 6); } }) }), 0, fyy + 0.6, 0.02, 0.02, [0, 0, 0.12]);
    const tb = B.sub(2.3, 0, -0.3, 0);
    tb.put(lathe([[0.001, 0], [0.18, 0], [0.05, 0.05], [0.04, 0.55], [0.24, 0.57], [0.24, 0.6], [0.001, 0.6]], 16), woodD, 0, SH.FY, 0);
    tb.put(lathe([[0.001, 0], [0.09, 0], [0.03, 0.05], [0.025, 0.4], [0.001, 0.4]], 12), paint(0xe1b95c), 0, SH.FY + 0.6, 0);
    tb.put(lathe([[0.06, 0.38], [0.2, 0.18], [0.22, 0.16], [0.08, 0.36]], 18), paint(0xdc9e9a, { side: THREE.DoubleSide }), 0, SH.FY + 0.6, 0);
    tb.put(new THREE.SphereGeometry(0.06, 10, 8), paint(0xfff6dc, { hatch: 0, emissive: 0xffd98a }), 0, SH.FY + 0.88, 0).userData.noInk = true;
    tb.put(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 12), paint(0xf6eedb), 0.13, SH.FY + 0.65, 0.08);          // a mug of tea
    lightPool(B, 2.1, 0.3, 0.85);
  }
  rug(B, 0.1, 0.35, 2.7, 1.9, { a: '#c4607e', b: '#e1b95c', c: '#f6eedb' });
  pendant(B, -1.1, 0.0, { shade: paint(0x7fb3a8) });
  pendant(B, 0.6, -0.9, { shade: paint(0xe1b95c), y: 2.35 });
  plant(B, -2.35, 1.85, 1.1);
  B.put(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 18), paint(0xdc9e9a), -1.05, SH.FY + 0.05, 1.5);       // the cat's cushion
  walls.push(...[[-1.9, -1.4, 0.45], [-0.8, -1.55, 0.45], [1.9, -1.4, 0.45], [0.7, -1.35, 0.3], [-1.6, 0.6, 0.3],
    [1.95, 0.75, 0.42], [2.3, -0.3, 0.25], [-2.35, 1.85, 0.25]]);                          // the furniture is solid
  return walls;
}
function shopDeck(B, U) {                      // Picture Palace: a little art-deco cinema
  const red = paint(0xa94848), gold = paint(0xe4b84f), cream = paint(0xf6eedb), dk = DARK();
  const { walls } = shopShell(B, U, { wall: red, trim: gold, floor: paint(0x6b3a44), name: null, sideWin: false });
  // stepped deco parapet
  for (const [w, h, y] of [[SH.W + 0.1, 0.4, SH.H + 0.36], [3.2, 0.5, SH.H + 0.8], [1.6, 0.45, SH.H + 1.26]]) U.box(w, h, 0.3, red, 0, y, SH.D / 2 - 0.12, 0.05);
  U.box(1.62, 0.08, 0.32, gold, 0, SH.H + 1.5, SH.D / 2 - 0.12, 0.02);
  // the marquee: a canopy edged with bulbs, its letter board saying what's on
  U.box(SH.W - 0.2, 0.1, 1.0, dk, 0, 2.5, SH.D / 2 + 0.5, 0.03);
  U.box(SH.W - 0.2, 0.5, 0.08, cream, 0, 2.78, SH.D / 2 + 1.0, 0.02);
  U.flat(SH.W - 0.4, 0.42, signMat('NOW SHOWING: YOUR DECK', { bg: '#f6eedb', fg: '#2a2230', font: '700 $px ' + HAND, w: 768, h: 72 }), 0, 2.78, SH.D / 2 + 1.07);
  const bulb = paint(0xfff1c8, { emissive: 0xffd98a, hatch: 0 });
  for (let x = -2.5; x <= 2.51; x += 0.42) { U.put(new THREE.SphereGeometry(0.055, 8, 6), bulb, x, 3.06, SH.D / 2 + 1.0); U.put(new THREE.SphereGeometry(0.055, 8, 6), bulb, x, 2.5, SH.D / 2 + 1.0); }
  // the blade sign: DECKGPT down a tall vertical board
  const blade = U.sub(2.1, 0, SH.D / 2 + 0.2, 0);
  blade.box(0.18, 2.4, 0.7, red, 0, SH.H + 0.7, 0.3, 0.05);
  for (const s of [-1, 1]) blade.flat(0.62, 2.25, paint(0xffffff, { hatch: 0, map: canvasTex(64, 256, (c, w, h) => {
    c.fillStyle = '#2a2230'; c.fillRect(0, 0, w, h); c.fillStyle = '#e4b84f'; c.font = `700 34px ${HAND}`; c.textAlign = 'center';
    [...'DECKGPT'].forEach((ch, i) => c.fillText(ch, w / 2, 36 + i * 34));
  }) }), s * 0.1, SH.H + 0.7, 0.3, [0, s * Math.PI / 2, 0]);
  // posters either side of the door
  for (const [s, t] of [[-1, 'Scope → Story'], [1, 'Visuals → Deck']]) {
    U.box(1.0, 1.15, 0.06, gold, s * 2.1, 1.75, SH.D / 2 + 0.06, 0.02);
    U.flat(0.9, 1.05, boardMat(t, 'A four-stage pipeline, in your house style.', { bg: '#2a2230', fg: '#f6eedb', accent: '#e4b84f', w: 256, h: 300 }), s * 2.1, 1.75, SH.D / 2 + 0.12);
  }
  // inside: the screen (a slide), two rows of red seats, a popcorn cart
  const fy = SH.FY, scr = B.sub(0, 0, -1.95, 0);
  for (const s of [-1, 1]) scr.box(0.08, 2.4, 0.08, dk, s * 1.75, fy + 1.2, 0, 0.02);
  scr.box(3.6, 1.9, 0.08, dk, 0, fy + 1.45, 0, 0.02);
  scr.flat(3.4, 1.72, paint(0xffffff, { hatch: 0, emissive: 0x222222, map: canvasTex(512, 260, (c, w, h) => {
    c.fillStyle = '#f6eedb'; c.fillRect(0, 0, w, h); c.fillStyle = '#a94848'; c.fillRect(0, 0, w, 54);
    c.fillStyle = '#f6eedb'; c.font = `700 40px ${SCRIPT}`; c.fillText('DeckGPT', 22, 40);
    c.fillStyle = '#2a2230'; c.font = `400 28px ${HAND}`;
    ['1  Scope — what are you sharing?', '2  Story — the argument', '3  Visuals — your house style', '4  Deck — export it'].forEach((t, i) => c.fillText(t, 30, 100 + i * 40));
  }) }), 0, fy + 1.45, 0.075);
  const seat = paint(0xc0404a);
  for (const z of [-0.45, 0.55]) for (const x of [-1.85, -0.95, 0.95, 1.85]) {                 // an aisle up the middle
    B.box(0.62, 0.14, 0.5, seat, x, fy + 0.42, z, 0.05);
    B.box(0.62, 0.55, 0.12, seat, x, fy + 0.72, z + 0.26, 0.05);
    B.box(0.66, 0.35, 0.5, dk, x, fy + 0.18, z, 0.03);
  }
  const pc = B.sub(-2.0, 0, 1.55, 0.4);
  pc.box(0.6, 0.7, 0.45, red, 0, fy + 0.35, 0, 0.04);
  pc.box(0.56, 0.4, 0.42, paint(0xbfd8e0, { opacity: 0.55 }), 0, fy + 0.9, 0, 0.02);
  for (let k = 0; k < 6; k++) pc.put(new THREE.SphereGeometry(0.07, 8, 6), cream, -0.15 + (k % 3) * 0.15, fy + 0.78 + Math.floor(k / 3) * 0.08, -0.05 + (k % 2) * 0.1);
  infoStand(B, 2.0, 1.45, -0.6, boardMat('DeckGPT', 'Builds a presentation with you, step by step: what you are sharing, the story, the visuals — then the deck.', { accent: '#a94848' }));
  // ── a proper picture house: velvet curtains, a red aisle runner, glowing sconces, a projector ──
  const velvet = paint(0x8a2f3a);
  for (const s2 of [-1, 1]) for (let k = 0; k < 4; k++) B.put(new THREE.CylinderGeometry(0.11, 0.13, 2.5, 10), velvet, s2 * (1.85 + k * 0.17), fy + 1.25, -1.9 + (k % 2) * 0.05);
  B.box(4.4, 0.32, 0.16, velvet, 0, fy + 2.55, -1.88, 0.05);
  for (let x = -2.1; x <= 2.11; x += 0.3) B.put(new THREE.SphereGeometry(0.045, 8, 6), gold, x, fy + 2.36, -1.8);
  rug(B, 0, 0.3, 0.75, 3.6, { a: '#8a2f3a', b: '#e4b84f', c: '#8a2f3a', oval: false });
  for (const s2 of [-1, 1]) for (const z of [-0.6, 1.0]) {
    const x = s2 * (SH.W / 2 - SH.T - 0.06);
    B.put(new THREE.CylinderGeometry(0.14, 0.1, 0.3, 14, 1, false, 0, Math.PI), gold, x, 1.95, z, [0, s2 > 0 ? -Math.PI / 2 : Math.PI / 2, 0]);
    B.put(new THREE.SphereGeometry(0.07, 10, 8), paint(0xfff6dc, { hatch: 0, emissive: 0xffc070 }), x - s2 * 0.06, 2.1, z).userData.noInk = true;
    lightPool(B, x - s2 * 0.55, z, 0.6, POOL_DIM);
  }
  { const pj = B.sub(-1.7, 0.12, 1.45, 0.3);                                         // the projector, slung from the front beam off to one side (in the middle it hid the screen)
    pj.box(0.06, 0.25, 0.06, dk, 0, SH.H - 0.27, 0, 0.01);
    pj.box(0.46, 0.3, 0.55, paint(0x3a3340), 0, SH.H - 0.55, 0, 0.05);
    for (const s2 of [-1, 1]) pj.put(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 18), dk, s2 * 0.13, SH.H - 0.27, 0.1, [0, 0, Math.PI / 2]);
    pj.put(new THREE.CylinderGeometry(0.08, 0.1, 0.16, 14), dk, 0, SH.H - 0.55, -0.34, [Math.PI / 2, 0, 0]);
    pj.put(new THREE.CircleGeometry(0.07, 14), paint(0xfff6dc, { hatch: 0, emissive: 0xfff0c0 }), 0, SH.H - 0.55, -0.425, [Math.PI, 0, 0]).userData.noInk = true; }
  walls.push(...[[-1.85, -0.45, 0.38], [-0.95, -0.45, 0.38], [0.95, -0.45, 0.38], [1.85, -0.45, 0.38], [-1.85, 0.55, 0.38], [-0.95, 0.55, 0.38], [0.95, 0.55, 0.38], [1.85, 0.55, 0.38], [-2.0, 1.55, 0.35], [2.0, 1.45, 0.3]]);                          // the furniture is solid
  return walls;
}
function shopSplat(B, U) {                     // Paint & Supplies: paint pours off the roof
  const white = paint(0xf6f0e4), blue = paint(0x4f7fc4), dk = DARK();
  const { walls } = shopShell(B, U, { wall: white, trim: paint(0x2a2230), floor: paint(0xd8cab0), name: 'Splatform', sign: { bg: '#f6f0e4', fg: '#e8604c', gold: false } });
  // splats on the walls: torn-edge blots in each medium's colour
  // (painted on the wall's / floor's own colour: the paint material has no alpha)
  const splat = (col, seed, bg = '#f6f0e4') => paint(0xffffff, { hatch: 0, map: canvasTex(128, 128, (c, w, h) => {
    const R = rng(seed); c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = col; c.beginPath();
    for (let k = 0; k <= 18; k++) { const a = k / 18 * Math.PI * 2, r = 34 + R() * 22; c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    c.fill(); for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(64 + (R() - 0.5) * 100, 64 + (R() - 0.5) * 100, 3 + R() * 6, 0, 7); c.fill(); }
  }) });
  const SPLC = [['#e8604c', 3], ['#e1b95c', 7], ['#7fb3a8', 11], ['#b7a3c6', 13], ['#4f7fc4', 17]];
  const SPL = SPLC.map(([c, s]) => splat(c, s)), SPLF = SPLC.map(([c, s]) => splat(c, s + 1, '#d8cab0'));
  [[-1.4, 0.62, 0], [1.6, 0.6, 3]].forEach(([x, y, i]) => U.flat(0.7, 0.7, SPL[i], x, y, SH.D / 2 + 0.106));
  for (const s of [-1, 1]) [[0.9, 2.3, 4], [-1.2, 0.65, 2]].forEach(([z, y, i]) => (y > SH.LOW ? U : B).flat(0.8, 0.8, SPL[(i + (s > 0 ? 1 : 0)) % 5], s * (SH.W / 2 + 0.106), y, z, [0, s * Math.PI / 2, 0]));
  // a flat roof; a giant tin of blue paint tipped on its front edge, pouring down the shopfront
  U.box(SH.W - 0.1, 0.06, SH.D - 0.1, paint(0xd8cab0), 0, SH.H + 0.19, 0, 0.02);
  const can = U.sub(-2.35, SH.H + 0.8, 1.2, 0.25); can.g.rotation.x = 1.0;
  can.put(lathe([[0.001, -0.55], [0.55, -0.55], [0.55, 0.5], [0.5, 0.55], [0.001, 0.55]], 26), paint(0xb8bec6), 0, 0, 0);
  can.put(new THREE.CylinderGeometry(0.56, 0.56, 0.5, 26, 1, true), paint(0xffffff, { hatch: 0, map: canvasTex(128, 32, (c, w, h) => { c.fillStyle = '#f6eedb'; c.fillRect(0, 0, w, h); c.fillStyle = '#4f7fc4'; c.font = `700 22px ${HAND}`; c.fillText('BLUE', 10, 24); c.fillText('BLUE', 74, 24); }) }), 0, -0.05, 0);
  can.put(new THREE.CircleGeometry(0.5, 24), blue, 0, 0.56, 0, [-Math.PI / 2, 0, 0]);
  // the pour: a thick ribbon of paint over the cornice and down the wall above the door, a pool on the stoop
  const pour = shape([[-0.42, 0], [0.42, 0], [0.38, -0.5], [0.28, -0.9], [0.34, -1.3], [0.18, -1.75], [0.2, -2.2], [0.05, -2.4], [-0.12, -2.25], [-0.2, -1.6], [-0.36, -1.1], [-0.3, -0.6]]);
  U.put(extrude(pour, 0.06, 0.02), blue, -2.55, SH.H + 0.3, SH.D / 2 + 0.13).scale.set(0.62, 0.8, 1);
  U.put(extrude(pour, 0.06, 0.02), blue, -2.55, SH.LOW + 0.02, SH.D / 2 + 0.13).scale.set(0.5, 0.42, 1);   // it carries on down the riser
  B.put(new THREE.CylinderGeometry(0.45, 0.5, 0.03, 20), blue, -2.5, 0.11, SH.D / 2 + 0.3).scale.set(1.0, 1, 0.7);
  // a giant brush leaning on the side
  const br = B.sub(SH.W / 2 + 0.45, 0, 1.2, 0); br.g.rotation.z = 0.22;
  br.put(new THREE.CylinderGeometry(0.08, 0.1, 2.0, 12), paint(0xd58b63), 0, 1.4, 0);
  br.put(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 14), paint(0xb8bec6), 0, 0.35, 0);
  br.put(lathe([[0.001, 0], [0.17, 0], [0.19, 0.25], [0.04, 0.42], [0.001, 0.42]], 14), paint(0xe8604c), 0, 0.2, 0, [Math.PI, 0, 0]);
  // inside: shelves of paint pots, an easel of swatches (the five media), splats on the floor
  const fy = SH.FY, pots = [0xe8604c, 0xe1b95c, 0x7fb3a8, 0xb7a3c6, 0x4f7fc4, 0xa8b994, 0xdc9e9a, 0x2a2230];
  for (const s of [-1, 1]) {
    const sh = B.sub(s * 1.5, 0, -1.9, 0);
    for (const y of [0.35, 0.8]) {
      sh.box(1.9, 0.05, 0.4, paint(0x8a6448), 0, fy + y, 0, 0.015);
      for (let k = 0; k < 5; k++) sh.put(lathe([[0.001, 0], [0.13, 0], [0.13, 0.2], [0.001, 0.2]], 14), paint(pots[(k + (y > 0.5 ? 3 : 0) + (s > 0 ? 2 : 0)) % pots.length]), -0.75 + k * 0.375, fy + y + 0.025, 0);
    }
    for (const x of [-0.92, 0.92]) sh.box(0.05, 1.0, 0.4, paint(0x6e452c), x, fy + 0.5, 0, 0.015);
  }
  const ea = B.sub(1.6, 0, 0.3, -0.5);
  for (const s of [-1, 1]) ea.box(0.05, 1.7, 0.05, paint(0x8a5a35), s * 0.4, fy + 0.85, 0, 0.015, [0, 0, s * 0.1]);
  ea.box(0.9, 0.05, 0.12, paint(0x8a5a35), 0, fy + 0.62, 0.02, 0.015);
  ea.flat(0.8, 0.95, paint(0xffffff, { hatch: 0, map: canvasTex(200, 240, (c, w, h) => {
    c.fillStyle = '#fbf6ec'; c.fillRect(0, 0, w, h); c.font = `400 18px ${HAND}`;
    [['watercolor', '#7fb3a8'], ['acrylic', '#e8604c'], ['charcoal', '#2a2230'], ['torn paper', '#e1b95c'], ['marker', '#4f7fc4']].forEach(([t, col], i) => {
      c.fillStyle = col; c.globalAlpha = i === 0 ? 0.6 : 1; c.fillRect(14, 14 + i * 44, 92, 32); c.globalAlpha = 1; c.fillStyle = '#2a2230'; c.fillText(t, 112, 36 + i * 44);
    });
  }) }), 0, fy + 1.12, 0.06);
  for (const [x, z, i] of [[-0.6, 0.4, 0], [0.4, -0.6, 2], [-1.6, 1.0, 3]]) B.flat(0.6, 0.6, SPLF[i], x, fy + 0.025, z, [-Math.PI / 2, 0, 0]);
  infoStand(B, -1.6, 0.4, 0.5, boardMat('Splatform', 'Components, painted: every button, card and input made of a real medium. One attribute paints your whole site.', { accent: '#e8604c' }));
  // ── a working studio: a pegboard of brushes, swatch fans, a paint-spattered drop cloth, a stepladder ──
  { const pz = -SH.D / 2 + SH.T + 0.02;
    B.box(1.1, 1.1, 0.04, paint(0xc8b48a), 0, 2.0, pz + 0.02, 0.01);
    for (let k = 0; k < 7; k++) { const x = -0.42 + k * 0.14; B.box(0.035, 0.42, 0.03, paint(0xd58b63), x, 2.15, pz + 0.07, 0.01); B.box(0.05, 0.1, 0.04, paint(pots[k % pots.length]), x, 1.9, pz + 0.07, 0.01); }
    for (const s2 of [-1, 1]) for (let k = 0; k < 5; k++) {        // swatch fans pinned either side
      const fan = B.sub(s2 * 1.6, 1.95, pz + 0.06, 0); fan.g.rotation.z = (k - 2) * 0.28 * s2;
      fan.box(0.12, 0.62, 0.01, paint(pots[(k + (s2 > 0 ? 4 : 0)) % pots.length]), 0, 0.28, k * 0.004, 0.005); } }
  rug(B, 0, 0.6, 3.0, 2.0, { a: '#e9e0cc', b: '#d8cab0', c: '#e8604c', oval: false, ry: 0.06 });
  { const ld = B.sub(2.3, 0, 1.55, -0.5), al = paint(0xb8bec6);
    for (const s2 of [-1, 1]) ld.box(0.05, 1.5, 0.05, al, s2 * 0.22, SH.FY + 0.72, 0.12, 0.01, [0.16, 0, 0]);
    for (const s2 of [-1, 1]) ld.box(0.05, 1.45, 0.05, al, s2 * 0.22, SH.FY + 0.7, -0.22, 0.01, [-0.16, 0, 0]);
    for (let k = 0; k < 4; k++) ld.box(0.46, 0.04, 0.1, al, 0, SH.FY + 0.3 + k * 0.33, 0.12 - k * 0.02, 0.01); }
  for (const [x, z] of [[-1.0, -0.2], [1.0, 0.9]]) pendant(B, x, z, { shade: paint(0xf6f0e4), y: 2.3 });
  walls.push(...[[-2.0, -1.9, 0.3], [-1.0, -1.9, 0.3], [1.0, -1.9, 0.3], [2.0, -1.9, 0.3], [1.6, 0.3, 0.35], [-1.6, 0.4, 0.3], [2.3, 1.55, 0.3]]);                          // the furniture is solid
  return walls;
}
function shopEyes(B, U) {                      // Optics & Menagerie: the roof is a great watching eye
  const night = paint(0x34506a), brass = paint(0xc9a14a), cream = paint(0xf6eedb), dk = DARK();
  const { walls } = shopShell(B, U, { wall: night, trim: brass, floor: paint(0x5b4a3c), name: 'Borrowed Eyes', sign: { bg: '#1f2d3d', fg: '#f2d27a' }, glass: upperGlass(3) });
  // the eye: a white eyeball sat in a drum on the roof, looking down the road, lids above and below
  const ey = SH.H + 1.15, ez = 0.2;
  U.put(lathe([[0.001, 0], [1.75, 0], [1.6, 0.4], [0.001, 0.45]], 30), paint(0x2a3a4e), 0, SH.H + 0.16, 0);
  U.put(new THREE.SphereGeometry(1.15, 32, 20), cream, 0, ey, ez);
  // iris and pupil: caps of slightly bigger spheres, so they hug the eyeball (looking a touch down the road)
  const look = U.sub(0, ey, ez, 0); look.g.rotation.x = 0.12;
  look.put(new THREE.SphereGeometry(1.165, 32, 10, 0, Math.PI * 2, 0, 0.5), paint(0x6f9a5a), 0, 0, 0, [Math.PI / 2, 0, 0]);
  look.put(new THREE.SphereGeometry(1.18, 28, 8, 0, Math.PI * 2, 0, 0.24), paint(0x2a2230, { hatch: 0 }), 0, 0, 0, [Math.PI / 2, 0, 0]);
  look.put(new THREE.SphereGeometry(0.09, 10, 8), paint(0xffffff, { hatch: 0 }), -0.17, 0.2, 1.15);
  look.put(new THREE.TorusGeometry(0.555, 0.035, 6, 32), paint(0xd9a73e), 0, 0, 1.03);
  // the upper lid droops over the top of the eye (a heavy, knowing look); lashes along its rim
  const LT = 0.4, LR = 1.24, LA = 1.0;          // lid tilt (forward), radius, cap angle
  const lid = U.put(new THREE.SphereGeometry(LR, 30, 12, 0, Math.PI * 2, 0, LA), night, 0, ey, ez); lid.rotation.x = LT;
  const rc = LR * Math.cos(LA), rr = LR * Math.sin(LA), cy = ey + rc * Math.cos(LT), cz = ez + rc * Math.sin(LT);
  U.put(new THREE.TorusGeometry(rr, 0.07, 8, 36), brass, 0, cy, cz, [LT - Math.PI / 2, 0, 0]);       // its brass rim
  for (let k = -3; k <= 3; k++) {                // lashes along the front of the rim, flicking forward and up
    const a = k * 0.3, w = rr * Math.cos(a);
    U.box(0.06, 0.32, 0.06, dk, rr * Math.sin(a), cy - w * Math.sin(LT) + 0.1, cz + w * Math.cos(LT) + 0.12, 0.015, [0.9, 0, -a * 0.5]);
  }
  // a brass telescope poking out of the drum
  const ts = U.sub(-1.6, SH.H + 0.55, -1.0, 0.5); ts.g.rotation.z = 0.75;
  ts.put(new THREE.CylinderGeometry(0.14, 0.2, 1.5, 14), brass, 0, 0.6, 0);
  ts.put(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 14), dk, 0, 1.35, 0);
  // brass porthole rings round the display windows
  for (const s of [-1, 1]) U.put(new THREE.TorusGeometry(0.42, 0.06, 8, 26), brass, s * (SH.DOOR / 2 + (SH.W - SH.DOOR) / 4), 1.82, SH.D / 2 + 0.12);
  // inside: four pedestals, each an animal and the eyes you borrow from it
  const fy = SH.FY, ped = (x, z, label, sub, build) => {
    const P = B.sub(x, 0, z, 0);
    P.put(lathe([[0.001, 0], [0.32, 0], [0.32, 0.08], [0.24, 0.12], [0.22, 0.8], [0.3, 0.84], [0.3, 0.9], [0.001, 0.9]], 18), cream, 0, fy, 0);
    const b = P.sub(0, fy + 0.55, 0.33, 0); b.g.rotation.x = -0.5;
    b.box(0.52, 0.26, 0.03, brass, 0, 0, 0, 0.01);
    b.flat(0.48, 0.22, signMat(label + ' · ' + sub, { bg: '#1f2d3d', fg: '#f2d27a', font: '700 $px ' + HAND, w: 256, h: 112, border: false }), 0, 0, 0.04);
    build(P.sub(0, fy + 0.9, 0));
  };
  ped(-1.7, -1.4, 'bee', 'ultraviolet', (A) => {
    A.put(new THREE.SphereGeometry(0.16, 16, 12), paint(0xe1b95c), 0, 0.16, 0).scale.set(1, 0.8, 1.4);
    for (const z of [-0.08, 0.06]) A.put(new THREE.TorusGeometry(0.135, 0.03, 6, 16), dk, 0, 0.16, z);
    for (const s of [-1, 1]) A.put(new THREE.SphereGeometry(0.11, 10, 8), paint(0xdfe9f2, { opacity: 0.7 }), s * 0.12, 0.3, -0.02).scale.set(1, 0.3, 0.7);
  });
  ped(-0.55, -1.6, 'snake', 'heat pits', (A) => {
    for (let k = 0; k < 3; k++) A.put(new THREE.TorusGeometry(0.2 - k * 0.04, 0.06, 8, 20), paint(0x6f9a5a), 0, 0.07 + k * 0.1, 0, [Math.PI / 2, 0, 0]);
    A.put(new THREE.SphereGeometry(0.08, 10, 8), paint(0x6f9a5a), 0.05, 0.36, 0.05).scale.set(1, 0.8, 1.4);
  });
  ped(0.6, -1.6, 'bat', 'echoes', (A) => {
    A.put(new THREE.SphereGeometry(0.1, 12, 10), paint(0x4a3f4f), 0, 0.2, 0).scale.set(1, 1.2, 0.9);
    for (const s of [-1, 1]) A.put(extrude(shape([[0, 0], [0.32, 0.12], [0.28, -0.04], [0.2, 0.0], [0.14, -0.08], [0.06, -0.02]]), 0.02, 0.005), paint(0x4a3f4f), 0, 0.22, 0).scale.set(s, 1, 1);
  });
  ped(1.75, -1.4, 'owl', 'night eyes', (A) => {
    A.put(new THREE.SphereGeometry(0.18, 16, 12), paint(0x9a744e), 0, 0.2, 0).scale.set(1, 1.25, 0.9);
    for (const s of [-1, 1]) { A.put(new THREE.SphereGeometry(0.065, 12, 8), cream, s * 0.075, 0.3, 0.14); A.put(new THREE.SphereGeometry(0.035, 8, 6), dk, s * 0.075, 0.3, 0.19); }
    A.put(new THREE.ConeGeometry(0.03, 0.07, 6), paint(0xe1b95c), 0, 0.25, 0.17, [Math.PI / 2, 0, 0]);
  });
  // a big lens on a stand to look through
  const ln = B.sub(1.9, 0, 0.9, -0.7);
  ln.box(0.06, 1.2, 0.06, dk, 0, fy + 0.6, 0, 0.02);
  ln.put(new THREE.TorusGeometry(0.42, 0.06, 8, 28), brass, 0, fy + 1.45, 0);
  ln.put(new THREE.CircleGeometry(0.4, 28), paint(0xbfd8e0, { opacity: 0.45, hatch: 0 }), 0, fy + 1.45, 0).userData.noInk = true;
  infoStand(B, -1.75, 0.8, 0.55, boardMat('Borrowed Eyes', 'Photograph 14 hidden animals and borrow their eyes: see in ultraviolet, feel heat, hear in echoes, own the night.', { bg: '#1f2d3d', fg: '#f6eedb', accent: '#f2d27a' }));
  // ── a naturalist's night room: a star chart, shelves of brass instruments and specimen jars, lantern glow ──
  { const pz = -SH.D / 2 + SH.T + 0.02;
    B.box(2.0, 1.0, 0.04, brass, 0, 2.15, pz + 0.02, 0.01);
    B.flat(1.9, 0.9, paint(0xffffff, { hatch: 0, emissive: 0x0a1020, map: canvasTex(256, 128, (c, w, h, r) => {
      c.fillStyle = '#16202e'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2d27a';
      for (let i = 0; i < 70; i++) { c.globalAlpha = 0.4 + r() * 0.6; c.beginPath(); c.arc(r() * w, r() * h, 0.6 + r() * 1.6, 0, 7); c.fill(); }
      c.globalAlpha = 0.7; c.strokeStyle = '#f2d27a'; c.lineWidth = 1; c.beginPath(); [[40, 30], [70, 50], [100, 40], [130, 70], [160, 60]].forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
      c.globalAlpha = 1; c.font = '700 14px ' + HAND; c.fillText('what the owl sees', 150, 118);
    }) }), 0, 2.15, pz + 0.05);
    for (const s2 of [-1, 1]) {
      const y = wallShelf(B, s2 * 1.85, 2.0, 1.1, paint(0x5b4a3c));
      B.put(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 12), paint(0xbfd8e0, { opacity: 0.55 }), s2 * 1.55, y + 0.12, pz + 0.17);
      B.put(new THREE.SphereGeometry(0.06, 10, 8), paint(0x6f9a5a), s2 * 1.55, y + 0.1, pz + 0.17);
      B.put(new THREE.SphereGeometry(0.13, 14, 10), brass, s2 * 1.95, y + 0.14, pz + 0.17);
      B.put(new THREE.TorusGeometry(0.17, 0.015, 6, 20), brass, s2 * 1.95, y + 0.14, pz + 0.17, [0.5, 0.3, 0]);
      B.put(new THREE.CylinderGeometry(0.035, 0.05, 0.36, 10), brass, s2 * 2.25, y + 0.06, pz + 0.17, [0, 0, Math.PI / 2 - 0.2]);
    } }
  rug(B, 0, 0.35, 2.8, 1.8, { a: '#1f2d3d', b: '#c9a14a', c: '#f2d27a' });
  for (const [x, z] of [[-1.0, -0.1], [1.0, -0.1]]) pendant(B, x, z, { shade: paint(0x2a3a4e), y: 2.25, glow: 0xffe08a });
  plant(B, 2.35, -0.2, 1.0, paint(0x4f7a5a));
  walls.push(...[[-1.7, -1.4, 0.35], [-0.55, -1.6, 0.35], [0.6, -1.6, 0.35], [1.75, -1.4, 0.35], [1.9, 0.9, 0.25], [-1.75, 0.8, 0.3], [2.35, -0.2, 0.25]]);                          // the furniture is solid
  return walls;
}
const SHOPS = { behaviors: shopBehaviors, qr: shopQR, yarn: shopYarn, deckgpt: shopDeck, splat: shopSplat, eyes: shopEyes };
export const isProjectShop = (style) => style in SHOPS;
// build one project's shop: unplaced raw groups + its walls [[x, z, r]…], floor test and "inside" test
export function projectShop(style) {
  const B = kit(), U = kit();
  const walls = SHOPS[style](B, U);
  const { W, D, FY, DOOR } = SH;
  const floor = (x, z) => (Math.abs(x) < W / 2 + 0.18 && Math.abs(z) < D / 2 + 0.18) ? FY
    : (Math.abs(x) < DOOR / 2 + 0.4 && z > 0 && z < D / 2 + 0.8) ? 0.1 : null;        // the stoop
  return { base: B.g, upper: U.g, walls, floor, inside: (x, z) => Math.abs(x) < W / 2 - 0.05 && z > -D / 2 && z < D / 2 + 0.2 };
}
// shared with train.js (the parked train at Central Station)
export { kit, lathe, signMat, upperGlass, DARK, HAND };
