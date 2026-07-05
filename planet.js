// ═══════════════════════════════════════════════════════════════════════════
// janelle's tiny planet — a low-poly world you fly around.
// Every project is a building on the surface; the bookshelf room is the
// Library; the old portfolio's space station orbits overhead.
// Spherical gravity: "up" is always away from the planet's center.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';

// ─── tunables ────────────────────────────────────────────────────────────────
const R = 30;                    // planet radius
const H_AMP = 1.15;              // terrain displacement amplitude
const HOVER = 1.15;              // courier hover height above ground
const MAX_SPEED = 9;             // surface units / s
const ACCEL = 26;
const DAMP = 6;
const CAM_H = 3.6, CAM_D = 8.2;  // chase camera offsets
const NEAR_ARC = 0.115;          // radians — arrive at a landmark
const FAR_ARC = 0.165;           // radians — leave a landmark

// deterministic PRNG so the world is identical every visit
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260705);

// ─── loader plumbing ─────────────────────────────────────────────────────────
const loaderEl = document.getElementById('loader');
const loaderBar = document.getElementById('loader-bar');
const loaderMsg = document.getElementById('loader-msg');
function progress(p, msg) {
  loaderBar.style.width = `${Math.round(p * 100)}%`;
  if (msg) loaderMsg.textContent = msg;
}

// ─── renderer / scene ────────────────────────────────────────────────────────
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
renderer.shadowMap.enabled = !IS_TOUCH;         // shadows on desktop only
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
if (IS_TOUCH) document.body.classList.add('touch');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe3cfe8, 55, 190);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 26, 95);   // intro: far out; chase cam eases in

// ─── pastel sky + stars ──────────────────────────────────────────────────────
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(420, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      cPeach: { value: new THREE.Color(0xffd9b8) },
      cLav:   { value: new THREE.Color(0xd9c4f2) },
      cBlue:  { value: new THREE.Color(0x9fc0ee) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 cPeach, cLav, cBlue;
      void main() {
        float h = normalize(vP).y * 0.5 + 0.5;
        vec3 c = mix(cPeach, cLav, smoothstep(0.05, 0.52, h));
        c = mix(c, cBlue, smoothstep(0.5, 0.95, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
);
scene.add(sky);

{ // faint drifting stars
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(320 + rand() * 60);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xfff6e8, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.6,
  }));
  scene.add(stars);
}

// ─── lights ──────────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(0xfff2dd, 0x8a76b8, 0.75));
const sun = new THREE.DirectionalLight(0xffe0b8, 1.5);
sun.position.set(60, 45, 30);
if (!IS_TOUCH) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 44;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.001;
}
scene.add(sun);
const rim = new THREE.DirectionalLight(0xa8c8f0, 0.35);
rim.position.set(-50, -20, -40);
scene.add(rim);

progress(0.15, 'raising mountains…');

// ─── terrain ─────────────────────────────────────────────────────────────────
// deterministic height field on the unit sphere (sum of sines — cheap + smooth)
function surfH(d) {
  return (
    Math.sin(d.x * 3.1 + 1.3) * Math.sin(d.y * 2.7 + 2.1) * Math.sin(d.z * 3.7 + 0.5) * 0.62 +
    Math.sin(d.x * 6.4 + 4.2) * Math.sin(d.z * 5.2 + 1.1) * 0.28 +
    Math.sin(d.y * 7.3 + 0.7) * 0.10
  );
}
const radiusAt = (d) => R + surfH(d) * H_AMP;
const posOn = (d, extra = 0) => d.clone().multiplyScalar(radiusAt(d) + extra);

const UP_Y = new THREE.Vector3(0, 1, 0);
function alignToSurface(obj, d, yaw = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP_Y, d);
  if (yaw) q.premultiply(new THREE.Quaternion().setFromAxisAngle(d, yaw));
  obj.quaternion.copy(q);
}

const planet = (() => {
  let g = new THREE.IcosahedronGeometry(R, 4).toNonIndexed();
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = radiusAt(v);
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  // per-face pastel colors by average height
  const cLow = new THREE.Color(0xefdca6);   // sand
  const cMid = new THREE.Color(0x93ce9d);   // mint grass
  const cHigh = new THREE.Color(0xbfaee0);  // lavender rock
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < p.count; f += 3) {
    let h = 0;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, f + k); h += v.length() - R; }
    h /= 3 * H_AMP;                          // ≈ -1 .. 1
    if (h < -0.18) c.copy(cLow).lerp(cMid, (h + 1) / 0.82 * 0.5);
    else if (h < 0.42) c.copy(cMid);
    else c.copy(cMid).lerp(cHigh, Math.min(1, (h - 0.42) / 0.5));
    // tiny per-face variation for the faceted look
    const jitter = 0.965 + rand() * 0.07;
    for (let k = 0; k < 3; k++) colors.set([c.r * jitter, c.g * jitter, c.b * jitter], (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

progress(0.3, 'planting trees…');

// ─── decorations ─────────────────────────────────────────────────────────────
const deco = new THREE.Group();
scene.add(deco);
const M = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...opts });
const WOOD = M(0x9a6b4f), LEAF_A = M(0x7fbf8b), LEAF_B = M(0xa8d8a0), ROCK = M(0xcdc3dd);

function randomDir() {
  return new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
}
function scatter(make, count, minArcFromLandmarks = 0.14) {
  for (let i = 0; i < count; i++) {
    let d, tries = 0;
    do { d = randomDir(); tries++; }
    while (tries < 20 && LANDMARKS.some(l => l.dir.angleTo(d) < minArcFromLandmarks));
    const o = make();
    o.position.copy(posOn(d, -0.06));
    alignToSurface(o, d, rand() * Math.PI * 2);
    o.traverse(m => { if (m.isMesh && !IS_TOUCH) { m.castShadow = true; } });
    deco.add(o);
  }
}
function pineTree() {
  const g = new THREE.Group(), s = 0.7 + rand() * 0.8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.6 * s, 6), WOOD);
  trunk.position.y = 0.3 * s; g.add(trunk);
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.62 * s, 1.1 * s, 7), rand() > 0.5 ? LEAF_A : LEAF_B);
  c1.position.y = 1.0 * s; g.add(c1);
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.45 * s, 0.85 * s, 7), LEAF_A);
  c2.position.y = 1.55 * s; g.add(c2);
  return g;
}
function roundTree() {
  const g = new THREE.Group(), s = 0.7 + rand() * 0.7;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.13 * s, 0.7 * s, 6), WOOD);
  trunk.position.y = 0.35 * s; g.add(trunk);
  const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * s, 1), rand() > 0.5 ? LEAF_A : LEAF_B);
  puff.position.y = 1.0 * s; puff.scale.y = 0.85; g.add(puff);
  return g;
}
function rock() {
  const s = 0.25 + rand() * 0.5;
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), ROCK);
  m.scale.set(1, 0.7 + rand() * 0.5, 1);
  return m;
}

// ─── landmarks (projects) ────────────────────────────────────────────────────
function ll(latDeg, lonDeg) {
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize();
}
const LANDMARKS = [
  { key: 'library', name: 'The Library', tag: 'the bookshelf', style: 'library', color: 0xe8a350,
    desc: 'A cozy room holding all 39 of my repos as books on a shelf — plus a walkable gallery of my paintings.',
    enter: './room.html', dir: ll(14, -8) },
  { key: 'yarnflow', name: 'YarnFlow', tag: 'hobby · social', style: 'dome', color: 0xff7eb6,
    desc: 'A crochet studio — patterns as threads you can share, fork, and remix.',
    url: 'https://ghanemja.github.io/crochet/', dir: ll(32, 58) },
  { key: 'inbox', name: 'Inbox Zero', tag: 'tool', style: 'tower', color: 0x4e8eff,
    desc: 'Kanban for email — drag messages between todo / waiting / done.',
    url: 'https://ghanemja.github.io/inbox-zero-board/', dir: ll(-18, 38) },
  { key: 'charterscope', name: 'CharterScope', tag: 'tool · nlp', style: 'lighthouse', color: 0x33c9ff,
    desc: 'Flags unusual clauses in maritime shipping contracts before you sign.',
    url: 'https://ghanemja.github.io/charterscope/', dir: ll(8, 118) },
  { key: 'deckgpt', name: 'DeckGPT', tag: 'ai', style: 'arch', color: 0xb265ff,
    desc: 'Prompt → branded PowerPoint. Slides that argue back.',
    url: 'https://pptgpt.netlify.app', dir: ll(-34, 96) },
  { key: 'council', name: 'The Council', tag: 'ai · agents', style: 'dome', color: 0x8f7ae8,
    desc: 'Specialist agents debate with citations; experts score the outcome.',
    dir: ll(44, 168) },
  { key: 'brainu', name: 'Brain U', tag: 'ai · learning', style: 'tower', color: 0xd06ee0,
    desc: 'Turns paper corpora into an adaptive curriculum with video lessons.',
    dir: ll(-8, -158) },
  { key: 'sinescape', name: 'Sinescape', tag: 'creative code', style: 'arch', color: 0x2dd47b,
    desc: 'Rebuilds an image from pure math — Fourier brushstrokes.',
    url: 'https://yeganeh-formula-studio.netlify.app', dir: ll(26, -118) },
  { key: 'pixels', name: 'Pixels → Params', tag: 'research', style: 'tower', color: 0xff8a3d,
    desc: 'Vision-language models for automated CAD design and optimization.',
    url: 'https://ghanemja.github.io/html/', dir: ll(-40, -58) },
  { key: 'ros2', name: 'Robot Lab', tag: 'robotics', style: 'dome', color: 0xff4d6e,
    desc: 'ROS2 + depth cameras + QNX — my robotics tutorials and demos.',
    url: 'https://ghanemja.github.io/ros2_depth_camera_tutorial/', dir: ll(-52, 15) },
];

progress(0.45, 'building the villages…');

const landmarkGroup = new THREE.Group();
scene.add(landmarkGroup);
const clickables = [];   // meshes → userData.landmark

function makeBuilding(lm) {
  const g = new THREE.Group();
  const body = M(lm.color);
  const trim = M(0xfff4e0);
  // platform disc seats the building into the terrain
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 0.5, 10), M(0xd8cbb2));
  plat.position.y = 0.1; g.add(plat);

  if (lm.style === 'library') {
    const main = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.2, 2.2), body);
    main.position.y = 1.35; g.add(main);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.35, 1.3, 4), M(0xc7572a));
    roof.position.y = 3.1; roof.rotation.y = Math.PI / 4; g.add(roof);
    // shelf stripes on the facade
    for (let i = 0; i < 3; i++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.1), trim);
      shelf.position.set(0, 0.9 + i * 0.6, 1.16); g.add(shelf);
      for (let b = 0; b < 5; b++) {
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.08),
          M([0xff7eb6, 0x4e8eff, 0x2dd47b, 0xb265ff, 0xffd23d][(i * 5 + b) % 5]));
        book.position.set(-0.85 + b * 0.42, 1.16 + i * 0.6, 1.17); g.add(book);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.1), M(0x6b4a2b));
    door.position.set(0, 0.75, 1.16); g.add(door);
  } else if (lm.style === 'tower') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 2.6, 8), body);
    t.position.y = 1.55; g.add(t);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.0, 8), trim);
    top.position.y = 3.35; g.add(top);
  } else if (lm.style === 'lighthouse') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 3.0, 8), body);
    t.position.y = 1.75; g.add(t);
    for (let i = 0; i < 2; i++) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.86 - i * 0.09, 0.92 - i * 0.09, 0.34, 8), trim);
      stripe.position.y = 1.1 + i * 1.0; g.add(stripe);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8), M(0x2d2138));
    cap.position.y = 3.5; g.add(cap);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffdd77, emissiveIntensity: 1.4 }));
    lamp.position.y = 3.5; g.add(lamp);
  } else if (lm.style === 'dome') {
    const d = new THREE.Mesh(new THREE.SphereGeometry(1.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), body);
    d.position.y = 0.35; g.add(d);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.12), trim);
    door.position.set(0, 0.75, 1.28); g.add(door);
  } else { // arch
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.4, 0.7), body); l.position.set(-0.9, 1.55, 0); g.add(l);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.4, 0.7), body); r.position.set(0.9, 1.55, 0); g.add(r);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.55, 0.8), trim); top.position.y = 2.95; g.add(top);
  }

  // floating beacon gem — always visible from afar
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42),
    new THREE.MeshStandardMaterial({ color: lm.color, emissive: lm.color, emissiveIntensity: 0.9, flatShading: true }));
  gem.position.y = 4.7;
  g.add(gem);
  lm.gem = gem;

  g.traverse(m => {
    if (m.isMesh) {
      m.userData.landmark = lm;
      clickables.push(m);
      if (!IS_TOUCH) { m.castShadow = true; m.receiveShadow = true; }
    }
  });
  return g;
}

// name label sprite (drawn after fonts load; rebuilt crisp)
function makeLabel(lm) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = '700 58px "Fredoka", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(lm.name).width + 70;
  ctx.fillStyle = 'rgba(255, 250, 242, 0.92)';
  const x = (512 - w) / 2;
  ctx.beginPath();
  ctx.roundRect(x, 22, w, 84, 42);
  ctx.fill();
  ctx.fillStyle = '#2d2138';
  ctx.fillText(lm.name, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(6.4, 1.6, 1);
  sp.position.copy(posOn(lm.dir, 6.6));
  scene.add(sp);
  lm.label = sp;
}

for (const lm of LANDMARKS) {
  const b = makeBuilding(lm);
  b.position.copy(posOn(lm.dir, -0.05));
  alignToSurface(b, lm.dir, rand() * Math.PI * 2);
  landmarkGroup.add(b);
  lm.root = b;
}
document.fonts.ready.then(() => LANDMARKS.forEach(makeLabel));

// scatter AFTER landmarks so trees avoid them
scatter(pineTree, 46);
scatter(roundTree, 22);
scatter(rock, 26);

progress(0.6, 'launching the space station…');

// ─── the old portfolio's space station, orbiting overhead ───────────────────
const stationPivot = new THREE.Group();
scene.add(stationPivot);
const station = (() => {
  const g = new THREE.Group();
  const hullM = M(0xe8e2f2, { roughness: 0.55 });
  const dark = M(0x5d5375);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.6, 10), hullM);
  core.rotation.z = Math.PI / 2; g.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.42, 8, 20), hullM);
  ring.rotation.y = Math.PI / 2; g.add(ring);
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x4e8eff, emissive: 0x2255cc, emissiveIntensity: 0.5, flatShading: true }));
    panel.position.x = s * 2.6; g.add(panel);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), dark);
    strut.rotation.z = Math.PI / 2; strut.position.x = s * 1.6; g.add(strut);
  }
  for (let i = 0; i < 6; i++) {  // glowing windows
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffe080, emissiveIntensity: 1.2 }));
    w.position.set(-1.2 + i * 0.5, 0.35, 1.08); g.add(w);
  }
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 8), dark);
  dish.position.y = 1.6; g.add(dish);
  g.scale.setScalar(1.35);
  const stationLm = {
    key: 'station', name: 'The Space Station', tag: 'the original portfolio',
    desc: 'Where it all started — my first 3D portfolio, a space station with pods for research, industry, and art. Still flying.',
    url: 'https://janelle-ghanem.netlify.app', isStation: true,
  };
  g.traverse(m => { if (m.isMesh) { m.userData.landmark = stationLm; clickables.push(m); } });
  g.position.set(52, 14, 0);
  stationPivot.rotation.x = 0.35;
  stationPivot.add(g);
  return g;
})();

// ─── clouds ──────────────────────────────────────────────────────────────────
const cloudPivots = [];
{
  const cloudM = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const pivot = new THREE.Group();
    pivot.quaternion.setFromUnitVectors(UP_Y, randomDir());
    const cl = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = 0.7 + rand() * 0.9;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), cloudM);
      puff.position.set(p * 1.1 - puffs * 0.5, rand() * 0.4, rand() * 0.6);
      puff.scale.y = 0.6;
      cl.add(puff);
    }
    cl.position.y = R + 7 + rand() * 4;
    pivot.add(cl);
    pivot.userData.speed = 0.008 + rand() * 0.014;
    scene.add(pivot);
    cloudPivots.push(pivot);
  }
}

progress(0.78, 'waking the courier…');

// ─── the courier ─────────────────────────────────────────────────────────────
const courier = new THREE.Group();
const courierBody = (() => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), M(0xff8a5c, { roughness: 0.6 }));
  body.scale.set(1, 0.8, 1.15); g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), M(0xfff4e0));
  belly.position.set(0, -0.18, 0.15); belly.scale.set(0.95, 0.6, 1); g.add(belly);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d2138, roughness: 0.25 }));
  visor.position.set(0, 0.12, 0.42); g.add(visor);
  for (const s of [-1, 1]) {  // little wings
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), M(0xffb28a));
    wing.position.set(s * 0.62, 0, -0.05); wing.rotation.z = s * -0.25; g.add(wing);
  }
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.16), M(0x5d5375));
  rotor.position.y = 0.72; g.add(rotor);
  g.userData.rotor = rotor;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4), M(0x5d5375));
  antenna.position.set(0.2, 0.55, -0.25); g.add(antenna);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0xff4d6e, emissive: 0xff4d6e, emissiveIntensity: 1 }));
  tip.position.set(0.2, 0.75, -0.25); g.add(tip);
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
})();
courier.add(courierBody);
scene.add(courier);

// courier state — spherical kinematics
let dir = ll(6, -30);                      // where on the sphere
let heading = new THREE.Vector3(0, 0, 1);  // unit tangent
let speed = 0;
let targetDir = null;                      // click-to-move goal
{ // make heading tangent
  heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
}

// travel target ring
const targetRing = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.72, 24),
  new THREE.MeshBasicMaterial({ color: 0xff8a5c, transparent: true, opacity: 0, side: THREE.DoubleSide })
);
scene.add(targetRing);

// ─── input ───────────────────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

const stickState = { active: false, x: 0, y: 0 };
if (IS_TOUCH) {
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  let sid = null, cx = 0, cy = 0;
  stick.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    sid = t.identifier;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stickState.active = true;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', e => {
    if (sid === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== sid) continue;
      const dx = (t.clientX - cx) / 42, dy = (t.clientY - cy) / 42;
      const len = Math.hypot(dx, dy) || 1;
      stickState.x = Math.abs(dx) > 1 ? dx / len : dx;
      stickState.y = Math.abs(dy) > 1 ? dy / len : dy;
      knob.style.transform = `translate(calc(-50% + ${stickState.x * 26}px), calc(-50% + ${stickState.y * 26}px))`;
    }
  }, { passive: true });
  window.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== sid) continue;
      sid = null; stickState.active = false; stickState.x = stickState.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    }
  });
}

// click / tap: buildings first, else travel to ground point
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = 0, downX = 0, downY = 0;
renderer.domElement.addEventListener('pointerdown', e => {
  downAt = performance.now(); downX = e.clientX; downY = e.clientY;
});
renderer.domElement.addEventListener('pointerup', e => {
  if (performance.now() - downAt > 350 || Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hitLm = ray.intersectObjects(clickables, false)[0];
  if (hitLm) { openCard(hitLm.object.userData.landmark); return; }
  const hitPlanet = ray.intersectObject(planet, false)[0];
  if (hitPlanet) {
    targetDir = hitPlanet.point.clone().normalize();
    targetRing.position.copy(posOn(targetDir, 0.12));
    alignToSurface(targetRing, targetDir);
    targetRing.rotateX(Math.PI / 2);
    targetRing.material.opacity = 0.9;
    hideHint();
  }
});
// hover cursor on buildings (desktop)
if (!IS_TOUCH) {
  renderer.domElement.addEventListener('pointermove', e => {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    renderer.domElement.style.cursor = ray.intersectObjects(clickables, false)[0] ? 'pointer' : 'default';
  });
}

// ─── project card ────────────────────────────────────────────────────────────
const cardEl = document.getElementById('card');
const cardTag = document.getElementById('card-tag');
const cardTitle = document.getElementById('card-title');
const cardDesc = document.getElementById('card-desc');
const cardVisit = document.getElementById('card-visit');
const cardEnter = document.getElementById('card-enter');
let openLm = null;
function openCard(lm) {
  openLm = lm;
  cardTag.textContent = lm.tag;
  cardTitle.textContent = lm.name;
  cardDesc.textContent = lm.desc;
  if (lm.url) { cardVisit.style.display = ''; cardVisit.href = lm.url; }
  else cardVisit.style.display = 'none';
  if (lm.enter) { cardEnter.style.display = ''; cardEnter.href = lm.enter; }
  else cardEnter.style.display = 'none';
  cardEl.classList.add('show');
  cardEl.setAttribute('aria-hidden', 'false');
}
function closeCard() {
  openLm = null;
  cardEl.classList.remove('show');
  cardEl.setAttribute('aria-hidden', 'true');
}
cardEl.querySelector('.c-close').addEventListener('click', closeCard);
window.addEventListener('keydown', e => { if (e.key === 'Escape') closeCard(); });

const hintEl = document.getElementById('controls-hint');
let hintHidden = false;
function hideHint() {
  if (!hintHidden) { hintHidden = true; setTimeout(() => hintEl.classList.add('hide'), 1200); }
}

// ─── main loop ───────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let introT = 0;
let nearLm = null;

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _desired = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // ── input → desired tangent direction ──
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (stickState.active) { ix += stickState.x; iz += -stickState.y; }
  const hasInput = Math.abs(ix) > 0.01 || Math.abs(iz) > 0.01;
  if (hasInput) { targetDir = null; targetRing.material.opacity = 0; hideHint(); }

  // camera-relative frame on the tangent plane
  _fwd.subVectors(courier.position, camera.position);
  _fwd.sub(dir.clone().multiplyScalar(_fwd.dot(dir))).normalize();
  _right.crossVectors(_fwd, dir).normalize();   // fwd × up = camera-right

  if (hasInput) {
    _desired.set(0, 0, 0).addScaledVector(_fwd, iz).addScaledVector(_right, ix).normalize();
    heading.lerp(_desired, 1 - Math.pow(0.0001, dt)).normalize();
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
  } else if (targetDir) {
    const arc = dir.angleTo(targetDir);
    if (arc < 0.02) { targetDir = null; targetRing.material.opacity = 0; }
    else {
      _desired.subVectors(targetDir, dir.clone().multiplyScalar(dir.dot(targetDir))).normalize();
      heading.lerp(_desired, 1 - Math.pow(0.0001, dt)).normalize();
      const slow = Math.min(1, arc / 0.12);
      speed = Math.min(MAX_SPEED * slow + 1.2, speed + ACCEL * dt);
    }
  } else {
    speed = Math.max(0, speed - DAMP * dt * (speed + 1));
  }

  // ── advance along the sphere ──
  if (speed > 0.001) {
    dir.multiplyScalar(R).addScaledVector(heading, speed * dt).normalize();
    heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
  }

  // ── place + orient courier ──
  const bob = Math.sin(t * 3.1) * 0.12;
  courier.position.copy(posOn(dir, HOVER + bob));
  _right.crossVectors(dir, heading);                     // up × fwd = local X
  _m.makeBasis(_right, dir, heading);
  _q.setFromRotationMatrix(_m);
  courier.quaternion.slerp(_q, 1 - Math.pow(0.0001, dt));
  courierBody.rotation.z = THREE.MathUtils.lerp(courierBody.rotation.z, -ix * 0.35, 0.12);
  courierBody.rotation.x = THREE.MathUtils.lerp(courierBody.rotation.x, iz * 0.18 * (speed / MAX_SPEED), 0.12);
  courierBody.userData.rotor.rotation.y += dt * (14 + speed * 2);

  // ── chase camera (eases from the intro orbit into place) ──
  introT = Math.min(1, introT + dt / 2.6);
  const ease = introT * introT * (3 - 2 * introT);
  const camPos = courier.position.clone()
    .addScaledVector(dir, CAM_H)
    .addScaledVector(heading, -CAM_D);
  camera.position.lerp(camPos, (0.028 + 0.06 * ease));
  camera.up.lerp(dir, 0.08).normalize();
  camera.lookAt(courier.position.clone().addScaledVector(dir, 1.1));

  // ── landmark proximity → open card ──
  let nearest = null, nearestArc = 1e9;
  for (const lm of LANDMARKS) {
    const a = dir.angleTo(lm.dir);
    if (a < nearestArc) { nearestArc = a; nearest = lm; }
    if (lm.gem) {
      lm.gem.rotation.y += dt * 1.5;
      lm.gem.position.y = 4.7 + Math.sin(t * 2 + lm.dir.x * 10) * 0.18;
      const target = (lm === nearLm) ? 1.35 : 1.0;
      lm.gem.scale.setScalar(THREE.MathUtils.lerp(lm.gem.scale.x, target, 0.1));
    }
  }
  if (nearLm && dir.angleTo(nearLm.dir) > FAR_ARC) {
    if (openLm === nearLm) closeCard();
    nearLm = null;
  }
  if (!nearLm && nearest && nearestArc < NEAR_ARC) {
    nearLm = nearest;
    openCard(nearest);
  }

  // labels always face up nicely (sprites auto-face camera; fade far ones)
  for (const lm of LANDMARKS) {
    if (!lm.label) continue;
    const d = camera.position.distanceTo(lm.label.position);
    lm.label.material.opacity = THREE.MathUtils.clamp(1.6 - d / 55, 0, 1);
  }

  // ── ambient motion ──
  for (const p of cloudPivots) p.rotateY(p.userData.speed * dt);
  stationPivot.rotateY(dt * 0.05);
  station.rotation.y += dt * 0.2;
  targetRing.material.opacity = Math.max(0, targetRing.material.opacity - dt * 0.25);
  sky.position.copy(camera.position);   // keep sky centered on the eye

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── go ──────────────────────────────────────────────────────────────────────
progress(1, 'ready!');
animate();
setTimeout(() => loaderEl.classList.add('hide'), 450);
