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
    road: 0x9c8295, roadLine: 0xfff2d8,
  },
  bratz: {
    label: '😎 bratz',
    skyDay: [0xbfe8e2, 0x8fd4cd, 0x6cc2bd], skyNight: [0x2e4a58, 0x1f3542, 0x14242e],
    fogDay: 0xa8ded8, fogNight: 0x2a4450,
    sunDay: 0xfff2d8, sunDusk: 0xffb37f,
    hemiSky: 0xf0fff8, hemiGround: 0x6f9a8a,
    terr: { deep: 0xb5a582, sand: 0xe8dcc0, mid: 0x8fbf7f, high: 0xbfae8e, snow: 0xf4f1e8 },
    water: 0x3f9db2, leafA: 0x4f8f5f, leafB: 0x7fb56f, wood: 0x8a6248, rock: 0xc2b8a4,
    cloud: 0xffffff, trail: 0xffe2b8,
    road: 0x8d8f96, roadLine: 0xf2ecd8,
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

// hand-made paper texture: speckle grain + soft blotches (tileable enough)
function makePaperTexture() {
  const s = 512, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, s, s);
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 88;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  ctx.filter = 'blur(1px)'; ctx.drawImage(cv, 0, 0); ctx.filter = 'none';
  for (let b = 0; b < 26; b++) {   // pigment blotches
    const x = Math.random() * s, y = Math.random() * s, r = 40 + Math.random() * 120;
    const v = Math.random() > 0.5 ? 255 : 0, a = 0.04 + Math.random() * 0.05;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v},${a})`);
    g.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
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
      tPaper: { value: makePaperTexture() },
      res: { value: new THREE.Vector2(w * dpr, h * dpr) },
      camNear: { value: camera.near },
      camFar: { value: camera.far },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tColor, tDepth, tNormal, tPaper;
      uniform vec2 res;
      uniform float camNear, camFar, time;

      float readDepth(vec2 uv) {
        float z = texture2D(tDepth, uv).x;
        float ndc = z * 2.0 - 1.0;
        return (2.0 * camNear * camFar) / (camFar + camNear - ndc * (camFar - camNear));
      }
      vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
      }
      // edge strength at uv with stroke width o (pixels)
      float edgeAt(vec2 uv, float o, float d0ref) {
        vec2 px = 1.0 / res;
        float dN = readDepth(uv + vec2(0.0, px.y * o));
        float dS = readDepth(uv - vec2(0.0, px.y * o));
        float dE = readDepth(uv + vec2(px.x * o, 0.0));
        float dW = readDepth(uv - vec2(px.x * o, 0.0));
        float edgeD = abs(dN - dS) + abs(dE - dW);
        vec3 nN = texture2D(tNormal, uv + vec2(0.0, px.y * o)).xyz;
        vec3 nS = texture2D(tNormal, uv - vec2(0.0, px.y * o)).xyz;
        vec3 nE = texture2D(tNormal, uv + vec2(px.x * o, 0.0)).xyz;
        vec3 nW = texture2D(tNormal, uv - vec2(px.x * o, 0.0)).xyz;
        float edgeN = length(nN - nS) + length(nE - nW);
        float eD = smoothstep(0.3, 1.0, edgeD / (0.02 * d0ref + 0.18));
        float eN = smoothstep(0.5, 1.1, edgeN);
        return clamp(eD + eN, 0.0, 1.0);
      }
      void main() {
        vec2 px = 1.0 / res;
        // "line boil": time stepped at 8fps, like hand-painted animation frames
        float tq = floor(time * 8.0) / 8.0;
        vec2 pj = hash22(vec2(tq * 7.3, tq * 3.1)) * 0.012;
        float paper = texture2D(tPaper, vUv * vec2(res.x / res.y, 1.0) * 2.6 + pj).r;
        // slow continuous pigment drift — the wash never quite dries
        float flow = texture2D(tPaper, vUv * vec2(res.x / res.y, 1.0) * 0.7
                               + vec2(time * 0.010, -time * 0.007)).r;
        float d0 = readDepth(vUv);
        float skyMask = 1.0 - step(camFar * 0.55, d0);

        // ── the ink: double-stroked, wobbling, redrawn every boil step
        vec2 wobA = hash22(floor(vUv * res / 6.0) + tq * 17.0) * px * 1.4;
        vec2 wobB = hash22(floor(vUv * res / 6.0) + 31.7 + tq * 17.0) * px * 2.4;
        float w = 1.5 + paper * 1.7;
        float e1 = edgeAt(vUv + wobA, w, d0);
        float e2 = edgeAt(vUv + wobB, w * 0.65, d0);
        float ink = clamp(e1 + e2 * 0.6, 0.0, 1.0) * skyMask;

        // ── the fill: watercolor washes whose boundaries slowly crawl
        vec3 col = texture2D(tColor, vUv).rgb;
        float pn = (paper - 0.5) + (flow - 0.5) * 0.55;
        vec3 post = floor(col * 5.0 + 0.5 + pn * 0.45) / 5.0;
        col = mix(col, post, 0.65 * skyMask);
        col *= 0.94 + 0.10 * paper + 0.05 * flow;

        // pencil hatching creeps into the shadows
        float lum0 = dot(col, vec3(0.299, 0.587, 0.114));
        float hatch = step(0.55, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
        col *= 1.0 - (1.0 - hatch) * smoothstep(0.45, 0.12, lum0) * 0.12 * skyMask;

        // pooled pigment beneath the line — cool blue, never gray
        col = mix(col, col * vec3(0.50, 0.55, 0.78), e1 * 0.35 * skyMask);

        // ── pastel watercolor grade: saturated but LIGHT, shadows go ultramarine
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = clamp(mix(vec3(lum), col, 1.35), 0.0, 1.0);   // vibrance — no more faded gray
        col = pow(col, vec3(0.80));                          // lift everything into pastel range
        float sh = 1.0 - smoothstep(0.06, 0.5, lum);
        col = mix(col, col * vec3(0.66, 0.70, 1.05) + vec3(0.10, 0.11, 0.24), sh * 0.55);
        col = col * 0.93 + 0.05;

        // …but the INK does: confident near-black sketch line on top
        vec3 inkCol = vec3(0.07, 0.07, 0.10);
        col = mix(col, inkCol, ink * 0.9);

        // grain washes over the sky
        col = mix(col * (0.95 + 0.08 * paper), col, skyMask);

        // linear → sRGB
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
  inkQuad.material.uniforms.time.value = clock.elapsedTime;
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
if (['dreamy', 'inked', 'watercolor'].includes(stored)) stored = 'sketch';   // migrate old settings
let gfxInked = stored === 'sketch';
const gfxBtn = document.getElementById('gfx-toggle');
function applyGfx() {
  gfxBtn.textContent = gfxInked ? '✏️ sketchbook' : '🧊 classic';
  scene.fog.near = gfxInked ? 40 : 42;
  scene.fog.far = gfxInked ? 145 : 155;
}
gfxBtn.addEventListener('click', () => {
  gfxInked = !gfxInked;
  localStorage.setItem('planet-gfx', gfxInked ? 'sketch' : 'classic');
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
  { key: 'artgarden', name: 'The Downtown Museum', tag: 'tonight’s main event', style: 'garden', color: 0xffd23d,
    desc: 'Opening night! A sculpture garden of my real acrylics — 45 paintings hang in the gallery inside.',
    enter: './room.html', dir: ll(26, -66) },
];
const LAKE = ll(-40, 62);
const MTN = ll(55, -50);

// extra route stops (train stations, the overlook, the boardwalk) — these are
// part of the world whether or not your route uses them
const STOP_DIRS = {
  central: ll(12, 4),        // Central Station, just east of the Library
  lakeside: ll(-26, 58),     // Lakeside Station, on the bay
  farside: ll(6, -168),      // Far Side Station, out past Sinescape
  museumst: ll(18, -74),     // Museum Station, walking distance to the event
  overlook: ll(44, -46),     // Summit Overlook, on the mountain's shoulder
  boardwalk: ll(-9, -38),    // Seaside Boardwalk, on the west coast
};
// stops that get flat land pedestals like landmarks do (not the overlook — it clings to the mountain)
const STOP_PEDESTALS = [STOP_DIRS.central, STOP_DIRS.lakeside, STOP_DIRS.farside, STOP_DIRS.museumst, STOP_DIRS.boardwalk];

// ─── terrain: continents + ocean + lake bay + mountain + land pedestals ─────
function surfH(d) {
  let h =
    Math.sin(d.x * 1.6 + 0.4) * Math.sin(d.y * 1.3 + 2.0) * Math.sin(d.z * 1.5 + 4.1) * 0.95 +   // continents
    Math.sin(d.x * 3.1 + 1.3) * Math.sin(d.y * 2.7 + 2.1) * Math.sin(d.z * 3.7 + 0.5) * 0.55 +
    Math.sin(d.x * 6.4 + 4.2) * Math.sin(d.z * 5.2 + 1.1) * 0.24 +
    Math.sin(d.y * 7.3 + 0.7) * 0.10;
  const stepH = 0.55;                                    // terraced cliffs
  h = h - (h - Math.round(h / stepH) * stepH) * 0.55;
  const aL = Math.acos(THREE.MathUtils.clamp(d.dot(LAKE), -1, 1));
  h -= 1.5 * Math.exp(-(aL * aL) / (0.16 * 0.16));                    // a bay
  const aM = Math.acos(THREE.MathUtils.clamp(d.dot(MTN), -1, 1));
  h += 2.7 * Math.exp(-(aM * aM) / (0.15 * 0.15));                    // the mountain
  for (const lm of LANDMARKS) {                                        // land under buildings
    const a = Math.acos(THREE.MathUtils.clamp(d.dot(lm.dir), -1, 1));
    h += (SEA_H + 0.55 - Math.min(h, SEA_H + 0.55)) * Math.exp(-(a * a) / (0.09 * 0.09));
  }
  for (const sd of STOP_PEDESTALS) {                                   // land under stations & boardwalk
    const a = Math.acos(THREE.MathUtils.clamp(d.dot(sd), -1, 1));
    h += (SEA_H + 0.55 - Math.min(h, SEA_H + 0.55)) * Math.exp(-(a * a) / (0.07 * 0.07));
  }
  return h;
}
const radiusAt = (d) => R + surfH(d) * H_AMP;
const posOn = (d, extra = 0) => d.clone().multiplyScalar(radiusAt(d) + extra);
const isLand = (d, margin = 0.15) => surfH(d) > SEA_H + margin;
const isWater = (d, margin = 0.2) => surfH(d) < SEA_H - margin;

// sit a structure on the LOWEST ground under its footprint (sunk a touch),
// so nothing floats off a slope or terrace edge
function settleOn(dirVec, halfExtent = 1.2, sink = 0.1) {
  let r = radiusAt(dirVec);
  const axisA = new THREE.Vector3(0, 1, 0).cross(dirVec).normalize();
  if (axisA.lengthSq() < 1e-6) axisA.set(1, 0, 0);
  const axisB = new THREE.Vector3().crossVectors(dirVec, axisA).normalize();
  const arc = halfExtent / R;
  for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]) {
    const d2 = dirVec.clone().applyAxisAngle(axisA, a * arc).applyAxisAngle(axisB, b * arc).normalize();
    r = Math.min(r, radiusAt(d2));
  }
  return dirVec.clone().multiplyScalar(Math.max(r, SEA_R) - sink);
}

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

  // lived-in clutter around each stop: crates, barrel, signpost, potted plants
  if (lm.style !== 'garden') {
    const crateM = M(0xc9a06a);
    const ca = rand() * Math.PI * 2;
    const cx = Math.sin(ca) * 1.65, cz = Math.cos(ca) * 1.65;
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), crateM);
    c1.position.set(cx, 0.56, cz); c1.rotation.y = rand(); g.add(c1);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), crateM);
    c2.position.set(cx + 0.36, 0.51, cz - 0.12); c2.rotation.y = rand(); g.add(c2);
    const c3 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), crateM);
    c3.position.set(cx - 0.05, 0.92, cz + 0.04); c3.rotation.y = rand() * 0.8; g.add(c3);
    const ba = ca + 1.6 + rand() * 1.2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.46, 9), M(0x9a6a44));
    barrel.position.set(Math.sin(ba) * 1.7, 0.58, Math.cos(ba) * 1.7); g.add(barrel);
    const sa = ca - 1.2 - rand() * 0.8;
    const sx = Math.sin(sa) * 1.85, sz = Math.cos(sa) * 1.85;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.05, 6), WOOD);
    pole.position.set(sx, 0.85, sz); g.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.34, 0.06), M(0xffd23d));
    board.position.set(sx, 1.28, sz);
    board.rotation.y = sa + Math.PI + (rand() - 0.5) * 0.5;
    board.rotation.z = (rand() - 0.5) * 0.12;
    g.add(board);
    for (let i = 0; i < 2; i++) {
      const pa = ca + 3 + i * 0.7 + rand() * 0.4;
      const px = Math.sin(pa) * 1.8, pz2 = Math.cos(pa) * 1.8;
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.2, 7), M(0xc76a3a));
      pot.position.set(px, 0.44, pz2); g.add(pot);
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), LEAF_A);
      bush.position.set(px, 0.62, pz2); g.add(bush);
    }
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
  b.position.copy(settleOn(lm.dir, 2.2, 0.14));
  alignToSurface(b, lm.dir, rand() * Math.PI * 2);
  landmarkGroup.add(b);
  lm.root = b;
}
document.fonts.ready.then(() => { LANDMARKS.forEach(makeLabel); makeVehicleSigns(); });

// trees grow in FOREST CLUMPS (like the reference), not lone scatter
function scatterClumps(make, clumpCount, perClump, spread = 0.055) {
  for (let c = 0; c < clumpCount; c++) {
    const center = randomLandDir(0.13);
    for (let i = 0; i < perClump; i++) {
      const axis = randomDir().cross(center).normalize();
      const d = center.clone().applyAxisAngle(axis, rand() * spread).normalize();
      if (!isLand(d, 0.08)) continue;
      const o = make();
      o.position.copy(posOn(d, -0.06));
      alignToSurface(o, d, rand() * Math.PI * 2);
      o.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
      deco.add(o);
    }
  }
}
scatterClumps(pineTree, 5, 8);
scatterClumps(roundTree, 5, 6);
scatter(rockDeco, 26);

// ─── the ROAD: a paved ribbon through every stop on the route ───────────────
function slerpDir(a, b, t) {
  const th = a.angleTo(b);
  if (th < 1e-4) return a.clone();
  const s = Math.sin(th);
  return a.clone().multiplyScalar(Math.sin((1 - t) * th) / s)
    .addScaledVector(b, Math.sin(t * th) / s).normalize();
}
const roadParts = [];   // tinted by the vibe toggle
{
  const pts = [];
  for (let i = 0; i < LANDMARKS.length; i++) {
    const a = LANDMARKS[i].dir, b = LANDMARKS[(i + 1) % LANDMARKS.length].dir;
    const n = 22;
    for (let k = 0; k < n; k++) pts.push(slerpDir(a, b, k / n));
  }
  function ribbon(halfW, lift, key, dashed = false) {
    const pos = [], idx = [];
    const lat = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const d = pts[i], dn = pts[(i + 1) % pts.length];
      const tang = dn.clone().sub(d.clone().multiplyScalar(d.dot(dn))).normalize();
      lat.crossVectors(d, tang).normalize();
      const r = Math.max(radiusAt(d), SEA_R) + lift;   // becomes a causeway over bays
      const p1 = d.clone().multiplyScalar(r).addScaledVector(lat, halfW);
      const p2 = d.clone().multiplyScalar(r).addScaledVector(lat, -halfW);
      pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      if (dashed && i % 4 >= 2) continue;
      const a0 = i * 2, a1 = i * 2 + 1, b0 = ((i + 1) % n) * 2, b1 = ((i + 1) % n) * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }));
    mesh.receiveShadow = true;
    scene.add(mesh);
    roadParts.push({ mesh, key });
    return mesh;
  }
  ribbon(1.62, 0.05, 'roadLine');            // pale shoulders peeking out
  ribbon(1.45, 0.065, 'road');               // asphalt
  ribbon(0.09, 0.08, 'roadLine', true);      // dashed centerline

  // pines line the road at regular intervals — planted, not scattered
  for (let i = 0; i < pts.length; i += 5) {
    const d = pts[i], dn = pts[(i + 1) % pts.length];
    const tang = dn.clone().sub(d.clone().multiplyScalar(d.dot(dn))).normalize();
    for (const s of [-1, 1]) {
      const dd = d.clone().applyAxisAngle(tang, s * 0.06).normalize();
      if (!isLand(dd, 0.1)) continue;
      if (LANDMARKS.some(l => l.dir.angleTo(dd) < 0.09)) continue;
      const o = pineTree();
      o.scale.setScalar(0.8);
      o.position.copy(posOn(dd, -0.06));
      alignToSurface(o, dd, rand() * Math.PI * 2);
      o.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
      deco.add(o);
    }
  }
}

// ─── the railway: open track through 4 stations, rails + ties + platforms ───
const TRAIN_STATIONS = ['central', 'lakeside', 'farside', 'museumst'];
const trackPts = [];
{
  for (let i = 0; i < TRAIN_STATIONS.length - 1; i++) {
    const a = STOP_DIRS[TRAIN_STATIONS[i]], b = STOP_DIRS[TRAIN_STATIONS[i + 1]];
    const n = 26;
    for (let k = 0; k < n; k++) trackPts.push(slerpDir(a, b, k / n));
  }
  trackPts.push(STOP_DIRS.museumst.clone());

  // open ribbon (no wraparound) — same trick as the road, raised a touch
  function railRibbon(offset, halfW, lift, color) {
    const pos = [], idx = [];
    const lat = new THREE.Vector3();
    for (let i = 0; i < trackPts.length; i++) {
      const d = trackPts[i], dn = trackPts[Math.min(i + 1, trackPts.length - 1)];
      const dp = trackPts[Math.max(i - 1, 0)];
      const tang = dn.clone().sub(dp.clone().multiplyScalar(dp.dot(dn))).normalize();
      lat.crossVectors(d, tang).normalize();
      const r = Math.max(radiusAt(d), SEA_R) + lift;
      const c = d.clone().multiplyScalar(r).addScaledVector(lat, offset);
      const p1 = c.clone().addScaledVector(lat, halfW);
      const p2 = c.clone().addScaledVector(lat, -halfW);
      pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
    for (let i = 0; i < trackPts.length - 1; i++) {
      const a0 = i * 2, a1 = i * 2 + 1, b0 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, M(color));
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  railRibbon(0, 0.55, 0.045, 0xb0a488);          // gravel bed
  railRibbon(0.3, 0.05, 0.075, 0x8b8fa0);        // rail
  railRibbon(-0.3, 0.05, 0.075, 0x8b8fa0);       // rail
  const _tieM = new THREE.Matrix4(), _tieLat = new THREE.Vector3();
  for (let i = 0; i < trackPts.length - 1; i += 2) {   // crossties
    const d = trackPts[i], dn = trackPts[i + 1];
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.16), WOOD);
    tie.position.copy(d.clone().multiplyScalar(Math.max(radiusAt(d), SEA_R) + 0.06));
    const tang = dn.clone().sub(d.clone().multiplyScalar(d.dot(dn))).normalize();
    _tieLat.crossVectors(d, tang).normalize();
    _tieM.makeBasis(_tieLat, d, tang);
    tie.quaternion.setFromRotationMatrix(_tieM);
    deco.add(tie);
  }
}

// station platform + canopy + sign; overlook cairn; boardwalk stand
function makeStation(dir, name) {
  const g = new THREE.Group();
  const plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.34, 1.7), M(0xd8cbb2));
  plat.position.y = 0.17; g.add(plat);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.25, 6), WOOD);
    post.position.set(s * 1.2, 0.95, -0.45); g.add(post);
  }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 1.15), M(0xc7572a));
  canopy.position.set(0, 1.62, -0.45); canopy.rotation.x = 0.09; g.add(canopy);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.34), WOOD);
  bench.position.set(0, 0.52, -0.55); g.add(bench);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.4, 0.07), M(0x2d6ea8));
  sign.position.set(1.35, 1.15, 0.35); g.add(sign);
  const lpole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), M(0x2d2138));
  lpole.position.set(-1.35, 0.9, 0.4); g.add(lpole);
  const lbulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd98a, emissiveIntensity: 1.1 }));
  lbulb.position.set(-1.35, 1.6, 0.4); g.add(lbulb);
  g.userData.stopName = name;
  return g;
}
const stopStructures = {};
{
  const names = { central: 'Central Station', lakeside: 'Lakeside Station', farside: 'Far Side Station', museumst: 'Museum Station' };
  TRAIN_STATIONS.forEach((key, i) => {
    const d = STOP_DIRS[key];
    const st = makeStation(d, names[key]);
    // platform long axis along the local track tangent, shifted off the rails
    // so the Museum Express pulls up BESIDE it (canopy side away from the track)
    const pi2 = Math.min(i * 26, trackPts.length - 1);
    const nb = i < TRAIN_STATIONS.length - 1 ? trackPts[pi2 + 1] : trackPts[pi2 - 1];
    const tang = nb.clone().sub(d.clone().multiplyScalar(d.dot(nb))).normalize();
    if (i === TRAIN_STATIONS.length - 1) tang.negate();   // neighbor is behind the last stop
    const sd = d.clone().applyAxisAngle(tang, -1.5 / R).normalize();   // ~1.5 units to the +lat side
    st.position.copy(settleOn(sd, 1.7, 0.12));
    const zAxis = new THREE.Vector3().crossVectors(tang, sd).normalize();
    st.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tang, sd, zAxis));
    scene.add(st);
    stopStructures[key] = st;
  });
  // Summit Overlook: stone cairn + telescope + bench facing the museum
  const ov = new THREE.Group();
  let cy = 0.16;
  for (const s of [0.34, 0.27, 0.19]) {
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), ROCK);
    stone.position.y = cy; cy += s * 0.9; ov.add(stone);
  }
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.75, 7), M(0x8f7ae8));
  scope.position.set(0.75, 0.85, 0); scope.rotation.z = -0.7; ov.add(scope);
  const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.8, 5), M(0x2d2138));
  tripod.position.set(0.75, 0.4, 0); ov.add(tripod);
  const obench = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.35), WOOD);
  obench.position.set(-0.8, 0.42, 0.2); ov.add(obench);
  ov.position.copy(settleOn(STOP_DIRS.overlook, 1.0, 0.1));
  alignToSurface(ov, STOP_DIRS.overlook, yawToFace(STOP_DIRS.overlook, lmByKeyLater('artgarden')));
  scene.add(ov);
  stopStructures.overlook = ov;
  // Seaside Boardwalk: planks + shave-ice stand with a striped awning
  const bw = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.09, 0.5), WOOD);
    plank.position.set(0, 0.12, -1.1 + i * 0.55); bw.add(plank);
  }
  const stand = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.8), M(0xfff4e0));
  stand.position.set(0.6, 0.65, -0.4); bw.add(stand);
  for (let i = 0; i < 4; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.95), M(i % 2 ? 0xff7eb6 : 0xfffaf2));
    strip.position.set(0.15 + i * 0.3, 1.28, -0.4); strip.rotation.z = 0.08; bw.add(strip);
  }
  bw.position.copy(settleOn(STOP_DIRS.boardwalk, 1.4, 0.1));
  alignToSurface(bw, STOP_DIRS.boardwalk, rand() * Math.PI * 2);
  scene.add(bw);
  stopStructures.boardwalk = bw;
}
// forward ref helper — LANDMARKS is defined above, lmByKey comes later
function lmByKeyLater(k) { return LANDMARKS.find(l => l.key === k).dir; }

// ─── attractions: the sailboat mooring + Cape Far Side launchpad ─────────────
const vehicleMeshes = [];
// the sailboat moors in the first open water off the boardwalk
let moorDir = null;
{
  const bwD = STOP_DIRS.boardwalk;
  const t1 = new THREE.Vector3(1, 0, 0).cross(bwD).normalize();
  const t2 = new THREE.Vector3().crossVectors(bwD, t1);
  outer: for (let ring = 0.07; ring <= 0.2; ring += 0.03) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const axis = t1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(t2, Math.sin(ang)).normalize();
      const d = bwD.clone().applyAxisAngle(axis, ring).normalize();
      if (isWater(d, 0.3)) { moorDir = d; break outer; }
    }
  }
  if (!moorDir) moorDir = LAKE.clone();   // the bay is always wet
}
const mooredBoat = buildBoat();
mooredBoat.position.copy(moorDir.clone().multiplyScalar(SEA_R + 0.1));
alignToSurface(mooredBoat, moorDir, rand() * Math.PI * 2);
scene.add(mooredBoat);
mooredBoat.traverse(m => { if (m.isMesh) { m.userData.vehicle = 'boat'; vehicleMeshes.push(m); } });

// Cape Far Side: launchpad, gantry, and a very eager rocket
const padDir = STOP_DIRS.farside.clone().applyAxisAngle(
  new THREE.Vector3(0, 1, 0).cross(STOP_DIRS.farside).normalize(), 0.12).normalize();
const padPos = settleOn(padDir, 1.7, 0.12);
// a surface tangent at the pad — the liftoff camera stands here to watch
const padSide = new THREE.Vector3(0, 1, 0).cross(padDir).normalize();
if (padSide.lengthSq() < 1e-6) padSide.set(1, 0, 0);
{
  const padG = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.35, 12), M(0xb8b2a6));
  slab.position.y = 0.17; padG.add(slab);
  const scorch = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.37, 10), M(0x5a5248));
  scorch.position.y = 0.17; padG.add(scorch);
  const gant = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.6, 0.22), M(0xd9534f));
  gant.position.set(1.0, 1.6, 0); padG.add(gant);
  const gantArm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.14), M(0xd9534f));
  gantArm.position.set(0.65, 2.6, 0); padG.add(gantArm);
  padG.position.copy(padPos);
  alignToSurface(padG, padDir);
  padG.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  scene.add(padG);
}
const rocketG = new THREE.Group();
{
  const rbody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 1.7, 10), M(0xf4f0e6, { roughness: 0.4 }));
  rbody.position.y = 1.35; rocketG.add(rbody);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 10), M(0xff4d6e));
  nose.position.y = 2.55; rocketG.add(nose);
  const win = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 10), M(0x33c9ff));
  win.position.y = 1.8; rocketG.add(win);
  for (let f = 0; f < 3; f++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.42), M(0xff4d6e));
    const fa = (f / 3) * Math.PI * 2;
    fin.position.set(Math.sin(fa) * 0.42, 0.65, Math.cos(fa) * 0.42);
    fin.rotation.y = fa;
    rocketG.add(fin);
  }
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.3, 10), M(0x4a4454));
  bell.position.y = 0.42; rocketG.add(bell);
  rocketG.position.copy(padPos.clone().addScaledVector(padDir, 0.3));
  alignToSurface(rocketG, padDir);
  rocketG.traverse(m => { if (m.isMesh) { m.userData.vehicle = 'rocket'; vehicleMeshes.push(m); if (!IS_TOUCH) m.castShadow = true; } });
  scene.add(rocketG);
}
const rocketHome = rocketG.position.clone();
const rocketHomeQ = rocketG.quaternion.clone();

function tinySign(text, pos) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c2 = cv.getContext('2d');
  c2.font = '700 52px "Fredoka", system-ui, sans-serif';
  c2.textAlign = 'center'; c2.textBaseline = 'middle';
  const w = c2.measureText(text).width + 60;
  c2.fillStyle = 'rgba(255, 250, 242, 0.92)';
  c2.beginPath(); c2.roundRect((512 - w) / 2, 24, w, 80, 40); c2.fill();
  c2.fillStyle = '#2d2138';
  c2.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(5.2, 1.3, 1);
  sp.position.copy(pos);
  scene.add(sp);
  return sp;
}
function makeVehicleSigns() {
  tinySign('⛵ go sailing', mooredBoat.position.clone().addScaledVector(moorDir, 2.6));
  tinySign('🚀 space tour', rocketHome.clone().addScaledVector(padDir, 3.6));
}

// ─── little people: NPCs who hand you things for the museum ─────────────────
function makePerson(bodyHex, hatHex = null) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.55, 8), M(bodyHex));
  body.position.y = 0.45; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), M(0xffd9b8));
  head.position.y = 0.9; g.add(head);
  if (hatHex !== null) {
    const beret = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.09, 9), M(hatHex));
    beret.position.set(0.03, 1.04, 0); beret.rotation.z = 0.22; g.add(beret);
  }
  g.userData.head = head;
  return g;
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
// yaw that turns a surface object to face a target point along the ground
function yawToFace(d, target) {
  const q0 = new THREE.Quaternion().setFromUnitVectors(UP_Y, d);
  const v0 = new THREE.Vector3(0, 0, 1).applyQuaternion(q0);
  const f = target.clone().sub(d.clone().multiplyScalar(d.dot(target))).normalize();
  const c = new THREE.Vector3().crossVectors(v0, f);
  return Math.atan2(c.dot(d), v0.dot(f));
}
// cottages flank each stop across the road, FACING it — deliberate villages
for (let i = 0; i < LANDMARKS.length; i++) {
  const lm = LANDMARKS[i];
  const nxt = LANDMARKS[(i + 1) % LANDMARKS.length];
  const tang = nxt.dir.clone().sub(lm.dir.clone().multiplyScalar(lm.dir.dot(nxt.dir))).normalize();
  for (const s of [-1, 1]) {
    const d = lm.dir.clone().applyAxisAngle(tang, s * 0.085).normalize();
    if (!isLand(d, 0.02)) continue;
    if (LANDMARKS.some(l => l !== lm && l.dir.angleTo(d) < 0.07)) continue;
    const o = cottage();
    o.position.copy(settleOn(d, 1.0, 0.12));
    alignToSurface(o, d, yawToFace(d, lm.dir));
    o.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    deco.add(o);
  }
}
placeBand(bush, 30, 0.07);
placeBand(flowerPatch, 34, 0.06);

// ─── hand-placed set pieces ──────────────────────────────────────────────────
// town plaza at the Library: paved circle ringed with benches
{
  const lib = LANDMARKS[0];
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.3, 20), M(0xcfc4b2));
  disc.position.copy(settleOn(lib.dir, 3.2, 0.16));
  alignToSurface(disc, lib.dir);
  disc.receiveShadow = true;
  scene.add(disc);
  const t1 = new THREE.Vector3(1, 0, 0).cross(lib.dir).normalize();
  const t2 = new THREE.Vector3().crossVectors(lib.dir, t1);
  for (let k = 0; k < 4; k++) {
    const ang = k * Math.PI / 2 + Math.PI / 4;
    const axis = t1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(t2, Math.sin(ang)).normalize();
    const d = lib.dir.clone().applyAxisAngle(axis, 0.115).normalize();
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.45), WOOD);
    seat.position.y = 0.45; bench.add(seat);
    for (const sx of [-0.5, 0.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.4), WOOD);
      leg.position.set(sx, 0.22, 0); bench.add(leg);
    }
    bench.position.copy(settleOn(d, 0.7, 0.08));
    alignToSurface(bench, d, yawToFace(d, lib.dir));
    bench.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    deco.add(bench);
  }
}
// harbor dock at CharterScope — planks reach toward the nearest water
{
  const cs = LANDMARKS[3];
  const t1 = new THREE.Vector3(1, 0, 0).cross(cs.dir).normalize();
  const t2 = new THREE.Vector3().crossVectors(cs.dir, t1);
  let best = null, bestH = 1e9;
  for (let k = 0; k < 16; k++) {
    const ang = k / 16 * Math.PI * 2;
    const axis = t1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(t2, Math.sin(ang)).normalize();
    const d = cs.dir.clone().applyAxisAngle(axis, 0.1).normalize();
    const h = surfH(d);
    if (h < bestH) { bestH = h; best = axis; }
  }
  if (bestH < SEA_H + 0.12) {
    for (let k = 0; k < 5; k++) {
      const d = cs.dir.clone().applyAxisAngle(best, 0.035 + k * 0.017).normalize();
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.85), WOOD);
      plank.position.copy(d.clone().multiplyScalar(SEA_R + 0.35));
      alignToSurface(plank, d, yawToFace(d, cs.dir));
      if (!IS_TOUCH) plank.castShadow = true;
      deco.add(plank);
      if (k % 2 === 1) for (const s of [-0.45, 0.45]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), WOOD);
        post.position.copy(d.clone().multiplyScalar(SEA_R + 0.1));
        alignToSurface(post, d);
        post.translateX(s);
        deco.add(post);
      }
    }
  }
}

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
      puff.scale.y = 0.45;
      cl.add(puff);
    }
    cl.position.y = R + 4.5 + rand() * 2.5;
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

// ─── the courier: one group, four possible rides. local +Z = forward ─────────
const courier = new THREE.Group();
// the Tuscadero jeep — hot pink, doors off, parcel in the back
function buildJeep() {
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
}

// the art critic on foot — beret, scarf, satchel, phone held high
function buildCritic() {
  const g = new THREE.Group();
  const p = makePerson(0x2d2138, 0xff4d6e);
  p.scale.setScalar(1.5);
  g.add(p);
  const scarf = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.16, 8), M(0xffd23d));
  scarf.position.y = 1.13; g.add(scarf);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.62, 6), M(0x2d2138));
  arm.position.set(0.36, 1.3, 0.1); arm.rotation.z = -0.85; g.add(arm);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.04), M(0x1c1626));
  phone.position.set(0.62, 1.62, 0.1); phone.rotation.z = -0.2; g.add(phone);
  const phoneGlow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.27, 0.015),
    new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x9fd8ff, emissiveIntensity: 0.9 }));
  phoneGlow.position.set(0.62, 1.62, 0.125); phoneGlow.rotation.z = -0.2; g.add(phoneGlow);
  const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.14), M(0x9a6b4f));
  satchel.position.set(-0.36, 0.72, -0.05); g.add(satchel);
  g.userData.wheels = [];
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
}

// the rental bike — basket in front, critic in the saddle
function buildBike() {
  const g = new THREE.Group();
  const FR = M(0x33c9ff, { roughness: 0.4 });
  const DARK = M(0x2d2138);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.09, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const z of [0.52, -0.52]) {
    const w = new THREE.Mesh(wheelGeo, DARK);
    w.position.set(0, 0.32, z); g.add(w); wheels.push(w);
  }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), FR);
  tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.55, 0); g.add(tube);
  const seatPost = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 6), FR);
  seatPost.position.set(0, 0.75, -0.4); g.add(seatPost);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.3), DARK);
  seat.position.set(0, 0.97, -0.4); g.add(seat);
  const barPost = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), FR);
  barPost.position.set(0, 0.78, 0.45); barPost.rotation.x = 0.2; g.add(barPost);
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), DARK);
  bars.rotation.z = Math.PI / 2; bars.position.set(0, 1.0, 0.4); g.add(bars);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.3), M(0xc9a06a));
  basket.position.set(0, 0.86, 0.62); g.add(basket);
  const rider = makePerson(0x2d2138, 0xff4d6e);
  rider.position.set(0, 0.5, -0.35);
  g.add(rider);
  g.userData.wheels = wheels;
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
}

// the day-sailer — white sails, wooden hull, critic at the tiller
function buildBoat() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 2.3), WOOD);
  hull.position.y = 0.42; g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.8, 4), WOOD);
  bow.rotation.x = Math.PI / 2; bow.rotation.z = Math.PI / 4;
  bow.position.set(0, 0.42, 1.5); g.add(bow);
  const gunwale = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 2.4), M(0xc7572a));
  gunwale.position.y = 0.66; g.add(gunwale);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 6), M(0x8a6a3a));
  mast.position.set(0, 1.8, 0.3); g.add(mast);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), M(0x8a6a3a));
  boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.95, -0.45); g.add(boom);
  // canvas is lit from both sides — the trimmed-out sail faces away from the
  // sun half the time and would otherwise read as a grey slab
  const sailM = new THREE.MeshStandardMaterial({
    color: 0xfffaf0, roughness: 0.85, flatShading: true, side: THREE.DoubleSide,
    emissive: 0xfff0dc, emissiveIntensity: 0.42,
  });
  // sails are trimmed out on a broad reach — dead fore-and-aft they'd be
  // edge-on to the chase camera and read as an invisible sliver
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.7), sailM);
  sail.rotation.y = Math.PI / 2 - 0.62;
  sail.position.set(-0.28, 1.85, -0.35); g.add(sail);
  const jib = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.1), sailM);
  jib.rotation.y = Math.PI / 2 - 0.5;
  jib.position.set(-0.14, 1.5, 0.85); g.add(jib);
  const rider = makePerson(0x2d2138, 0xff4d6e);
  rider.position.set(0, 0.72, -0.75);   // sits ON the deck, not in it
  g.add(rider);
  g.userData.wheels = [];
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
}

// the Museum Express — a stubby engine with the critic waving from the cab
function buildTrain() {
  const g = new THREE.Group();
  const BODY = M(0x2d6ea8, { roughness: 0.5 });
  const TRIM = M(0xffd23d);
  const DARK = M(0x2d2138);
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12), BODY);
  boiler.rotation.x = Math.PI / 2; boiler.position.set(0, 0.85, 0.45); g.add(boiler);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.14, 12), TRIM);
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.85, 1.22); g.add(nose);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.42, 8), DARK);
  chimney.position.set(0, 1.5, 0.95); g.add(chimney);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.9), BODY);
  cab.position.set(0, 1.05, -0.75); g.add(cab);
  const roofC = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 1.05), TRIM);
  roofC.position.set(0, 1.62, -0.75); g.add(roofC);
  const cow = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 4), TRIM);
  cow.rotation.x = Math.PI / 2; cow.rotation.z = Math.PI / 4;
  cow.position.set(0, 0.42, 1.35); g.add(cow);
  const lampT = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffedb0, emissiveIntensity: 1.0 }));
  lampT.position.set(0, 1.18, 1.3); g.add(lampT);
  const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.14, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.5, 0.7], [0.5, 0.7], [-0.5, 0.0], [0.5, 0.0], [-0.5, -0.8], [0.5, -0.8]]) {
    const w = new THREE.Mesh(wheelGeo, DARK);
    w.position.set(wx, 0.28, wz); g.add(w); wheels.push(w);
  }
  const rider = makePerson(0x2d2138, 0xff4d6e);
  rider.position.set(0, 0.8, -0.75);
  g.add(rider);
  g.userData.wheels = wheels;
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
}

const bodies = { jeep: buildJeep(), walk: buildCritic(), bike: buildBike(), train: buildTrain(), boat: buildBoat() };
for (const k of Object.keys(bodies)) { bodies[k].visible = (k === 'jeep'); courier.add(bodies[k]); }
let courierBody = bodies.jeep;
scene.add(courier);

// how each ride handles: top speed, pickup, ride height, camera distance
const TRANSPORT = {
  jeep: { max: 7.2, accel: 13, hover: 0.36, camH: 2.5, camD: 7.0, emoji: '🚙', label: 'rental jeep', engine: true },
  bike: { max: 4.8, accel: 9, hover: 0.12, camH: 2.2, camD: 6.0, emoji: '🚲', label: 'bike', engine: false },
  walk: { max: 2.8, accel: 8, hover: 0.03, camH: 1.9, camD: 4.8, emoji: '🚶', label: 'on foot', engine: false },
  train: { max: 8.5, accel: 6, hover: 0.16, camH: 3.0, camD: 8.6, emoji: '🚂', label: 'the Museum Express', engine: true, rail: true },
  boat: { max: 6.2, accel: 7, hover: 0.1, camH: 2.4, camD: 7.4, emoji: '⛵', label: 'sailboat', engine: false },
};
let transport = 'jeep';
let runTransport = 'jeep';   // the mode the run STARTED with (the train ends on foot)
function setTransport(t) {
  transport = t;
  for (const k of Object.keys(bodies)) bodies[k].visible = (k === t);
  courierBody = bodies[t];
  courierBody.rotation.set(0, 0, 0);
  updateNav();
}

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
  for (const rp of roadParts) rp.mesh.material.color.setHex(P[rp.key]);
  paintTerrain(P.terr);
}
vibeBtn.addEventListener('click', () => {
  vibe = vibe === 'barbie' ? 'bratz' : 'barbie';
  localStorage.setItem('planet-vibe', vibe);
  applyVibe();
});

// ─── the GPS run: routes, NPC side quests, the navigator ─────────────────────
const questText = document.getElementById('quest-text');
const questCount = document.getElementById('quest-count');
const starCount = document.getElementById('star-count');
const lmByKey = Object.fromEntries(LANDMARKS.map(l => [l.key, l]));

// cumulative arc along the railway + where each station sits on it
const trackArc = [0];
for (let i = 1; i < trackPts.length; i++) trackArc.push(trackArc[i - 1] + trackPts[i - 1].angleTo(trackPts[i]));
const stationU = TRAIN_STATIONS.map((k, i) => trackArc[Math.min(i * 26, trackArc.length - 1)]);
const _tanTmp = new THREE.Vector3();
function sampleTrack(u, outDir, outTan) {
  let i = 0;
  while (i < trackArc.length - 2 && trackArc[i + 1] < u) i++;
  const span = Math.max(1e-6, trackArc[i + 1] - trackArc[i]);
  const f = THREE.MathUtils.clamp((u - trackArc[i]) / span, 0, 1);
  outDir.copy(slerpDir(trackPts[i], trackPts[i + 1], f));
  outTan.copy(trackPts[i + 1]).sub(_tanTmp.copy(trackPts[i]).multiplyScalar(trackPts[i].dot(trackPts[i + 1]))).normalize();
}

// every stop: who's there, what they say (per transport), what they hand you
const STOPS = {};
function defStop(key, o) {
  const lm = o.dirOf ? lmByKey[o.dirOf] : null;
  STOPS[key] = { key, name: o.name ?? lm.name, dir: o.dir ?? lm.dir, lm, npc: o.npc, line: o.line, item: o.item, switchTo: o.switchTo };
}
defStop('library', { dirOf: 'library', npc: { face: '📚', name: 'Bea the librarian' }, item: '📖',
  line: {
    jeep: 'The critic! Your rental’s gassed up. Take this rare exhibition catalog with you — the museum wants it on the front desk tonight!',
    walk: 'Walking over the summit? Brave choice. Would you carry this exhibition catalog? The view up there is worth every step.',
    bike: 'Taking the coastal path? Lovely. Here — the museum needs this exhibition catalog for opening night!',
  } });
defStop('inbox', { dirOf: 'inbox', npc: { face: '✉️', name: 'Piet the postmaster' }, item: '💌',
  line: { all: 'Disaster! The opening-night invitations never went out. You’re driving there anyway — deliver them for me and I’ll owe you forever!' } });
defStop('deckgpt', { dirOf: 'deckgpt', npc: { face: '🎤', name: 'Nova the curator' }, item: '📊',
  line: { all: 'My artist talk is TONIGHT and my slides are here. Take the deck — I’ll catch the next ride. Don’t let them argue with anyone on the way!' } });
defStop('sinescape', { dirOf: 'sinescape', npc: { face: '📐', name: 'Yeganeh the mathematician' }, item: '🌀',
  line: { all: 'One formula print, fresh off the plotter — pure math, pure art. Hang it well, critic. The curves must face the light.' } });
defStop('ros2', { dirOf: 'ros2', npc: { face: '🤖', name: 'Turing the robot' }, item: '🖼️',
  line: { all: 'BEEP. MY FIRST PAINTING. ACRYLIC ON CANVAS. PLEASE DELIVER TO MUSEUM. DO NOT FOLD. I AM… NERVOUS.' } });
defStop('overlook', { dir: STOP_DIRS.overlook, name: 'Summit Overlook', npc: { face: '🥾', name: 'Hana the hiker' }, item: '🎨',
  line: { all: 'You hiked up too?! Best view on the planet. Take my plein-air sketch down to the museum — careful, the paint’s still wet!' } });
defStop('boardwalk', { dir: STOP_DIRS.boardwalk, name: 'Seaside Boardwalk', npc: { face: '🍧', name: 'Coco the vendor' }, item: '🍧',
  line: { all: 'Museum opening? Take the director her strawberry shaved ice — pedal FAST, it’s already melting!' } });
defStop('central', { dir: STOP_DIRS.central, name: 'Central Station', npc: { face: '🚂', name: 'Casey the conductor' }, item: '🎫',
  line: { all: 'All aboard the Museum Express! Three stops, almost no delays. Keep your ticket — the museum stamps them into little artworks.' } });
defStop('lakeside', { dir: STOP_DIRS.lakeside, name: 'Lakeside Station', npc: { face: '🎣', name: 'Finn the angler' }, item: '🐟',
  line: { all: 'Quick stop! The fish are jumping today. Take this lake-glass sculpture to the museum for me, will you? Caught the light myself.' } });
defStop('farside', { dir: STOP_DIRS.farside, name: 'Far Side Station', npc: { face: '🔭', name: 'Stella the stargazer' }, item: '🌌',
  line: { all: 'From this platform you can watch the space station pass over twice a night. Bring my astro-photograph for the night wing!' } });
defStop('museumst', { dir: STOP_DIRS.museumst, name: 'Museum Station', switchTo: 'walk',
  npc: { face: '🚂', name: 'Casey the conductor' },
  line: { all: 'End of the line! The museum’s just up the path — you’ll walk from here. Enjoy the opening, critic. Make it a kind review!' } });
defStop('artgarden', { dirOf: 'artgarden', npc: { face: '🖼️', name: 'Director Vivi' }, item: '📝',
  line: { all: 'You MADE it! And you brought treasures from all over the planet! Critique filed, darling. Now — the Space Museum is expecting you too. The pad at Cape Far Side is holding a seat.' } });
// second deadline: the Space Museum is the station, and you fly to it
defStop('cape', { dir: padDir, name: 'Cape Far Side', npc: { face: '👩‍🚀', name: 'Ground crew' },
  line: { all: 'Shuttle’s fuelled and the Space Museum has your press pass waiting. Strap in, critic — T-minus now.' },
  launches: true });

// the NPCs stand at their stops whether or not your route goes there
const npcs = [];
{
  const palette = [0xff7eb6, 0x4e8eff, 0x2dd47b, 0xb265ff, 0xff8a3d, 0x33c9ff, 0xffd23d, 0xff4d6e];
  let pi = 0;
  for (const key of Object.keys(STOPS)) {
    const s = STOPS[key];
    const axis = new THREE.Vector3(0, 1, 0).cross(s.dir).normalize();
    const nd = s.dir.clone().applyAxisAngle(axis, 0.055).normalize();
    const p = makePerson(palette[pi % palette.length], pi % 3 === 0 ? 0x2d2138 : null);
    pi++;
    p.scale.setScalar(1.35);
    p.position.copy(settleOn(nd, 0.3, 0.05));
    alignToSurface(p, nd, yawToFace(nd, s.dir));
    p.userData.phase = pi * 1.7;
    scene.add(p);
    npcs.push(p);
    s.npcMesh = p;
  }
}

// every route files the downtown critique, then heads for the pad and the
// Space Museum in orbit — two deadlines, one night
const ROUTES = {
  jeep: ['library', 'inbox', 'deckgpt', 'sinescape', 'ros2', 'artgarden', 'cape'],
  walk: ['library', 'overlook', 'artgarden', 'cape'],
  bike: ['library', 'boardwalk', 'artgarden', 'cape'],
  train: ['central', 'lakeside', 'farside', 'museumst', 'artgarden', 'cape'],
};
let route = ROUTES.jeep.map(k => STOPS[k]);
let routeIdx = 0;
let bag = [];
let trainU = 0;

function currentStop() { return routeIdx < route.length ? route[routeIdx] : null; }

function updateQuestHUD() {
  const s = currentStop();
  questText.textContent = s ? `🎨 to the museum · next: ${s.name}` : 'you made the opening! 🎉';
  questCount.textContent = `stop ${Math.min(routeIdx + 1, route.length)}/${route.length}`;
  starCount.textContent = `⭐ ${collectedStars.size}/${STAR_COUNT}`;
}

// the corner navigator — the critic's phone, still running directions
const navMode = document.getElementById('nav-mode');
const navEta = document.getElementById('nav-eta');
const navNext = document.getElementById('nav-next');
const navDots = document.getElementById('nav-dots');
const navBag = document.getElementById('nav-bag');
function updateNav() {
  navMode.textContent = TRANSPORT[transport].emoji;
  const s = currentStop();
  navNext.textContent = s ? `→ ${s.name}` : '🏛️ you have arrived';
  navDots.textContent = route.map((_, i) => (i < routeIdx ? '●' : i === routeIdx ? '◉' : '○')).join(' ');
  navBag.textContent = bag.length ? `carrying: ${bag.join(' ')}` : 'carrying: (nothing yet)';
}

// dialogue — an NPC talks, the world waits
const dlgEl = document.getElementById('dlg');
const dlgFace = document.getElementById('dlg-face');
const dlgName = document.getElementById('dlg-name');
const dlgText = document.getElementById('dlg-text');
let dlgOpen = false, dlgTimer = null;
function openDlg(stop) {
  dlgOpen = true;
  dlgEl.classList.add('show');
  dlgFace.textContent = stop.npc.face;
  dlgName.textContent = stop.npc.name;
  const text = stop.line[transport] ?? stop.line.all ?? Object.values(stop.line)[0];
  clearInterval(dlgTimer);
  let i = 0;
  dlgText.textContent = '';
  dlgTimer = setInterval(() => {
    i += 2;
    dlgText.textContent = text.slice(0, i);
    if (i >= text.length) clearInterval(dlgTimer);
  }, 24);
}
document.getElementById('dlg-ok').addEventListener('click', () => {
  if (!dlgOpen) return;
  clearInterval(dlgTimer);
  dlgOpen = false;
  dlgEl.classList.remove('show');
  const stop = route[routeIdx];
  if (stop.item) { bag.push(stop.item); ping(980, 0.12); }
  routeIdx++;
  if (stop.switchTo) setTransport(stop.switchTo);
  if (stop.launches) {                    // second deadline: fly to the Space Museum
    finaleAfterLaunch = true;
    setTimeout(startLaunch, 350);
  } else if (routeIdx >= route.length) {
    showFinale(stop.dir);
  }
  updateQuestHUD(); updateNav();
});

let finaleAfterLaunch = false;
function showFinale(atDir) {
  burstConfetti(posOn(atDir, 5), atDir.clone());
  ping(680, 0.16); setTimeout(() => ping(920, 0.2), 130); setTimeout(() => ping(1240, 0.24), 280);
  setTimeout(() => openCard({
    name: 'Both critiques filed 🎉', tag: 'downtown + orbit',
    desc: `You made the opening ${runTransport === 'walk' ? 'on foot' : `by ${TRANSPORT[runTransport].label}`}, then flew up to the Space Museum — carrying ${bag.length ? bag.join(' ') : 'nothing but opinions'} and ${collectedStars.size}/${STAR_COUNT} stars. Step inside the gallery: the paintings are real.`,
    enter: './room.html',
  }), 700);
}

function arriveAtStop(stop) {
  targetDir = null;                       // cancel any pending click-to-travel
  targetRing.material.opacity = 0;        // …so the world actually waits
  burstConfetti(posOn(stop.dir, 4.2), stop.dir.clone());
  ping(680, 0.14);
  openDlg(stop);
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
  if (gameState !== 'play' || dlgOpen) return;
  if (performance.now() - downAt > 350 || Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hitVeh = ray.intersectObjects(vehicleMeshes, false)[0];
  if (hitVeh) {
    const v = hitVeh.object.userData.vehicle;
    if (v === 'boat' && transport !== 'boat' && dir.angleTo(moorDir) < 0.45) boardBoat();
    else if (v === 'rocket' && dir.angleTo(padDir) < 0.45) startLaunch();
    return;
  }
  const hitLm = ray.intersectObjects(clickables, false)[0];
  if (hitLm) { openCard(hitLm.object.userData.landmark); return; }
  if (TRANSPORT[transport].rail) return;   // no click-to-travel while riding the train
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
    renderer.domElement.style.cursor =
      (ray.intersectObjects(vehicleMeshes, false)[0] || ray.intersectObjects(clickables, false)[0]) ? 'pointer' : 'default';
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
// the hint has to follow whatever you're currently riding — you can swap into
// the sailboat mid-route, so it can't be written once at the start of the run
const HINT_VERB = { jeep: 'drive', bike: 'pedal', walk: 'walk', boat: 'sail', train: 'ride' };
function showHint(t) {
  hintEl.innerHTML = TRANSPORT[t].rail
    ? 'sit back — the Museum Express drives itself &nbsp;·&nbsp; click a building for details'
    : `<kbd>WASD</kbd> / <kbd>←↑↓→</kbd> ${HINT_VERB[t]} &nbsp;·&nbsp; ${
        t === 'boat' ? 'run ashore to hop out' : 'click ground to travel'
      } &nbsp;·&nbsp; click a building`;
  hintHidden = false;
  hintEl.classList.remove('hide');
}

// ─── attractions: go sailing, ride the rocket ────────────────────────────────
function boardBoat() {
  if (gameState !== 'play' || dlgOpen || TRANSPORT[transport].rail) return;
  dir = moorDir.clone();
  heading = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
  if (heading.lengthSq() < 1e-4) heading.set(1, 0, 0);
  speed = 0; targetDir = null; targetRing.material.opacity = 0;
  setTransport('boat');
  showHint('boat');
  ping(760, 0.14);
}

let launchT = 0, launchConfettied = false, exitStored = false;
const _lPrev = new THREE.Vector3(), _lVel = new THREE.Vector3(), _lUp = new THREE.Vector3();
const _stW = new THREE.Vector3(), _camL = new THREE.Vector3(), _launchExit = new THREE.Vector3();
function startLaunch() {
  if (gameState !== 'play' || dlgOpen || TRANSPORT[transport].rail) return;
  gameState = 'launch';
  launchT = 0; launchConfettied = false; exitStored = false;
  _lPrev.copy(rocketG.position);
  hideHint();
  closeCard();
  ping(520, 0.2); setTimeout(() => ping(700, 0.2), 220); setTimeout(() => ping(940, 0.25), 440);
}
function updateLaunch(dt) {
  launchT = Math.min(1, launchT + dt / 26);
  const T = launchT;
  station.getWorldPosition(_stW);
  let p;
  if (T < 0.3) {                                   // liftoff
    const k = (T / 0.3) ** 2;
    const alt = padPos.length() + 0.4 + k * (_stW.length() - padPos.length());
    p = padDir.clone().multiplyScalar(alt);
  } else if (T < 0.78) {                           // one lap around the station
    const k = (T - 0.3) / 0.48;
    const up2 = _lUp.copy(_stW).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(up2).normalize();
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    const fwd2 = up2.clone().cross(side).normalize();
    const ang = k * Math.PI * 2 + Math.PI * 0.2;
    p = _stW.clone().addScaledVector(side, Math.cos(ang) * 9.5)
      .addScaledVector(fwd2, Math.sin(ang) * 9.5).addScaledVector(up2, 2.2);
    if (!launchConfettied && k > 0.5) { launchConfettied = true; burstConfetti(p.clone(), up2.clone()); ping(1240, 0.22); }
  } else {                                         // glide home
    if (!exitStored) { exitStored = true; _launchExit.copy(_lPrev); }
    const k = (T - 0.78) / 0.22;
    const e = k * k * (3 - 2 * k);
    p = _launchExit.clone().lerp(rocketHome, e);
  }
  rocketG.position.copy(p);
  _lVel.subVectors(p, _lPrev);
  if (_lVel.lengthSq() > 1e-8) {
    rocketG.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(UP_Y, _lVel.clone().normalize()), 0.12);
  }
  if (T < 0.3) {                                   // exhaust
    emitTrail(p.clone().addScaledVector(padDir, -0.2), padDir.clone().negate(), padDir);
    emitTrail(p.clone().addScaledVector(padDir, -0.2), padDir.clone().negate(), padDir);
  }
  // liftoff is watched from BESIDE the pad — trailing the rocket at T≈0 would
  // put the camera 8 units straight down, i.e. inside the planet
  if (T < 0.34) {
    const k = THREE.MathUtils.smoothstep(T, 0.16, 0.34);
    _camL.copy(p).addScaledVector(padSide, 9 - k * 3).addScaledVector(padDir, 2.5 + k * 4);
  } else {
    const back = _lVel.lengthSq() > 1e-8 ? _lVel.clone().normalize() : padDir.clone();
    _camL.copy(p).addScaledVector(back, -8).addScaledVector(_lUp.copy(p).normalize(), 3);
  }
  camera.position.lerp(_camL, T < 0.02 ? 1 : 0.08);
  camera.up.lerp(p.clone().normalize(), 0.08).normalize();
  camera.lookAt(T > 0.32 && T < 0.75 ? _stW : p);
  _lPrev.copy(p);
  if (T >= 1) {                                    // wheels down — well, fins
    gameState = 'play';
    rocketG.position.copy(rocketHome);
    rocketG.quaternion.copy(rocketHomeQ);
    introT = 0.3;
    ping(880, 0.18);
    if (finaleAfterLaunch) { finaleAfterLaunch = false; showFinale(padDir); }
  }
}

// ─── title screen → GPS phone → play ─────────────────────────────────────────
let gameState = 'title';
document.body.classList.add('title-mode');
const titleEl = document.getElementById('title');
const phoneEl = document.getElementById('phone');
const pGo = document.getElementById('p-go');

let chosenTransport = null;

// the critic stands on the ground and pulls out their phone: texts first,
// then maps. the world keeps living behind the screen.
const scrMsg = document.getElementById('scr-msg');
const scrMap = document.getElementById('scr-map');
function enterGame() {
  if (gameState !== 'title') return;
  gameState = 'msg';
  titleEl.classList.add('hide');
  phoneEl.classList.add('show');
  scrMsg.classList.add('on');
  // put the critic on the pavement outside the Library, phone raised
  setTransport('walk');
  dir = ll(8, -22);
  heading = new THREE.Vector3(0, 0, 1);
  heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
  speed = 0;
  applyGfx();                       // ground-level fog, not the orbit fog
  startAudio();
}
document.getElementById('enter-btn').addEventListener('click', enterGame);
window.addEventListener('keydown', e => { if (e.key === 'Enter' && gameState === 'title') enterGame(); });

document.getElementById('msg-reply').addEventListener('click', () => {
  if (gameState !== 'msg') return;
  gameState = 'maps';
  scrMsg.classList.remove('on');
  scrMap.classList.add('on');
  ping(980, 0.1);
});

// per-mode ETA/distance shown on the maps card, derived from the real routes
const GM_INFO = {
  jeep:  { eta: '12 min', dist: '3.2 km', via: 'fastest route now · via the coast road' },
  train: { eta: '9 min',  dist: '4.1 km', via: 'Museum Express · 4 stations' },
  bike:  { eta: '21 min', dist: '2.8 km', via: 'mostly flat · via the boardwalk' },
  walk:  { eta: '46 min', dist: '2.1 km', via: 'steep · over the summit' },
};
const gmTime = document.getElementById('gm-time');
const gmDist = document.getElementById('gm-dist');
const gmVia = document.getElementById('gm-via');
const gmRoute = document.getElementById('gm-route');
const GM_PATHS = {
  jeep:  'M64 232 L64 168 L132 168 L132 70 L196 70 L196 108',
  train: 'M64 232 L64 70 L196 70 L196 108',
  bike:  'M64 232 L196 232 L196 168 L132 168 L132 108 L196 108',
  walk:  'M64 232 L64 220 L132 220 L132 168 L196 168 L196 108',
};
for (const btn of document.querySelectorAll('#phone .gm-modes button')) {
  btn.addEventListener('click', () => {
    chosenTransport = btn.dataset.t;
    document.querySelectorAll('#phone .gm-modes button').forEach(b => b.classList.toggle('sel', b === btn));
    const info = GM_INFO[chosenTransport];
    gmTime.textContent = info.eta; gmDist.textContent = info.dist; gmVia.textContent = info.via;
    gmRoute.setAttribute('d', GM_PATHS[chosenTransport]);
    gmRoute.style.animation = 'none'; void gmRoute.getBoundingClientRect();
    gmRoute.style.animation = '';     // redraw the blue line for the new mode
    pGo.disabled = false;
    ping(880, 0.08);
  });
}
pGo.addEventListener('click', () => {
  if (!chosenTransport) return;
  if (runStarted) switchRide(chosenTransport); else beginRun(chosenTransport);
});

// ── the phone stays in your pocket: pull it out mid-run to change your ride ──
let runStarted = false;
const gmSearchDest = document.querySelector('#phone .gm-dest');
document.getElementById('phone-btn').addEventListener('click', () => {
  if (gameState !== 'play' || dlgOpen) return;
  gameState = 'maps';
  chosenTransport = null;
  pGo.disabled = true;
  pGo.textContent = 'Switch';
  const next = currentStop();
  if (gmSearchDest) gmSearchDest.textContent = next ? next.name : 'The Downtown Museum';
  // the Express only picks you up at a platform — no hailing it from a field
  for (const b of document.querySelectorAll('#phone .gm-modes button')) {
    const railFar = b.dataset.t === 'train' && !TRAIN_STATIONS.some(k => dir.angleTo(STOP_DIRS[k]) < 0.14);
    b.disabled = railFar;
    b.style.opacity = railFar ? 0.35 : '';
    b.classList.remove('sel');
  }
  document.body.classList.add('title-mode');
  phoneEl.classList.add('show');
  scrMsg.classList.remove('on');
  scrMap.classList.add('on');
  ping(760, 0.1);
});

// swap vehicle without losing where you are or which stops you've made
function switchRide(t) {
  setTransport(t);
  speed = 0;
  targetDir = null;
  targetRing.material.opacity = 0;
  if (TRANSPORT[t].rail) {          // board at the nearest platform
    let best = TRAIN_STATIONS[0], bestArc = 1e9;
    TRAIN_STATIONS.forEach((k, i) => {
      const a = dir.angleTo(STOP_DIRS[k]);
      if (a < bestArc) { bestArc = a; best = k; }
    });
    const bi = TRAIN_STATIONS.indexOf(best);
    dir = STOP_DIRS[best].clone();
    trainU = stationU[bi];
  }
  heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
  showHint(t);
  phoneEl.classList.remove('show');
  scrMap.classList.remove('on');
  document.body.classList.remove('title-mode');
  gameState = 'play';
  pGo.textContent = 'Go';
  updateNav();
}

function beginRun(t) {
  setTransport(t);
  runTransport = t;
  route = ROUTES[t].map(k => STOPS[k]);
  routeIdx = 0; bag = []; trainU = 0;
  showHint(t);
  if (t === 'train') dir = STOP_DIRS.central.clone();
  else dir = ll(8, -22);
  heading = new THREE.Vector3(0, 0, 1);
  heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
  speed = 0;
  targetDir = null;
  phoneEl.classList.remove('show');
  scrMap.classList.remove('on');
  document.body.classList.remove('title-mode');
  gameState = 'play';
  introT = 0;
  applyGfx();          // restore driving-distance fog
  runStarted = true;
  updateQuestHUD(); updateNav();
}

// ─── main loop ───────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let introT = 0;
let navAcc = 0;
{
  const _qs = new URLSearchParams(location.search);
  if (_qs.get('title') === '0') {
    enterGame();
    const tp = _qs.get('transport');
    beginRun(tp && TRANSPORT[tp] ? tp : 'jeep');
    // ?launch=1 rides from the pad; ?launch=0.5 seeks into the flight (dev)
    const lp = _qs.get('launch');
    if (lp !== null) { startLaunch(); launchT = Math.min(0.99, parseFloat(lp) || 0); }
    if (_qs.get('sail') === '1') boardBoat();
  } else if (_qs.get('gps')) {
    enterGame();   // jump straight to the phone (testing)
    if (_qs.get('gps') === 'maps') document.getElementById('msg-reply').click();
  }
}
let nearLm = null;
let emitAcc = 0;

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _desired = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _back = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _sunDay = new THREE.Color(0xffe0b8), _sunDusk = new THREE.Color(0xff9a66);
const _fogDay = new THREE.Color(0xe3cfe8), _fogNight = new THREE.Color(0x241f47);

// world keeps breathing whether you're on the title screen or driving
function updateWorldAmbient(dt, t) {
  // day/night
  const phase = (dayPhase0 + t / DAY_PERIOD) % 1;
  const sunEl = Math.sin((phase - 0.25) * Math.PI * 2);
  dayK = THREE.MathUtils.clamp(sunEl * 2.4 + 0.5, 0, 1);
  const th = (phase - 0.25) * Math.PI * 2;
  sun.position.set(Math.cos(th) * 70, Math.sin(th) * 60, 28);
  sun.intensity = 0.28 + 1.25 * dayK;
  const duskiness = 1 - Math.abs(sunEl);
  sun.color.copy(_sunDay).lerp(_sunDusk, THREE.MathUtils.clamp(duskiness * 1.4 - 0.2, 0, 1));
  // sketch nights stay luminous — pastel watercolor never goes muddy dark
  const nightLift = gfxInked ? (1 - dayK) * 0.42 : 0;
  hemi.intensity = 0.48 + 0.4 * dayK + nightLift;
  moon.intensity = 0.3 + 0.45 * (1 - dayK) + nightLift * 0.5;
  for (let i = 0; i < 3; i++) {
    skyU[['cA', 'cB', 'cC'][i]].value.copy(SKY.night[i]).lerp(SKY.day[i], dayK);
  }
  scene.fog.color.copy(_fogNight).lerp(_fogDay, dayK);
  skyStars.material.opacity = 0.15 + 0.75 * (1 - dayK);
  lampBulbMat.emissiveIntensity = 0.5 + (1 - dayK) * 1.9;

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
  ocean.material.opacity = 0.78 + Math.sin(t * 0.7) * 0.05;
  ocean.rotation.y += dt * 0.004;

  if (gameState !== 'play') {
    for (const lm of LANDMARKS) {
      if (lm.gem) lm.gem.rotation.y += dt * 1.5;
      if (lm.sculpture) lm.sculpture.rotation.y += dt * 0.6;
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // the space tour: cinematic, hands off the controls
  if (gameState === 'launch') {
    updateLaunch(dt);
    updateWorldAmbient(dt, t);
    updatePool(trailPool, dt);
    updatePool(confettiPool, dt);
    sky.position.copy(camera.position);
    if (gfxInked) renderInked(); else renderer.render(scene, camera);
    return;
  }

  // title: slow orbit of the whole planet, world alive behind the logo
  if (gameState === 'title') {
    const a = t * 0.055;
    camera.position.set(Math.sin(a) * 92, 34, Math.cos(a) * 92);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    scene.fog.near = 260; scene.fog.far = 520;   // whole planet crisp from space
    updateWorldAmbient(dt, t);
    sky.position.copy(camera.position);
    if (gfxInked) renderInked(); else renderer.render(scene, camera);
    return;
  }

  // phone flow: down on the pavement, over the critic's shoulder while they
  // read their texts and pick a route
  if (gameState === 'msg' || gameState === 'maps') {
    const groundR0 = Math.max(radiusAt(dir), SEA_R);
    courier.position.copy(dir.clone().multiplyScalar(groundR0 + TRANSPORT.walk.hover));
    _right.crossVectors(dir, heading);
    _m.makeBasis(_right, dir, heading);
    courier.quaternion.setFromRotationMatrix(_m);
    // drift slowly around them so the street stays alive behind the phone
    const orbit = Math.sin(t * 0.16) * 0.5 + 2.4;
    const off = heading.clone().multiplyScalar(-Math.cos(orbit) * 4.2)
      .addScaledVector(_right, Math.sin(orbit) * 4.2);
    // slide the eye sideways so the critic sits clear of the phone, not behind it
    off.addScaledVector(_right, -3.1);
    camera.position.lerp(courier.position.clone().addScaledVector(dir, 2.0).add(off), 0.05);
    camera.up.lerp(dir, 0.08).normalize();
    camera.lookAt(courier.position.clone().addScaledVector(dir, 1.0));
    updateWorldAmbient(dt, t);
    sky.position.copy(camera.position);
    if (gfxInked) renderInked(); else renderer.render(scene, camera);
    return;
  }

  const TR = TRANSPORT[transport];

  // input (the world waits while someone's talking to you)
  let ix = 0, iz = 0;
  if (!dlgOpen) {
    if (keys.KeyW || keys.ArrowUp) iz += 1;
    if (keys.KeyS || keys.ArrowDown) iz -= 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    if (stickState.active) { ix += stickState.x; iz += -stickState.y; }
  }
  if (TR.rail) { ix = 0; iz = 0; }   // the Express takes no steering suggestions
  const hasInput = Math.abs(ix) > 0.01 || Math.abs(iz) > 0.01;
  if (hasInput) { targetDir = null; targetRing.material.opacity = 0; hideHint(); }

  if (TR.rail) {
    // the Museum Express drives itself — ease toward the next station
    const targetU = stationU[Math.min(routeIdx, stationU.length - 1)];
    const distArc = Math.max(0, targetU - trainU);
    speed = (dlgOpen || distArc < 0.0005)
      ? Math.max(0, speed - 6 * dt)
      : Math.min(Math.min(TR.max, 1.6 + distArc * R * 0.55), speed + TR.accel * dt);
    trainU = Math.min(targetU, trainU + (speed * dt) / R);
    sampleTrack(trainU, dir, heading);
  } else {
    _fwd.subVectors(courier.position, camera.position);
    _fwd.sub(dir.clone().multiplyScalar(_fwd.dot(dir))).normalize();
    _right.crossVectors(_fwd, dir).normalize();
    const turnK = 1 - Math.pow(TURN * (1 + speed / TR.max), dt);

    if (hasInput) {
      _desired.set(0, 0, 0).addScaledVector(_fwd, iz).addScaledVector(_right, ix).normalize();
      heading.lerp(_desired, turnK).normalize();
      speed = Math.min(TR.max, speed + TR.accel * dt);
    } else if (targetDir) {
      const arc = dir.angleTo(targetDir);
      if (arc < 0.02) { targetDir = null; targetRing.material.opacity = 0; }
      else {
        _desired.subVectors(targetDir, dir.clone().multiplyScalar(dir.dot(targetDir))).normalize();
        heading.lerp(_desired, turnK).normalize();
        const slow = Math.min(1, arc / 0.12);
        speed = Math.min(TR.max * slow + 1.2, speed + TR.accel * dt);
      }
    } else {
      speed = Math.max(0, speed - DAMP * dt * (speed + 1));
    }
    if (dlgOpen) speed = Math.max(0, speed - 8 * dt);

    if (speed > 0.001) {
      dir.multiplyScalar(R).addScaledVector(heading, speed * dt).normalize();
      heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
    }

    // sailing ends at the shoreline — beach the boat and hop out
    if (transport === 'boat' && isLand(dir, 0.02)) {
      const ashore = TRANSPORT[runTransport].rail ? 'walk' : runTransport;
      setTransport(ashore);
      showHint(ashore);
      speed = Math.min(speed, 1.5);
      ping(620, 0.12);
    }
  }

  // ride-height bob: suspension for wheels, a light step for the walker
  const bob = transport === 'walk'
    ? Math.abs(Math.sin(t * 9)) * 0.07 * (speed / TR.max)
    : Math.sin(t * 8.5) * 0.03 * (0.3 + speed / TR.max);
  const groundR = Math.max(radiusAt(dir), SEA_R);
  courier.position.copy(dir.clone().multiplyScalar(groundR + TR.hover + bob));
  _right.crossVectors(dir, heading);
  _m.makeBasis(_right, dir, heading);
  _q.setFromRotationMatrix(_m);
  courier.quaternion.slerp(_q, 1 - Math.pow(0.001, dt));
  const leanK = transport === 'bike' ? 0.22 : transport === 'jeep' ? 0.12 : 0;
  courierBody.rotation.z = THREE.MathUtils.lerp(courierBody.rotation.z, -ix * leanK, 0.09);
  courierBody.rotation.x = THREE.MathUtils.lerp(courierBody.rotation.x, iz * 0.07 * (speed / TR.max), 0.09);
  for (const w of courierBody.userData.wheels) w.rotation.x += dt * speed / 0.34;

  // engine particles + hum
  if (TR.engine && speed > 1.4) {
    emitAcc += dt * (5 + speed * 3.2);
    _back.copy(heading).negate();
    while (emitAcc >= 1) { emitAcc -= 1; emitTrail(courier.position, _back, dir); }
  }
  updatePool(trailPool, dt);
  updatePool(confettiPool, dt);
  if (AudioState.engineGain) {
    const g = (speed / TR.max) * (TR.engine ? 1 : 0);
    AudioState.engineGain.gain.setTargetAtTime(g * g * 0.05, AudioState.ctx.currentTime, 0.12);
    AudioState.engineOsc.frequency.setTargetAtTime((transport === 'train' ? 54 : 72) + g * 46, AudioState.ctx.currentTime, 0.15);
  }

  // chase camera
  introT = Math.min(1, introT + dt / 2.6);
  const ease = introT * introT * (3 - 2 * introT);
  const camPos = courier.position.clone()
    .addScaledVector(dir, TR.camH)
    .addScaledVector(heading, -TR.camD);
  camera.position.lerp(camPos, (0.02 + 0.05 * ease));
  camera.up.lerp(dir, 0.06).normalize();
  camera.lookAt(courier.position.clone().addScaledVector(dir, 1.1));

  updateWorldAmbient(dt, t);

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
    }
    if (lm.sculpture) lm.sculpture.rotation.y += dt * 0.6;
  }
  if (nearLm && dir.angleTo(nearLm.dir) > FAR_ARC) {
    if (openLm === nearLm) closeCard();
    nearLm = null;
  }
  if (!nearLm && nearest && nearestArc < NEAR_ARC) nearLm = nearest;

  // route: reaching the next stop starts a conversation
  // (the train pulls all the way into the platform before anyone talks)
  const stop = currentStop();
  const arriveArc = TR.rail ? 0.02 : 0.1;
  if (stop && !dlgOpen && dir.angleTo(stop.dir) < arriveArc) arriveAtStop(stop);

  for (const lm of LANDMARKS) {
    if (!lm.label) continue;
    const d = camera.position.distanceTo(lm.label.position);
    lm.label.material.opacity = THREE.MathUtils.clamp(1.6 - d / 55, 0, 1);
  }

  // compass → next stop on the route
  const quest = currentStop();
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

  // the moored sailboat bobs at anchor (hidden while you're sailing it)
  mooredBoat.visible = transport !== 'boat';
  mooredBoat.position.copy(moorDir).multiplyScalar(SEA_R + 0.1 + Math.sin(t * 1.3) * 0.05);

  // npcs idle — a little breath, a little head-bob
  for (const p of npcs) {
    const ph = p.userData.phase;
    p.userData.head.position.y = 0.9 + Math.sin(t * 2 + ph) * 0.025;
    p.scale.y = 1.35 * (1 + Math.sin(t * 2.6 + ph) * 0.02);
  }

  // navigator: distance + eta to the next stop
  navAcc += dt;
  if (navAcc > 0.3) {
    navAcc = 0;
    const ns = currentStop();
    if (ns) {
      const meters = Math.round(dir.angleTo(ns.dir) * R * 12);
      const eta = Math.max(1, Math.round(meters / (Math.max(TR.max, 1) * 11)));
      navEta.textContent = `${meters} m · ~${eta}s`;
    } else {
      navEta.textContent = 'arrived 🏛️';
    }
  }

  targetRing.material.opacity = Math.max(0, targetRing.material.opacity - dt * 0.25);
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
updateNav();
progress(1, 'ready!');
animate();
setTimeout(() => loaderEl.classList.add('hide'), 450);
