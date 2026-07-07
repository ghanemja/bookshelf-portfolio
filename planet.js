// ═══════════════════════════════════════════════════════════════════════════
// janelle's tiny planet — v3
// v1: spherical world, courier, project buildings, space station, library.
// v2: dreamy/classic gfx, day/night, ambient audio, engine particles.
// v3: DELIVERY QUESTS (compass, confetti, stamps, completion), collectible
//     stars, real oceans + beaches, animals (birds/sheep/fish), and an Art
//     Garden showing real paintings.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ─── tunables ────────────────────────────────────────────────────────────────
const R = 30;
const H_AMP = 1.15;
const SEA_H = -0.304;                 // sea level in surfH units (≈ R − 0.35)
const SEA_R = R + SEA_H * H_AMP;
const HOVER = 0.36;                   // jeep wheels on the ground

// ─── vibes: barbie (strawberry-lemonade world) ↔ bratz (the classic palette) ─
const VIBES = {
  barbie: {
    label: '💖 barbie',
    skyDay: [0xffe9a8, 0xffb3d1, 0xf48fc0], skyNight: [0x5c2a52, 0x3e1e48, 0x241634],
    fogDay: 0xffd6e5, fogNight: 0x4a2545,
    sunDay: 0xffe0ec, sunDusk: 0xff7fa8,
    hemiSky: 0xfff0f6, hemiGround: 0xc07898,
    terr: { deep: 0xd9a1b8, sand: 0xffe9b3, mid: 0xff9fc2, high: 0xf2c9e0, snow: 0xfff6fa },
    water: 0xff9fc0, leafA: 0xff8ab5, leafB: 0xffc2d8, wood: 0xf2e0d0, rock: 0xf4d9e8,
    cloud: 0xffe4ef, trail: 0xffc2d8,
  },
  bratz: {
    label: '😎 bratz',
    skyDay: [0xffd9b8, 0xd9c4f2, 0x9fc0ee], skyNight: [0x4a3e72, 0x342d5c, 0x1e2144],
    fogDay: 0xe3cfe8, fogNight: 0x3a3462,
    sunDay: 0xffe0b8, sunDusk: 0xff9a66,
    hemiSky: 0xfff2dd, hemiGround: 0x8a76b8,
    terr: { deep: 0xc9b287, sand: 0xefdca6, mid: 0x93ce9d, high: 0xbfaee0, snow: 0xf7f4fb },
    water: 0x6cbcdf, leafA: 0x7fbf8b, leafB: 0xa8d8a0, wood: 0x9a6b4f, rock: 0xcdc3dd,
    cloud: 0xffffff, trail: 0xffbe96,
  },
};
let vibe = (new URLSearchParams(location.search).get('vibe'))
  ?? localStorage.getItem('planet-vibe') ?? 'barbie';
if (!VIBES[vibe]) vibe = 'barbie';
const MAX_SPEED = 7.2;
const ACCEL = 13;
const DAMP = 4.5;
const TURN = 0.05;
const CAM_H = 2.5, CAM_D = 7.0;   // lower + closer: street-level, Season-style
const NEAR_ARC = 0.115, FAR_ARC = 0.165;
const DAY_PERIOD = 240;
const STAR_COUNT = 18;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260705);

// ─── loader ──────────────────────────────────────────────────────────────────
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
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
if (IS_TOUCH) document.body.classList.add('touch');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe3cfe8, 42, 155);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 26, 95);

// ─── "inked" mode: anime cel look — ink outlines from depth+normal edges ────
// 3-pass pipeline, built lazily: (1) color+depth → RT, (2) flat normals → RT,
// (3) fullscreen composite that draws sketchy ink lines on depth/normal
// discontinuities and posterizes the colors. Classic stays single-pass.
let inkReady = false;
let rtColor, rtNormal, normalOverride, inkQuad;
function ensureInk() {
  if (inkReady) return;
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = renderer.getPixelRatio();
  rtColor = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    depthTexture: new THREE.DepthTexture(w * dpr, h * dpr),
  });
  rtNormal = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  normalOverride = new THREE.MeshNormalMaterial({ flatShading: true });
  inkQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: rtColor.texture },
      tDepth: { value: rtColor.depthTexture },
      tNormal: { value: rtNormal.texture },
      res: { value: new THREE.Vector2(w * dpr, h * dpr) },
      camNear: { value: camera.near },
      camFar: { value: camera.far },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tColor, tDepth, tNormal;
      uniform vec2 res;
      uniform float camNear, camFar;

      float readDepth(vec2 uv) {
        float z = texture2D(tDepth, uv).x;
        float ndc = z * 2.0 - 1.0;
        return (2.0 * camNear * camFar) / (camFar + camNear - ndc * (camFar - camNear));
      }
      vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
      }
      void main() {
        vec2 px = 1.0 / res;
        // subtle hand-drawn wobble (kept small so lines stay solid, not specks)
        vec2 wob = hash22(floor(vUv * res / 6.0)) * px * 0.55;
        vec2 uv = vUv + wob;
        float o = 2.0;   // line thickness in pixels

        float d0 = readDepth(uv);
        float dN = readDepth(uv + vec2(0.0,  px.y * o));
        float dS = readDepth(uv - vec2(0.0,  px.y * o));
        float dE = readDepth(uv + vec2(px.x * o, 0.0));
        float dW = readDepth(uv - vec2(px.x * o, 0.0));
        float edgeD = abs(dN - dS) + abs(dE - dW);

        vec3 nN = texture2D(tNormal, uv + vec2(0.0,  px.y * o)).xyz;
        vec3 nS = texture2D(tNormal, uv - vec2(0.0,  px.y * o)).xyz;
        vec3 nE = texture2D(tNormal, uv + vec2(px.x * o, 0.0)).xyz;
        vec3 nW = texture2D(tNormal, uv - vec2(px.x * o, 0.0)).xyz;
        float edgeN = length(nN - nS) + length(nE - nW);

        float skyMask = 1.0 - step(camFar * 0.55, d0);   // no ink on the sky
        // depth threshold scales with distance so far hills don't fill solid
        float eD = smoothstep(0.3, 1.0, edgeD / (0.02 * d0 + 0.18));
        float eN = smoothstep(0.55, 1.15, edgeN);        // creases only, not facets
        float edge = clamp(eD + eN, 0.0, 1.0) * skyMask;

        vec3 col = texture2D(tColor, vUv).rgb;
        // cel posterize (soft) — skip the sky so gradients stay smooth
        vec3 post = floor(col * 6.0 + 0.5) / 6.0;
        col = mix(col, post, 0.5 * skyMask);
        // anime pop: gentle saturation + ink lines
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(lum), col, 1.18);
        vec3 ink = vec3(0.09, 0.10, 0.14);
        col = mix(col, ink, edge * 0.85);
        // proper linear → sRGB (RT holds tone-mapped linear)
        vec3 lo = col * 12.92;
        vec3 hi = 1.055 * pow(max(col, 0.0), vec3(1.0 / 2.4)) - 0.055;
        col = mix(lo, hi, step(0.0031308, col));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  inkReady = true;
}
function renderInked() {
  ensureInk();
  // pass 1: color + depth
  renderer.setRenderTarget(rtColor);
  renderer.render(scene, camera);
  // pass 2: flat normals (hide sky/sprites/particles so they don't get lines)
  const hidden = [];
  scene.traverse(o => {
    if ((o.isSprite || o === sky || o === skyStars) && o.visible) { o.visible = false; hidden.push(o); }
  });
  scene.overrideMaterial = normalOverride;
  renderer.setRenderTarget(rtNormal);
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  for (const o of hidden) o.visible = true;
  // pass 3: composite with ink lines
  renderer.setRenderTarget(null);
  inkQuad.render(renderer);
}
const gfxParam = new URLSearchParams(location.search).get('gfx');
let stored = gfxParam ?? localStorage.getItem('planet-gfx') ?? (IS_TOUCH ? 'classic' : 'inked');
if (stored === 'dreamy') stored = 'inked';   // migrate old setting
let gfxInked = stored === 'inked';
const gfxBtn = document.getElementById('gfx-toggle');
function applyGfx() {
  gfxBtn.textContent = gfxInked ? '🖌 inked' : '🧊 classic';
  scene.fog.near = gfxInked ? 40 : 42;
  scene.fog.far = gfxInked ? 145 : 155;
}
gfxBtn.addEventListener('click', () => {
  gfxInked = !gfxInked;
  localStorage.setItem('planet-gfx', gfxInked ? 'inked' : 'classic');
  applyGfx();
});

// day/night seeded from EST
function estHourNow() {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date());
    return (parseInt(p, 10) % 24) / 24;
  } catch { return 0.5; }
}
const todParam = new URLSearchParams(location.search).get('tod');   // ?tod=day|night|golden
const dayPhase0 = todParam === 'day' ? 0.5
  : todParam === 'night' ? 0.0
  : todParam === 'golden' ? 0.72
  : estHourNow();
let dayK = 1;

// ─── sky + stars ─────────────────────────────────────────────────────────────
const SKY = {
  day:   [new THREE.Color(0xffd9b8), new THREE.Color(0xd9c4f2), new THREE.Color(0x9fc0ee)],
  night: [new THREE.Color(0x3a2f5e), new THREE.Color(0x241f47), new THREE.Color(0x121430)],
};
const skyU = {
  cA: { value: SKY.day[0].clone() },
  cB: { value: SKY.day[1].clone() },
  cC: { value: SKY.day[2].clone() },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(420, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyU,
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vP; uniform vec3 cA,cB,cC;
      void main(){
        float h = normalize(vP).y*0.5+0.5;
        vec3 c = mix(cA, cB, smoothstep(0.05,0.52,h));
        c = mix(c, cC, smoothstep(0.5,0.95,h));
        gl_FragColor = vec4(c,1.0);
      }`,
  })
);
scene.add(sky);

let skyStars;
{
  const n = 800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(320 + rand() * 60);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  skyStars = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xfff6e8, size: 1.7, sizeAttenuation: true, transparent: true, opacity: 0.2, depthWrite: false,
  }));
  scene.add(skyStars);
}

// ─── lights ──────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0xfff2dd, 0x8a76b8, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b8, 1.5);
sun.position.set(60, 45, 30);
if (!IS_TOUCH) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 44;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.001;
}
scene.add(sun);
const moon = new THREE.DirectionalLight(0xa8c8f0, 0.35);
moon.position.set(-50, -20, -40);
scene.add(moon);

progress(0.12, 'charting the continents…');

// ─── landmarks (defined BEFORE terrain: buildings get land pedestals) ────────
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
    url: 'https://ghanemja.github.io/crochet/', dir: ll(24, 22) },
  { key: 'inbox', name: 'Inbox Zero', tag: 'tool', style: 'tower', color: 0x4e8eff,
    desc: 'Kanban for email — drag messages between todo / waiting / done.',
    url: 'https://ghanemja.github.io/inbox-zero-board/', dir: ll(2, 46) },
  { key: 'charterscope', name: 'CharterScope', tag: 'tool · nlp', style: 'lighthouse', color: 0x33c9ff,
    desc: 'Flags unusual clauses in maritime shipping contracts before you sign.',
    url: 'https://ghanemja.github.io/charterscope/', dir: ll(18, 76) },
  { key: 'deckgpt', name: 'DeckGPT', tag: 'ai', style: 'arch', color: 0xb265ff,
    desc: 'Prompt → branded PowerPoint. Slides that argue back.',
    url: 'https://pptgpt.netlify.app', dir: ll(-8, 100) },
  { key: 'council', name: 'The Council', tag: 'ai · agents', style: 'dome', color: 0x8f7ae8,
    desc: 'Specialist agents debate with citations; experts score the outcome.',
    dir: ll(16, 128) },
  { key: 'brainu', name: 'Brain U', tag: 'ai · learning', style: 'tower', color: 0xd06ee0,
    desc: 'Turns paper corpora into an adaptive curriculum with video lessons.',
    dir: ll(-2, 156) },
  { key: 'sinescape', name: 'Sinescape', tag: 'creative code', style: 'arch', color: 0x2dd47b,
    desc: 'Rebuilds an image from pure math — Fourier brushstrokes.',
    url: 'https://yeganeh-formula-studio.netlify.app', dir: ll(12, -176) },
  { key: 'pixels', name: 'Pixels → Params', tag: 'research', style: 'tower', color: 0xff8a3d,
    desc: 'Vision-language models for automated CAD design and optimization.',
    url: 'https://ghanemja.github.io/html/', dir: ll(-6, -148) },
  { key: 'ros2', name: 'Robot Lab', tag: 'robotics', style: 'dome', color: 0xff4d6e,
    desc: 'ROS2 + depth cameras + QNX — my robotics tutorials and demos.',
    url: 'https://ghanemja.github.io/ros2_depth_camera_tutorial/', dir: ll(14, -120) },
  { key: 'artgarden', name: 'The Art Garden', tag: 'paintings', style: 'garden', color: 0xffd23d,
    desc: 'A sculpture garden of my real acrylics — 45 paintings hang in the gallery inside the Library.',
    enter: './room.html', dir: ll(26, -66) },
];
const LAKE = ll(-40, 62);
const MTN = ll(55, -50);

// ─── terrain: continents + ocean + lake bay + mountain + land pedestals ─────
function surfH(d) {
  let h =
    Math.sin(d.x * 1.6 + 0.4) * Math.sin(d.y * 1.3 + 2.0) * Math.sin(d.z * 1.5 + 4.1) * 0.95 +   // continents
    Math.sin(d.x * 3.1 + 1.3) * Math.sin(d.y * 2.7 + 2.1) * Math.sin(d.z * 3.7 + 0.5) * 0.55 +
    Math.sin(d.x * 6.4 + 4.2) * Math.sin(d.z * 5.2 + 1.1) * 0.24 +
    Math.sin(d.y * 7.3 + 0.7) * 0.10;
  const aL = Math.acos(THREE.MathUtils.clamp(d.dot(LAKE), -1, 1));
  h -= 1.5 * Math.exp(-(aL * aL) / (0.16 * 0.16));                    // a bay
  const aM = Math.acos(THREE.MathUtils.clamp(d.dot(MTN), -1, 1));
  h += 2.7 * Math.exp(-(aM * aM) / (0.15 * 0.15));                    // the mountain
  for (const lm of LANDMARKS) {                                        // land under buildings
    const a = Math.acos(THREE.MathUtils.clamp(d.dot(lm.dir), -1, 1));
    h += (SEA_H + 0.55 - Math.min(h, SEA_H + 0.55)) * Math.exp(-(a * a) / (0.09 * 0.09));
  }
  return h;
}
const radiusAt = (d) => R + surfH(d) * H_AMP;
const posOn = (d, extra = 0) => d.clone().multiplyScalar(radiusAt(d) + extra);
const isLand = (d, margin = 0.15) => surfH(d) > SEA_H + margin;
const isWater = (d, margin = 0.2) => surfH(d) < SEA_H - margin;

const UP_Y = new THREE.Vector3(0, 1, 0);
function alignToSurface(obj, d, yaw = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP_Y, d);
  if (yaw) q.premultiply(new THREE.Quaternion().setFromAxisAngle(d, yaw));
  obj.quaternion.copy(q);
}
function randomDir() {
  return new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
}
function randomLandDir(minArcFromLandmarks = 0.12) {
  for (let i = 0; i < 60; i++) {
    const d = randomDir();
    if (!isLand(d)) continue;
    if (LANDMARKS.some(l => l.dir.angleTo(d) < minArcFromLandmarks)) continue;
    if (d.angleTo(MTN) < 0.085) continue;
    return d;
  }
  return LANDMARKS[0].dir.clone();
}
function randomWaterDir() {
  for (let i = 0; i < 60; i++) {
    const d = randomDir();
    if (isWater(d)) return d;
  }
  return LAKE.clone();
}

const planet = (() => {
  let g = new THREE.IcosahedronGeometry(R, 5).toNonIndexed();   // 4× mesh detail
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = radiusAt(v);
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

// paint (or repaint) the terrain colors for the active vibe
function paintTerrain(T) {
  const g = planet.geometry;
  const p = g.attributes.position;
  let colAttr = g.getAttribute('color');
  if (!colAttr) {
    colAttr = new THREE.BufferAttribute(new Float32Array(p.count * 3), 3);
    g.setAttribute('color', colAttr);
  }
  const jr = mulberry32(7);   // stable jitter across repaints
  const cDeep = new THREE.Color(T.deep), cSand = new THREE.Color(T.sand);
  const cMid = new THREE.Color(T.mid), cHigh = new THREE.Color(T.high), cSnow = new THREE.Color(T.snow);
  const c = new THREE.Color(), v = new THREE.Vector3();
  for (let f = 0; f < p.count; f += 3) {
    let h = 0;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, f + k); h += v.length() - R; }
    h /= 3 * H_AMP;
    if (h < SEA_H - 0.25) c.copy(cDeep);
    else if (h < SEA_H + 0.10) c.copy(cSand);
    else if (h < 0.45) c.copy(cSand).lerp(cMid, Math.min(1, (h - SEA_H - 0.10) / 0.35));
    else if (h < 1.15) c.copy(cMid).lerp(cHigh, (h - 0.45) / 0.7);
    else c.copy(cHigh).lerp(cSnow, Math.min(1, (h - 1.15) / 0.8));
    const jit = 0.965 + jr() * 0.07;
    for (let k = 0; k < 3; k++) colAttr.setXYZ(f + k, c.r * jit, c.g * jit, c.b * jit);
  }
  colAttr.needsUpdate = true;
}
paintTerrain(VIBES[vibe].terr);

// ocean — faceted translucent sphere at sea level
const ocean = new THREE.Mesh(
  new THREE.IcosahedronGeometry(SEA_R, 3),
  new THREE.MeshStandardMaterial({
    color: 0x6cbcdf, transparent: true, opacity: 0.82, roughness: 0.2, metalness: 0.05,
    flatShading: true, depthWrite: false,
  })
);
scene.add(ocean);

progress(0.28, 'planting forests…');

// ─── decorations (land only) ─────────────────────────────────────────────────
const deco = new THREE.Group();
scene.add(deco);
const M = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...opts });
const WOOD = M(0x9a6b4f), LEAF_A = M(0x7fbf8b), LEAF_B = M(0xa8d8a0), ROCK = M(0xcdc3dd);

function scatter(make, count) {
  for (let i = 0; i < count; i++) {
    const d = randomLandDir();
    const o = make();
    o.position.copy(posOn(d, -0.06));
    alignToSurface(o, d, rand() * Math.PI * 2);
    o.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
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
function rockDeco() {
  const s = 0.25 + rand() * 0.5;
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), ROCK);
  m.scale.set(1, 0.7 + rand() * 0.5, 1);
  return m;
}

progress(0.4, 'building the villages…');

// ─── buildings ───────────────────────────────────────────────────────────────
const landmarkGroup = new THREE.Group();
scene.add(landmarkGroup);
const clickables = [];
const texLoader = new THREE.TextureLoader();

function makeBuilding(lm) {
  const g = new THREE.Group();
  const body = M(lm.color);
  const trim = M(0xfff4e0);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 0.5, 10), M(0xd8cbb2));
  plat.position.y = 0.1; g.add(plat);

  if (lm.style === 'library') {
    const main = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.2, 2.2), body);
    main.position.y = 1.35; g.add(main);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.35, 1.3, 4), M(0xc7572a));
    roof.position.y = 3.1; roof.rotation.y = Math.PI / 4; g.add(roof);
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
  } else if (lm.style === 'garden') {
    // sculpture garden with three of the real paintings on display stands
    const arts = ['art_IMG_5262.jpg', 'art_cows_in_storm.jpg', 'art_IMG_0471.jpg'];
    arts.forEach((fn, i) => {
      const ang = (i - 1) * 0.85;
      const px = Math.sin(ang) * 1.5, pz = Math.cos(ang) * 1.15;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 6), WOOD);
      stand.position.set(px, 0.8, pz); g.add(stand);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.35, 0.1), M(0x8a6a3a));
      frame.position.set(px, 1.95, pz);
      frame.rotation.y = ang;
      g.add(frame);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      texLoader.load(`./artworks/${fn}`, (t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; });
      const canvasM = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.15), mat);
      canvasM.position.set(px, 1.95, pz);
      canvasM.rotation.y = ang;
      canvasM.translateZ(0.07);
      g.add(canvasM);
    });
    // floating sculpture
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.42, 0.13, 48, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd23d, emissive: 0x664c00, emissiveIntensity: 0.4, flatShading: true, roughness: 0.4 }));
    knot.position.set(0, 3.6, 0);
    g.add(knot);
    lm.sculpture = knot;
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
  } else {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.4, 0.7), body); l.position.set(-0.9, 1.55, 0); g.add(l);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.4, 0.7), body); r.position.set(0.9, 1.55, 0); g.add(r);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.55, 0.8), trim); top.position.y = 2.95; g.add(top);
  }

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

function makeLabel(lm) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = '700 58px "Fredoka", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(lm.name).width + 70;
  ctx.fillStyle = 'rgba(255, 250, 242, 0.92)';
  ctx.beginPath();
  ctx.roundRect((512 - w) / 2, 22, w, 84, 42);
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

scatter(pineTree, 64);
scatter(roundTree, 30);
scatter(rockDeco, 30);

// ─── main-street furniture: lamps line the route, cottages + flora fill it ──
function slerpDir(a, b, t) {
  const th = a.angleTo(b);
  if (th < 1e-4) return a.clone();
  const s = Math.sin(th);
  return a.clone().multiplyScalar(Math.sin((1 - t) * th) / s)
    .addScaledVector(b, Math.sin(t * th) / s).normalize();
}
function bandLandDir(minArc = 0.12) {   // sample near the equatorial street
  for (let i = 0; i < 60; i++) {
    const d = ll((rand() - 0.5) * 48, rand() * 360);
    if (!isLand(d)) continue;
    if (LANDMARKS.some(l => l.dir.angleTo(d) < minArc)) continue;
    return d;
  }
  return randomLandDir(minArc);
}
const lampBulbMat = new THREE.MeshStandardMaterial({
  color: 0xfff2c8, emissive: 0xffd98a, emissiveIntensity: 0.5,
});
function streetLamp() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.9, 6), M(0x4a3f54));
  pole.position.y = 0.95; g.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 5), M(0x4a3f54));
  arm.rotation.z = Math.PI / 2; arm.position.set(0.2, 1.86, 0); g.add(arm);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), lampBulbMat);
  bulb.position.set(0.42, 1.8, 0); g.add(bulb);
  return g;
}
// two lamps in every gap along the delivery route
for (let i = 0; i < LANDMARKS.length; i++) {
  const a = LANDMARKS[i].dir, b = LANDMARKS[(i + 1) % LANDMARKS.length].dir;
  for (const t of [0.35, 0.68]) {
    const d = slerpDir(a, b, t);
    if (!isLand(d, 0.05)) continue;
    const o = streetLamp();
    o.position.copy(posOn(d, -0.04));
    alignToSurface(o, d, rand() * Math.PI * 2);
    o.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    deco.add(o);
  }
}
const COTTAGE_COLORS = [0xffd9c2, 0xcfe8ff, 0xffe9b3, 0xe0d4ff, 0xd6f2d9];
function cottage() {
  const g = new THREE.Group(), s = 0.8 + rand() * 0.5;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 1.0 * s, 1.2 * s),
    M(COTTAGE_COLORS[Math.floor(rand() * COTTAGE_COLORS.length)]));
  body.position.y = 0.55 * s; g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25 * s, 0.8 * s, 4), M(0xb5654a));
  roof.position.y = 1.45 * s; roof.rotation.y = Math.PI / 4; g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.55 * s, 0.06), M(0x6b4a3a));
  door.position.set(0, 0.32 * s, 0.62 * s); g.add(door);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.28 * s, 0.05), lampBulbMat);
  win.position.set(0.42 * s, 0.62 * s, 0.62 * s); g.add(win);
  return g;
}
function bush() {
  const s = 0.35 + rand() * 0.35;
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), rand() > 0.5 ? LEAF_A : LEAF_B);
  m.scale.y = 0.7; m.position.y = s * 0.5;
  const g = new THREE.Group(); g.add(m); return g;
}
const FLOWER_COLORS = [0xff8ab5, 0xffd23d, 0xfff4f8, 0xb265ff];
function flowerPatch() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), LEAF_A);
    stem.position.set((rand() - 0.5) * 0.5, 0.15, (rand() - 0.5) * 0.5); g.add(stem);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0),
      M(FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)]));
    head.position.copy(stem.position).y += 0.2; g.add(head);
  }
  return g;
}
function placeBand(make, count, minArc = 0.1) {
  for (let i = 0; i < count; i++) {
    const d = bandLandDir(minArc);
    const o = make();
    o.position.copy(posOn(d, -0.05));
    alignToSurface(o, d, rand() * Math.PI * 2);
    o.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    deco.add(o);
  }
}
placeBand(cottage, 9, 0.13);
placeBand(bush, 30, 0.07);
placeBand(flowerPatch, 34, 0.06);

progress(0.52, 'releasing the animals…');

// ─── animals ─────────────────────────────────────────────────────────────────
// birds — flapping flocks orbiting low
const birdFlocks = [];
{
  const bodyM = M(0xfff4e0), wingM = M(0xd9c4f2);
  for (let f = 0; f < 3; f++) {
    const pivot = new THREE.Group();
    pivot.quaternion.setFromUnitVectors(UP_Y, randomDir());
    const flock = new THREE.Group();
    const birds = [];
    for (let b = 0; b < 5; b++) {
      const bird = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 5), bodyM);
      body.rotation.x = Math.PI / 2; bird.add(body);
      const wl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.16), wingM);
      wl.position.x = -0.28; bird.add(wl);
      const wr = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.16), wingM);
      wr.position.x = 0.28; bird.add(wr);
      bird.userData = { wl, wr, phase: rand() * Math.PI * 2 };
      bird.position.set((rand() - 0.5) * 2.4, (rand() - 0.5) * 1.2, (rand() - 0.5) * 2.4);
      flock.add(bird);
      birds.push(bird);
    }
    flock.position.y = R + 5.5 + rand() * 2.5;
    flock.rotation.y = rand() * Math.PI;
    pivot.add(flock);
    pivot.userData = { speed: 0.03 + rand() * 0.02, birds };
    scene.add(pivot);
    birdFlocks.push(pivot);
  }
}

// sheep — puffy grazers that hop in place
const sheepies = [];
{
  const woolM = M(0xfdf7ec), faceM = M(0x5d5375);
  for (let i = 0; i < 8; i++) {
    const d = bandLandDir(0.14);
    const s = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), woolM);
    body.position.y = 0.45; body.scale.set(1.15, 0.95, 1); s.add(body);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), faceM);
    head.position.set(0, 0.52, 0.45); s.add(head);
    for (const [lx, lz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.22], [0.2, 0.22]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 5), faceM);
      leg.position.set(lx, 0.13, lz); s.add(leg);
    }
    s.position.copy(posOn(d, -0.02));
    alignToSurface(s, d, rand() * Math.PI * 2);
    s.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    s.userData = { dir: d, phase: rand() * Math.PI * 2, body };
    scene.add(s);
    sheepies.push(s);
  }
}

// fish — arcs leaping out of the ocean
const fishes = [];
{
  const fishM = M(0xff9a5c, { roughness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const d = randomWaterDir();
    const axis = randomDir().cross(d).normalize();
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.62, 6), fishM);
    f.visible = false;
    scene.add(f);
    fishes.push({ mesh: f, dir: d, axis, period: 3.5 + rand() * 4, phase: rand() * 10 });
  }
}

progress(0.62, 'launching the space station…');

// ─── space station ───────────────────────────────────────────────────────────
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
  for (let i = 0; i < 6; i++) {
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

// clouds
const cloudPivots = [];
let cloudMat;
{
  const cloudM = cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, roughness: 1 });
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

progress(0.72, 'hiding the stars…');

// ─── collectible stars ───────────────────────────────────────────────────────
const collectedStars = new Set(JSON.parse(localStorage.getItem('planet-stars') || '[]'));
const starItems = [];
{
  const starM = new THREE.MeshStandardMaterial({
    color: 0xffd23d, emissive: 0xffb800, emissiveIntensity: 0.8, flatShading: true,
  });
  for (let i = 0; i < STAR_COUNT; i++) {
    const d = bandLandDir(0.09);
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), starM.clone());
    m.position.copy(posOn(d, HOVER + 0.55));
    m.visible = !collectedStars.has(i);
    scene.add(m);
    starItems.push({ mesh: m, dir: d, idx: i });
  }
}
function saveStars() { localStorage.setItem('planet-stars', JSON.stringify([...collectedStars])); }

// ─── the courier ─────────────────────────────────────────────────────────────
// the Tuscadero jeep — hot pink, doors off, parcel in the back. local +Z = forward
const courier = new THREE.Group();
const courierBody = (() => {
  const g = new THREE.Group();
  const PINK = M(0xff2e88, { roughness: 0.45 });      // tuscadero
  const PINK_D = M(0xe0176f, { roughness: 0.5 });
  const DARK = M(0x2d2138, { roughness: 0.7 });
  const SILVER = M(0xe8e2ea, { roughness: 0.35 });

  // tub + hood
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.35), PINK);
  tub.position.y = 0.62; g.add(tub);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.16, 0.8), PINK_D);
  hood.position.set(0, 0.95, 0.75); g.add(hood);
  // side fender flares
  for (const s of [-1, 1]) {
    const flare = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 2.3), PINK_D);
    flare.position.set(s * 0.8, 0.5, 0); g.add(flare);
  }
  // windshield
  const wsFrame = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.55, 0.08), DARK);
  wsFrame.position.set(0, 1.22, 0.42); wsFrame.rotation.x = -0.14; g.add(wsFrame);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xcfeef8, roughness: 0.15, transparent: true, opacity: 0.55 }));
  glass.position.set(0, 1.22, 0.46); glass.rotation.x = -0.14; g.add(glass);
  // grille + headlights + bumpers
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 0.08), SILVER);
  grille.position.set(0, 0.66, 1.2); g.add(grille);
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffedb0, emissiveIntensity: 0.9 }));
    hl.position.set(s * 0.45, 0.72, 1.24); g.add(hl);
  }
  for (const zz of [1.26, -1.26]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.12), SILVER);
    bumper.position.set(0, 0.36, zz); g.add(bumper);
  }
  // roll bar
  for (const s of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), DARK);
    bar.position.set(s * 0.6, 1.25, -0.42); g.add(bar);
  }
  const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.28, 6), DARK);
  cross.rotation.z = Math.PI / 2; cross.position.set(0, 1.58, -0.42); g.add(cross);
  // seats
  for (const s of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), M(0xfff4e0));
    seat.position.set(s * 0.36, 1.0, -0.05); g.add(seat);
  }
  // the parcel rides in the back
  const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), M(0xc9944a));
  parcel.position.set(0, 1.05, -0.85); parcel.rotation.y = 0.25; g.add(parcel);
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.12), M(0xff4d6e));
  ribbon.position.set(0, 1.05, -0.85); ribbon.rotation.y = 0.25; g.add(ribbon);
  // wheels (axis along X) + white hubs; spare on the tailgate
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.24, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.78, 0.78], [0.78, 0.78], [-0.78, -0.78], [0.78, -0.78]]) {
    const w = new THREE.Mesh(wheelGeo, DARK);
    w.position.set(wx, 0.34, wz);
    const hub = new THREE.Mesh(hubGeo, SILVER);
    w.add(hub);
    g.add(w);
    wheels.push(w);
  }
  const spare = new THREE.Mesh(wheelGeo, DARK);
  spare.rotation.y = Math.PI / 2;   // face rearward
  spare.position.set(0, 0.78, -1.32);
  g.add(spare);
  g.userData.wheels = wheels;
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
})();
courier.add(courierBody);
scene.add(courier);

let dir = ll(8, -22);           // spawn just east of the Library
let heading = new THREE.Vector3(0, 0, 1);
heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
let speed = 0;
let targetDir = null;

const targetRing = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.72, 24),
  new THREE.MeshBasicMaterial({ color: 0xff8a5c, transparent: true, opacity: 0, side: THREE.DoubleSide })
);
scene.add(targetRing);

// compass arrow — points along the surface toward the next delivery
const compass = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 0.75, 6),
  new THREE.MeshStandardMaterial({ color: 0xff8a5c, emissive: 0xff6a30, emissiveIntensity: 0.7, flatShading: true })
);
scene.add(compass);

// ─── particles: engine trail + confetti ──────────────────────────────────────
function radialTexture(inner, mid, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner); grad.addColorStop(0.5, mid); grad.addColorStop(1, outer);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
function makePool(n, tex, colored = false) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      color: colored ? new THREE.Color().setHSL(rand(), 0.85, 0.7) : 0xffffff,
    }));
    sp.scale.setScalar(0.4);
    scene.add(sp);
    pool.push({ sp, life: 0, maxLife: 1, vel: new THREE.Vector3(), grav: null });
  }
  return pool;
}
const trailTex = radialTexture('rgba(255,230,200,1)', 'rgba(255,190,150,0.55)', 'rgba(255,170,120,0)');
const trailPool = makePool(42, trailTex);
let trailIdx = 0;
function emitTrail(pos, backward, up) {
  const p = trailPool[trailIdx]; trailIdx = (trailIdx + 1) % trailPool.length;
  p.life = p.maxLife = 0.65 + Math.random() * 0.2;
  p.sp.position.copy(pos).addScaledVector(backward, 0.75).addScaledVector(up, -0.15);
  p.vel.copy(backward).multiplyScalar(2.2 + Math.random()).addScaledVector(up, 0.4 * (Math.random() - 0.3));
  p.vel.x += (Math.random() - 0.5) * 0.7; p.vel.y += (Math.random() - 0.5) * 0.7; p.vel.z += (Math.random() - 0.5) * 0.7;
  p.grav = null;
  p.sp.material.opacity = 0.85;
  p.sp.scale.setScalar(0.35 + Math.random() * 0.2);
}
const confettiTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)');
const confettiPool = makePool(30, confettiTex, true);
let confIdx = 0;
function burstConfetti(pos, up) {
  for (let i = 0; i < 26; i++) {
    const p = confettiPool[confIdx]; confIdx = (confIdx + 1) % confettiPool.length;
    p.life = p.maxLife = 1.1 + Math.random() * 0.4;
    p.sp.position.copy(pos);
    p.vel.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)
      .addScaledVector(up, 4 + Math.random() * 3);
    p.grav = up.clone().multiplyScalar(-7);
    p.sp.material.opacity = 1;
    p.sp.scale.setScalar(0.3 + Math.random() * 0.25);
  }
}
function updatePool(pool, dt) {
  for (const p of pool) {
    if (p.life <= 0) continue;
    p.life -= dt;
    const k = Math.max(0, p.life / p.maxLife);
    if (p.grav) p.vel.addScaledVector(p.grav, dt);
    p.sp.position.addScaledVector(p.vel, dt);
    p.sp.material.opacity = 0.9 * k;
    if (p.life <= 0) p.sp.material.opacity = 0;
  }
}

progress(0.82, 'loading the parcels…');

// ─── vibes toggle: repaint the whole world ───────────────────────────────────
const vibeBtn = document.getElementById('vibe-toggle');
function applyVibe() {
  const P = VIBES[vibe];
  vibeBtn.textContent = P.label;
  SKY.day.forEach((c, i) => c.setHex(P.skyDay[i]));
  SKY.night.forEach((c, i) => c.setHex(P.skyNight[i]));
  _fogDay.setHex(P.fogDay); _fogNight.setHex(P.fogNight);
  _sunDay.setHex(P.sunDay); _sunDusk.setHex(P.sunDusk);
  hemi.color.setHex(P.hemiSky); hemi.groundColor.setHex(P.hemiGround);
  ocean.material.color.setHex(P.water);
  LEAF_A.color.setHex(P.leafA); LEAF_B.color.setHex(P.leafB);
  WOOD.color.setHex(P.wood); ROCK.color.setHex(P.rock);
  cloudMat.color.setHex(P.cloud);
  for (const p of trailPool) p.sp.material.color.setHex(P.trail);
  paintTerrain(P.terr);
}
vibeBtn.addEventListener('click', () => {
  vibe = vibe === 'barbie' ? 'bratz' : 'barbie';
  localStorage.setItem('planet-vibe', vibe);
  applyVibe();
});

// ─── delivery quests ─────────────────────────────────────────────────────────
const QUEST_ORDER = ['library', 'yarnflow', 'inbox', 'charterscope', 'deckgpt',
  'council', 'brainu', 'sinescape', 'pixels', 'ros2', 'artgarden'];
const delivered = new Set(JSON.parse(localStorage.getItem('planet-delivered') || '[]'));
const questText = document.getElementById('quest-text');
const questCount = document.getElementById('quest-count');
const starCount = document.getElementById('star-count');
const lmByKey = Object.fromEntries(LANDMARKS.map(l => [l.key, l]));

function currentQuest() {
  const k = QUEST_ORDER.find(k => !delivered.has(k));
  return k ? lmByKey[k] : null;
}
function updateQuestHUD() {
  const q = currentQuest();
  questText.textContent = q ? `next delivery: ${q.name}` : 'all parcels delivered! 🎉';
  questCount.textContent = `${delivered.size}/${QUEST_ORDER.length}`;
  starCount.textContent = `⭐ ${collectedStars.size}/${STAR_COUNT}`;
}
function saveDelivered() { localStorage.setItem('planet-delivered', JSON.stringify([...delivered])); }

function deliverTo(lm) {
  if (!QUEST_ORDER.includes(lm.key) || delivered.has(lm.key)) return;
  delivered.add(lm.key);
  saveDelivered();
  burstConfetti(posOn(lm.dir, 4.5), lm.dir.clone());
  ping(680, 0.16); setTimeout(() => ping(920, 0.2), 130);
  updateQuestHUD();
  if (delivered.size === QUEST_ORDER.length) {
    setTimeout(() => openCard({
      name: 'Planet complete! 🎉', tag: 'every parcel delivered',
      desc: `You visited all ${QUEST_ORDER.length} projects and collected ${collectedStars.size}/${STAR_COUNT} stars. Thanks for flying — step into the Library to browse everything up close, or restart the route from the ↺ button.`,
      enter: './room.html',
    }), 700);
  }
}

document.getElementById('reset-progress').addEventListener('click', () => {
  localStorage.removeItem('planet-delivered');
  localStorage.removeItem('planet-stars');
  location.reload();
});

// ─── ambient audio ───────────────────────────────────────────────────────────
const AudioState = { ctx: null, master: null, engineGain: null, enabled: localStorage.getItem('planet-snd') !== 'off' };
const sndBtn = document.getElementById('snd-toggle');
function sndLabel() { sndBtn.textContent = AudioState.enabled ? '🔊 sound' : '🔇 muted'; }
sndLabel();

function startAudio() {
  if (AudioState.ctx) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = AudioState.enabled ? 0.14 : 0;
  master.connect(ctx.destination);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 760; lp.Q.value = 0.4;
  lp.connect(master);
  const breathe = ctx.createGain(); breathe.gain.value = 0.5; breathe.connect(lp);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
  const lfoAmp = ctx.createGain(); lfoAmp.gain.value = 0.22;
  lfo.connect(lfoAmp); lfoAmp.connect(breathe.gain); lfo.start();
  [[130.81, 0.06], [164.81, 0.05], [196.0, 0.045], [261.63, 0.02]].forEach(([f, g0], i) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    o.detune.value = (i - 1.5) * 4;
    const g = ctx.createGain(); g.gain.value = g0;
    const drift = ctx.createOscillator(); drift.frequency.value = 0.03 + i * 0.013;
    const driftAmp = ctx.createGain(); driftAmp.gain.value = 2.5;
    drift.connect(driftAmp); driftAmp.connect(o.detune); drift.start();
    o.connect(g); g.connect(breathe); o.start();
  });

  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
  const windG = ctx.createGain(); windG.gain.value = 0.05;
  const windLfo = ctx.createOscillator(); windLfo.frequency.value = 0.07;
  const windLfoAmp = ctx.createGain(); windLfoAmp.gain.value = 160;
  windLfo.connect(windLfoAmp); windLfoAmp.connect(bp.frequency); windLfo.start();
  noise.connect(bp); bp.connect(windG); windG.connect(master); noise.start();

  const eng = ctx.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 82;
  const engLp = ctx.createBiquadFilter(); engLp.type = 'lowpass'; engLp.frequency.value = 240;
  const engG = ctx.createGain(); engG.gain.value = 0;
  eng.connect(engLp); engLp.connect(engG); engG.connect(master); eng.start();

  AudioState.ctx = ctx; AudioState.master = master; AudioState.engineGain = engG; AudioState.engineOsc = eng;
}
function ping(freq = 880, dur = 0.18) {
  if (!AudioState.ctx || !AudioState.enabled) return;
  const ctx = AudioState.ctx;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g); g.connect(AudioState.master);
  o.start(); o.stop(ctx.currentTime + dur + 0.05);
}
const gestureStart = () => { startAudio(); window.removeEventListener('pointerdown', gestureStart); window.removeEventListener('keydown', gestureStart); };
window.addEventListener('pointerdown', gestureStart);
window.addEventListener('keydown', gestureStart);
sndBtn.addEventListener('click', () => {
  AudioState.enabled = !AudioState.enabled;
  localStorage.setItem('planet-snd', AudioState.enabled ? 'on' : 'off');
  startAudio();
  if (AudioState.master) {
    AudioState.master.gain.linearRampToValueAtTime(
      AudioState.enabled ? 0.14 : 0, AudioState.ctx.currentTime + 0.4);
  }
  sndLabel();
});

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
if (!IS_TOUCH) {
  renderer.domElement.addEventListener('pointermove', e => {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    renderer.domElement.style.cursor = ray.intersectObjects(clickables, false)[0] ? 'pointer' : 'default';
  });
}

// ─── card ────────────────────────────────────────────────────────────────────
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
let emitAcc = 0;

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _desired = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _back = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _sunDay = new THREE.Color(0xffe0b8), _sunDusk = new THREE.Color(0xff9a66);
const _fogDay = new THREE.Color(0xe3cfe8), _fogNight = new THREE.Color(0x241f47);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // input
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (stickState.active) { ix += stickState.x; iz += -stickState.y; }
  const hasInput = Math.abs(ix) > 0.01 || Math.abs(iz) > 0.01;
  if (hasInput) { targetDir = null; targetRing.material.opacity = 0; hideHint(); }

  _fwd.subVectors(courier.position, camera.position);
  _fwd.sub(dir.clone().multiplyScalar(_fwd.dot(dir))).normalize();
  _right.crossVectors(_fwd, dir).normalize();
  const turnK = 1 - Math.pow(TURN * (1 + speed / MAX_SPEED), dt);

  if (hasInput) {
    _desired.set(0, 0, 0).addScaledVector(_fwd, iz).addScaledVector(_right, ix).normalize();
    heading.lerp(_desired, turnK).normalize();
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
  } else if (targetDir) {
    const arc = dir.angleTo(targetDir);
    if (arc < 0.02) { targetDir = null; targetRing.material.opacity = 0; }
    else {
      _desired.subVectors(targetDir, dir.clone().multiplyScalar(dir.dot(targetDir))).normalize();
      heading.lerp(_desired, turnK).normalize();
      const slow = Math.min(1, arc / 0.12);
      speed = Math.min(MAX_SPEED * slow + 1.2, speed + ACCEL * dt);
    }
  } else {
    speed = Math.max(0, speed - DAMP * dt * (speed + 1));
  }

  if (speed > 0.001) {
    dir.multiplyScalar(R).addScaledVector(heading, speed * dt).normalize();
    heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
  }

  // suspension jiggle scales with speed (it's a jeep now, not a drone)
  const bob = Math.sin(t * 8.5) * 0.03 * (0.3 + speed / MAX_SPEED);
  // drive on whichever is higher: terrain or the sea surface (magic jeep)
  const groundR = Math.max(radiusAt(dir), SEA_R);
  courier.position.copy(dir.clone().multiplyScalar(groundR + HOVER + bob));
  _right.crossVectors(dir, heading);
  _m.makeBasis(_right, dir, heading);
  _q.setFromRotationMatrix(_m);
  courier.quaternion.slerp(_q, 1 - Math.pow(0.001, dt));
  courierBody.rotation.z = THREE.MathUtils.lerp(courierBody.rotation.z, -ix * 0.12, 0.09);
  courierBody.rotation.x = THREE.MathUtils.lerp(courierBody.rotation.x, iz * 0.07 * (speed / MAX_SPEED), 0.09);
  for (const w of courierBody.userData.wheels) w.rotation.x += dt * speed / 0.34;

  // engine particles + hum
  if (speed > 1.4) {
    emitAcc += dt * (5 + speed * 3.2);
    _back.copy(heading).negate();
    while (emitAcc >= 1) { emitAcc -= 1; emitTrail(courier.position, _back, dir); }
  }
  updatePool(trailPool, dt);
  updatePool(confettiPool, dt);
  if (AudioState.engineGain) {
    const g = (speed / MAX_SPEED);
    AudioState.engineGain.gain.setTargetAtTime(g * g * 0.05, AudioState.ctx.currentTime, 0.12);
    AudioState.engineOsc.frequency.setTargetAtTime(72 + g * 46, AudioState.ctx.currentTime, 0.15);
  }

  // chase camera
  introT = Math.min(1, introT + dt / 2.6);
  const ease = introT * introT * (3 - 2 * introT);
  const camPos = courier.position.clone()
    .addScaledVector(dir, CAM_H)
    .addScaledVector(heading, -CAM_D);
  camera.position.lerp(camPos, (0.02 + 0.05 * ease));
  camera.up.lerp(dir, 0.06).normalize();
  camera.lookAt(courier.position.clone().addScaledVector(dir, 1.1));

  // day/night
  const phase = (dayPhase0 + t / DAY_PERIOD) % 1;
  const sunEl = Math.sin((phase - 0.25) * Math.PI * 2);
  dayK = THREE.MathUtils.clamp(sunEl * 2.4 + 0.5, 0, 1);
  const th = (phase - 0.25) * Math.PI * 2;
  sun.position.set(Math.cos(th) * 70, Math.sin(th) * 60, 28);
  sun.intensity = 0.28 + 1.25 * dayK;
  const duskiness = 1 - Math.abs(sunEl);
  sun.color.copy(_sunDay).lerp(_sunDusk, THREE.MathUtils.clamp(duskiness * 1.4 - 0.2, 0, 1));
  hemi.intensity = 0.48 + 0.4 * dayK;
  moon.intensity = 0.3 + 0.45 * (1 - dayK);
  for (let i = 0; i < 3; i++) {
    skyU[['cA', 'cB', 'cC'][i]].value.copy(SKY.night[i]).lerp(SKY.day[i], dayK);
  }
  scene.fog.color.copy(_fogNight).lerp(_fogDay, dayK);
  skyStars.material.opacity = 0.15 + 0.75 * (1 - dayK);

  // landmark proximity → card + delivery
  let nearest = null, nearestArc = 1e9;
  for (const lm of LANDMARKS) {
    const a = dir.angleTo(lm.dir);
    if (a < nearestArc) { nearestArc = a; nearest = lm; }
    if (lm.gem) {
      lm.gem.rotation.y += dt * 1.5;
      lm.gem.position.y = 4.7 + Math.sin(t * 2 + lm.dir.x * 10) * 0.18;
      const target = (lm === nearLm) ? 1.35 : 1.0;
      lm.gem.scale.setScalar(THREE.MathUtils.lerp(lm.gem.scale.x, target, 0.1));
      lm.gem.material.emissiveIntensity = 0.9 + (1 - dayK) * 0.8;
      lampBulbMat.emissiveIntensity = 0.5 + (1 - dayK) * 1.9;
    }
    if (lm.sculpture) lm.sculpture.rotation.y += dt * 0.6;
  }
  if (nearLm && dir.angleTo(nearLm.dir) > FAR_ARC) {
    if (openLm === nearLm) closeCard();
    nearLm = null;
  }
  if (!nearLm && nearest && nearestArc < NEAR_ARC) {
    nearLm = nearest;
    openCard(nearest);
    deliverTo(nearest);
  }

  for (const lm of LANDMARKS) {
    if (!lm.label) continue;
    const d = camera.position.distanceTo(lm.label.position);
    lm.label.material.opacity = THREE.MathUtils.clamp(1.6 - d / 55, 0, 1);
  }

  // compass → next delivery
  const quest = currentQuest();
  if (quest && dir.angleTo(quest.dir) > NEAR_ARC) {
    compass.visible = true;
    _tan.subVectors(quest.dir, dir.clone().multiplyScalar(dir.dot(quest.dir))).normalize();
    compass.position.copy(courier.position).addScaledVector(dir, 1.9).addScaledVector(_tan, 0.9);
    compass.quaternion.setFromUnitVectors(UP_Y, _tan);
    compass.position.addScaledVector(dir, Math.sin(t * 3) * 0.08);
  } else {
    compass.visible = false;
  }

  // collect stars
  for (const s of starItems) {
    if (!s.mesh.visible) continue;
    s.mesh.rotation.y += dt * 2;
    s.mesh.position.copy(posOn(s.dir, HOVER + 0.55 + Math.sin(t * 2.4 + s.idx) * 0.15));
    if (dir.angleTo(s.dir) < 0.05) {
      s.mesh.visible = false;
      collectedStars.add(s.idx);
      saveStars();
      ping(1180, 0.14);
      burstConfetti(s.mesh.position, s.dir.clone());
      updateQuestHUD();
    }
  }

  // animals
  for (const f of birdFlocks) {
    f.rotateY(f.userData.speed * dt);
    for (const b of f.userData.birds) {
      const flap = Math.sin(t * 9 + b.userData.phase) * 0.7;
      b.userData.wl.rotation.z = flap;
      b.userData.wr.rotation.z = -flap;
    }
  }
  for (const s of sheepies) {
    const hop = Math.max(0, Math.sin(t * 2.2 + s.userData.phase)) * 0.22;
    s.position.copy(posOn(s.userData.dir, -0.02 + hop));
    s.userData.body.scale.y = 0.95 - hop * 0.25;
  }
  for (const f of fishes) {
    const u = ((t + f.phase) / f.period) % 1;
    if (u < 0.32) {
      const k = u / 0.32;
      f.mesh.visible = true;
      const d2 = f.dir.clone().applyAxisAngle(f.axis, (k - 0.5) * 0.05).normalize();
      const alt = SEA_R + Math.sin(k * Math.PI) * 1.25;
      f.mesh.position.copy(d2.multiplyScalar(alt));
      const pitch = (0.5 - k) * 2.2;
      f.mesh.quaternion.setFromUnitVectors(UP_Y, f.dir);
      f.mesh.rotateOnAxis(new THREE.Vector3(1, 0, 0), pitch);
    } else {
      f.mesh.visible = false;
    }
  }

  // ambient motion
  for (const p of cloudPivots) p.rotateY(p.userData.speed * dt);
  stationPivot.rotateY(dt * 0.05);
  station.rotation.y += dt * 0.2;
  targetRing.material.opacity = Math.max(0, targetRing.material.opacity - dt * 0.25);
  ocean.material.opacity = 0.78 + Math.sin(t * 0.7) * 0.05;
  ocean.rotation.y += dt * 0.004;
  sky.position.copy(camera.position);

  if (gfxInked) {
    renderInked();
  } else {
    renderer.render(scene, camera);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (inkReady) {
    const dpr = renderer.getPixelRatio();
    const w = window.innerWidth * dpr, h = window.innerHeight * dpr;
    rtColor.setSize(w, h);
    rtNormal.setSize(w, h);
    inkQuad.material.uniforms.res.value.set(w, h);
  }
});

// ─── go ──────────────────────────────────────────────────────────────────────
applyGfx();
applyVibe();
updateQuestHUD();
progress(1, 'ready!');
animate();
setTimeout(() => loaderEl.classList.add('hide'), 450);
