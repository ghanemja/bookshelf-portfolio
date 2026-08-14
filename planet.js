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
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

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
    road: 0x6e5a6a, roadLine: 0xfff2d8, roadMark: 0xffe9c8,
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
    road: 0x54575f, roadLine: 0xf2ecd8, roadMark: 0xf2ecd8,
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
const _T0 = performance.now();
const TRACE = new URLSearchParams(location.search).get('debug') === '1';
const mark = (s) => { if (TRACE) console.log(`[build] ${Math.round(performance.now() - _T0)}ms ${s}`); };
function progress(p, msg) {
  mark(msg);
  loaderBar.style.width = `${Math.round(p * 100)}%`;
  if (msg) loaderMsg.textContent = msg;
}

// ─── renderer / scene ────────────────────────────────────────────────────────
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));   // cartoon world: 2x retina is wasted fill
// perf probe (dev): draw calls / triangles / programs from the last frame
window.__perf = () => ({ ...renderer.info.render, programs: renderer.info.programs?.length });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// the shadow pass re-renders every caster into a 2048² map — at 60fps that's
// a third full-geometry pass. The world is static and the sun crawls, so
// refresh shadows every OTHER frame (30Hz, imperceptible) and halve the cost.
renderer.shadowMap.autoUpdate = false;
let _shFrame = 0;
app.appendChild(renderer.domElement);
if (IS_TOUCH) document.body.classList.add('touch');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe3cfe8, 42, 155);

// ─── chrome/pearlescent finish for barbie mode ───────────────────────────────
// A neutral studio env map so metals have something to reflect (metalness with
// no envMap renders black). Metals tint reflections by their own base color, so
// barbie's already-pink materials read as pearlescent-pink chrome for free.
const _pmrem = new THREE.PMREMGenerator(renderer);
const _chromeEnv = _pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
// Toggle high metalness / low roughness across solid surfaces. Skips glass,
// water, clouds, sprites and anything emissive so lights still glow. Stashes the
// original matte values once so bratz restores exactly.
function applyChrome(on) {
  scene.environment = on ? _chromeEnv : null;
  scene.traverse((o) => {
    const mat = o.material;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (!m.isMeshStandardMaterial) continue;         // Basic/Normal/Shader/Points/Sprite → skip
      if (m.transparent || (m.opacity ?? 1) < 1) continue; // glass, water, clouds, trails
      if (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 0) > 0) continue; // lamps, windows, stars
      if (!m.userData._matte) {
        m.userData._matte = { metalness: m.metalness, roughness: m.roughness, envMapIntensity: m.envMapIntensity };
      }
      if (on) {
        m.metalness = 0.85;
        m.roughness = 0.22;          // satin, not a hard mirror → reads pearlescent
        m.envMapIntensity = 1.5;
      } else {
        const s = m.userData._matte;
        m.metalness = s.metalness; m.roughness = s.roughness; m.envMapIntensity = s.envMapIntensity;
      }
    }
  });
}

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
  // the normal buffer only feeds edge detection — half resolution halves the
  // fill cost of the second scene pass, and the ink lines just soften a hair
  rtNormal = new THREE.WebGLRenderTarget(Math.ceil(w * dpr / 2), Math.ceil(h * dpr / 2), {
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
      wasteland: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tColor, tDepth, tNormal, tPaper;
      uniform vec2 res;
      uniform float camNear, camFar, time, wasteland;

      float readDepth(vec2 uv) {
        float z = texture2D(tDepth, uv).x;
        float ndc = z * 2.0 - 1.0;
        return (2.0 * camNear * camFar) / (camFar + camNear - ndc * (camFar - camNear));
      }
      vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
      }
      // a field of hand-drawn pencil lines at a given angle: strokes wobble
      // (hand tremor), break up along their length (uneven pressure), and are
      // spaced irregularly — messy graphite, not a mechanical screen pattern.
      float pencilLines(vec2 fc, float ang, float spacing, float seed) {
        vec2 dir = vec2(cos(ang), sin(ang));
        float across = dot(fc, vec2(-dir.y, dir.x));   // perpendicular to strokes
        float along  = dot(fc, dir);
        // wobble the stroke sideways with two octaves of tremor
        across += sin(along * 0.05 + seed) * 3.0 + sin(along * 0.17 + seed * 2.3) * 1.1;
        // slightly irregular spacing so lines don't march in lockstep
        float sp = spacing * (0.85 + 0.3 * sin(across * 0.02 + seed));
        float d = abs(fract(across / sp) - 0.5) * 2.0;  // 0 at a line centre
        float core = 1.0 - smoothstep(0.0, 0.42, d);    // the drawn stroke
        // pressure breaks: the pencil skips, darker in patches
        float press = 0.5 + 0.5 * sin(along * 0.35 + seed * 1.7)
                          + 0.3 * sin(along * 0.9 + seed);
        return core * clamp(press, 0.0, 1.0);
      }
      // edge strength at uv with stroke width o (pixels)
      float edgeAt(vec2 uv, float o, float d0ref) {
        vec2 px = 1.0 / res;
        // wasteland: graphite + ink wash, near monochrome (Epic Mickey's Wasteland)
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
        // wasteland: graphite + ink wash, near monochrome (Epic Mickey's Wasteland)
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
        vec2 wobA = hash22(floor(vUv * res / 5.0) + tq * 17.0) * px * 2.1;
        vec2 wobB = hash22(floor(vUv * res / 5.0) + 31.7 + tq * 17.0) * px * 3.3;
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

        // ── WASTELAND: graphite and ink wash. Colour is drained to a warm
        // grey, hatching bites everywhere rather than only in shadow, the ink
        // gets heavier, and a grimy vignette closes in at the edges.
        if (wasteland > 0.5) {
          // ── PENCIL ON PAPER: graphite shading and hatching on a cream sheet,
          // the way the reference sketches read — light paper, directional
          // strokes that pile up into cross-hatch as the scene darkens.
          vec3 raw = texture2D(tColor, vUv).rgb;
          float g = clamp(pow(dot(raw, vec3(0.299, 0.587, 0.114)), 0.9), 0.0, 1.0);
          // warm paper with a visible tooth
          vec3 paperCol = vec3(0.94, 0.92, 0.87) * (0.90 + 0.14 * paper);
          float shade = smoothstep(0.96, 0.04, g);            // 0 = light, 1 = dark
          vec2 fc = gl_FragCoord.xy;
          // boil the seed a touch so the strokes are redrawn frame to frame
          float sd = 3.1 + floor(time * 6.0);
          // build tone in messy pencil passes, each biting deeper in shadow
          float p1 = pencilLines(fc, 0.7,  7.0, sd)       * smoothstep(0.14, 0.5, shade);
          float p2 = pencilLines(fc, -0.5, 8.5, sd + 5.0) * smoothstep(0.44, 0.8, shade);  // cross-hatch
          float p3 = pencilLines(fc, 1.9,  6.0, sd + 9.0) * smoothstep(0.72, 1.0, shade);  // darkest
          float hatch = clamp(p1 * 0.7 + p2 * 0.7 + p3 * 0.8, 0.0, 1.0);
          float graphite = shade * 0.42 + hatch * 0.6;
          vec3 lead = vec3(0.16, 0.15, 0.17);                 // 2B graphite grey
          vec3 gr = mix(paperCol, lead, clamp(graphite, 0.0, 1.0));
          gr *= 0.97 + 0.03 * paper;                          // just a whisper of tooth, no dot pattern
          // sketched contour lines drawn over the top, wobbling and skipping
          float pline = clamp(ink * 1.15, 0.0, 1.0);
          gr = mix(gr, lead * 0.75, pline);
          gr = mix(paperCol, gr, skyMask);                    // sky is bare paper
          col = gr;
        }

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
  inkQuad.material.uniforms.wasteland.value = gfxMode === 'wasteland' ? 1 : 0;
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
if (stored !== 'sketch' && stored !== 'classic' && stored !== 'wasteland') stored = 'sketch';
let gfxMode = stored;                       // 'sketch' | 'wasteland' | 'classic'
const GFX_CYCLE = ['sketch', 'wasteland', 'classic'];
const GFX_LABEL = { sketch: '✏️ sketchbook', wasteland: '🖤 wasteland', classic: '🧊 classic' };
let gfxInked = gfxMode === 'sketch';        // only sketchbook uses the 3-pass ink pipeline
const gfxBtn = document.getElementById('gfx-toggle');
function applyGfx() {
  gfxBtn.textContent = GFX_LABEL[gfxMode];
  gfxInked = gfxMode === 'sketch';        // wasteland is single-pass grease pencil now
  setGreasePencil(gfxMode === 'wasteland');
  // the wasteland is smoggy: haze closes in a lot sooner
  scene.fog.near = gfxMode === 'wasteland' ? 40 : gfxInked ? 40 : 42;
  scene.fog.far = gfxMode === 'wasteland' ? 150 : gfxInked ? 145 : 155;
}
gfxBtn.addEventListener('click', () => {
  gfxMode = GFX_CYCLE[(GFX_CYCLE.indexOf(gfxMode) + 1) % GFX_CYCLE.length];
  localStorage.setItem('planet-gfx', gfxMode);
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
// the city sits between the Library and the Downtown Museum
const DOWNTOWN = ll(20, -36);

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
// a wide sandy bay on the south coast, for the beach, the dock and the fishing
const BEACH = ll(-16, -60);
// district anchors (lat, lon), each on open ground linked to downtown by a radial
const MALL = ll(9, -48);       // shopping district SE of downtown
const AIRPORT = ll(55, 80);    // clear airspace, well outside the city footprint
const FARM_A = ll(46, -12);    // north-east fields
const FARM_B = ll(-34, -46);   // south-west fields
const RESORT = ll(-14, -66);   // hotel, just inland of the beach
const FLATS = [MALL, AIRPORT, FARM_A, FARM_B, RESORT];
const HILL_A = ll(30, 40), HILL_B = ll(-46, -110);
// a channel of open water south-west of downtown, spanned by the big bridge
const STRAIT = DOWNTOWN.clone().multiplyScalar(0.4)
  .addScaledVector(STOP_DIRS.boardwalk, 0.6).normalize();


// ─── terrain: continents + ocean + lake bay + mountain + land pedestals ─────
function surfH(d) {
  let h =
    Math.sin(d.x * 1.6 + 0.4) * Math.sin(d.y * 1.3 + 2.0) * Math.sin(d.z * 1.5 + 4.1) * 0.95 +   // continents
    Math.sin(d.x * 3.1 + 1.3) * Math.sin(d.y * 2.7 + 2.1) * Math.sin(d.z * 3.7 + 0.5) * 0.55 +
    Math.sin(d.x * 6.4 + 4.2) * Math.sin(d.z * 5.2 + 1.1) * 0.24 +
    Math.sin(d.y * 7.3 + 0.7) * 0.10;
  const stepH = 0.55;                                    // gentle terraces, not cliffs
  h = h - (h - Math.round(h / stepH) * stepH) * 0.22;
  // rolling hills fill the empty country between districts
  h += 0.9 * Math.exp(-(2 - 2 * d.dot(HILL_A)) / (0.22 * 0.22));
  h += 0.7 * Math.exp(-(2 - 2 * d.dot(HILL_B)) / (0.20 * 0.20));
  // chord² = 2-2·dot ≈ angle² for the small radii below, and skips ~20 acos
  const aL2 = 2 - 2 * d.dot(LAKE);
  h -= 1.5 * Math.exp(-aL2 / (0.16 * 0.16));                          // a bay
  const aM2 = 2 - 2 * d.dot(MTN);
  h += 2.7 * Math.exp(-aM2 / (0.15 * 0.15));                          // the mountain
  for (let i = 0; i < LANDMARKS.length; i++) {                         // land under buildings
    const a2 = 2 - 2 * d.dot(LANDMARKS[i].dir);
    if (a2 > 0.25) continue;                                           // far away: skip the exp
    h += (SEA_H + 0.55 - Math.min(h, SEA_H + 0.55)) * Math.exp(-a2 / (0.09 * 0.09));
  }
  for (let i = 0; i < STOP_PEDESTALS.length; i++) {                    // stations & boardwalk
    const a2 = 2 - 2 * d.dot(STOP_PEDESTALS[i]);
    if (a2 > 0.16) continue;
    h += (SEA_H + 0.55 - Math.min(h, SEA_H + 0.55)) * Math.exp(-a2 / (0.07 * 0.07));
  }
  // downtown is built on a plateau — a grid can't sit on terraced hillside
  const aC = Math.acos(THREE.MathUtils.clamp(d.dot(DOWNTOWN), -1, 1));
  const kC = Math.exp(-Math.pow(aC / 0.92, 6));
  // roll: broad low swells across the city so streets rise and dip
  const roll = (Math.sin(d.x * 9 + 1.0) * Math.sin(d.z * 8 + 2.0) * 0.20
              + Math.sin(d.y * 11 + 0.5) * 0.12);
  h = h * (1 - kC) + (SEA_H + 0.92 + roll) * kC;
  // level ground under each outlying district so nothing sits on a slope
  for (let i = 0; i < FLATS.length; i++) {
    const a2 = 2 - 2 * d.dot(FLATS[i]);
    const wide = FLATS[i] === AIRPORT ? 0.21 : 0.11;   // broad apron round the runway
    if (a2 > wide * wide * 6) continue;
    const kF = Math.exp(-a2 / (wide * wide));
    h = h * (1 - kF) + (SEA_H + (FLATS[i] === RESORT ? 0.30 : 0.62)) * kF;
  }
  // the strait the bridge spans — carved AFTER the plateau or it gets filled in
  const aS2 = 2 - 2 * d.dot(STRAIT);
  h -= 2.6 * Math.exp(-aS2 / (0.085 * 0.085));
  // the beach: flatten a broad shelf so the land wades gently into the water
  const aB2 = 2 - 2 * d.dot(BEACH);
  if (aB2 < 0.35) {
    const kB = Math.exp(-aB2 / (0.17 * 0.17));
    h = h * (1 - kB) + (SEA_H - 0.10) * kB;
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
  // corners reach 1.41x further than the edge midpoints, and a terrace step can
  // hide between probes, so sample the full square at two radii
  for (const ring of [1, 1.42]) {
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]) {
      const d2 = dirVec.clone().applyAxisAngle(axisA, a * arc * ring).applyAxisAngle(axisB, b * arc * ring).normalize();
      r = Math.min(r, radiusAt(d2));
    }
  }
  return dirVec.clone().multiplyScalar(Math.max(r, SEA_R) - sink);
}

// a plinth that continues underground: whatever the terrain does beneath a
// building, you see foundation instead of a gap of sky
function foundation(radius, depth = 2.6, sides = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.06, depth, sides),
    new THREE.MeshStandardMaterial({ color: 0xbdb2a2, flatShading: true, roughness: 0.95 }));
  m.position.y = -depth / 2 + 0.12;
  return m;
}

// solid footprints: {dir, r} where r is an ARC radius in radians
const solids = [];            // {dir, r} footprints you cannot walk through
const roadParts = [];         // road meshes, retinted by the vibe toggle
const cityWindowMats = [];    // tower window materials, lit after dark
const traffic = [];           // cars and pedestrians that actually move
const bobbers = [];           // moored boats that rock on the swell
let airportPlane = null, resortHotel = null;   // handles for the arrival intro
let RING_LOOP = null;                          // the smoothed landmark loop
let GAS_DIR = null;                            // gas station, off the airport spur
let cityMapCtx = null, cityMapTex = null, cityMapDraw = null;   // the painted city floor
const SKIN = [0xffd9b8, 0xe8b98f, 0xc68a5e, 0x8a5a3a];
const HAIR = [0x2d2138, 0x5a3a22, 0x8a6a3a, 0x1c1620, 0x704020];
const npcs = [];              // everyone standing around the world
const camOccluders = [];      // big statics the camera must never hide behind
const collidables = [];   // building groups merged into one BVH after build
function addSolid(dirVec, worldRadius, group) {
  solids.push({ dir: dirVec.clone(), r: worldRadius / R });   // kept for broad hints
  if (group) collidables.push(group);
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
  // level 6 gives a fine sphere; merging shared vertices lets computeVertexNormals
  // AVERAGE across faces → smooth, bevelled ground instead of hard facets
  let g = mergeVertices(new THREE.IcosahedronGeometry(R, 6));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = radiusAt(v);
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,   // smooth-shaded, no facets
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

// paint (or repaint) the terrain colors for the active vibe
const CONCRETE = new THREE.Color(0x9c9a95);
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
  const c = new THREE.Color(), v = new THREE.Vector3(), nd = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = (v.length() - R) / H_AMP;
    if (h < SEA_H - 0.25) c.copy(cDeep);
    else if (h < SEA_H + 0.10) c.copy(cSand);
    else if (h < 0.45) c.copy(cSand).lerp(cMid, Math.min(1, (h - SEA_H - 0.10) / 0.35));
    else if (h < 1.15) c.copy(cMid).lerp(cHigh, (h - 0.45) / 0.7);
    else c.copy(cHigh).lerp(cSnow, Math.min(1, (h - 1.15) / 0.8));
    nd.copy(v).normalize();
    const aCity = nd.angleTo(DOWNTOWN);
    if (aCity < 0.94 && h > SEA_H + 0.05) {
      const k2 = THREE.MathUtils.smoothstep(aCity, 0.74, 0.94);
      c.lerp(CONCRETE, 1 - k2);
    }
    const jit = 0.98 + jr() * 0.035;   // subtler jitter on the smooth surface
    colAttr.setXYZ(i, c.r * jit, c.g * jit, c.b * jit);
  }
  colAttr.needsUpdate = true;
}
paintTerrain(VIBES[vibe].terr);
function roadMat(dark) {
  return new THREE.MeshStandardMaterial({
    roughness: 0.97, flatShading: true,
    polygonOffset: true, polygonOffsetFactor: dark ? -2 : -1, polygonOffsetUnits: dark ? -2 : -1,
  });
}

// ocean — faceted translucent sphere at sea level
const ocean = new THREE.Mesh(
  mergeVertices(new THREE.IcosahedronGeometry(SEA_R, 4)),
  new THREE.MeshStandardMaterial({
    color: 0x6cbcdf, transparent: true, opacity: 0.82, roughness: 0.2, metalness: 0.05,
    depthWrite: false,   // smooth water, no faceted spikes
  })
);
ocean.geometry.computeVertexNormals();
scene.add(ocean);

progress(0.28, 'planting forests…');

// ─── decorations (land only) ─────────────────────────────────────────────────
const deco = new THREE.Group();
scene.add(deco);
const M = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...opts });
const WOOD = M(0x9a6b4f), LEAF_A = M(0x7fbf8b), LEAF_B = M(0xa8d8a0), ROCK = M(0xcdc3dd);
// grease-pencil category tags: what kind of marks (if any) a surface earns
WOOD.userData.gp = 'wood'; LEAF_A.userData.gp = 'leaf'; LEAF_B.userData.gp = 'leaf';
// MW = a WALL material: the only kind that gets brick-and-scratch detail
const MW = (color, opts = {}) => { const m = M(color, opts); m.userData.gp = 'wall'; return m; };

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
  const body = MW(lm.color);
  const trim = M(0xfff4e0);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 0.5, 10), M(0xd8cbb2));
  plat.position.y = 0.1; g.add(plat);
  g.add(foundation(2.35));

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

function slerpDir(a, b, t) {
  const th = a.angleTo(b);
  if (th < 1e-4) return a.clone();
  const s = Math.sin(th);
  return a.clone().multiplyScalar(Math.sin((1 - t) * th) / s)
    .addScaledVector(b, Math.sin(t * th) / s).normalize();
}
// the road network's sample points, known before anything is placed, so
// nothing may be built on a carriageway
const roadNetPts = [];
function nearRoad(d, units = 2.0) {
  const lim = units / R;
  for (let i = 0; i < roadNetPts.length; i += 2) {
    if (d.angleTo(roadNetPts[i]) < lim) return true;
  }
  return false;
}
{
  // gates: each landmark's waypoint shifts ~2.7 units to the side, so the
  // road runs past the plaza's edge instead of through its middle
  const gates = LANDMARKS.map((lm, i) => {
    const prev = LANDMARKS[(i - 1 + LANDMARKS.length) % LANDMARKS.length].dir;
    const next = LANDMARKS[(i + 1) % LANDMARKS.length].dir;
    const tang = next.clone().sub(prev.clone().multiplyScalar(prev.dot(next))).normalize();
    return lm.dir.clone().applyAxisAngle(tang, 2.7 / R).normalize();
  });
  let pts0 = [];
  for (let i = 0; i < gates.length; i++) {
    const a = gates[i], b = gates[(i + 1) % gates.length];
    for (let k = 0; k < 22; k++) pts0.push(slerpDir(a, b, k / 22));
  }
  for (let pass = 0; pass < 6; pass++) {
    const n = pts0.length, out = [];
    for (let i = 0; i < n; i++) {
      out.push(pts0[i].clone().multiplyScalar(2)
        .add(pts0[(i - 1 + n) % n]).add(pts0[(i + 1) % n]).normalize());
    }
    pts0 = out;
  }
  RING_LOOP = pts0;
  roadNetPts.push(...pts0);
}

for (const lm of LANDMARKS) {
  const b = makeBuilding(lm);
  addSolid(lm.dir, 1.9, b);
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
{
  // ── ONE road network, with a hierarchy like real planning: smooth asphalt
  // near the city that grades into dirt lanes in the country, spur roads out
  // to every district, and a turning circle wherever a road ends.
  const DIRT = { edge: new THREE.Color(0x8a7a5c), bed: new THREE.Color(0x9a805a) };
  const PAVED = { edge: new THREE.Color(0xf2ecd8), bed: new THREE.Color(0x54575f) };
  // 1 near downtown → 0 in the country; drives width, colour and dashes
  const cityness = (d) => THREE.MathUtils.smoothstep(1.35 - d.angleTo(DOWNTOWN), 0.10, 0.90);

  function smoothLoop(raw, passes, closed) {
    let out = raw.map(v => v.clone());
    const n = out.length;
    for (let p = 0; p < passes; p++) {
      const next = [];
      for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) { next.push(out[i].clone()); continue; }
        next.push(out[i].clone().multiplyScalar(2)
          .add(out[(i - 1 + n) % n]).add(out[(i + 1) % n]).normalize());
      }
      out = next;
    }
    return out;
  }

  // ribbon with PER-VERTEX colour: asphalt and dirt in one continuous mesh
  function gradedRibbon(pts, closed, widthOf, colorOf, lift, dashed = false) {
    const pos = [], col = [], idx = [];
    const lat = new THREE.Vector3();
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const d = pts[i];
      const dn = pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
      const dp = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)];
      const tang = dn.clone().sub(dp.clone().multiplyScalar(dp.dot(dn))).normalize();
      lat.crossVectors(d, tang).normalize();
      const r = Math.max(radiusAt(d), SEA_R) + lift;
      const w = widthOf(d);
      const c = colorOf(d);
      const p1 = d.clone().multiplyScalar(r).addScaledVector(lat, w);
      const p2 = d.clone().multiplyScalar(r).addScaledVector(lat, -w);
      pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      if (dashed && i % 4 >= 2) continue;
      if (dashed && cityness(pts[i]) < 0.45) continue;   // no lane paint on dirt
      const a0 = i * 2, a1 = i * 2 + 1, b0 = ((i + 1) % n) * 2, b1 = ((i + 1) % n) * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.97, flatShading: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  const _cTmp = new THREE.Color();
  function roadLayers(pts, closed) {
    gradedRibbon(pts, closed,
      d => { const c = cityness(d); return (1.35 + 0.35 * c) * (1.06 + 0.14 * (1 - c)); },
      d => _cTmp.copy(DIRT.edge).lerp(PAVED.edge, cityness(d)).clone(), 0.04);
    gradedRibbon(pts, closed,
      d => { const c = cityness(d); return 1.15 + 0.38 * c; },
      d => _cTmp.copy(DIRT.bed).lerp(PAVED.bed, cityness(d)).clone(), 0.05);
    gradedRibbon(pts, closed, () => 0.07,
      () => new THREE.Color(0xf2ecd8), 0.06, true);
  }

  // the grand loop through every landmark, precomputed above
  const loop = RING_LOOP;
  roadLayers(loop, true);

  // the RING BOULEVARD: a bypass around the whole city at the grid edge —
  // spurs meet it, and through-traffic goes AROUND downtown, never across
  const bvE1 = new THREE.Vector3(0, 1, 0).cross(DOWNTOWN).normalize();
  const bvE2 = new THREE.Vector3().crossVectors(DOWNTOWN, bvE1).normalize();
  const BLVD_ARC = 0.94;
  const blvd = [];
  for (let i = 0; i < 72; i++) {
    const th = (i / 72) * Math.PI * 2;
    blvd.push(DOWNTOWN.clone().multiplyScalar(Math.cos(BLVD_ARC))
      .addScaledVector(bvE1, Math.sin(BLVD_ARC) * Math.cos(th))
      .addScaledVector(bvE2, Math.sin(BLVD_ARC) * Math.sin(th)).normalize());
  }
  roadLayers(blvd, true);
  roadNetPts.push(...blvd);

  // spur roads: downtown out to every district, ending in a turning circle
  const SPURS = [AIRPORT, RESORT, MALL, FARM_A, FARM_B, BEACH];
  for (const target of SPURS) {
    const total = DOWNTOWN.angleTo(target);
    const t0 = Math.min(0.9, 0.94 / total);           // leave from the ring boulevard
    const spur = [];
    for (let k = 0; k <= 26; k++) spur.push(slerpDir(DOWNTOWN, target, t0 + (1 - t0) * (k / 26)));
    const spurPts = smoothLoop(spur, 3, false);
    roadLayers(spurPts, false);
    roadNetPts.push(...spurPts);
    // cul-de-sac: a dirt turning circle where the road arrives
    const end = spur[spur.length - 1];
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.0, 22), new THREE.MeshStandardMaterial({
      color: 0x9a805a, roughness: 0.97, flatShading: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    disc.position.copy(posOn(end, 0.06));
    alignToSurface(disc, end);
    disc.rotateX(-Math.PI / 2);
    disc.receiveShadow = true;
    scene.add(disc);
  }

  // pines line the road at regular intervals — planted, not scattered
  for (let i = 0; i < loop.length; i += 5) {
    const d = loop[i], dn = loop[(i + 1) % loop.length];
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
  const plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.34, 1.7), MW(0xd8cbb2));
  plat.position.y = 0.17; g.add(plat);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 1.7),
    new THREE.MeshStandardMaterial({ color: 0xbdb2a2, flatShading: true, roughness: 0.95 }));
  skirt.position.y = -1.18; g.add(skirt);
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
  // the monumental stair: terraced steps climbing toward the summit, ending
  // at a small columned temple — straight out of the inspiration reel
  {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const d = slerpDir(STOP_DIRS.overlook, MTN, 0.06 + (i / steps) * 0.30);
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.7 - i * 0.05, 0.26, 0.9), M(0xe8e2d4));
      st.position.copy(settleOn(d, 0.9, -0.02));
      alignToSurface(st, d, yawToFace(d, MTN));
      st.receiveShadow = !IS_TOUCH;
      scene.add(st);
    }
    const td = slerpDir(STOP_DIRS.overlook, MTN, 0.4);
    const temple = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 1.7), M(0xe8e2d4));
    base.position.y = 0.15; temple.add(base);
    for (const [px, pz] of [[-0.9, 0.6], [0, 0.6], [0.9, 0.6], [-0.9, -0.6], [0, -0.6], [0.9, -0.6]]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.1, 8), M(0xf2ede2));
      col.position.set(px, 0.85, pz); temple.add(col);
    }
    const archi = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 1.8), M(0xe8e2d4));
    archi.position.y = 1.5; temple.add(archi);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 1.35, 0.55, 4, 1), M(0xdcd4c2));
    ped.rotation.y = Math.PI / 4; ped.scale.z = 0.72; ped.position.y = 1.85; temple.add(ped);
    temple.position.copy(settleOn(td, 1.6, 0.1));
    alignToSurface(temple, td, yawToFace(td, STOP_DIRS.overlook));
    temple.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(temple);
    addSolid(td, 1.6, temple);
  }
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

// ─── little people: torso, head, arms and legs, with a walk cycle ───────────
function makePerson(bodyHex, hatHex = null) {
  const g = new THREE.Group();
  const skin = M(SKIN[Math.floor(rand() * SKIN.length)]);
  const legM = M(0x2d2138);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.42, 10), M(bodyHex));
  torso.position.y = 0.60; g.add(torso);
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.14, 10), legM);
  hips.position.y = 0.36; g.add(hips);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 0.94; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
    M(HAIR[Math.floor(rand() * HAIR.length)]));
  hair.position.y = 0.96; g.add(hair);
  // arms and legs, pivoting from the shoulder/hip so they can swing
  const limbs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.19, 0.78, 0);
    const am = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.38, 6), M(bodyHex));
    am.position.y = -0.19; arm.add(am);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), skin);
    hand.position.y = -0.38; arm.add(hand);
    g.add(arm);
    const leg = new THREE.Group(); leg.position.set(side * 0.09, 0.30, 0);
    const lm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.34, 6), legM);
    lm.position.y = -0.17; leg.add(lm);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.17), M(0x1c1620));
    foot.position.set(0, -0.34, 0.03); leg.add(foot);
    g.add(leg);
    limbs.push({ arm, leg, side });
  }
  if (hatHex !== null) {
    const beret = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.08, 10), M(hatHex));
    beret.position.set(0.02, 1.06, 0); beret.rotation.z = 0.22; g.add(beret);
  }
  g.userData.head = head;
  g.userData.limbs = limbs;
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
}
// swing a person's arms and legs; call each frame with their walk speed 0..1
function walkPerson(p, t, gait) {
  const L = p.userData.limbs; if (!L) return;
  const sw = Math.sin(t * 8) * gait;
  L[0].leg.rotation.x = sw; L[1].leg.rotation.x = -sw;
  L[0].arm.rotation.x = -sw * 0.8; L[1].arm.rotation.x = sw * 0.8;
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
    MW(COTTAGE_COLORS[Math.floor(rand() * COTTAGE_COLORS.length)]));
  body.position.y = 0.55 * s; g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25 * s, 0.8 * s, 4), M(0xb5654a));
  roof.position.y = 1.45 * s; roof.rotation.y = Math.PI / 4; g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.55 * s, 0.06), M(0x6b4a3a));
  door.position.set(0, 0.32 * s, 0.62 * s); g.add(door);
  g.add(foundation(0.95 * s, 1.8, 6));
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
    if (nearRoad(d, 2.0)) continue;
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

mark('downtown:start');
// ─── DOWNTOWN: a real street grid, blocks, and towers ───────────────────────
// Local tangent frame at the plateau: everything below is laid out in metres
// on that plane and then projected back onto the sphere.
{
  const cEast = new THREE.Vector3(0, 1, 0).cross(DOWNTOWN).normalize();
  const cNorth = new THREE.Vector3().crossVectors(DOWNTOWN, cEast).normalize();
  const at = (x, y) => DOWNTOWN.clone().multiplyScalar(R)
    .addScaledVector(cEast, x).addScaledVector(cNorth, y).normalize();

  // Every dimension below is derived, not guessed. A person is 0.6 wide and a
  // jeep 1.5, so the carriageway and footway are sized from those and the
  // buildable area is whatever is left. Nothing may be built outside it.
  const BLOCK = 7.5;          // block pitch — roomier so you can actually drive
  const ROAD_W = 1.3;         // half-width of asphalt (2.6 total: a jeep is 1.5)
  const WALK_W = 0.8;         // footway width (a person is 0.6 across)
  const EDGE = ROAD_W + WALK_W;                 // kerb outer edge from centreline
  const BUILDABLE = BLOCK / 2 - EDGE - 0.05;    // half-width of the plot
  const N = 2;                // blocks out from centre, each way

  // streets: an open ribbon, same construction as the highway
  function street(a, b, halfW, lift, key) {
    const pts = [];
    const STEPS = 40;
    for (let i = 0; i <= STEPS; i++) pts.push(slerpDir(a, b, i / STEPS));
    const pos = [], idx = [];
    const lat = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const d = pts[i], dn = pts[Math.min(i + 1, pts.length - 1)], dp = pts[Math.max(i - 1, 0)];
      const tang = dn.clone().sub(dp.clone().multiplyScalar(dp.dot(dn))).normalize();
      lat.crossVectors(d, tang).normalize();
      const r = Math.max(radiusAt(d), SEA_R) + lift;
      const p1 = d.clone().multiplyScalar(r).addScaledVector(lat, halfW);
      const p2 = d.clone().multiplyScalar(r).addScaledVector(lat, -halfW);
      pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a0 = i * 2, a1 = i * 2 + 1, b0 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, roadMat(key === 'roadMark'));
    mesh.receiveShadow = true;
    scene.add(mesh);
    roadParts.push({ mesh, key });
  }

  const SUB = N + 1;                       // suburbs reach one block further
  const SPAN = BLOCK * (SUB + 0.55);
  const MAP_R = BLOCK * (SUB + 1.4);       // radius of the painted ground, in units

  // draw the whole city floor: concrete, asphalt grid, kerbs, dashes, crosswalks
  function drawCityMap(ctx, P, SZ) {
    const u = SZ / (2 * MAP_R);            // units → pixels
    const X = (x) => SZ / 2 + x * u, Y = (y) => SZ / 2 - y * u;
    const hex = (h) => '#' + h.toString(16).padStart(6, '0');
    ctx.clearRect(0, 0, SZ, SZ);
    // concrete base with a soft grass fade at the rim
    const grad = ctx.createRadialGradient(SZ/2, SZ/2, SZ * 0.30, SZ/2, SZ/2, SZ * 0.5);
    grad.addColorStop(0, '#9c9a95'); grad.addColorStop(0.82, '#9c9a95');
    grad.addColorStop(1, 'rgba(156,154,149,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(SZ/2, SZ/2, SZ/2, 0, Math.PI*2); ctx.fill();
    for (let i = -SUB; i <= SUB; i++) {
      const o = i * BLOCK;
      const w = Math.abs(i) <= N ? ROAD_W : ROAD_W * 0.72;
      const ext = Math.abs(i) <= N ? SPAN : BLOCK * (SUB + 0.2);
      // kerbs (pale), then asphalt (dark)
      ctx.fillStyle = hex(P.roadLine);
      ctx.fillRect(X(o - w - 0.3), Y(ext), (w + 0.3) * 2 * u, 2 * ext * u);
      ctx.fillRect(X(-ext), Y(o + w + 0.3), 2 * ext * u, (w + 0.3) * 2 * u);
      ctx.fillStyle = hex(P.road);
      ctx.fillRect(X(o - w), Y(ext), w * 2 * u, 2 * ext * u);
      ctx.fillRect(X(-ext), Y(o + w), 2 * ext * u, w * 2 * u);
    }
    // dashed centre lines
    ctx.strokeStyle = hex(P.roadMark); ctx.lineWidth = 0.14 * u;
    ctx.setLineDash([0.9 * u, 0.9 * u]);
    for (let i = -N; i <= N; i++) {
      const o = i * BLOCK;
      ctx.beginPath(); ctx.moveTo(X(o), Y(SPAN)); ctx.lineTo(X(o), Y(-SPAN)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(-SPAN), Y(o)); ctx.lineTo(X(SPAN), Y(o)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // zebra crossings on every approach of alternating intersections
    ctx.fillStyle = hex(P.roadMark);
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        if ((i + j) % 2) continue;
        const cx = i * BLOCK, cy = j * BLOCK;
        for (const sgn of [-1, 1]) {
          for (let k = -1; k <= 1; k++) {
            // stripes across the N-S road
            ctx.fillRect(X(cx + k * 0.44 - 0.15), Y(cy + sgn * (ROAD_W + 0.55)), 0.3 * u, 0.5 * u);
            // stripes across the E-W road
            ctx.fillRect(X(cx + sgn * (ROAD_W + 0.55) - 0.25), Y(cy + k * 0.44 + 0.1), 0.5 * u, 0.3 * u);
          }
        }
      }
    }
  }

  // the ground mesh: a disc of tangent-space quads conformed to the terrain,
  // one texture stretched over it — roads are PART OF THE GROUND now
  {
    const SZ = 2048;
    const cv = document.createElement('canvas');
    cv.width = cv.height = SZ;
    cityMapCtx = cv.getContext('2d');
    cityMapDraw = (P) => drawCityMap(cityMapCtx, P, SZ);
    drawCityMap(cityMapCtx, VIBES[vibe], SZ);
    cityMapTex = new THREE.CanvasTexture(cv);
    cityMapTex.colorSpace = THREE.SRGBColorSpace;
    cityMapTex.anisotropy = 4;
    const SEG = 96;
    const pos = [], uvA = [], idx = [];
    for (let iy = 0; iy <= SEG; iy++) {
      for (let ix = 0; ix <= SEG; ix++) {
        const x = -MAP_R + (2 * MAP_R * ix) / SEG;
        const y = -MAP_R + (2 * MAP_R * iy) / SEG;
        const d = at(x, y);
        const r = Math.max(radiusAt(d), SEA_R) + 0.045;
        pos.push(d.x * r, d.y * r, d.z * r);
        uvA.push(ix / SEG, iy / SEG);
      }
    }
    for (let iy = 0; iy < SEG; iy++) {
      for (let ix = 0; ix < SEG; ix++) {
        const a = iy * (SEG + 1) + ix, b = a + 1, c = a + SEG + 1, d2 = c + 1;
        idx.push(a, c, b, b, c, d2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: cityMapTex, transparent: true, roughness: 0.96, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      depthWrite: false,
    }));
    mesh.renderOrder = 2;   // painted floor draws over the terrain, always
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // windows, baked once into a texture — 40 buildings of window boxes would
  // be thousands of meshes for no visual gain
  function windowTexture(lit) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = lit ? '#0d0a14' : '#ffffff';
    c.fillRect(0, 0, 64, 64);
    for (let y = 6; y < 60; y += 13) {
      for (let x = 6; x < 60; x += 13) {
        const on = Math.random() > 0.42;
        c.fillStyle = lit ? (on ? '#ffe9a8' : '#151020') : '#8fa3b8';
        c.fillRect(x, y, 8, 8);
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const winMap = windowTexture(false), winEmis = windowTexture(true);
  const TOWER_COLORS = [0xd9cdbd, 0xc9b7a6, 0xe0d3c2, 0xb9a894, 0xd2c2b8];
  const towerMats = TOWER_COLORS.map(hex => new THREE.MeshStandardMaterial({
    color: hex, map: winMap, emissive: 0xffffff, emissiveMap: winEmis,
    emissiveIntensity: 0.0, roughness: 0.9, flatShading: false,
  }));
  cityWindowMats.push(...towerMats);

  const ROOF = M(0x8d8477);
  function tower(x, y, h, w, d, mat, rot) {
    const g = new THREE.Group();
    // grid-aligned: local +Z faces "grid east", then rot turns in right angles
    const gridYaw = (dd2) => yawToFace(dd2, at(x + 4, y)) + rot;
    const geo = new THREE.BoxGeometry(w, h, d);
    // one texture tile per storey, so windows stay the same size on every tower
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 4.5), uv.getY(i) * (h / 4.5));
    uv.needsUpdate = true;
    const body = new THREE.Mesh(geo, mat);
    body.position.y = h / 2 - 0.5; g.add(body);   // sunk, so short blocks need no plinth
    // ground-floor: a darker stone base with a doorway
    const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.9, d * 1.04), M(0x9a8f80));
    base.position.y = -0.05; g.add(base);
    const doorw = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 0.7, 0.06), M(0x2d2138));
    doorw.position.set(0, 0.05, d / 2 + 0.02); g.add(doorw);
    // a cornice lip, then the roof slab
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(w * 1.12, 0.16, d * 1.12), M(0x746a5e));
    cornice.position.y = h - 0.5; g.add(cornice);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 0.22, d * 1.06), ROOF);
    cap.position.y = h - 0.36; g.add(cap);
    // a stepped penthouse on the taller towers
    if (h > 7 && rand() > 0.4) {
      const pent = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.9, d * 0.6), mat);
      pent.position.y = h - 0.05; g.add(pent);
      const pcap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.66, 0.14, d * 0.66), ROOF);
      pcap.position.y = h + 0.42; g.add(pcap);
    }
    // rooftop clutter, the detail that sells a lived-in city
    if (h > 5.0 && rand() > 0.45) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 8), M(0x9a6b4f));
      tank.position.set((rand() - 0.5) * w * 0.5, h + 0.5, (rand() - 0.5) * d * 0.5); g.add(tank);
    }
    if (h > 5.0 && rand() > 0.5) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.42), M(0xa8adb5));
      ac.position.set((rand() - 0.5) * w * 0.5, h + 0.42, (rand() - 0.5) * d * 0.5); g.add(ac);
    }
    if (h > 5.0) g.add(foundation(Math.max(w, d) * 0.6, 3.0, 6));
    const dd = at(x, y);
    addSolid(dd, Math.max(w, d) * 0.62, g);
    g.position.copy(settleOn(dd, Math.max(w, d) * 0.6, 0.14));
    alignToSurface(g, dd, gridYaw(dd));
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(g);
  }

  const FACADE = [0x3fa8a0, 0xc0504a, 0xd8a83a, 0xe8836a, 0x6a8fc0, 0xb06ab0, 0xe8c9a8];
  const TILE = [0xb5654a, 0xc76a3a, 0xa85a3f];
  // Density falls off with distance: glass core -> midrise -> houses with
  // gardens. Cities read as cities because of the gradient, not the towers.
  const museumDir = LANDMARKS.find(l => l.key === 'artgarden').dir;
  let mi = 0;
  for (let bx = -SUB; bx < SUB; bx++) {
    for (let by = -SUB; by < SUB; by++) {
      const cx = bx * BLOCK + BLOCK / 2, cy = by * BLOCK + BLOCK / 2;
      const ring = Math.max(Math.abs(bx + 0.5), Math.abs(by + 0.5));   // Chebyshev = square rings
      const dd0 = at(cx, cy);
      if (dd0.angleTo(museumDir) < 0.075) continue;
      if (!isLand(dd0, 0.05)) continue;               // don't build into the strait
      const fromCentre = ring / SUB;

      if (ring <= N * 0.55) {                          // ── core: towers
        if (rand() < 0.14) { plaza(cx, cy); continue; }   // more open squares
        const per = 1;                                    // one tower per block
        for (let k = 0; k < per; k++) {
          const h = (7.5 + rand() * 6.5) * (1.15 - fromCentre * 0.35);
          plot(cx, cy, Math.max(6.0, h), 1.2 + rand() * 0.5, mi++);
        }
      } else if (ring <= N) {                          // ── midrise: shops + flats
        if (rand() < 0.22) { plaza(cx, cy); continue; }
        const per = 1;
        for (let k = 0; k < per; k++) {
          plot(cx, cy, 2.7 + rand() * 2.2, 1.2 + rand() * 0.5, mi++);
        }
      } else {                                         // ── suburbs: EUROPEAN
        // row-house terraces — many buildings shoulder to shoulder, vivid
        // facades under one shared terracotta roof, like the reference
        if (rand() < 0.22) { park(cx, cy, 3); continue; }
        const terrace = buildTerrace(cx, cy, (bx + by) % 2 ? 0 : Math.PI / 2);
        if (terrace && rand() > 0.55) {                // a tree by the terrace
          const td = at(cx + (rand() - 0.5) * 3, cy + (rand() - 0.5) * 3);
          if (isLand(td, 0.05) && !nearRoad(td, 2.2)) {
            const tr = roundTree();
            tr.position.copy(settleOn(td, 0.4, 0.1));
            alignToSurface(tr, td, rand() * Math.PI * 2);
            deco.add(tr);
          }
        }
      }
    }
  }

  // a European terrace: 4-5 contiguous units, each its own vivid colour, tall
  // windows and a door, iron balcony line, one continuous terracotta roof
  function buildTerrace(cx, cy, yawExtra) {
    const dd0 = at(cx, cy);
    if (!isLand(dd0, 0.05) || nearRoad(dd0, 2.4)) return null;
    const g = new THREE.Group();
    const units = 4 + Math.floor(rand() * 2);
    const uw = 0.72, depth = 1.3;
    const len = units * uw;
    const H0 = 1.5 + rand() * 0.4;
    let fx = -len / 2;
    for (let u = 0; u < units; u++) {
      const wallHex = FACADE[Math.floor(rand() * FACADE.length)];
      const h = H0 + (rand() - 0.5) * 0.25;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(uw, h, depth), MW(wallHex));
      wall.position.set(fx + uw / 2, h / 2, 0); g.add(wall);
      // tall door OR ground window, and an upper window with shutters
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.05), M(0x6b4a2b));
      door.position.set(fx + uw / 2 + (rand() - 0.5) * 0.2, 0.21, depth / 2 + 0.02); g.add(door);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.04), M(0xbfe8ff));
      win.position.set(fx + uw / 2, h * 0.68, depth / 2 + 0.02); g.add(win);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), M(0xf2e8d8));
      lintel.position.set(fx + uw / 2, h * 0.68 + 0.19, depth / 2 + 0.02); g.add(lintel);
      fx += uw;
    }
    // one continuous balcony rail across the upper floor
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, 0.05, 0.06), M(0x2d2138));
    rail.position.set(0, H0 * 0.55, depth / 2 + 0.08); g.add(rail);
    for (let b = 0; b <= units * 2; b++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.025), M(0x2d2138));
      bar.position.set(-len * 0.48 + (len * 0.96 / (units * 2)) * b, H0 * 0.55 - 0.09, depth / 2 + 0.08);
      g.add(bar);
    }
    // the shared terracotta roof, one gable over the whole terrace
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, depth * 0.82, 0.55, 4, 1), M(TILE[Math.floor(rand() * TILE.length)]));
    roof.rotation.y = Math.PI / 4;
    roof.scale.x = (len + 0.2) / (depth * 1.16);
    roof.position.y = H0 + 0.26; g.add(roof);
    // ridge caps + chimney
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.35, 0.16), M(0x9a6b4f));
    chim.position.set(len * (rand() - 0.5) * 0.6, H0 + 0.55, 0); g.add(chim);
    g.add(foundation(len * 0.55, 2.0, 6));
    addSolid(dd0, len * 0.55, g);
    g.position.copy(settleOn(dd0, len * 0.55, 0.12));
    alignToSurface(g, dd0, gridYawAt(cx, cy) + yawExtra);
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(g);
    return g;
  }
  function gridYawAt(cx, cy) {
    const dd = at(cx, cy);
    return yawToFace(dd, at(cx + 4, cy));
  }

  // the only way a building gets placed: size and jitter are clamped so the
  // footprint always stays inside the plot, clear of footway and carriageway
  function plot(cx, cy, h, halfW, idx) {
    const hw = Math.min(halfW, BUILDABLE * 0.86);
    const room = Math.max(0, BUILDABLE - hw);
    const ox = (rand() - 0.5) * 2 * room, oy = (rand() - 0.5) * 2 * room;
    tower(cx + ox, cy + oy, h, hw * 2, hw * 2,
      towerMats[idx % towerMats.length], Math.round(rand() * 4) * Math.PI / 2);
  }

  function plaza(cx, cy) {
    for (let k = 0; k < 4; k++) {
      const dd = at(cx + (rand() - 0.5) * 3, cy + (rand() - 0.5) * 3);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.3), WOOD);
      bench.position.copy(settleOn(dd, 0.4, 0.02));
      alignToSurface(bench, dd, rand() * Math.PI);
      deco.add(bench);
    }
    for (let k = 0; k < 2; k++) {
      const dd = at(cx + (rand() - 0.5) * 3.6, cy + (rand() - 0.5) * 3.6);
      const tr = roundTree();
      tr.scale.setScalar(0.7);
      tr.position.copy(settleOn(dd, 0.4, 0.1));
      alignToSurface(tr, dd, rand() * Math.PI * 2);
      deco.add(tr);
    }
  }

  function park(cx, cy, n) {
    for (let k = 0; k < n; k++) {
      const dd = at(cx + (rand() - 0.5) * 3.4, cy + (rand() - 0.5) * 3.4);
      if (!isLand(dd, 0.05)) continue;
      const tr = rand() > 0.5 ? pineTree() : roundTree();
      tr.position.copy(settleOn(dd, 0.5, 0.1));
      alignToSurface(tr, dd, rand() * Math.PI * 2);
      deco.add(tr);
    }
  }

  // ── kerbs: a raised sidewalk slab down each block frontage. This is what
  // actually separates "buildings on grass" from "buildings on a street".
  for (let i = -N; i <= N; i++) {
    for (const axis of [0, 1]) {
      for (const side of [-1, 1]) {
        const o = i * BLOCK + side * (ROAD_W + WALK_W / 2);
        const ext = BLOCK * (N + 0.5);
        const a = axis ? at(-ext, o) : at(o, -ext);
        const b = axis ? at(ext, o) : at(o, ext);
        street(a, b, WALK_W / 2, 0.14, 'roadLine');
      }
    }
  }
  // ── traffic: cars driving the grid, and people on the sidewalks
  const carBody = [0xff4d6e, 0x4e8eff, 0xffd23d, 0xfffaf2, 0x2dd47b, 0x8f7ae8];
  function makeCar(hex) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 2.1), M(hex, { roughness: 0.5 }));
    b.position.y = 0.4; g.add(b);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.38, 0.95), M(0xcfeef8, { roughness: 0.2 }));
    cab.position.set(0, 0.78, -0.1); g.add(cab);
    for (const [wx, wz] of [[-0.5, 0.66], [0.5, 0.66], [-0.5, -0.66], [0.5, -0.66]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 7), M(0x2d2138));
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.2, wz); g.add(w);
    }
    return g;
  }
  const LANE = ROAD_W * 0.5;
  for (let n = 0; n < 7; n++) {               // fewer cars: real models cost more
    const axis = n % 2;
    const line = (Math.floor(rand() * (2 * N + 1)) - N) * BLOCK;
    const fwd = rand() > 0.5 ? 1 : -1;
    const ext = BLOCK * (N + 0.5);
    const lane = fwd * LANE;                       // keep right
    const a = axis ? at(-ext * fwd, line + lane) : at(line - lane, -ext * fwd);
    const b = axis ? at(ext * fwd, line + lane) : at(line - lane, ext * fwd);
    const car = makeCar(carBody[n % carBody.length]);
    scene.add(car);
    traffic.push({ obj: car, a, b, t: rand(), speed: 0.055 + rand() * 0.05, kind: 'car' });
  }
  for (let n = 0; n < 12; n++) {                   // pedestrians on the kerb
    const axis = n % 2;
    const line = (Math.floor(rand() * (2 * N + 1)) - N) * BLOCK;
    const side = rand() > 0.5 ? 1 : -1;
    const off = side * (ROAD_W + WALK_W * 0.5);
    const ext = BLOCK * (N + 0.4);
    const dirSign = rand() > 0.5 ? 1 : -1;
    const a = axis ? at(-ext * dirSign, line + off) : at(line + off, -ext * dirSign);
    const b = axis ? at(ext * dirSign, line + off) : at(line + off, ext * dirSign);
    const ped = makePerson(carBody[(n + 3) % carBody.length], n % 3 === 0 ? 0x2d2138 : null);
    ped.scale.setScalar(0.72);
    scene.add(ped);
    traffic.push({ obj: ped, a, b, t: rand(), speed: 0.016 + rand() * 0.01, kind: 'ped', phase: n });
  }

  // street furniture at the intersections
  for (let i = -N; i <= N; i++) {
    for (let j = -N; j <= N; j++) {
      if ((i + j) % 3) continue;
      const dd = at(i * BLOCK + 1.6, j * BLOCK + 1.6);
      const lamp = streetLamp();
      lamp.position.copy(settleOn(dd, 0.4, 0.1));
      alignToSurface(lamp, dd, rand() * Math.PI * 2);
      deco.add(lamp);
    }
  }
}

mark('bridge:start');
// ─── the big red bridge, and the working waterfront ─────────────────────────
{
  const INTL_ORANGE = M(0xd8492a, { roughness: 0.72 });
  const CABLE = M(0x8f2f18, { roughness: 0.6 });
  const DECK_M = M(0x8d8f96, { roughness: 0.95 });
  const RAIL_M = M(0xb8452a, { roughness: 0.7 });

  // span the strait: walk the arc from downtown toward the boardwalk and take
  // the stretch that is actually open water
  const A = DOWNTOWN, B = STOP_DIRS.boardwalk;
  let t0 = null, t1 = null;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const wet = !isLand(slerpDir(A, B, t), 0.02);
    if (wet && t0 === null) t0 = t;
    if (wet) t1 = t;
  }
  if (t0 !== null && t1 - t0 > 0.02) {
    const pad = 0.035;                       // land the abutments on dry ground
    const s0 = Math.max(0, t0 - pad), s1 = Math.min(1, t1 + pad);
    const DECK_R = SEA_R + 1.9;              // deck rides well clear of the water
    const N = 30;
    const pts = [];
    for (let i = 0; i <= N; i++) pts.push(slerpDir(A, B, s0 + (s1 - s0) * i / N));

    // deck + kerbs, built like the roads so it tints with the vibe
    function deckRibbon(halfW, lift, mat) {
      const pos = [], idx = [];
      const lat = new THREE.Vector3();
      for (let i = 0; i < pts.length; i++) {
        const d = pts[i], dn = pts[Math.min(i + 1, N)], dp = pts[Math.max(i - 1, 0)];
        const tang = dn.clone().sub(dp.clone().multiplyScalar(dp.dot(dn))).normalize();
        lat.crossVectors(d, tang).normalize();
        // ends dip down to meet the shore
        const edge = Math.min(i, N - i) / 6;
        const r = DECK_R + lift - (1 - Math.min(1, edge)) * 1.25;
        const p1 = d.clone().multiplyScalar(r).addScaledVector(lat, halfW);
        const p2 = d.clone().multiplyScalar(r).addScaledVector(lat, -halfW);
        pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
      for (let i = 0; i < N; i++) {
        const a0 = i * 2, a1 = i * 2 + 1, b0 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    }
    camOccluders.push(deckRibbon(1.55, 0, DECK_M));
    deckRibbon(1.62, -0.12, INTL_ORANGE);    // the deck's underside beam

    const towerAt = [0.28, 0.72];
    const tops = [];
    for (const f of towerAt) {
      const d = pts[Math.round(f * N)];
      const dn = pts[Math.min(Math.round(f * N) + 1, N)];
      const tang = dn.clone().sub(d.clone().multiplyScalar(d.dot(dn))).normalize();
      const lat = new THREE.Vector3().crossVectors(d, tang).normalize();
      const base = d.clone().multiplyScalar(SEA_R - 0.6);
      const H = 9.0;
      const g = new THREE.Group();
      for (const sgn of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, H, 0.42), INTL_ORANGE);
        leg.position.set(sgn * 1.35, H / 2, 0);
        g.add(leg);
      }
      for (const hy of [0.42, 0.66, 0.9]) {                 // crossbeams
        const bar = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.34, 0.36), INTL_ORANGE);
        bar.position.set(0, H * hy, 0); g.add(bar);
      }
      const _m2 = new THREE.Matrix4().makeBasis(lat, d, tang);
      g.position.copy(base);
      g.quaternion.setFromRotationMatrix(_m2);
      g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
      scene.add(g);
      camOccluders.push(g);
      tops.push(d.clone().multiplyScalar(SEA_R - 0.6 + H));
    }

    // main cables: a sag through midspan, plus suspenders down to the deck
    for (const sgn of [-1, 1]) {
      const cablePts = [];
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        const d = pts[i];
        const dn = pts[Math.min(i + 1, N)], dp = pts[Math.max(i - 1, 0)];
        const tang = dn.clone().sub(dp.clone().multiplyScalar(dp.dot(dn))).normalize();
        const lat = new THREE.Vector3().crossVectors(d, tang).normalize();
        let hgt;
        if (f < towerAt[0]) hgt = THREE.MathUtils.lerp(1.2, 8.4, f / towerAt[0]);
        else if (f > towerAt[1]) hgt = THREE.MathUtils.lerp(8.4, 1.2, (f - towerAt[1]) / (1 - towerAt[1]));
        else {
          const k = (f - towerAt[0]) / (towerAt[1] - towerAt[0]);
          hgt = 8.4 - Math.sin(k * Math.PI) * 6.2;        // the sag
        }
        cablePts.push(d.clone().multiplyScalar(SEA_R - 0.6 + hgt).addScaledVector(lat, sgn * 1.35));
      }
      const curve = new THREE.CatmullRomCurve3(cablePts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 46, 0.11, 5, false), CABLE);
      scene.add(tube);
      for (let i = 3; i < N - 2; i += 2) {                  // suspender ropes
        const top = cablePts[i];
        const d = pts[i];
        const dn = pts[Math.min(i + 1, N)], dp = pts[Math.max(i - 1, 0)];
        const tang = dn.clone().sub(dp.clone().multiplyScalar(dp.dot(dn))).normalize();
        const lat = new THREE.Vector3().crossVectors(d, tang).normalize();
        const bot = d.clone().multiplyScalar(DECK_R).addScaledVector(lat, sgn * 1.35);
        const len = top.distanceTo(bot);
        if (len < 0.25) continue;
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 4), CABLE);
        rope.position.copy(top).lerp(bot, 0.5);
        rope.quaternion.setFromUnitVectors(UP_Y, top.clone().sub(bot).normalize());
        scene.add(rope);
      }
      for (let i = 0; i < N; i += 2) {                      // deck railing
        const d = pts[i];
        const dn = pts[Math.min(i + 1, N)], dp = pts[Math.max(i - 1, 0)];
        const tang = dn.clone().sub(dp.clone().multiplyScalar(dp.dot(dn))).normalize();
        const lat = new THREE.Vector3().crossVectors(d, tang).normalize();
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.09), RAIL_M);
        post.position.copy(d.clone().multiplyScalar(DECK_R + 0.2).addScaledVector(lat, sgn * 1.5));
        alignToSurface(post, d);
        scene.add(post);
      }
    }
  }

  // ── the working waterfront: a fishing pier off the boardwalk ──
  {
    const shore = STOP_DIRS.boardwalk;
    // head out to sea, perpendicular-ish to the coast
    let best = null, bestScore = -1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const axis = new THREE.Vector3(0, 1, 0).cross(shore).normalize().applyAxisAngle(shore, a);
      const probe = shore.clone().applyAxisAngle(axis, 0.055).normalize();
      const score = SEA_H - surfH(probe);
      if (score > bestScore) { bestScore = score; best = axis; }
    }
    if (bestScore > 0) {
      const PLANKS = 9;
      for (let i = 1; i <= PLANKS; i++) {
        const d = shore.clone().applyAxisAngle(best, 0.011 * i).normalize();
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.62), WOOD);
        plank.position.copy(d.clone().multiplyScalar(SEA_R + 0.42));
        alignToSurface(plank, d, yawToFace(d, shore));
        scene.add(plank);
        for (const sgn of [-1, 1]) {                        // pilings
          const axis2 = new THREE.Vector3().crossVectors(d, best).normalize();
          const pd = d.clone().applyAxisAngle(axis2, sgn * 0.008).normalize();
          const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.5, 5), M(0x6b4a2b));
          pile.position.copy(pd.clone().multiplyScalar(SEA_R - 0.3));
          alignToSurface(pile, pd);
          scene.add(pile);
        }
        if (i === PLANKS) {                                  // the fisherman
          const f = makePerson(0x2d6ea8, 0xffd23d);
          f.scale.setScalar(0.78);
          f.position.copy(d.clone().multiplyScalar(SEA_R + 0.48));
          alignToSurface(f, d, yawToFace(d, shore));
          scene.add(f);
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.5, 4), WOOD);
          rod.position.copy(d.clone().multiplyScalar(SEA_R + 1.35));
          alignToSurface(rod, d);
          rod.rotateX(0.9);
          scene.add(rod);
        }
        if (i === 4 || i === 7) {                            // crates + creels
          const crate = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), M(0xc9a06a));
          crate.position.copy(d.clone().multiplyScalar(SEA_R + 0.68));
          alignToSurface(crate, d, rand() * Math.PI);
          scene.add(crate);
        }
      }
    }
  }
}

// ─── THE BAY: beach, dock, fishing boats and the people who use them ────────
{
  const bEast = new THREE.Vector3(0, 1, 0).cross(BEACH).normalize();
  const bNorth = new THREE.Vector3().crossVectors(BEACH, bEast).normalize();
  const bAt = (x, y) => BEACH.clone().multiplyScalar(R)
    .addScaledVector(bEast, x).addScaledVector(bNorth, y).normalize();

  // find which way is out to sea, so the dock runs the right direction
  let seaSign = 1, best = -1e9;
  for (const sgn of [-1, 1]) {
    const depth = SEA_H - surfH(bAt(0, sgn * 7));
    if (depth > best) { best = depth; seaSign = sgn; }
  }

  // ── the dock: a long jetty on pilings, with a shack and moored boats
  const DOCK_LEN = 13;
  for (let i = 0; i < DOCK_LEN; i++) {
    const y = seaSign * (1.5 + i * 1.05);
    const d = bAt(0, y);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 1.05), WOOD);
    deck.position.copy(d.clone().multiplyScalar(SEA_R + 0.55));
    alignToSurface(deck, d, yawToFace(d, BEACH));
    deck.receiveShadow = !IS_TOUCH;
    scene.add(deck);
    if (i % 2 === 0) {
      for (const sx of [-1.05, 1.05]) {
        const pd = bAt(sx, y);
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6), M(0x6b4a2b));
        pile.position.copy(pd.clone().multiplyScalar(SEA_R - 0.35));
        alignToSurface(pile, pd);
        scene.add(pile);
      }
    }
    if (i % 4 === 1) {                       // lamp posts down the jetty
      const pd = bAt(1.05, y);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6), M(0x2d2138));
      post.position.copy(pd.clone().multiplyScalar(SEA_R + 1.35));
      alignToSurface(post, pd); scene.add(post);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lampBulbMat);
      bulb.position.copy(pd.clone().multiplyScalar(SEA_R + 2.15));
      scene.add(bulb);
    }
  }
  // the bait shack at the head of the jetty
  {
    const d = bAt(-2.2, seaSign * 2.0);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.25, 1.5), MW(0xdfe6ec));
    body.position.y = 0.62; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.7, 4), M(0xc7572a));
    roof.position.y = 1.6; roof.rotation.y = Math.PI / 4; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.8, 0.08), M(0x6b4a2b));
    door.position.set(0, 0.4, 0.78); g.add(door);
    g.add(foundation(1.1, 2.0, 6));
    g.position.copy(settleOn(d, 1.1, 0.1));
    alignToSurface(g, d, yawToFace(d, bAt(0, seaSign * 8)));
    scene.add(g);
    addSolid(d, 1.1, g);
  }

  // ── people fishing: some on the jetty, some down on the sand
  const anglerSpots = [
    [1.15, seaSign * 6.3], [-1.15, seaSign * 9.5], [1.15, seaSign * 12.0],
    [-1.15, seaSign * 4.2], [3.4, seaSign * 1.2], [-4.1, seaSign * 0.6],
  ];
  anglerSpots.forEach(([x, y], i) => {
    const d = bAt(x, y);
    const onDock = Math.abs(x) < 1.6 && Math.abs(y) > 2;
    const p = makePerson([0x2d6ea8, 0xff7eb6, 0xffd23d, 0x2dd47b][i % 4], i % 2 ? 0x2d2138 : null);
    p.scale.setScalar(0.78);
    p.position.copy(onDock ? d.clone().multiplyScalar(SEA_R + 0.62) : settleOn(d, 0.3, 0.02));
    alignToSurface(p, d, yawToFace(d, bAt(x, y + seaSign * 4)));
    scene.add(p);
    npcs.push(Object.assign(p, { userData: { head: p.userData.head, phase: i * 2.1 } }));
    // the rod, angled out over the water
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 1.7, 4), WOOD);
    rod.position.copy((onDock ? d.clone().multiplyScalar(SEA_R + 1.2) : posOn(d, 0.62)));
    alignToSurface(rod, d, yawToFace(d, bAt(x, y + seaSign * 4)));
    rod.rotateX(-0.95);
    scene.add(rod);
    // a bucket for the catch
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 7), M(0xc7572a));
    bucket.position.copy(onDock ? d.clone().multiplyScalar(SEA_R + 0.6) : settleOn(d, 0.2, 0.0));
    bucket.translateOnAxis(new THREE.Vector3(1, 0, 0), 0.4);
    scene.add(bucket);
  });

  // ── moored fishing boats along the jetty
  for (const [x, y, hue] of [[2.1, seaSign * 5.0, 0xff4d6e], [-2.1, seaSign * 8.0, 0x4e8eff], [2.1, seaSign * 11.0, 0xffd23d]]) {
    const d = bAt(x, y);
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 2.2), M(hue));
    hull.position.y = 0.2; g.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.7, 4), M(hue));
    bow.rotation.x = Math.PI / 2; bow.rotation.z = Math.PI / 4;
    bow.position.set(0, 0.2, 1.4); g.add(bow);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), M(0xfffaf2));
    cabin.position.set(0, 0.62, -0.5); g.add(cabin);
    const mastB = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 5), WOOD);
    mastB.position.set(0, 1.0, 0.3); g.add(mastB);
    g.position.copy(d.clone().multiplyScalar(SEA_R - 0.08));
    alignToSurface(g, d, yawToFace(d, bAt(x, y + seaSign * 3)));
    scene.add(g);
    bobbers.push(g);
  }

  // ── beach clutter: umbrellas, towels, a rowboat pulled up on the sand
  for (let i = 0; i < 7; i++) {
    const d = bAt(-9 + i * 3.1 + rand() * 1.4, -seaSign * (1.2 + rand() * 2.6));
    if (surfH(d) < SEA_H) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.15, 5), M(0xfffaf2));
    pole.position.copy(settleOn(d, 0.2, 0)); pole.translateY(0.55);
    alignToSurface(pole, d); scene.add(pole);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.42, 9),
      M([0xff4d6e, 0xffd23d, 0x33c9ff][i % 3]));
    shade.position.copy(posOn(d, 1.15));
    alignToSurface(shade, d); scene.add(shade);
  }
}

mark('districts:start');
// ─── OUTLYING DISTRICTS: airport, resort, mall, farms ───────────────────────
// A local tangent frame at any anchor, so each district is laid out in metres
// on a plane and projected back onto the sphere.
function frameAt(anchor) {
  const east = new THREE.Vector3(0, 1, 0).cross(anchor).normalize();
  const north = new THREE.Vector3().crossVectors(anchor, east).normalize();
  return (x, y) => anchor.clone().multiplyScalar(R).addScaledVector(east, x).addScaledVector(north, y).normalize();
}
function districtSign(anchor, label, offX, offY) {
  const at = frameAt(anchor);
  const d = at(offX, offY);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.2, 6), M(0x2d2138));
  post.position.copy(settleOn(d, 0.3, 0)); post.translateY(0.6);
  alignToSurface(post, d); scene.add(post);
  tinySign(label, posOn(d, 1.6));
}
function simpleCar(hex) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 2.1), M(hex, { roughness: 0.5 }));
  b.position.y = 0.4; g.add(b);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.38, 0.95), M(0xcfeef8, { roughness: 0.2 }));
  cab.position.set(0, 0.78, -0.1); g.add(cab);
  for (const [wx, wz] of [[-0.5, 0.66], [0.5, 0.66], [-0.5, -0.66], [0.5, -0.66]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 7), M(0x2d2138));
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.2, wz); g.add(w);
  }
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
}
function boxHouse(w, h, dd_, bodyHex, roofHex, roofType = 'gable') {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd_), MW(bodyHex));
  body.position.y = h / 2; g.add(body);
  if (roofType === 'gable') {
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, w * 0.62, 0.5, 4, 1),
      M(roofHex)); roof.rotation.y = Math.PI / 4; roof.position.y = h + 0.24; roof.scale.z = dd_ / w; g.add(roof);
  } else {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.12, dd_ * 1.05), M(roofHex));
    roof.position.y = h + 0.06; g.add(roof);
  }
  return g;
}

// ── THE AIRPORT: a runway, a terminal, a parked plane ──
{
  const at = frameAt(AIRPORT);
  // runway: a long dark ribbon with dashed centreline
  for (const [halfW, lift, col, dash] of [[2.4, 0.05, 0x3a3a42, false], [0.14, 0.09, 0xf2ecd8, true]]) {
    const N = 30;
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const y = -18 + (36 * i / N);
      const c = at(0, y), cl = at(-1, y), cr = at(1, y);
      const lat = cr.clone().sub(cl).normalize();
      const r = Math.max(radiusAt(c), SEA_R) + lift;
      const p1 = c.clone().multiplyScalar(r).addScaledVector(lat, halfW);
      const p2 = c.clone().multiplyScalar(r).addScaledVector(lat, -halfW);
      pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
    for (let i = 0; i < N; i++) {
      if (dash && i % 3 === 0) continue;
      const a0 = i * 2, a1 = i * 2 + 1, b0 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, M(col)); m.receiveShadow = !IS_TOUCH; scene.add(m);
  }
  // terminal building
  {
    const d = at(4.5, 0);
    const g = new THREE.Group();
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.6, 7.0), MW(0xdfe6ec));
    hall.position.y = 0.8; g.add(hall);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(3.05, 1.0, 7.05),
      new THREE.MeshStandardMaterial({ color: 0x8fb8d8, roughness: 0.2, transparent: true, opacity: 0.55 }));
    glass.position.y = 0.75; g.add(glass);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.6, 0.8), M(0xcfd6de));
    tower.position.set(1.0, 1.3, 3.0); g.add(tower);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 1.0), M(0x2d6ea8));
    cab.position.set(1.0, 2.9, 3.0); g.add(cab);
    g.add(foundation(3.4, 2.4, 6));
    g.position.copy(settleOn(d, 3.4, 0.12));
    alignToSurface(g, d, yawToFace(d, at(0, 0)));
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(g); addSolid(d, 3.4, g);
  }
  // the private jet, silhouette done properly: tapered fuselage, swept wings
  // with dihedral, rear-mounted engines, swept tail with a T-stabiliser, and
  // real landing gear — nose along +Z
  {
    const d = at(-3.2, 3);
    const g = new THREE.Group();
    const WHITE = M(0xf4f6f8, { roughness: 0.35 });
    const NAVY = M(0x14243a);
    const DARKG = M(0x2d3540);
    // fuselage: centre tube + tapered nose and tail cones
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.6, 14), WHITE);
    tube.rotation.x = Math.PI / 2; tube.position.set(0, 1.05, 0.3); g.add(tube);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.1, 1.1, 14), WHITE);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.02, 2.15); g.add(nose);
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), NAVY);
    noseTip.position.set(0, 0.99, 2.7); g.add(noseTip);
    const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.14, 1.3, 14), WHITE);
    tailCone.rotation.x = -Math.PI / 2; tailCone.position.set(0, 1.1, -1.65); g.add(tailCone);
    // cockpit windows: a dark wrap near the nose
    const cockpit = new THREE.Mesh(new THREE.CylinderGeometry(0.425, 0.35, 0.35, 14), NAVY);
    cockpit.rotation.x = Math.PI / 2; cockpit.position.set(0, 1.06, 1.85); g.add(cockpit);
    // cheatline + cabin windows
    for (const sx of [-0.43, 0.43]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 3.2), NAVY);
      line.position.set(sx, 1.12, 0.2); g.add(line);
    }
    // swept wings with a little dihedral
    for (const sgn of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.95), WHITE);
      wing.position.set(sgn * 1.35, 0.88, 0.35);
      wing.rotation.z = sgn * 0.09;                  // dihedral
      wing.rotation.y = -sgn * 0.45;                 // sweep BACK
      g.add(wing);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.4), NAVY);
      tip.position.set(sgn * 2.42, 0.99, -0.42); tip.rotation.y = -sgn * 0.45; g.add(tip);
      // rear-mounted engines on the tail flanks
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.75, 10), DARKG);
      eng.rotation.x = Math.PI / 2; eng.position.set(sgn * 0.58, 1.28, -1.15); g.add(eng);
      const engRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 14), NAVY);
      engRing.position.set(sgn * 0.58, 1.28, -0.78); g.add(engRing);
    }
    // swept fin + T-tail stabiliser
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.05, 0.75), NAVY);
    fin.position.set(0, 1.75, -2.0); fin.rotation.x = 0.35; g.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.5), WHITE);
    stab.position.set(0, 2.22, -2.25); g.add(stab);
    // LANDING GEAR: nose strut + twin mains, real wheels
    const gearWheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10);
    gearWheelGeo.rotateZ(Math.PI / 2);
    function gear(x, z, twin) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 6), DARKG);
      strut.position.set(x, 0.55, z); g.add(strut);
      for (const wx of twin ? [x - 0.09, x + 0.09] : [x]) {
        const w = new THREE.Mesh(gearWheelGeo, M(0x1c1620));
        w.position.set(wx, 0.26, z); g.add(w);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), M(0xd8d8e0));
        hub.rotation.z = Math.PI / 2; hub.position.set(wx, 0.26, z); g.add(hub);
      }
    }
    gear(0, 1.9, false);                            // nose gear
    gear(-0.55, -0.1, true); gear(0.55, -0.1, true); // mains under the wing root
    g.position.copy(settleOn(d, 2.0, -0.02));
    alignToSurface(g, d, yawToFace(d, at(0, 12)));
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(g); airportPlane = g;
  }
  // the NetJets sign on the terminal apron
  {
    const d = at(4.5, -6);
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.16), M(0x14243a));
    const g = new THREE.Group();
    g.add(board);
    const posts = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6), M(0x2d2138));
    posts.position.y = -1.0; g.add(posts);
    g.position.copy(posOn(d, 1.5));
    alignToSurface(g, d, yawToFace(d, at(0, 0)));
    scene.add(g);
    tinySign('✈ NetJets Terminal', posOn(d, 2.9));
  }
  districtSign(AIRPORT, '✈ Airport', 0, -19);
}

// ─── real 3-D vehicles: a diverse car fleet for the traffic, plus the parked
// jet. The source GLBs are huge photoreal scans; scripts/optimize-cars.mjs
// decimates them to ~45k tris and shrinks their textures to 512² WebP but KEEPS
// their real livery + smooth (curved) normals, so here we just wear the model's
// own materials and let the scene light them. Cars can only ever ride the road
// because they REUSE the existing traffic lane system — we swap the boxy
// placeholder for a real model once it streams in, so a slow/failed load never
// leaves a hole (the box stays), and register each one with the grease-pencil /
// boil-outline system so they draw correctly in Sketchbook + Wasteland modes.
let limoTemplate = null;   // real limo model for the arrival cinematic (see buildLimo)
let gearProto = null;      // one normalized landing-gear leg, cloned onto the jet
let stationG = null;       // real Central Station building (walk through to board)
let subwayInt = null;      // subway car interior, wrapped around the camera mid-ride
{
  const draco = new DRACOLoader().setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
  const gltfV = new GLTFLoader().setDRACOLoader(draco);

  // NO fallbacks for real-model assets: a missing/broken GLB is a hard error,
  // same treatment as critic.glb — full-screen banner + throw, so a bad build
  // can never quietly ship boxy stand-ins.
  function assetFail(label) {
    return (e) => {
      const msg = `Asset ${label} failed to load: ` + (e?.message || e);
      console.error(msg);
      const b = document.createElement('div');
      b.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;'
        + 'justify-content:center;text-align:center;padding:8vw;background:#160f1e;color:#ff8ab0;'
        + 'font:600 clamp(15px,2.4vw,20px)/1.5 system-ui,sans-serif';
      b.textContent = '⚠ ' + msg;
      document.body.appendChild(b);
      throw new Error(msg);
    };
  }

  // len = how long the car should read in world units (a lane is ~2.6 wide);
  // flip if the model happens to be built nose-toward -Z.
  const FLEET = [
    { file: 'mustang', len: 2.15, flip: false }, // '65 classic muscle
    // picanto dropped: 31 fragmented materials = 31 draw calls for one car
    // tarraco dropped from traffic: 23 fragmented materials resist decimation
    // (130k tris even at ratio .025) — one SUV isn't worth a third of the budget
    { file: 'simca',   len: 1.90, flip: false }, // '66 retro
    { file: 'escort',  len: 2.05, flip: false }, // convertible
    { file: 'skylark', len: 2.20, flip: false }, // retro coupe
    { file: 'faraday', len: 2.30, flip: false }, // futurist
    { file: 'pagani',  len: 2.10, flip: false }, // supercar
  ];

  const _vb = new THREE.Box3(), _vs = new THREE.Vector3(), _vc = new THREE.Vector3();
  // Return a wrapper Group whose child is oriented forward = +Z, up = +Y, sitting
  // on the ground (wheels at y ≈ sink), scaled to targetLen. The wrapper stays at
  // identity so the traffic loop can drive its position/quaternion each frame.
  function toTemplate(root, targetLen, sink, autoFace, extraYaw, preRot) {
    // preRot fixes a non-Y-up model (e.g. the Z-up limo) before anything else
    const oriented = new THREE.Group();
    if (preRot) oriented.rotation.copy(preRot);
    oriented.add(root);
    oriented.updateWorldMatrix(true, true);
    // measure, decide facing: if built along X, yaw 90° so length lands on Z
    _vb.setFromObject(oriented); _vb.getSize(_vs);
    let yaw = extraYaw || 0;
    if (autoFace && _vs.x > _vs.z) yaw += Math.PI / 2;
    const spin = new THREE.Group();
    spin.rotation.y = yaw;
    spin.add(oriented);
    spin.updateWorldMatrix(true, true);
    _vb.setFromObject(spin); _vb.getSize(_vs);
    spin.scale.setScalar(targetLen / Math.max(_vs.z, 1e-3));
    spin.updateWorldMatrix(true, true);
    _vb.setFromObject(spin); _vb.getCenter(_vc); _vb.getSize(_vs);
    spin.position.x -= _vc.x;                 // centre on the lane
    spin.position.z -= _vc.z;
    spin.position.y -= (_vc.y - _vs.y / 2);   // min-y → 0
    spin.position.y += sink;                  // then sink so wheels meet the road
    const wrap = new THREE.Group();
    wrap.add(spin);
    return wrap;
  }

  // wear the model's OWN materials — keep the real textured livery, just make
  // sure it shades smooth (curved, not faceted) and casts a shadow. Photoscans
  // sometimes bake metalness to the max, which reads as near-black under our
  // few lights, so clamp it back to something the toon lighting can catch.
  function dressCar(wrap, shadow = false) {
    wrap.traverse(o => {
      if (!o.isMesh) return;
      // traffic never casts shadows — re-rendering 8 real models into the
      // shadow map each frame was a big chunk of the lag. Hero vehicles
      // (limo) opt back in via `shadow`.
      o.castShadow = shadow && !IS_TOUCH; o.receiveShadow = false;
      o.frustumCulled = true;
      o.userData._gpThin = true;             // thin clean contour in drawn modes
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.flatShading = false;                 // smooth normals → curved body
        if (m.isMeshStandardMaterial) {
          if (m.metalness > 0.6) m.metalness = 0.6;
          if (m.roughness < 0.25) m.roughness = 0.25;
          m.envMapIntensity = 1.0;
        }
        m.needsUpdate = true;
      }
    });
  }

  // stream every car in parallel, then swap the placeholder boxes for real models
  Promise.all(FLEET.map(f =>
    gltfV.loadAsync(`./models/opt/${f.file}.glb`).then(g => {
      // sink −0.09 cancels the +0.09 lane lift so tyres sit ON the road, not above it
      const tpl = toTemplate(g.scene, f.len, -0.09, true, f.flip ? Math.PI : 0);
      dressCar(tpl);
      return tpl;
    }).catch(assetFail(`car ${f.file}.glb`))
  )).then(tpls => {
    const ready = tpls.filter(Boolean);
    if (!ready.length) return;
    let i = 0;
    for (const v of traffic) {
      if (v.kind !== 'car') continue;
      const inst = ready[i++ % ready.length].clone(true);   // shares geo + mats
      inst.position.copy(v.obj.position);
      inst.quaternion.copy(v.obj.quaternion);
      inst.userData.wheels = [];
      inst.traverse(o => { if (o.isMesh && /wheel|tyre|tire|rim|hub/i.test(o.name)) inst.userData.wheels.push(o); });
      scene.remove(v.obj);
      scene.add(inst);
      v.obj = inst;
      gpRegister(inst);            // thin boil contour + flat fills in drawn modes
    }
  });

  // swap the boxy parked jet for the real model, keeping its exact parked pose so
  // the arrival cinematic (which drives airportPlane) keeps working unchanged
  gltfV.loadAsync('./models/opt/jet.glb').then(g => {
    // the jet's footprint is near-square (wingspan ≈ length), which fools
    // toTemplate's autoFace heuristic — its fuselage runs down -X natively, so
    // it was left pointing sideways. Force the nose onto +Z ourselves. Raise it
    // off the ground so it stands on its (added) landing gear instead of belly.
    const jw = toTemplate(g.scene, 5.0, 0.30, false, Math.PI / 2);
    jw.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = !IS_TOUCH; o.receiveShadow = false;
      o.userData._gpForce = true;   // opt every jet part into the boil contour
      o.userData._gpThin = true;    // ...as a thin clean stroke
      // KEEP the jet's own materials — real livery: white body, gold cheatline,
      // tinted glass, dark engines. The old override matched English material
      // names but this model's are named in Russian, so every part fell through
      // to flat white (why it looked untextured). Just add a little sheen.
      const m = o.material;
      if (m && m.isMeshStandardMaterial) {
        m.flatShading = false;
        m.metalness = Math.max(m.metalness ?? 0, 0.25);
        m.roughness = Math.min(m.roughness ?? 1, 0.5);
        m.envMapIntensity = 1.1;
        m.needsUpdate = true;
      }
    });
    jw.userData.rig = buildJetRig(jw);   // deployable gear + airstair
    if (airportPlane) {
      jw.position.copy(airportPlane.position);
      jw.quaternion.copy(airportPlane.quaternion);
      jw.scale.copy(airportPlane.scale);
      scene.remove(airportPlane);
      airportPlane = jw;
    }
    scene.add(jw);
    gpRegister(jw);                // participate in the drawn modes too
  }).catch(assetFail('jet.glb'));

  // the limo the arrival cinematic drives — real model, kept textured + smooth.
  // In three.js space it's already Y-up with the body length on +Z (node
  // transforms handle it), so no pre-rotation — just size + face it.
  gltfV.loadAsync('./models/opt/limo.glb').then(g => {
    const tpl = toTemplate(g.scene, 4.6, -0.02, false, 0);
    dressCar(tpl, true);
    limoTemplate = tpl;
    // any limo group created before the GLB landed fills itself now
    for (const holder of limoWaiters) if (!holder.children.length) holder.add(dressLimoClone());
    limoWaiters.length = 0;
  }).catch(assetFail('limo.glb'));

  // one landing-gear leg, normalized to unit height with the wheels at the
  // bottom (y −1) and the mount at the top (y 0), so buildJetRig can clone it
  // three times and scale each to the belly gap. Already Y-up (tall axis Y) in
  // three.js space, so no turn. Textured + smooth + boil-tagged like everything.
  gltfV.loadAsync('./models/opt/gear.glb').then(g => {
    const root = g.scene;
    const grp = new THREE.Group();
    grp.add(root);
    grp.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(grp), s = b.getSize(new THREE.Vector3());
    root.scale.multiplyScalar(1 / Math.max(s.y, 1e-3));
    root.updateWorldMatrix(true, true);
    const b2 = new THREE.Box3().setFromObject(grp), c2 = b2.getCenter(new THREE.Vector3());
    root.position.x -= c2.x; root.position.z -= c2.z;
    root.position.y -= b2.max.y;           // top of the leg at y = 0
    dressCar(grp);
    grp.traverse(o => { if (o.isMesh) o.userData._gpForce = true; });
    gearProto = grp;
  }).catch(assetFail('gear.glb'));

  // ── THE TRAIN STATION: the real model replaces procedural Central Station.
  // Placed with the same off-track math as the stand-in (long axis along the
  // rail tangent, shifted aside so the Express pulls up alongside). It is
  // deliberately NOT in the collision BVH — you walk THROUGH it to board.
  gltfV.loadAsync('./models/opt/station.glb').then(g => {
    const tpl = toTemplate(g.scene, 9.0, 0.02, true, 0);
    // Sketchfab bakes a big translucent ground "Plane" under the scene — on
    // the planet it lies across the road as a weird clear oval. Delete it.
    const junk = [];
    tpl.traverse(o => { if (o.isMesh && /^plane/i.test(o.name)) junk.push(o); });
    for (const o of junk) o.removeFromParent();
    dressCar(tpl);
    tpl.traverse(o => { if (o.isMesh) o.userData._gpForce = true; });
    const d = STOP_DIRS.central;
    const nb = trackPts[1];
    const tang = nb.clone().sub(d.clone().multiplyScalar(d.dot(nb))).normalize();
    const sd = d.clone().applyAxisAngle(tang, -2.4 / R).normalize();
    // the plateau's roll swells undulate ±0.2 under the station's 9-unit
    // footprint and settleOn seats it on the LOWEST sample — half the model
    // ended up under the lawn. Lift it clear; the platform skirt hides the
    // sliver of air over the dips.
    tpl.position.copy(settleOn(sd, 2.6, 0.32));
    const xAxis = new THREE.Vector3().crossVectors(sd, tang).normalize();
    tpl.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, sd, tang));
    tpl.traverse(o => { if (o.isMesh) o.userData._gpThin = true; });
    const old = stopStructures.central;
    if (old) scene.remove(old);
    stopStructures.central = tpl;
    scene.add(tpl);
    gpRegister(tpl);
    stationG = tpl;
  }).catch(assetFail('station.glb'));

  // ── THE SUBWAY INTERIOR: normalized car cabin (floor y=0, length on Z) that
  // wraps the camera while riding the Express — see the train camera override.
  gltfV.loadAsync('./models/opt/subway.glb').then(g => {
    const tpl = toTemplate(g.scene, 4.2, 0, true, 0);
    const GLASS = new THREE.MeshBasicMaterial({
      color: 0xcfe2ec, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false,
    });
    tpl.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;               // wrapped around the eye: never cull
      // the source model's windows used KHR transmission (dropped in the
      // optimizer), leaving open holes — reglaze anything window-named with a
      // simple translucent pane so the world outside reads as behind glass
      if (/glass|window/i.test(o.name) || /glass|window/i.test(o.material?.name || '')) {
        o.material = GLASS;
        return;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) { m.flatShading = false; m.needsUpdate = true; }
    });
    tpl.traverse(o => { if (o.isMesh) o.userData._gpThin = true; });
    subwayInt = new THREE.Group();
    subwayInt.add(tpl);
    subwayInt.visible = false;
    scene.add(subwayInt);
    gpRegister(subwayInt);
  }).catch(assetFail('subway.glb'));
}

// Landing gear + airstair that DEPLOY, built as children of the parked jet so
// they ride its transform for free. The returned setters are driven by the
// arrival cinematic: gear folds down on descent, the stair unfolds at step-off.
function buildJetRig(jet) {
  const bb = new THREE.Box3().setFromObject(jet);
  const size = bb.getSize(new THREE.Vector3());
  const len = size.z, wid = size.x;
  const belly = bb.min.y;                    // jet was raised, so belly sits > 0
  const DARK  = M(0x18161c, { roughness: 0.9 });                 // tyre
  const HUB   = M(0xd8dae0, { roughness: 0.4, metalness: 0.3 }); // hub
  const STRUT = M(0xaeb2ba, { roughness: 0.35, metalness: 0.5 });

  // ── landing gear: three legs, each pivots about its top. deployed = straight
  // down (rot 0); retracted = swung forward and up into the belly.
  const RETRACT = -1.55;
  const gearPivots = [];
  const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.07, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  // the belly bbox min is set by the LOWEST geometry (engine pods), not the
  // fuselage skin above each wheel — mounting there leaves the legs floating
  // with a gap under the body. Probe the real underside at each station with
  // an upward raycast and hang the leg from the hit, tucked slightly inside.
  const _gRay = new THREE.Raycaster(), _gO = new THREE.Vector3(), _gD = new THREE.Vector3();
  function undersideAt(x, z) {
    jet.updateWorldMatrix(true, true);
    _gO.set(x, belly - 0.5, z); jet.localToWorld(_gO);
    _gD.set(0, 1, 0).applyQuaternion(jet.getWorldQuaternion(_gq)).normalize();
    _gRay.set(_gO, _gD); _gRay.far = 4;
    const hit = _gRay.intersectObject(jet, true)[0];
    return hit ? jet.worldToLocal(hit.point.clone()).y : belly;
  }
  // real bizjets squat LOW: the belly rides less than half a metre over the
  // tarmac on stubby legs. The model parks with its lowest stray geometry on
  // the ground plane, which leaves the fuselage on stilts — so first drop the
  // whole airframe until the belly at the main-gear station sits LEG above
  // the road, then cut each leg mount→surface so wheels rest ON the ground.
  const GROUND = 0.02;                        // road surface in jet-local Y
  const LEG = Math.min(0.45, len * 0.09);     // visible strut, proportional
  {
    const underMain = undersideAt(0, -len * 0.03);
    const drop = underMain - (GROUND + LEG);
    if (drop > 0) for (const c of jet.children) c.position.y -= drop;
  }
  function makeGear(x, z, twin) {
    const piv = new THREE.Group();
    const mountY = undersideAt(x, z) + 0.05;   // 0.05 tucked into the skin
    piv.position.set(x, mountY, z);
    if (gearProto) {
      // the real gear leg (unit height, wheels at −1), scaled mount→surface
      const leg = gearProto.clone(true);
      leg.scale.setScalar(Math.max(mountY - GROUND, 0.1));
      piv.add(leg);
    } else {
      // fallback if the gear model hasn't streamed in yet: a simple strut + wheels
      const drop = Math.max(mountY - GROUND, 0.1);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, drop, 6), STRUT);
      strut.position.y = -drop / 2; piv.add(strut);
      for (const wx of twin ? [-0.085, 0.085] : [0]) {
        const w = new THREE.Mesh(wheelGeo, DARK);
        w.position.set(wx, -drop, 0); piv.add(w);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.075, 8), HUB);
        hub.rotation.z = Math.PI / 2; hub.position.set(wx, -drop, 0); piv.add(hub);
      }
    }
    piv.traverse(m => { if (m.isMesh) { m.userData._gpForce = true; if (!IS_TOUCH) m.castShadow = true; } });
    jet.add(piv); gearPivots.push(piv);
  }
  makeGear(0,     len * 0.30, false);   // nose
  makeGear(-0.20, -len * 0.03, true);   // main L
  makeGear(0.20,  -len * 0.03, true);   // main R

  // ── airstair: a flight of steps + a looping grab-rail, hinged at the door
  // sill forward-left of the fuselage. deployed = folded down to the ground;
  // stowed = swung up flat against the door.
  const STEPN = 6, run = 0.17;
  // hinge the stair at the (freshly lowered) fuselage side, not the stale bbox
  const doorX = -wid * 0.15, doorZ = len * 0.16;
  const doorY = undersideAt(doorX * 0.5, doorZ) + 0.10;
  const rise = doorY / STEPN;
  const stair = new THREE.Group();
  stair.position.set(doorX, doorY, doorZ);
  const SIDE = M(0xf3f2ee, { roughness: 0.5 });   // white panel
  const TREAD = M(0x39323a, { roughness: 0.85 }); // dark tread
  const stepX = (i) => -0.14 - i * (run * 0.92);
  const stepY = (i) => -i * rise - rise;
  for (let i = 0; i < STEPN; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, run * 0.96), TREAD);
    step.position.set(stepX(i), stepY(i), 0); stair.add(step);
  }
  // sloped white side panels down each edge
  for (const sz of [-0.19, 0.19]) {
    const pts = [];
    for (let i = 0; i <= STEPN; i++) pts.push(new THREE.Vector3(stepX(i - 1), stepY(i - 1) + 0.02, sz));
    const panel = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.03, 5, false), SIDE);
    stair.add(panel);
  }
  // a grab-rail arching over the outer edge on posts
  const railPts = [];
  for (let i = -1; i <= STEPN; i++) railPts.push(new THREE.Vector3(stepX(i), stepY(i) + 0.36, 0.19));
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 24, 0.012, 6, false), STRUT);
  stair.add(rail);
  for (let i = 0; i <= STEPN; i += 2) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.36, 5), STRUT);
    post.position.set(stepX(i), stepY(i) + 0.18, 0.19); stair.add(post);
  }
  stair.traverse(m => { if (m.isMesh) { m.userData._gpForce = true; if (!IS_TOUCH) m.castShadow = true; } });
  stair.visible = false;
  jet.add(stair);
  const STAIR_STOW = 1.78;   // radians about Z to fold flat against the fuselage

  const rig = {
    setGearDeploy(f) {
      const a = (1 - THREE.MathUtils.clamp(f, 0, 1)) * RETRACT;
      for (const p of gearPivots) p.rotation.x = a;
    },
    setStairDeploy(f) {
      f = THREE.MathUtils.clamp(f, 0, 1);
      stair.visible = f > 0.001;
      stair.rotation.z = (1 - f) * STAIR_STOW;
    },
    // world-space foot of the stairs — where the passenger starts walking
    footWorld(out) { return stair.localToWorld(out.set(stepX(STEPN - 1), stepY(STEPN - 1), 0)); },
  };
  rig.setGearDeploy(1);      // parked jet stands on its wheels by default
  rig.setStairDeploy(0);
  return rig;
}

// ── THE RESORT: a hotel tower, cabanas, palms ──
{
  const at = frameAt(RESORT);
  {
    const d = at(0, 0);
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6.5, 2.2), MW(0xf0e6d2));
    tower.position.y = 3.25;
    const uv = tower.geometry.attributes.uv;
    g.add(tower);
    // balcony bands
    for (let i = 1; i <= 6; i++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 2.35), M(0x33c9ff));
      band.position.y = i * 0.9; g.add(band);
    }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.1), M(0xff2e88));
    sign.position.set(0, 6.7, 1.1); g.add(sign);
    g.add(foundation(1.7, 3.0, 6));
    g.scale.setScalar(1.6);                        // a hotel, not a kiosk: bigger than any car
    g.position.copy(settleOn(d, 2.8, 0.14));
    alignToSurface(g, d, rand() * Math.PI * 2);
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(g); addSolid(d, 2.8, g); resortHotel = g;
  }
  // cabanas + palms round the pool
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const d = at(Math.cos(ang) * 3.4, Math.sin(ang) * 3.4 - 0.5);
    if (surfH(d) < SEA_H) continue;
    const cab = boxHouse(1.0, 0.7, 1.0, 0xfffaf2, [0xff4d6e, 0x33c9ff, 0xffd23d][i % 3], 'gable');
    cab.position.copy(settleOn(d, 0.7, 0.08));
    alignToSurface(cab, d, yawToFace(d, at(0, 0)));
    cab.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(cab);
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.4, 6), M(0x8a6a3a));
    trunk.position.y = 0.7; palm.add(trunk);
    for (let f = 0; f < 5; f++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 4), M(0x2dd47b));
      frond.position.y = 1.4; frond.rotation.set(1.1, f * 1.25, 0); frond.translateY(0.4); palm.add(frond);
    }
    const pd = at(Math.cos(ang) * 4.2, Math.sin(ang) * 4.2 - 0.5);
    palm.position.copy(settleOn(pd, 0.3, 0.05)); alignToSurface(palm, pd);
    scene.add(palm);
  }
  districtSign(RESORT, '🏖 Seaside Resort', 0, 5.2);
}

// ── THE MALL: a low retail block with a food court and a car park ──
{
  const at = frameAt(MALL);
  const shopHues = [0xff7eb6, 0x4e8eff, 0x2dd47b, 0xffd23d, 0xff8a3d, 0xb265ff];
  {
    const d = at(0, 0);
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.8, 3.4), MW(0xe8dcc8));
    box.position.y = 0.9; g.add(box);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8fd0e8, roughness: 0.25, transparent: true, opacity: 0.7 }));
    dome.position.y = 1.8; g.add(dome);
    // shopfront awnings
    for (let i = 0; i < 5; i++) {
      const aw = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.5), M(shopHues[i]));
      aw.position.set(-1.8 + i * 0.9, 0.9, 1.75); aw.rotation.x = 0.3; g.add(aw);
    }
    g.add(foundation(3.0, 2.2, 6));
    g.position.copy(settleOn(d, 3.0, 0.12));
    alignToSurface(g, d, yawToFace(d, at(0, -6)));
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(g); addSolid(d, 2.8, g);
  }
  // a few parked cars out front
  for (let i = 0; i < 4; i++) {
    const d = at(-2.4 + i * 1.6, -3.2);
    const car = simpleCar(shopHues[i]);
    car.position.copy(settleOn(d, 0.5, 0.02)); alignToSurface(car, d, rand() * Math.PI * 2); scene.add(car);
  }
  districtSign(MALL, '🛍 The Galleria', 0, -4.5);
}

// ── THE FARMS: fields, a barn, a silo, a farmhouse, fences ──
function buildFarm(anchor, label) {
  const at = frameAt(anchor);
  // field patches as tinted ground quads
  for (let fx = -1; fx <= 1; fx++) {
    for (let fy = -1; fy <= 1; fy++) {
      if (fx === 0 && fy === 0) continue;
      const d = at(fx * 3.2, fy * 3.2);
      if (surfH(d) < SEA_H + 0.05) continue;
      const crop = [0x8fae4a, 0xc9a94a, 0x6f9e4a, 0xb98a3a][(fx + fy + 2) % 4];
      const field = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 2.8), M(crop));
      field.position.copy(settleOn(d, 1.4, 0.02));
      alignToSurface(field, d, (fx * fy) * 0.4);
      scene.add(field);
    }
  }
  // barn
  {
    const d = at(0, 0);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 3.0), MW(0xa83a2a));
    body.position.y = 0.75; g.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 1.7, 1.0, 4, 1, false, Math.PI / 4), M(0x7a2a1e));
    roof.scale.set(1, 1, 1.36); roof.position.y = 2.0; g.add(roof);
    const doors = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.1), M(0xf0e6d2));
    doors.position.set(0, 0.5, 1.52); g.add(doors);
    g.add(foundation(1.8, 2.0, 6));
    g.position.copy(settleOn(d, 1.8, 0.1));
    alignToSurface(g, d, yawToFace(d, at(0, -5)));
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(g); addSolid(d, 1.7, g);
  }
  // silo
  {
    const d = at(1.8, 0.6);
    const g = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 12), M(0xcfd6de));
    drum.position.y = 1.2; g.add(drum);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(0x9aa0a8));
    cap.position.y = 2.4; g.add(cap);
    g.position.copy(settleOn(d, 0.6, 0.1)); alignToSurface(g, d);
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(g); addSolid(d, 0.6, g);
  }
  // farmhouse
  {
    const d = at(-2.4, 0.4);
    const g = boxHouse(1.6, 1.2, 1.4, 0xf0e6d2, 0x8a5a3a, 'gable');
    g.add(foundation(1.1, 1.8, 6));
    g.position.copy(settleOn(d, 1.1, 0.1));
    alignToSurface(g, d, yawToFace(d, at(0, -5)));
    g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
    scene.add(g); addSolid(d, 1.0, g);
  }
  // a run of fence posts around the plot
  for (let i = 0; i < 20; i++) {
    const ang = (i / 20) * Math.PI * 2;
    const d = at(Math.cos(ang) * 4.6, Math.sin(ang) * 4.6);
    if (surfH(d) < SEA_H) continue;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), M(0x8a6a3a));
    post.position.copy(settleOn(d, 0.2, 0)); post.translateY(0.25);
    alignToSurface(post, d); scene.add(post);
  }
  districtSign(anchor, label, 0, -5.4);
}
// ── THE GAS STATION: halfway down the airport spur, just off the road ──
{
  const mid = slerpDir(DOWNTOWN, AIRPORT, 0.5);
  const toAir = AIRPORT.clone().sub(mid.clone().multiplyScalar(mid.dot(AIRPORT))).normalize();
  const lat = new THREE.Vector3().crossVectors(mid, toAir).normalize();
  GAS_DIR = mid.clone().applyAxisAngle(toAir, 0).applyAxisAngle(lat.clone().cross(mid).normalize(), 0);
  // shift ~2.3 units to the roadside
  GAS_DIR = mid.clone().multiplyScalar(R).addScaledVector(lat, 2.3).normalize();
  const g = new THREE.Group();
  // forecourt slab
  const slab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 2.8), M(0xb9b4a8));
  slab.position.y = 0.1; g.add(slab);
  // canopy on two pillars
  for (const sx of [-1.2, 1.2]) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.7, 8), M(0xd8d8e0));
    pil.position.set(sx, 0.95, 0); g.add(pil);
  }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 2.2), M(0xff4d6e));
  canopy.position.y = 1.85; g.add(canopy);
  const canTrim = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 2.3), M(0xfffaf2));
  canTrim.position.y = 1.74; g.add(canTrim);
  // two pumps
  for (const sx of [-0.6, 0.6]) {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.75, 0.26), M(0xe8433f));
    pump.position.set(sx, 0.5, 0.4); g.add(pump);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.03), M(0xbfe8ff));
    screen.position.set(sx, 0.72, 0.54); g.add(screen);
  }
  // the kiosk
  const shop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.2), MW(0xf0e6d2));
  shop.position.set(0, 0.65, -1.4); g.add(shop);
  const shopRoof = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.12, 1.35), M(0xc7572a));
  shopRoof.position.set(0, 1.28, -1.4); g.add(shopRoof);
  g.add(foundation(2.0, 2.2, 6));
  g.scale.setScalar(1.7);                                // limo-scale, not toy-scale
  g.position.copy(settleOn(GAS_DIR, 3.3, 0.1));
  alignToSurface(g, GAS_DIR, yawToFace(GAS_DIR, mid));   // pumps face the road
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  scene.add(g);
  addSolid(GAS_DIR, 3.2, g);
  tinySign('⛽ Gas-N-Go', posOn(GAS_DIR, 5.2));
}

buildFarm(FARM_A, '🌾 Harvest Fields');
buildFarm(FARM_B, '🌱 West Meadows');

mark('heist:start');
// ─── THE HEIST: clues in the world, a notebook, and a whodunit ──────────────
// The critic's rounds turn into a mystery. Every gallery frame is empty; the
// answer is hidden in things you pass on the way. Drive near a clue to note it.
const SUSPECTS = [
  { id: 'valet',   name: 'The Hotel Valet',   face: '🧳', tell: 'someone in a hotel uniform' },
  { id: 'cyclist', name: 'The Courier',       face: '🚴', tell: 'a bike / a courier' },
  { id: 'driver',  name: 'The Van Driver',    face: '🚐', tell: 'a white van' },
];
const CULPRIT = 'driver';   // the clues below all point at the van
// each clue: where it sits (lat,lon), the icon, what you witness, who it implicates
const CLUES = [
  { at: ll(16, -18), icon: '🏃', text: 'A figure sprinted across the road clutching a flat parcel.', points: 'driver' },
  { at: ll(20, 10),  icon: '🚲', text: '“Someone stole my bike!” a courier shouts — but his hands are covered in paint.', points: 'cyclist' },
  { at: ll(6, 34),   icon: '🚐', text: 'A white van idles in a loading zone, engine running, no plates.', points: 'driver' },
  { at: ll(24, -52), icon: '🧤', text: 'A dropped work glove near the museum service door.', points: 'driver' },
  { at: ll(-4, 60),  icon: '🪜', text: 'A ladder leans against a wall below an open skylight.', points: 'driver' },
  { at: ll(14, -96), icon: '🎨', text: 'A smear of fresh varnish on the kerb — still tacky.', points: 'cyclist' },
];
const foundClues = new Set(JSON.parse(localStorage.getItem('heist-clues') || '[]'));
let heistSolved = localStorage.getItem('heist-solved') === '1';

// a little marker at each clue: an evidence cone that bobs and glints
CLUES.forEach((c, i) => {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.7, 4),
    new THREE.MeshStandardMaterial({ color: 0xffd23d, emissive: 0xffb800, emissiveIntensity: 0.7, flatShading: true }));
  cone.position.y = 0.55; g.add(cone);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 4), M(0x2d2138));
  band.position.y = 0.4; g.add(band);
  g.position.copy(posOn(c.at, 0.2));
  alignToSurface(g, c.at);
  g.visible = !foundClues.has(i);
  scene.add(g);
  c.marker = g;
});

const noteBtn = document.getElementById('note-btn');
const noteCount = document.getElementById('note-count');
const notebook = document.getElementById('notebook');
const noteList = document.getElementById('note-list');
const toast = document.getElementById('toast');
function updateNoteBadge() {
  const n = foundClues.size;
  if (noteCount) { noteCount.textContent = n; noteCount.style.display = n ? '' : 'none'; }
}
function showToast(txt) {
  if (!toast) return;
  toast.textContent = txt;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3200);
}
function collectClue(i) {
  if (foundClues.has(i)) return;
  foundClues.add(i);
  localStorage.setItem('heist-clues', JSON.stringify([...foundClues]));
  if (CLUES[i].marker) CLUES[i].marker.visible = false;
  ping(1180, 0.12); setTimeout(() => ping(1480, 0.1), 90);
  showToast('🔍 Clue noted: ' + CLUES[i].text);
  updateNoteBadge();
}
function renderNotebook() {
  if (!noteList) return;
  const items = CLUES.map((c, i) => foundClues.has(i)
    ? `<li><span class="ni-ic">${c.icon}</span>${c.text}</li>`
    : `<li class="locked"><span class="ni-ic">❔</span>— clue not yet found —</li>`).join('');
  const canSolve = foundClues.size >= 4 && !heistSolved;
  noteList.innerHTML = `<ul class="ni">${items}</ul>` + (heistSolved
    ? `<div class="solved">✔ Case closed — you named the thief.</div>`
    : canSolve
      ? `<button id="solve-btn">🔍 I know who did it →</button>`
      : `<div class="ni-hint">Find at least 4 clues to attempt a solution (${foundClues.size}/4).</div>`);
  const sb = document.getElementById('solve-btn');
  if (sb) sb.addEventListener('click', openSolve);
}
noteBtn?.addEventListener('click', () => {
  notebook.classList.toggle('show'); renderNotebook();
});
document.getElementById('note-close')?.addEventListener('click', () => notebook.classList.remove('show'));

function openSolve() {
  noteList.innerHTML = `<div class="solve-q">Who stole the paintings?</div>` +
    `<div class="suspects">` + SUSPECTS.map(su =>
      `<button class="suspect" data-id="${su.id}"><span>${su.face}</span>${su.name}</button>`).join('') + `</div>`;
  noteList.querySelectorAll('.suspect').forEach(b => b.addEventListener('click', () => {
    const right = b.dataset.id === CULPRIT;
    if (right) {
      heistSolved = true; localStorage.setItem('heist-solved', '1');
      burstConfetti(courier.position.clone(), dir.clone());
      ping(680, 0.16); setTimeout(() => ping(1020, 0.2), 160);
      noteList.innerHTML = `<div class="verdict win">🎉 Correct! The Van Driver rented a courier disguise, propped a ladder to the skylight, and drove off with the canvases. The tacky varnish and plateless van gave it away.</div>`;
    } else {
      ping(220, 0.25);
      noteList.innerHTML = `<div class="verdict lose">Not quite — the evidence doesn't fit. Look again at the van, the ladder and the glove.</div>` +
        `<button id="solve-retry">← back to the clues</button>`;
      document.getElementById('solve-retry').addEventListener('click', renderNotebook);
    }
  }));
}

mark('courier:start');
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
  p.scale.setScalar(0.8);
  g.add(p);
  const scarf = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.16, 8), M(0xffd23d));
  scarf.position.y = 0.95; g.add(scarf);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.62, 6), M(0x2d2138));
  arm.position.set(0.36, 1.12, 0.1); arm.rotation.z = -0.85; g.add(arm);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.04), M(0x1c1626));
  phone.position.set(0.62, 1.44, 0.1); phone.rotation.z = -0.2; g.add(phone);
  const phoneGlow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.27, 0.015),
    new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x9fd8ff, emissiveIntensity: 0.9 }));
  phoneGlow.position.set(0.62, 1.44, 0.125); phoneGlow.rotation.z = -0.2; g.add(phoneGlow);
  const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.14), M(0x9a6b4f));
  satchel.position.set(-0.36, 0.55, -0.05); g.add(satchel);
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
  rider.name = 'riderSlot';
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
  rider.name = 'riderSlot';
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
  rider.name = 'riderSlot';
  rider.position.set(0, 0.8, -0.75);
  g.add(rider);
  g.userData.wheels = wheels;
  g.traverse(m => { if (m.isMesh && !IS_TOUCH) m.castShadow = true; });
  return g;
}

const bodies = { jeep: buildJeep(), walk: buildCritic(), bike: buildBike(), train: buildTrain(), boat: buildBoat() };
// ── the Blender-rigged critic IS the main character — one skinned instance per
// body, each looping the pose baked for that ride, with mount/dismount intros ──
const FACE_Y = -Math.PI / 2;                       // model faces +X → turn to face +Z (travel dir)
// frame ranges (0-based, 24 fps) carved out of the single baked timeline in critic.glb
const SUBCLIPS = {
  Walk: [0, 23], RideBike: [24, 47], Sail: [48, 71], SitDrive: [72, 83], RideTrain: [84, 107],
  MountBike: [108, 119], DismountBike: [120, 131], BoardBoat: [132, 143], LeaveBoat: [144, 155],
};
const RIDE_CLIP = { walk: 'Walk', jeep: 'SitDrive', bike: 'RideBike', boat: 'Sail', train: 'RideTrain' };
// how she sits in each body. yRig centres the model on the holder; holder pos is
// the seat in body-space. These are eyeball starting points — easy to nudge.
const RIDER_XF = {
  walk:  { pos: [0, 0, 0],       s: 0.112, yRig: 4.593 * 0.112 },  // feet on the ground (smaller so buildings feel bigger)
  jeep:  { pos: [0.30, 0.62, -0.05], s: 0.11,  yRig: 0 },
  bike:  { pos: [0, 0.26, -0.38], s: 0.105, yRig: 0, lean: 0.24 },
  boat:  { pos: [0, 0.74, -0.70], s: 0.12,  yRig: 0 },
  train: { pos: [0, 0.84, -0.75], s: 0.12,  yRig: 0 },
};
const CRITIC = { clips: {}, insts: {} };           // insts[key] = { holder, mixer, cur, intro, actions }
let criticReady = false;

function playClip(inst, name, { loop = true, fade = 0.18, then = null } = {}) {
  const act = inst.actions[name]; if (!act) return;
  act.reset();
  act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  act.clampWhenFinished = !loop;
  act.timeScale = 1;
  act.enabled = true;
  if (inst.cur && inst.cur !== act) { act.play(); act.crossFadeFrom(inst.cur, fade, false); }
  else act.play();
  inst.cur = act;
  if (then) {
    const mx = inst.mixer;
    const onFin = (e) => { if (e.action === act) { mx.removeEventListener('finished', onFin); then(); } };
    mx.addEventListener('finished', onFin);
  }
}
// pick the clip for a mode, with a get-on / get-off intro when entering on the ground
function playRide(t, prev) {
  const inst = CRITIC.insts[t]; if (!inst) return;
  const ride = RIDE_CLIP[t] || 'Walk';
  // walking is procedural now — stop the mixer so procWalk fully owns the pose
  // (the baked Walk / dismount clips were broken).
  if (t === 'walk') { inst.intro = false; stopClip(inst); return; }
  let intro = null;
  if (t === 'bike') intro = 'MountBike';
  else if (t === 'boat') intro = 'BoardBoat';
  if (intro) { inst.intro = true; playClip(inst, intro, { loop: false, then: () => { inst.intro = false; playClip(inst, ride); } }); }
  else { inst.intro = false; playClip(inst, ride); }
}

// ── walking is FULLY procedural. The baked Walk clip was broken (legs swinging
// over the head), so we ignore it and drive the joints ourselves from a simple,
// constrained gait: hips/spine, both legs (hip + knee) and both arms (shoulder +
// elbow). Every angle is a small bounded sine, so nothing can flip out of range.
// Axes from the rig's bind pose: limbs run down local +Y, so a fore/aft swing is
// about local X and a sideways splay is about local Z. `dt` advances the step
// clock (faster with speed); `gaitK` (0..1 with speed) fades the whole cycle in,
// so a standstill relaxes to the bind pose.
const _gq = new THREE.Quaternion(), _gax = new THREE.Vector3();
const WALK = {
  cadence: 6.2,                 // step speed (rad/s), scaled by gait
  legFwd: 0.5, knee: 0.85,      // hip swing + knee flex (knee only bends one way)
  arm: 0.4, elbowBase: 0.35, elbowSwing: 0.15,
  armOut: 0.18, hipRoll: 0.05, torsoTwist: 0.06,
};
const WALK_BONES = ['hips', 'spine1', 'upperlegL', 'lowerlegL', 'upperlegR', 'lowerlegR',
  'upperarmL', 'lowerarmL', 'upperarmR', 'lowerarmR'];
function procWalk(inst, dt, gaitK) {
  const pb = inst.bones, bq = inst.bind; if (!pb || !bq) return;
  const k = THREE.MathUtils.clamp(gaitK, 0, 1);
  inst._wc = (inst._wc || 0) + dt * WALK.cadence * (0.4 + 0.9 * k);
  const p = inst._wc, s = Math.sin(p), sO = Math.sin(p + Math.PI);
  const liftL = Math.max(0, sO), liftR = Math.max(0, s);   // each knee flexes on its own swing
  // reset the walk bones to bind, then layer the constrained rotations on top
  for (const nm of WALK_BONES) { const b = pb[nm]; if (b) b.quaternion.copy(bq[nm]); }
  const rot = (name, ax, a) => { const b = pb[name]; if (!b || !a) return; _gax.set(ax[0], ax[1], ax[2]); _gq.setFromAxisAngle(_gax, a); b.quaternion.multiply(_gq); };
  const W = WALK, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  // legs: hips swing fore/aft (opposite phase), knees flex on the forward swing
  rot('upperlegL', X, -W.legFwd * s * k);
  rot('upperlegR', X, -W.legFwd * sO * k);
  rot('lowerlegL', X,  W.knee * liftL * k);
  rot('lowerlegR', X,  W.knee * liftR * k);
  // arms: shoulders swing opposite the legs, with resting clearance + elbow bend
  rot('upperarmL', X,  W.arm * sO * k);
  rot('upperarmR', X,  W.arm * s * k);
  rot('upperarmL', Z, -W.armOut);
  rot('upperarmR', Z,  W.armOut);
  rot('lowerarmL', X, -(W.elbowBase + W.elbowSwing * k));
  rot('lowerarmR', X, -(W.elbowBase + W.elbowSwing * k));
  // torso: a little hip roll + counter-twist so it reads alive, not stiff
  rot('hips',   Z, W.hipRoll * s * k);
  rot('spine1', Y, W.torsoTwist * s * k);
}
function stopClip(inst) { if (inst.cur) { inst.cur.fadeOut(0.15); inst.cur = null; } }

// critic.glb authoring bug: some body parts are baked into the WRONG mesh and
// so wear the wrong material — the hands live in the jeans mesh (jeans-blue)
// and the nape hair lives in the sweater mesh (shirt-grey). Repaint just those
// mis-assigned verts (identified by which bone drives them) with the correct
// material's colour via vertex colours; the rest of each mesh is untouched.
// (The clean fix is re-exporting the model with the right material assignment.)
const CRITIC_REPAINT = {
  jeans:   { bones: ['handL', 'handR'], to: 'skin' },   // hands baked into the jeans mesh
  sweater: { bones: ['head'],           to: 'hair' },   // nape hair baked into the sweater mesh
};
function fixCriticColors(root) {
  const colOf = {};
  root.traverse(o => { if (o.material && o.material.name) colOf[o.material.name] = o.material.color; });
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const rule = CRITIC_REPAINT[o.material.name]; if (!rule) return;
    const tgt = colOf[rule.to]; if (!tgt) return;
    const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si) return;
    const pick = new Set();
    o.skeleton.bones.forEach((b, i) => { if (rule.bones.includes(b.name)) pick.add(i); });
    if (!pick.size) return;
    const n = g.attributes.position.count, col = new Float32Array(n * 3), bc = o.material.color;
    let touched = false;
    for (let v = 0; v < n; v++) {
      let w = 0; for (let k = 0; k < 4; k++) if (pick.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      const c = w > 0.5 ? (touched = true, tgt) : bc;
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    if (touched) {
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      o.material = o.material.clone(); o.material.vertexColors = true; o.material.color.set(0xffffff);
    }
  });
}

new GLTFLoader().load('./models/critic.glb', (glb) => {
  fixCriticColors(glb.scene);
  const base = glb.animations[0];
  // strides / arm-swing / swag are baked into the clip itself (see the Blender
  // bake), so we just slice each named sub-clip out of the one timeline
  for (const [n, [a, b]] of Object.entries(SUBCLIPS))
    CRITIC.clips[n] = THREE.AnimationUtils.subclip(base.clone(), n, a, b, 24);
  for (const key of Object.keys(RIDER_XF)) {
    const rig = skeletonClone(glb.scene);
    rig.traverse(m => { if (m.isMesh) { m.castShadow = !IS_TOUCH; m.frustumCulled = false; } });
    const xf = RIDER_XF[key];
    rig.scale.setScalar(xf.s);
    rig.position.set(0, xf.yRig, 0);
    rig.rotation.y = FACE_Y;
    const holder = new THREE.Group();
    holder.position.set(...xf.pos);
    holder.rotation.x = xf.lean || 0;              // riding posture
    holder.add(rig);
    const mixer = new THREE.AnimationMixer(rig);
    const inst = { holder, mixer, cur: null, intro: false, actions: {}, bones: {}, bind: {} };
    // capture the bind-pose bone quaternions now (rig is untouched) so procWalk
    // can reset to them each frame before layering the walk cycle
    // the rig names bones with Blender-style dots (upperleg.L) but WALK_BONES
    // uses flat names (upperlegL) — normalize here or procWalk finds nothing
    // and the whole walk collapses to hip-roll (body rocking, limbs frozen)
    rig.traverse(o => { if (o.isBone) { const k = o.name.replace(/\./g, ''); inst.bones[k] = o; inst.bind[k] = o.quaternion.clone(); } });
    for (const n of Object.keys(CRITIC.clips)) inst.actions[n] = mixer.clipAction(CRITIC.clips[n]);
    CRITIC.insts[key] = inst;
    const body = bodies[key];
    if (key === 'walk') body.clear();                          // out with the pose-rigged boxes
    else { const old = body.getObjectByName('riderSlot'); if (old) old.removeFromParent(); }
    body.add(holder);
    body.userData.wheels = body.userData.wheels || [];
  }
  criticReady = true;
  playRide(transport, null);
}, undefined, (e) => {
  // NO silent fallback: the main character must load. Fail loud and visible
  // so a broken/missing critic.glb can never ship looking "fine but empty".
  const msg = 'Main character (critic.glb) failed to load: ' + (e?.message || e);
  console.error(msg);
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;'
    + 'justify-content:center;text-align:center;padding:8vw;background:#160f1e;color:#ff8ab0;'
    + 'font:600 clamp(15px,2.4vw,20px)/1.5 system-ui,sans-serif';
  b.textContent = '⚠ ' + msg;
  document.body.appendChild(b);
  throw new Error(msg);
});
for (const k of Object.keys(bodies)) { bodies[k].visible = (k === 'jeep'); courier.add(bodies[k]); }
let courierBody = bodies.jeep;
scene.add(courier);

// how each ride handles: top speed, pickup, ride height, camera distance
const TRANSPORT = {
  jeep: { max: 7.2, accel: 13, hover: 0.02, camH: 1.7, camD: 5.2, emoji: '🚙', label: 'rental jeep', engine: true },
  bike: { max: 4.8, accel: 9, hover: 0.02, camH: 1.4, camD: 4.2, emoji: '🚲', label: 'bike', engine: false },
  walk: { max: 2.8, accel: 8, hover: 0.02, camH: 1.05, camD: 3.0, emoji: '🚶', label: 'on foot', engine: false },
  train: { max: 8.5, accel: 6, hover: 0.10, camH: 2.1, camD: 6.4, emoji: '🚂', label: 'the Museum Express', engine: true, rail: true },
  rocket: { max: 7.2, accel: 13, hover: 0.02, camH: 1.7, camD: 5.2, emoji: '🚀', label: 'the shuttle (space first)', engine: true },
  boat: { max: 6.2, accel: 7, hover: -0.14, camH: 1.6, camD: 5.4, emoji: '⛵', label: 'sailboat', engine: false },
};
let transport = 'jeep';
let runTransport = 'jeep';   // the mode the run STARTED with (the train ends on foot)
function setTransport(t) {
  const prev = transport;
  transport = t;
  for (const k of Object.keys(bodies)) bodies[k].visible = (k === t);
  courierBody = bodies[t];
  courierBody.rotation.set(0, 0, 0);
  if (criticReady) playRide(t, prev);
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
  if (cityMapDraw) { cityMapDraw(P); cityMapTex.needsUpdate = true; }
  paintTerrain(P.terr);
  applyChrome(vibe === 'barbie');
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
{
  const palette = [0xff7eb6, 0x4e8eff, 0x2dd47b, 0xb265ff, 0xff8a3d, 0x33c9ff, 0xffd23d, 0xff4d6e];
  let pi = 0;
  for (const key of Object.keys(STOPS)) {
    const s = STOPS[key];
    const axis = new THREE.Vector3(0, 1, 0).cross(s.dir).normalize();
    let nd = s.dir.clone().applyAxisAngle(axis, 0.055).normalize();
    if (nearRoad(nd, 1.8)) nd = s.dir.clone().applyAxisAngle(axis, -0.055).normalize();
    const p = makePerson(palette[pi % palette.length], pi % 3 === 0 ? 0x2d2138 : null);
    pi++;
    p.scale.setScalar(0.78);
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
  boat: ['boardwalk', 'library', 'artgarden', 'cape'],
  rocket: ['cape', 'artgarden'],
};
// a chosen mode picks a route AND a vehicle — the shuttle run is driven
const MODE_VEHICLE = { jeep: 'jeep', train: 'train', bike: 'bike', walk: 'walk', boat: 'boat', rocket: 'jeep' };
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
const navRoute = document.getElementById('nav-route');
const navBag = document.getElementById('nav-bag');
function updateNav() {
  navMode.textContent = TRANSPORT[transport].emoji;
  const s = currentStop();
  navNext.textContent = s ? `→ ${s.name}` : '🏛️ you have arrived';
  navRoute.innerHTML = route.map((st, i) => {
    const cls = i < routeIdx ? 'done' : i === routeIdx ? 'now' : '';
    const last = i === route.length - 1 ? ' last' : '';
    return `<li class="${cls}${last}">${st.name}</li>`;
  }).join('');
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
  let text = stop.line[transport] ?? stop.line.all ?? Object.values(stop.line)[0];
  // the twist: at every gallery the art is gone
  if (stop.lm && (stop.lm.style === 'library' || stop.lm.style === 'garden' || stop.lm.tag?.includes('art'))) {
    text = '…the frames are EMPTY. Every canvas — gone. ' + text;
  }
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
  if (stop.launches) {                    // fly up to the Space Museum
    finaleAfterLaunch = routeIdx >= route.length;   // only the finale if it's last
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


mark('title3d:start');
// ─── THE TITLE, PAINTED IN 3D ────────────────────────────────────────────────
// Letters are not a font: each glyph is a set of polyline strokes in a unit em
// box - the path a hand actually takes - which gives real waypoints across the
// tops and bottoms for the brush to follow. Each stroke is a FLAT ribbon whose
// width swells in the middle and tapers at both ends, the way a loaded brush
// lays paint down. Unlit material, so it reads as flat pigment, not plastic.
const GLYPHS = {
  A: [[[0.02, 0], [0.5, 1], [0.98, 0]], [[0.19, 0.38], [0.81, 0.38]]],
  E: [[[0.88, 1], [0.06, 1], [0.06, 0], [0.9, 0]], [[0.06, 0.52], [0.66, 0.52]]],
  I: [[[0.5, 0], [0.5, 1]]],
  J: [[[0.82, 1], [0.82, 0.24], [0.6, 0.02], [0.28, 0.04], [0.12, 0.26]]],
  L: [[[0.12, 1], [0.12, 0], [0.92, 0]]],
  N: [[[0.05, 0], [0.05, 1], [0.95, 0], [0.95, 1]]],
  P: [[[0.08, 0], [0.08, 1], [0.72, 1], [0.92, 0.79], [0.7, 0.56], [0.08, 0.56]]],
  S: [[[0.92, 0.86], [0.5, 1], [0.12, 0.86], [0.13, 0.63], [0.78, 0.43], [0.83, 0.16], [0.46, 0], [0.07, 0.16]]],
  T: [[[0.5, 0], [0.5, 1]], [[0.04, 1], [0.96, 1]]],
  Y: [[[0.04, 1], [0.5, 0.52], [0.96, 1]], [[0.5, 0.52], [0.5, 0]]],
  "'": [[[0.55, 1], [0.42, 0.7]]],
  ' ': [],
};
const GLYPH_W = { I: 0.42, "'": 0.34, ' ': 0.45 };

const title3D = new THREE.Group();
title3D.position.set(0, 0.6, -17);
camera.add(title3D);
scene.add(camera);

const PAINTS = [
  { hex: 0xff2e88, blob: new THREE.Vector3(-0.78, 0.34, 0.22) },
  { hex: 0xffc233, blob: new THREE.Vector3(0.12, 0.52, 0.22) },
  { hex: 0x33c9ff, blob: new THREE.Vector3(-0.52, -0.42, 0.22) },
];

// classic cartoon outline: the same shell, flipped and grown a touch, in black
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x140f1a, side: THREE.BackSide });
function outline(mesh, grow = 1.07) {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  o.scale.multiplyScalar(grow);
  o.position.copy(mesh.position);
  o.rotation.copy(mesh.rotation);
  o.renderOrder = -1;
  return o;
}

// ── the palette: a real kidney silhouette with a thumb hole, not a disc
const paletteG = new THREE.Group();
{
  const sh = new THREE.Shape();
  sh.moveTo(-1.9, 0.15);
  sh.bezierCurveTo(-1.95, 1.15, -0.7, 1.5, 0.35, 1.25);
  sh.bezierCurveTo(1.5, 1.0, 2.05, 0.25, 1.85, -0.5);
  sh.bezierCurveTo(1.65, -1.2, 0.55, -1.5, -0.5, -1.25);
  sh.bezierCurveTo(-1.35, -1.05, -1.85, -0.5, -1.9, 0.15);
  const hole = new THREE.Path();
  hole.absarc(0.95, -0.55, 0.3, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 14 });
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd7a879, roughness: 0.7 }));
  paletteG.add(body);
  paletteG.add(outline(body, 1.045));
  for (const p of PAINTS) {                       // glossy mounds of wet paint
    const blob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 10),
      new THREE.MeshStandardMaterial({ color: p.hex, roughness: 0.18, metalness: 0.05 }));
    blob.scale.set(1.25, 1.0, 0.42);
    blob.position.copy(p.blob);
    paletteG.add(blob);
    paletteG.add(outline(blob, 1.16));
  }
  paletteG.position.set(-7.2, -3.1, 2.0);
  // held out to the side and tipped toward the viewer, thumb hole inboard
  paletteG.rotation.set(-0.28, 0.62, -0.42);
  paletteG.scale.setScalar(1.15);
  title3D.add(paletteG);
}

// ── the brush
const brush3D = new THREE.Group();
let brushHair;
{
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.6, 10),
    new THREE.MeshStandardMaterial({ color: 0xe2a35c, roughness: 0.7 }));
  handle.position.y = 2.05; brush3D.add(handle); brush3D.add(outline(handle, 1.09));
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.5, 10),
    new THREE.MeshStandardMaterial({ color: 0xcfd4dc, metalness: 0.5, roughness: 0.3 }));
  ferrule.position.y = 0.7; brush3D.add(ferrule); brush3D.add(outline(ferrule, 1.09));
  brushHair = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.015, 0.8, 10),
    new THREE.MeshStandardMaterial({ color: PAINTS[0].hex, roughness: 0.35 }));
  brushHair.position.y = 0.3; brush3D.add(brushHair); brush3D.add(outline(brushHair, 1.10));
  brush3D.visible = false;
  title3D.add(brush3D);
}

// ── a flat brush stroke: width swells mid-stroke, tapers to nothing at the ends
function strokeRibbon(curve, size, mat) {
  const SEG = Math.max(20, Math.round(curve.getLength() * 9));
  const pos = [], idx = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    curve.getPoint(t, a);
    curve.getPoint(Math.min(1, t + 0.01), b);
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    // pressure profile: light in, heavy through the middle, lifted off at the end
    const taper = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.42);
    const wobble = 0.9 + Math.sin(t * 11 + curve.points[0].x) * 0.1;
    const hw = size * 0.115 * taper * wobble + size * 0.012;
    pos.push(a.x - ty * hw, a.y + tx * hw, a.z, a.x + ty * hw, a.y - tx * hw, a.z);
  }
  for (let i = 0; i < SEG; i++) {
    const p0 = i * 2, p1 = i * 2 + 1, q0 = (i + 1) * 2, q1 = (i + 1) * 2 + 1;
    idx.push(p0, q0, p1, p1, q0, q1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  g.setDrawRange(0, 0);
  return { mesh, total: idx.length };
}

function buildLine(text, size, y, colorHex, arc) {
  const strokes = [];
  let w = 0;
  for (const ch of text) w += (GLYPH_W[ch] ?? 0.78) + 0.16;
  let x = -w * size / 2;
  // unlit: flat pigment, no plastic highlight
  const mat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
  for (const ch of text) {
    const adv = (GLYPH_W[ch] ?? 0.78) + 0.16;
    for (const poly of (GLYPHS[ch] || [])) {
      const pts = poly.map(([px, py]) => {
        const wx = x + px * size;
        const t = (wx + w * size / 2) / (w * size);
        const lift = arc * (1 - Math.pow(2 * t - 1, 2));
        return new THREE.Vector3(wx, y + py * size + lift, 0);
      });
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
      const { mesh, total } = strokeRibbon(curve, size, mat);
      title3D.add(mesh);
      strokes.push({ mesh, curve, total });
    }
    x += adv * size;
  }
  return strokes;
}

const LINE_A = buildLine("JANELLE'S", 0.85, 2.2, PAINTS[0].hex, 0.42);
const LINE_B = buildLine('TINY', 1.75, -0.9, PAINTS[1].hex, 0.55);
const LINE_C = buildLine('PLANET', 1.75, -0.9, PAINTS[2].hex, 0.55);
for (const s of LINE_B) s.mesh.position.x -= 4.9;
for (const s of LINE_C) s.mesh.position.x += 4.2;

// ── splatters: flat irregular flecks, not beads
const splashes = [];
{
  function fleckGeo(seed) {
    const sh = new THREE.Shape();
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 0.16 * (0.55 + ((Math.sin(seed + i * 2.7) + 1) / 2) * 0.9);
      const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.8;
      i ? sh.lineTo(px, py) : sh.moveTo(px, py);
    }
    return new THREE.ShapeGeometry(sh, 8);
  }
  for (let i = 0; i < 30; i++) {
    const m = new THREE.Mesh(fleckGeo(i * 1.7), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
    }));
    m.visible = false; m.frustumCulled = false;
    title3D.add(m);
    splashes.push({ mesh: m, life: 0, vel: new THREE.Vector3(), spin: 0, scale: 1 });
  }
}
function fling(at, hex) {
  const s = splashes.find(s => s.life <= 0);
  if (!s) return;
  s.mesh.material.color.setHex(hex);
  s.mesh.position.copy(at);
  s.vel.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, 9 + Math.random() * 12);
  s.life = 1; s.mesh.visible = true;
  s.spin = (Math.random() - 0.5) * 9;
  s.scale = 0.7 + Math.random() * 1.5;
}

// ── the score. Brisk: a title, not a short film.
const TITLE_STEPS = [];
{
  const lines = [
    { strokes: LINE_A, paint: PAINTS[0] },
    { strokes: LINE_B, paint: PAINTS[1] },
    { strokes: LINE_C, paint: PAINTS[2] },
  ];
  for (const ln of lines) {
    TITLE_STEPS.push({ kind: 'dip', dur: 0.16, paint: ln.paint });
    for (const st of ln.strokes) {
      TITLE_STEPS.push({ kind: 'fly', dur: 0.06, to: st.curve.getPoint(0), paint: ln.paint });
      TITLE_STEPS.push({ kind: 'paint', dur: Math.max(0.09, st.curve.getLength() * 0.027), stroke: st, paint: ln.paint });
    }
  }
  TITLE_STEPS.push({ kind: 'park', dur: 0.20 });
}
let tiStep = 0, tiT = 0, tiDone = false;
const _tiPrev = new THREE.Vector3(999, 999, 999);
const _tiTmp = new THREE.Vector3();

function finishTitleNow() {                        // used when you skip ahead
  for (const ln of [LINE_A, LINE_B, LINE_C]) for (const st of ln) st.mesh.geometry.setDrawRange(0, st.total);
  brush3D.visible = false;
  tiDone = true;
}

function updateTitle3D(dt) {
  for (const s of splashes) {
    if (s.life <= 0) continue;
    s.life -= dt * 1.5;
    s.mesh.position.addScaledVector(s.vel, dt);
    s.mesh.rotation.z += s.spin * dt;
    s.mesh.scale.setScalar(s.scale * (1 + (1 - s.life) * 3.2));
    s.mesh.material.opacity = Math.min(1, s.life * 1.8);
    if (s.life <= 0) s.mesh.visible = false;
  }
  if (tiDone) return;
  const step = TITLE_STEPS[tiStep];
  tiT += dt / step.dur;
  const k = Math.min(1, tiT);
  const ease = k * k * (3 - 2 * k);

  if (step.kind === 'dip') {
    const blob = _tiTmp.copy(step.paint.blob).applyMatrix4(paletteG.matrix);
    brush3D.visible = true;
    brush3D.position.lerpVectors(_tiPrev.x > 900 ? blob : _tiPrev, blob, ease);
    brush3D.position.y -= Math.sin(Math.PI * k) * 0.22;
    brush3D.rotation.set(0.5, 0, -0.55);
    if (k > 0.5) brushHair.material.color.setHex(step.paint.hex);
  } else if (step.kind === 'fly') {
    brush3D.position.lerpVectors(_tiPrev, step.to, ease);
    brush3D.position.y += Math.sin(Math.PI * ease) * 1.1;
    brush3D.rotation.set(0.3, 0, -0.28);
  } else if (step.kind === 'paint') {
    const st = step.stroke;
    const p = st.curve.getPoint(k);
    brush3D.position.copy(p).add(st.mesh.position);
    const ahead = st.curve.getPoint(Math.min(1, k + 0.08));
    brush3D.rotation.set(0.28, 0, -Math.atan2(ahead.x - p.x, ahead.y - p.y) * 0.45);
    st.mesh.geometry.setDrawRange(0, Math.ceil(st.total * k / 6) * 6);
    if (Math.random() < 0.12) fling(brush3D.position, step.paint.hex);
  } else {
    brush3D.position.lerpVectors(_tiPrev, _tiTmp.set(-5.6, -2.4, 2.4), ease);
    brush3D.rotation.set(0.4, 0, -0.5);
  }

  if (k >= 1) {
    if (step.kind === 'paint') step.stroke.mesh.geometry.setDrawRange(0, step.stroke.total);
    _tiPrev.copy(brush3D.position);
    tiStep++; tiT = 0;
    if (tiStep >= TITLE_STEPS.length) { tiDone = true; brush3D.visible = false; }
  }
}

// ─── title screen → GPS phone → play ─────────────────────────────────────────

// ─── THE ARRIVAL: plane lands, Uber to the hotel, check in, then the phone ───
// A hands-off cinematic that plays after "enter", using the airport and resort
// that already exist. Ends by handing off to the texts + GPS flow.
let arrivalT = 0, arrivalPhase = -1, limo = null, arrivalPax = null;
const _aTmp = new THREE.Vector3(), _aTmp2 = new THREE.Vector3(), _aTmp3 = new THREE.Vector3(), _aPrev = new THREE.Vector3();
const arrDir = { runwayA: null, runwayB: null, board: null, cityEnd: null };
let arrPath = null, arrArcs = null, arrTotal = 0, uGas = 0.45, uEnd = 1;
let gasDriver = null;
function buildArrPath() {
  // the same waypoints the spur roads are BUILT from, so the limo is always
  // on painted road: airport → spur → downtown centre → spur → resort
  const tA = Math.min(0.9, 0.94 / DOWNTOWN.angleTo(AIRPORT));
  const tR = Math.min(0.9, 0.94 / DOWNTOWN.angleTo(RESORT));
  const apron = frameAt(AIRPORT)(5.2, 12);       // where the limo waits (matches limoWait)
  const eA = slerpDir(DOWNTOWN, AIRPORT, tA);    // airport gate on the boulevard
  const eR = slerpDir(DOWNTOWN, RESORT, tR);     // resort gate
  let pts = [];
  // taxi across the apron to the spur's turning circle, then FOLLOW THE SPUR
  // ROAD to the boulevard gate — the old straight apron→gate slerp cut
  // cross-country and never touched the painted road (or the gas station)
  for (let k = 0; k < 6; k++) pts.push(slerpDir(apron, AIRPORT, k / 6));
  for (let k = 0; k < 18; k++) pts.push(slerpDir(AIRPORT, eA, k / 18));
  // around the ring boulevard, the short way — NEVER across downtown
  const bE1 = new THREE.Vector3(0, 1, 0).cross(DOWNTOWN).normalize();
  const bE2 = new THREE.Vector3().crossVectors(DOWNTOWN, bE1).normalize();
  const azi = (d) => Math.atan2(d.dot(bE2), d.dot(bE1));
  const thA = azi(eA), thR = azi(eR);
  let dth = thR - thA;
  while (dth > Math.PI) dth -= Math.PI * 2;
  while (dth < -Math.PI) dth += Math.PI * 2;
  const BARC = 0.94;
  for (let k = 0; k <= 24; k++) {
    const th = thA + dth * (k / 24);
    pts.push(DOWNTOWN.clone().multiplyScalar(Math.cos(BARC))
      .addScaledVector(bE1, Math.sin(BARC) * Math.cos(th))
      .addScaledVector(bE2, Math.sin(BARC) * Math.sin(th)).normalize());
  }
  for (let k = 0; k <= 20; k++) pts.push(slerpDir(eR, RESORT, k / 20));
  // soften the two grid-edge corners so the limo steers, not teleports
  for (let pass = 0; pass < 3; pass++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      out.push(pts[i].clone().multiplyScalar(2).add(pts[i - 1]).add(pts[i + 1]).normalize());
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  // extra corner-softening over the whole assembled route
  for (let pass = 0; pass < 4; pass++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      out.push(pts[i].clone().multiplyScalar(2).add(pts[i - 1]).add(pts[i + 1]).normalize());
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  arrPath = pts;
  arrArcs = [0];
  for (let i = 1; i < pts.length; i++) arrArcs.push(arrArcs[i - 1] + pts[i - 1].angleTo(pts[i]));
  arrTotal = arrArcs[arrArcs.length - 1];
  // where does the route pass the gas station?
  let best = 0, bestA = 1e9;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i].angleTo(GAS_DIR);
    if (a < bestA) { bestA = a; best = i; }
  }
  uGas = arrArcs[best] / arrTotal;
  // pull up OUTSIDE the hotel: the path ends at its centre, so stop short
  uEnd = Math.max(uGas + 0.05, 1 - 4.5 / (arrTotal * R));
}
const _apDir = new THREE.Vector3(), _apTan = new THREE.Vector3();
function sampleArrPath(u01, outDir, outTan) {
  const u = THREE.MathUtils.clamp(u01, 0, 1) * arrTotal;
  let i = 0;
  while (i < arrArcs.length - 2 && arrArcs[i + 1] < u) i++;
  const span = Math.max(1e-6, arrArcs[i + 1] - arrArcs[i]);
  const f = THREE.MathUtils.clamp((u - arrArcs[i]) / span, 0, 1);
  outDir.copy(slerpDir(arrPath[i], arrPath[i + 1], f));
  outTan.copy(arrPath[i + 1]).sub(arrPath[i].clone().multiplyScalar(arrPath[i].dot(arrPath[i + 1]))).normalize();
}
const arrCaption = document.getElementById('arr-caption');

// the limo: ALWAYS the real textured model — the old procedural box limo is
// gone. If the GLB hasn't streamed in yet the group starts empty (invisible
// for a beat) and fills itself the moment the template lands, so an early
// Enter can never resurrect a boxy stand-in.
function dressLimoClone() {
  const g = limoTemplate.clone(true);
  const wheels = [];
  g.traverse(o => {
    if (o.isMesh && /wheel|tyre|tire|rim/i.test(o.name)) wheels.push(o);
  });
  g.userData.wheels = wheels;
  gpRegister(g);                    // thin boil contour + flat fills in drawn modes
  return g;
}
function buildLimo() {
  const holder = new THREE.Group();
  if (limoTemplate) { holder.add(dressLimoClone()); return holder; }
  limoWaiters.push(holder);         // fill in as soon as the GLB lands
  return holder;
}
const limoWaiters = [];

let cabin = null;
// the cabin is a PAINTING: a hand-drawn NetJets-style interior on one
// billboard (the critic never walks, so it reads as a room), plus a real
// porthole to the left that the camera turns to for the planet-below shot
// hand-traced NetJets cabin: every shape (bulkhead, seats, windows, sign) is a
// flat fill with a wobbly grease-pencil outline. `seed` jitters the line path so
// a handful of variants swapped per frame read as a hand-drawn boil.
function drawCabinPainting(seed = 1) {
  const W = 1024, H = 640;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const ink = '#26202b';
  const rnd = mulberry32(seed >>> 0);
  const jit = (a) => (rnd() - 0.5) * a;
  c.lineJoin = 'round'; c.lineCap = 'round'; c.textAlign = 'center';
  const stroke = (pts, w, close, col) => {
    c.strokeStyle = col || ink; c.lineWidth = w; c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0] + jit(2.6), y = pts[i][1] + jit(2.6);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    if (close) c.closePath();
    c.stroke();
  };
  const panel = (x, y, w, h, r, col, lw = 5) => {
    c.fillStyle = col; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
    const N = 5, p = [];
    for (let i = 0; i <= N; i++) p.push([x + w * i / N, y]);
    for (let i = 1; i <= N; i++) p.push([x + w, y + h * i / N]);
    for (let i = 1; i <= N; i++) p.push([x + w - w * i / N, y + h]);
    for (let i = 1; i < N; i++) p.push([x, y + h - h * i / N]);
    stroke(p, lw, true);
  };
  const ellipse = (cx, cy, rx, ry, col, lw) => {
    c.fillStyle = col; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 7); c.fill();
    const p = []; for (let i = 0; i <= 22; i++) { const a = i / 22 * Math.PI * 2; p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    stroke(p, lw, true);
  };

  // warm cabin shell + ceiling glow + carpet
  const wall = c.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#f7eeda'); wall.addColorStop(0.55, '#efe4cf'); wall.addColorStop(1, '#e6d7bd');
  c.fillStyle = wall; c.fillRect(0, 0, W, H);
  const cg = c.createLinearGradient(0, 0, 0, H * 0.24);
  cg.addColorStop(0, '#fbf3df'); cg.addColorStop(1, 'rgba(251,243,223,0)');
  c.fillStyle = cg; c.fillRect(0, 0, W, H * 0.24);
  stroke([[0, H * 0.12], [W * 0.3, H * 0.08], [W * 0.7, H * 0.08], [W, H * 0.12]], 3);
  c.fillStyle = '#d3bda4'; c.fillRect(0, H * 0.76, W, H * 0.24);
  stroke([[0, H * 0.76], [W, H * 0.76]], 4);
  for (let i = 0; i < 6; i++) { const t = i / 5; stroke([[W * (0.18 + t * 0.68), H * 0.77], [W * (t * 1.05 - 0.05), H]], 2.5, false, 'rgba(38,32,43,0.35)'); }

  // maroon aft bulkhead (left), curved like the real cabin
  c.fillStyle = '#6f2b2c';
  c.beginPath(); c.moveTo(-10, H * 0.07);
  c.quadraticCurveTo(W * 0.30, H * 0.0, W * 0.44, H * 0.15);
  c.lineTo(W * 0.42, H * 0.82); c.lineTo(-10, H * 0.84); c.closePath(); c.fill();
  c.fillStyle = 'rgba(40,12,14,0.32)';
  c.beginPath(); c.moveTo(W * 0.30, H * 0.05); c.quadraticCurveTo(W * 0.40, H * 0.09, W * 0.44, H * 0.15);
  c.lineTo(W * 0.42, H * 0.82); c.lineTo(W * 0.33, H * 0.82); c.closePath(); c.fill();
  stroke([[-10, H * 0.07], [W * 0.30, H * 0.0], [W * 0.44, H * 0.15], [W * 0.42, H * 0.82]], 5);
  // NETJETS placard on the bulkhead
  panel(W * 0.05, H * 0.40, W * 0.22, H * 0.15, 10, '#fdfcf6', 5);
  c.fillStyle = ink; c.font = '700 30px "Fredoka", system-ui, sans-serif';
  c.fillText('NETJETS', W * 0.16, H * 0.487);
  stroke([[W * 0.075, H * 0.505], [W * 0.246, H * 0.44]], 3);

  // two glowing windows, right wall
  for (const wx of [W * 0.80, W * 0.915]) {
    panel(wx - 58, H * 0.24, 106, H * 0.42, 42, '#efe3c9', 6);
    const glow = c.createRadialGradient(wx - 6, H * 0.44, 6, wx - 6, H * 0.44, 130);
    glow.addColorStop(0, '#fffdf4'); glow.addColorStop(0.6, '#ffedbe'); glow.addColorStop(1, '#f4e0b2');
    c.save(); c.beginPath(); c.roundRect(wx - 46, H * 0.27, 80, H * 0.36, 34); c.clip();
    c.fillStyle = glow; c.fillRect(wx - 60, H * 0.24, 120, H * 0.5); c.restore();
    const p = []; for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI * 2; p.push([wx - 6 + Math.cos(a) * 40, H * 0.45 + Math.sin(a) * H * 0.18]); }
    stroke(p, 4);
  }

  // two cream club seats facing each other, centre, with a low table
  const seat = (x, base, w, tall, arm) => {
    panel(x - w * 0.10, base - tall * 0.12, w * 0.16, tall * 0.5, 12, '#e2d3b4', 4);   // armrest
    panel(x, base - tall * 0.60, w * 0.96, tall * 0.68, 22, '#efe4ca', 5);            // backrest
    panel(x, base, w, tall * 0.34, 20, '#e9dcc0', 5);                                 // cushion
    stroke([[x + w * 0.5, base - tall * 0.52], [x + w * 0.5, base + tall * 0.26]], 3, false, 'rgba(38,32,43,0.45)');
  };
  seat(W * 0.40, H * 0.66, W * 0.155, H * 0.40);
  seat(W * 0.575, H * 0.685, W * 0.155, H * 0.40);
  ellipse(W * 0.55, H * 0.72, 40, 14, '#8a5a36', 4);
  panel(W * 0.537, H * 0.645, 15, 30, 4, '#ffe6ac', 3);
  return cv;
}

// grease-pencil pass over a PHOTO: sobel edges become hand-inked strokes,
// and a paper tint pulls the photo toward the drawn world
function greaseOverPhoto(img, seed) {
  // PROPER line work: sparse, thin strokes traced along strong CONTOURS only,
  // sampled on a stride so lines read as drawn edges, not confetti. Two
  // seeds give two slightly different drawings — swapped at ~6fps = boil.
  const W = 1024, H = Math.round(1024 * img.height / img.width);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0, W, H);
  const dW = 256, dH = Math.round(dW * H / W);
  const dc = document.createElement('canvas');
  dc.width = dW; dc.height = dH;
  const d2 = dc.getContext('2d');
  d2.drawImage(img, 0, 0, dW, dH);
  const px = d2.getImageData(0, 0, dW, dH).data;
  const lum = (i) => px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
  c.strokeStyle = 'rgba(30, 22, 32, 0.6)';
  c.lineCap = 'round';
  const jr = mulberry32(seed);
  for (let y = 2; y < dH - 2; y += 3) {            // stride: sparse, not dense
    for (let x = 2; x < dW - 2; x += 3) {
      const i = (y * dW + x) * 4;
      const gx = lum(i + 4) - lum(i - 4);
      const gy = lum(i + dW * 4) - lum(i - dW * 4);
      const mag = Math.hypot(gx, gy);
      if (mag < 88) continue;                      // strong contours only
      // follow the contour a few steps: one continuous stroke, not a tick
      let ang = Math.atan2(gy, gx) + Math.PI / 2 + (jr() - 0.5) * 0.15;
      let sx = (x / dW) * W, sy = (y / dH) * H;
      c.lineWidth = 1.1 + jr() * 0.9;
      c.beginPath();
      c.moveTo(sx, sy);
      for (let st = 0; st < 3; st++) {
        sx += Math.cos(ang) * (7 + jr() * 5);
        sy += Math.sin(ang) * (7 + jr() * 5);
        ang += (jr() - 0.5) * 0.35;                // hand wander
        c.lineTo(sx, sy);
      }
      c.stroke();
    }
  }
  c.globalCompositeOperation = 'multiply';         // paper tint
  c.fillStyle = 'rgba(246, 239, 224, 0.5)';
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'source-over';
  return cv;
}

// a warm cabin-wall texture (cream/tan panels) for the annulus around the
// porthole, so the frame reads as interior, not a flat grey card
function makeCabinWallTex() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#f4ead4'); g.addColorStop(0.6, '#ecdcbe'); g.addColorStop(1, '#dcc8a6');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  c.strokeStyle = 'rgba(120,98,64,0.14)'; c.lineWidth = 2;              // faint panel seams
  for (let y = 42; y < S; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke(); }
  c.strokeStyle = 'rgba(255,250,240,0.35)'; c.lineWidth = 1;
  for (let y = 44; y < S; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  return t;
}
// a wide, seamlessly-tiling city-skyline-at-dusk with a water reflection —
// scrolled behind the porthole so it reads as the plane cruising over the city
function makeSkylineTex() {
  const W = 2048, H = 1024, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'); const rr = mulberry32(9);
  const horizon = H * 0.60;
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#39205a'); sky.addColorStop(0.5, '#6d2b63'); sky.addColorStop(1, '#c15c7d');
  c.fillStyle = sky; c.fillRect(0, 0, W, horizon);
  const wat = c.createLinearGradient(0, horizon, 0, H);
  wat.addColorStop(0, '#8a4064'); wat.addColorStop(1, '#33203f');
  c.fillStyle = wat; c.fillRect(0, horizon, W, H - horizon);
  // one continuous run of buildings, drawn twice (upright + faded reflection)
  const cells = [];
  let x = 0;
  while (x < W) { const bw = 26 + rr() * 74, bh = 90 + rr() * 340; cells.push([x, bw, bh]); x += bw + 2 + rr() * 7; }
  const winCol = (m) => `rgba(255,${(150 + rr() * 80) | 0},${(80 + rr() * 60) | 0},${m ? 0.28 : 0.95})`;
  const ink = '#26202b';
  for (const mirror of [false, true]) {
    for (const [bx, bw, bh] of cells) {
      const top = horizon - bh;
      c.fillStyle = `rgb(${(206 + rr() * 34) | 0},${(198 + rr() * 30) | 0},${(214 + rr() * 24) | 0})`;
      if (!mirror) {
        c.fillRect(bx, top, bw, bh);
        // cartoony ink contour around each tower, wobbled a touch so it reads
        // hand-drawn like the rest of the world
        c.strokeStyle = ink; c.lineWidth = 3.5 + rr() * 1.5;
        c.strokeRect(bx + (rr() - 0.5) * 2, top + (rr() - 0.5) * 2, bw, bh);
      } else { c.save(); c.globalAlpha = 0.3; c.fillRect(bx, horizon, bw, bh * 0.7); c.restore(); }
      const cols = Math.max(1, Math.floor(bw / 9)), rows = Math.floor(bh / 13);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if (rr() > 0.55) continue;
        c.fillStyle = winCol(mirror);
        const wx = bx + 3 + i * 9, wy = mirror ? horizon + j * 13 + 3 : top + 3 + j * 13;
        if (wy > horizon - 2 && !mirror) continue;
        c.fillRect(wx, wy, 5, 6);
      }
    }
  }
  // ink the waterline so the reflection reads as water, not a smudge
  c.strokeStyle = ink; c.lineWidth = 5;
  c.beginPath(); c.moveTo(0, horizon + 1); c.lineTo(W, horizon + 1); c.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(0.42, 1);
  return t;
}
// the cabin is a PAINTING: a hand-drawn NetJets-style interior on one
// billboard, plus a porthole whose glass shows a scrolling skyline (below)
function buildCabin() {
  const g = new THREE.Group();
  // THE CABIN IS A TUBE, like a real fuselage: an open cylinder around the
  // camera whose interior wears the cabin-wall texture, capped at the back by
  // the supplied NetJets painting (models/cabin_refined.png) as a flat image.
  // The camera sits INSIDE and simply yaws — panning now sweeps across curved
  // wall, so the head-turn reads geometrically instead of sliding a flashcard.
  const RAD = 2.7, LEN = 10;
  const wallTex = makeCabinWallTex();
  wallTex.repeat.set(6, 2);
  const tubeMat = new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide });
  // the BARREL holds the wall segments + porthole, and is ROLLED so the left
  // window tips toward the planet — through the real hole you see the actual
  // world below (sky, coastline, the whole map), not a painted stand-in
  const barrel = new THREE.Group();
  // wall with a REAL slot cut out of the -X side (two arc segments)...
  const SLOT = 0.60;                          // arc width of the porthole slot
  const TH0 = Math.PI * 1.5;                  // slot centred on -X (the left wall)
  barrel.add(new THREE.Mesh(
    new THREE.CylinderGeometry(RAD, RAD, LEN, 40, 1, true, TH0 + SLOT / 2, Math.PI * 2 - SLOT), tubeMat));
  // ...closed again above and below the porthole, leaving a ~1.6 opening that
  // the rim rings fully overlap
  const WIN_Z = 0.4, HALF = 0.8;
  for (const [lo, hi] of [[-LEN / 2, WIN_Z - HALF], [WIN_Z + HALF, LEN / 2]]) {
    const patch = new THREE.Mesh(
      new THREE.CylinderGeometry(RAD, RAD, hi - lo, 8, 1, true, TH0 - SLOT / 2, SLOT), tubeMat);
    patch.position.y = (lo + hi) / 2;
    barrel.add(patch);
  }
  barrel.rotation.x = Math.PI / 2;            // axis down Z (cabin length)
  barrel.rotation.z = 0.55;                   // roll: left window looks DOWN at the planet
  barrel.position.set(0, 0.6, 0);
  g.add(barrel);
  // back cap: the NetJets painting, a flat image closing the tube
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2 * RAD * 1.42, 2 * RAD * 1.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  new THREE.TextureLoader().load('./models/cabin_refined.png', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    board.material.map = tex;
    board.material.needsUpdate = true;
  });
  board.position.set(0, 0.6, LEN / 2 - 0.4);
  board.rotation.y = Math.PI;                 // faces the camera down the tube
  g.add(board);
  g.userData.board = board;
  // the porthole rides ON the left wall of the tube (inner face at -X),
  // rim + glass turned to face inward at the camera
  const winG = new THREE.Group();
  // ink contour behind the rim so the porthole wears the same cartoony outline
  // as everything else
  const rimInk = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.21, 12, 36), new THREE.MeshBasicMaterial({ color: 0x26202b }));
  rimInk.position.z = -0.015;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.16, 12, 36), new THREE.MeshBasicMaterial({ color: 0xe4d3b0 }));
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.055, 8, 36), new THREE.MeshBasicMaterial({ color: 0x8f95a0 }));
  winG.add(rimInk); winG.add(rim); winG.add(rim2);
  // the glass: a faint translucent pane over the REAL hole — the world outside
  // is the live scene (sky above, the planet's coasts and city sliding below)
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.87, 36),
    new THREE.MeshBasicMaterial({ color: 0xd6e8f2, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
  glass.position.set(0, 0, 0.02);
  winG.add(glass);
  // barrel-local frame (pre-roll): x=-RAD is the left wall, y runs down the
  // cabin length, z is vertical — the roll carries the window with the slot
  winG.position.set(-RAD + 0.08, WIN_Z, 0);
  winG.rotation.z = Math.PI / 2;              // stand the rings up in the slot
  winG.rotation.y = Math.PI / 2;              // and face them inward at the camera
  barrel.add(winG);
  g.userData.window = winG;
  g.visible = false;
  scene.add(g);
  return g;
}

function startArrival() {
  gameState = 'arrival';
  arrivalT = 0;
  titleEl.classList.add('hide');
  title3D.visible = false;
  document.body.classList.remove('title-mode');
  applyGfx();
  startAudio();
  if (!limo) { limo = buildLimo(); scene.add(limo); }
  if (!cabin) cabin = buildCabin();
  if (!arrPath) buildArrPath();
  if (!gasDriver) {
    gasDriver = makePerson(0x1c1620, 0x2d2138);   // black suit, chauffeur cap
    gasDriver.scale.setScalar(0.78);
    gasDriver.visible = false;
    scene.add(gasDriver);
  }
  if (!arrivalPax) {
    arrivalPax = makePerson(0x8f5ad8, 0xd23b6b);  // the arriving critic: violet coat, pink beret
    arrivalPax.scale.setScalar(0.82);
    arrivalPax.visible = false;
    scene.add(arrivalPax);
  }
  const airAt = frameAt(AIRPORT);
  arrDir.runwayA = airAt(0, -16).normalize();
  arrDir.runwayB = airAt(0, 12).normalize();
  arrDir.cityEnd = RESORT.clone();                // limo takes you to the hotel
  limo.visible = false;
  if (arrCaption) { arrCaption.style.opacity = 1; arrCaption.textContent = '✈ First class — welcome aboard'; }
}

const _paxA = new THREE.Vector3(), _paxB = new THREE.Vector3(), _paxP = new THREE.Vector3();
function updateArrival(dt) {
  arrivalT += dt / 36;   // an unhurried scene, not a chase
  const T = arrivalT;
  const airAt = frameAt(AIRPORT);
  const limoWait = airAt(5.2, 12).normalize();   // clear of the rolled-out jet
  const rig = airportPlane && airportPlane.userData.rig;
  const ease = (x) => x * x * (3 - 2 * x);

  // keep the jet parked at the gate whenever we're not actively flying it
  const parkJet = () => {
    const d = airAt(0, 12).normalize();
    airportPlane.position.copy(d.clone().multiplyScalar(Math.max(radiusAt(d), SEA_R) + 0.02));
    alignToSurface(airportPlane, d, yawToFace(d, airAt(0, 24)));
    airportPlane.visible = true;
  };
  // gear/stairs/passenger default to the resting state; each phase overrides
  if (rig) { rig.setGearDeploy(1); rig.setStairDeploy(0); }
  if (arrivalPax && T >= 0.54) arrivalPax.visible = false;

  if (T < 0.16) {                                 // 0. first class, then the view
    const up = AIRPORT.clone();
    cabin.visible = true;
    cabin.position.copy(up.clone().multiplyScalar(R + 34));
    alignToSurface(cabin, up);
    airportPlane.visible = false;
    if (rig) rig.setGearDeploy(0);                 // gear stowed at cruise
    // turbulence: the whole frame trembles like cruise altitude
    const tt = performance.now() / 1000;
    const brd = cabin.userData.board;
    if (brd?.userData.boil) {                      // the line boil: alternate drawings
      const which = Math.floor(tt * 6) % 2;
      if (brd.material.map !== brd.userData.boil[which]) {
        brd.material.map = brd.userData.boil[which];
        brd.material.needsUpdate = true;
      }
    }
    const jx = Math.sin(tt * 23.1) * 0.014 + Math.sin(tt * 13.7) * 0.02;
    const jy = Math.cos(tt * 19.3) * 0.012 + Math.sin(tt * 7.9) * 0.016;
    _aTmp.copy(cabin.localToWorld(new THREE.Vector3(jx, 1.1 + jy, 0)));
    camera.position.copy(_aTmp);
    camera.up.lerp(up, 0.25).normalize();
    const win = cabin.userData.window;
    // the porthole is FIXED to the tube's left wall now — always visible, the
    // skyline behind it always sliding right→left like the plane is cruising
    win.visible = true;
    if (T < 0.065) {                               // gazing down the cabin
      if (arrCaption) arrCaption.textContent = '✈ First class — welcome aboard';
      camera.lookAt(cabin.localToWorld(_aTmp2.set(jx * 2, 0.8, 4.0)));
    } else {                                       // TURN YOUR HEAD to the window
      if (arrCaption) arrCaption.textContent = '🌍 There it is — the tiny planet';
      const k = Math.min(1, (T - 0.065) / 0.035);
      const e = k * k * (3 - 2 * k);
      // head-turn inside the tube: gaze slides from the painting at the back of
      // the cabin to the porthole on the left wall — one smooth level yaw whose
      // panning sweeps across the curved wall between them
      const paintingAt = cabin.localToWorld(_aTmp2.set(0, 0.8, 4.0)).clone();
      const windowAt = cabin.userData.window.getWorldPosition(_aTmp3);
      camera.lookAt(_aTmp2.copy(paintingAt).lerp(windowAt, e));
      // ...and during the hold, drift very slowly so it feels alive
      if (k >= 1) camera.position.addScaledVector(camera.up, Math.sin(tt * 0.7) * 0.02);
    }
  } else if (T < 0.44) {                           // 1. the jet lands, nose-forward
    cabin.visible = false;
    airportPlane.visible = true;
    if (arrCaption) arrCaption.textContent = '✈ NetJets — cleared to land';
    const k = (T - 0.16) / 0.28;
    const along = -16 + k * 28;
    const alt = Math.max(0, (0.5 - k) * 24);
    if (rig) rig.setGearDeploy(THREE.MathUtils.clamp((k - 0.05) / 0.35, 0, 1));  // gear down before touchdown
    const d = airAt(0, along).normalize();
    airportPlane.position.copy(d.clone().multiplyScalar(Math.max(radiusAt(d), SEA_R) + 0.02 + alt));
    alignToSurface(airportPlane, d, yawToFace(d, airAt(0, along + 6)));
    airportPlane.visible = true;
    const back = airAt(-6, along - 9).normalize();
    _aTmp.copy(airportPlane.position).addScaledVector(_aTmp2.subVectors(back, d).normalize(), 7).addScaledVector(d, 3.5);
    camera.position.lerp(_aTmp, 0.06);
    camera.up.lerp(d, 0.1).normalize();
    camera.lookAt(airportPlane.position);
  } else if (T < 0.54) {                           // 2. step off to the waiting limo
    if (arrCaption) arrCaption.textContent = '🛬 Your car is waiting.';
    parkJet();
    limo.visible = true;
    limo.position.copy(settleOn(limoWait, 0.6, 0.02));
    alignToSurface(limo, limoWait, yawToFace(limoWait, arrDir.cityEnd));
    // the airstair folds down, then the critic walks down it and into the limo
    const kk = THREE.MathUtils.clamp((T - 0.44) / 0.10, 0, 1);
    if (rig) {
      rig.setGearDeploy(1);
      rig.setStairDeploy(ease(THREE.MathUtils.clamp(kk / 0.35, 0, 1)));
      if (arrivalPax) {
        rig.footWorld(_paxA);
        _paxB.copy(limo.position).addScaledVector(
          _paxP.subVectors(airportPlane.position, limo.position).normalize(), 1.0);
        const a = THREE.MathUtils.clamp((kk - 0.30) / 0.62, 0, 1);
        _paxP.copy(_paxA).lerp(_paxB, ease(a));
        const nrm = _paxP.clone().normalize();
        arrivalPax.position.copy(nrm.clone().multiplyScalar(Math.max(radiusAt(nrm), SEA_R) + 0.02));
        alignToSurface(arrivalPax, nrm, yawToFace(nrm, _paxB.clone().normalize()));
        walkPerson(arrivalPax, performance.now() / 1000 * 1.3, a < 0.99 ? 0.95 : 0);
        arrivalPax.visible = kk > 0.28 && a < 0.985;
      }
    }
    const d = airAt(0, 12).normalize();
    _aTmp.copy(airportPlane.position).addScaledVector(d, 3.5)
      .addScaledVector(_aTmp2.copy(d).cross(UP_Y).normalize(), 8);
    camera.position.lerp(_aTmp, 0.06);
    camera.up.lerp(d, 0.1).normalize();
    camera.lookAt(limo.position);
  } else if (T < 0.94) {                           // 3. the drive: spur road,
    // gas stop halfway, then through downtown to the resort — ON the roads
    const K = (T - 0.54) / 0.40;                   // 0..1 across the whole drive
    const LEG1 = 0.42, STOP = 0.60;                // fractions of K
    let u, driving = true;
    if (K < LEG1) {                                // airport → gas station
      const k = K / LEG1;
      // constant road speed with a soft start and stop, not a whole-leg ease
      const e = k < 0.12 ? (k / 0.12) * (k / 0.12) * 0.12 : k > 0.88 ? 1 - ((1 - k) / 0.12) * ((1 - k) / 0.12) * 0.12 : k;
      u = uGas * e;
      if (arrCaption) arrCaption.textContent = '🚘 Heading into town…';
    } else if (K < STOP) {                         // filling up
      u = uGas; driving = false;
      if (arrCaption) arrCaption.textContent = '⛽ Quick stop — topping up the tank';
    } else {                                       // gas → downtown → hotel
      const k = (K - STOP) / (1 - STOP);
      const e = k < 0.1 ? (k / 0.1) * (k / 0.1) * 0.1 : k > 0.9 ? 1 - ((1 - k) / 0.1) * ((1 - k) / 0.1) * 0.1 : k;
      u = uGas + (uEnd - uGas) * e;
      if (arrCaption) arrCaption.textContent = '🚘 Into the city…';
    }
    sampleArrPath(u, _apDir, _apTan);
    limo.visible = true;
    // lateral surface direction from the road toward the station
    const gasSide = GAS_DIR.clone().sub(_apDir.clone().multiplyScalar(_apDir.dot(GAS_DIR))).normalize();
    // driving: stay on the painted road. stopped: pull OFF onto the forecourt so
    // the limo sits alongside the pumps, not idling in the middle of the road.
    // road half-width is ~1.3, station centre 2.3 off, pumps ~1.9 off — so pull
    // in ~2.0 to clear the kerb and sit under the canopy at the pump line.
    const parkDir = driving ? _apDir.clone()
      : _apDir.clone().addScaledVector(gasSide, 2.0 / R).normalize();
    limo.position.copy(dbl(parkDir));
    alignToSurface(limo, parkDir, yawToFace(parkDir, parkDir.clone().multiplyScalar(R).addScaledVector(_apTan, 2).normalize()));
    if (driving) for (const w of limo.userData.wheels || []) w.rotation.x += dt * 5;
    // the chauffeur hops out on the pump side
    if (!driving) {
      gasDriver.visible = true;
      gasDriver.position.copy(limo.position).addScaledVector(gasSide, 1.0);
      alignToSurface(gasDriver, parkDir, yawToFace(parkDir, GAS_DIR));
      walkPerson(gasDriver, performance.now() / 1000, 0.25);   // fidgets with the pump
    } else {
      gasDriver.visible = false;
    }
    // camera: while driving it trails behind; at the stop it stands off on the
    // OPEN-ROAD side and looks back at the forecourt, so the limo and the
    // station share the frame and read at their true relative scale.
    let arrLook;
    if (driving) {
      _aTmp.copy(limo.position).addScaledVector(_apDir, 3.2)
        .addScaledVector(_aTmp2.copy(_apTan).negate(), 6.5);
      arrLook = limo.position.clone().addScaledVector(_apDir, 0.6);
    } else {
      const lat = _aTmp2.crossVectors(_apDir, _apTan).normalize();
      if (lat.dot(GAS_DIR) > 0) lat.negate();     // keep the station BEHIND the limo
      _aTmp.copy(limo.position).addScaledVector(_apDir, 2.8)
        .addScaledVector(lat, 6.5).addScaledVector(_apTan, -2.5);
      arrLook = limo.position.clone().addScaledVector(gasSide, 1.4).addScaledVector(_apDir, 0.4);
    }
    camera.position.lerp(_aTmp, 0.055);
    camera.up.lerp(_apDir, 0.08).normalize();
    camera.lookAt(arrLook);
  } else if (T < 1.0) {                            // 4. check in at the hotel
    gasDriver.visible = false;
    if (arrCaption) arrCaption.textContent = '🏨 Checking in…';
    sampleArrPath(uEnd, _apDir, _apTan);
    const d = _apDir.clone();
    limo.position.copy(dbl(d));
    alignToSurface(limo, d, yawToFace(d, arrDir.cityEnd));   // nose toward the doors
    const look = resortHotel ? resortHotel.position : posOn(d, 3);
    _aTmp.copy(look).addScaledVector(d, 3.5).addScaledVector(_aTmp2.copy(d).cross(UP_Y).normalize(), 7);
    camera.position.lerp(_aTmp, 0.06);
    camera.up.lerp(d, 0.08).normalize();
    camera.lookAt(look);
  } else {                                         // 5. done → the phone
    if (arrCaption) arrCaption.style.opacity = 0;
    limo.visible = false;
    gasDriver.visible = false;
    enterPhone();
  }
}
// drive on whichever is higher, terrain or sea
// wheels touch at the limo's origin, so sit it on the surface (a hair sunk, to
// match the parked settleOn sink and hide low-poly facet gaps) — no hover.
function dbl(d) { return d.clone().multiplyScalar(Math.max(radiusAt(d), SEA_R) - 0.02); }


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
  startArrival();                   // plane → Uber → hotel, then the phone
}
// after the arrival cinematic (or straight away in ?title=0), raise the phone
function enterPhone() {
  gameState = 'msg';
  phoneEl.classList.add('show');
  scrMsg.classList.add('on');
  scrMap.classList.remove('on');
  // the limo has dropped the critic at the hotel
  setTransport('walk');
  dir = RESORT.clone();
  heading = new THREE.Vector3(0, 0, 1);
  heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
  speed = 0;
  applyGfx();
}
document.getElementById('enter-btn').addEventListener('click', enterGame);
document.getElementById('arr-skip')?.addEventListener('click', () => {
  if (gameState === 'arrival') { arrivalT = 1; }   // jump to check-in → phone
});
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
  boat:  { eta: '28 min', dist: '3.6 km', via: 'coastal waters · moor at the boardwalk' },
  rocket:{ eta: '6 min',  dist: '410 km', via: 'Space Museum first · pad at Cape Far Side' },
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
  boat:  'M40 248 C 90 268 150 250 196 236 L196 168 L196 108',
  rocket:'M64 232 C 40 150 150 40 230 66 L214 96 L196 108',
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
  if (!chosenTransport) { if (runStarted) closePhone(); return; }
  if (runStarted) switchRide(chosenTransport); else beginRun(chosenTransport);
});

// mid-run the phone must always have a way back to the game
function closePhone() {
  if (gameState !== 'maps') return;
  phoneEl.classList.remove('show');
  scrMap.classList.remove('on');
  document.body.classList.remove('title-mode');
  gameState = 'play';
  pGo.textContent = 'Go';
  ping(560, 0.08);
}
document.querySelector('.gm-back')?.addEventListener('click', () => { if (runStarted) closePhone(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && gameState === 'maps' && runStarted) closePhone();
});

// ── the phone stays in your pocket: pull it out mid-run to change your ride ──
let runStarted = false;
const gmSearchDest = document.querySelector('#phone .gm-dest');
document.getElementById('phone-btn').addEventListener('click', () => {
  if (gameState !== 'play' || dlgOpen) return;
  gameState = 'maps';
  chosenTransport = transport;         // current ride pre-selected: Switch just works
  pGo.disabled = false;
  pGo.textContent = 'Switch';
  const next = currentStop();
  if (gmSearchDest) gmSearchDest.textContent = next ? next.name : 'The Downtown Museum';
  // the Express only picks you up at a platform — no hailing it from a field
  for (const b of document.querySelectorAll('#phone .gm-modes button')) {
    const railFar = b.dataset.t === 'train' && !TRAIN_STATIONS.some(k => dir.angleTo(STOP_DIRS[k]) < 0.14);
    b.disabled = railFar;
    b.style.opacity = railFar ? 0.35 : '';
    b.classList.toggle('sel', b.dataset.t === transport);
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
  showHint(MODE_VEHICLE[t] || t);
  phoneEl.classList.remove('show');
  scrMap.classList.remove('on');
  document.body.classList.remove('title-mode');
  gameState = 'play';
  pGo.textContent = 'Go';
  updateNav();
}

function beginRun(t) {
  setTransport(MODE_VEHICLE[t] || t);
  runTransport = t;
  route = ROUTES[t].map(k => STOPS[k]);
  routeIdx = 0; bag = []; trainU = 0;
  showHint(MODE_VEHICLE[t] || t);
  if (t === 'train') dir = STOP_DIRS.central.clone();
  else if (t === 'boat') dir = moorDir.clone();
  else if (t === 'rocket') dir = padDir.clone();
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

// walls are walls: if we ended up inside a footprint, slide back out to its
// edge along the great circle we came in on
const _colAxis = new THREE.Vector3();
function collideTraffic() {
  const rider = transport === 'walk' ? 0.3 : 0.62;
  for (const v of traffic) {                       // moving vehicles aren't in the static BVH
    if (!v.pos) continue;
    const rr = (rider + (v.kind === 'car' ? 0.7 : 0.3)) / R;
    const a = dir.angleTo(v.pos);
    if (a >= rr || a < 1e-6) continue;
    _colAxis.crossVectors(v.pos, dir);
    if (_colAxis.lengthSq() < 1e-12) continue;
    dir.copy(v.pos).applyAxisAngle(_colAxis.normalize(), rr).normalize();
    speed *= 0.5;
  }
}

// A straight lerp between two points on a sphere cuts THROUGH it, which sends
// the camera up out of the crust and shows every building's foundations from
// below. Fly an arc instead: slerp the direction, lerp the radius, and never
// let the eye drop under the ground it is passing over.
const _camDir = new THREE.Vector3(), _tgtDir = new THREE.Vector3();
function flyCameraTo(target, k, clearance = 1.2) {
  const curR = camera.position.length(), tgtR = target.length();
  _camDir.copy(camera.position).normalize();
  _tgtDir.copy(target).normalize();
  const ang = _camDir.angleTo(_tgtDir);
  const nd = ang > 1e-5 ? slerpDir(_camDir, _tgtDir, Math.min(1, k)) : _tgtDir.clone();
  // the bulge belongs to the TARGET, not to each frame: adding it every frame
  // while only lerping part-way leaves a standing error of bulge/k, which is
  // why the eye kept climbing instead of settling behind the car
  const bulge = Math.sin(Math.min(1, ang / 1.2) * Math.PI * 0.5) * 9;
  const goal = Math.max(tgtR + bulge, Math.max(radiusAt(_tgtDir), SEA_R) + clearance);
  const r = THREE.MathUtils.lerp(curR, goal, Math.min(1, k));
  camera.position.copy(nd).multiplyScalar(Math.max(r, Math.max(radiusAt(nd), SEA_R) + clearance * 0.6));
}

// ─── GREASE PENCIL: the Blender tutorial recipe, done live ───────────────────
// Two ingredients, exactly like the video: (1) toon-flat fills — every
// material swapped for an unlit flat version, so there is no 3D shading at
// all — and (2) LINE ART as real geometry: an inverted hull pushed out along
// the vertex normals draws a contour stroke around every object, the way the
// Line Art modifier traces meshes. No screen filter involved.
// LINE BOIL, the traditional-animation way: the stroke is redrawn as a
// slightly different line several times a second. Each 1/7s tick picks a new
// wobble variant — per-vertex pseudo-random offsets seeded by position and
// the tick — so the contour breathes like it was traced frame by frame.
// Two layers wear different seeds and weights: a firm dark stroke and a
// lighter, loose one over it, out of phase with each other.
function makeBoilMat(thickness, seed, color, opacity) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: opacity < 1,
    uniforms: {
      thick: { value: thickness },
      time: { value: 0 },
      seed: { value: seed },
    },
    vertexShader: `uniform float thick, time, seed;
      float h1(vec3 v, float s) {
        return fract(sin(dot(v, vec3(12.9898, 78.233, 45.164)) + s) * 43758.5453);
      }
      void main() {
        float tick = floor(time * 7.0);                     // 7 redraws a second
        float h = h1(position, seed + tick * 0.618);
        float g = h1(position.zxy, seed * 1.7 + tick * 0.37);
        // the line swells and thins along its length, differently every tick
        float w = thick * (0.55 + 1.0 * h);
        // and wanders sideways a touch, so it never sits exactly still
        vec3 wander = (vec3(h, g, h1(position.yzx, seed + tick)) - 0.5) * thick * 1.4;
        vec3 p = position + normalize(normal) * w + wander;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `void main() { gl_FragColor = vec4(${color}, ${opacity}); }`,
  });
}
const gpBoilHeavy = makeBoilMat(0.05, 3.1, '0.10, 0.09, 0.12', 1.0);    // buildings
const gpBoilMid   = makeBoilMat(0.032, 7.9, '0.10, 0.09, 0.12', 1.0);   // props, vehicles
const gpBoilLight = makeBoilMat(0.02, 15.3, '0.14, 0.12, 0.16', 0.8);   // small items
const gpBoilLoose = makeBoilMat(0.03, 11.7, '0.16, 0.14, 0.18', 0.5);   // the loose over-stroke
const gpBoilMats = [gpBoilHeavy, gpBoilMid, gpBoilLight, gpBoilLoose];
const gpOutlines = [];
let gpBuilt = false, gpOn = false;
const gpSkip = new Set([planet, ocean, sky, skyStars]);
// give ONE mesh its boiling inverted-hull contour(s). Idempotent (via _gpDone)
// so it's safe to call again for models that stream in after the first build.
function addBoilTo(o) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
  if (o.userData._gpDone) return;
  if (gpSkip.has(o) || gpBoilMats.includes(o.material)) return;
  if (!o.geometry?.attributes?.normal) return;
  // hero objects (the parked jet) opt IN to a contour no matter their size or
  // shape — it's a single instance, so the extra draws are cheap, and without
  // this its big fuselage mesh (>5k verts) and slab-thin wings get skipped and
  // it ends up the ONE thing in the scene with no ink around it.
  const force = !!o.userData._gpForce;
  const vcap = o.userData._gpThin ? 2500 : 5000;   // dense GLB panels: hull cost >> contour value
  if (!force && o.geometry.attributes.position.count > vcap) return;   // keep draws sane
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  const bb = o.geometry.boundingBox.getSize(new THREE.Vector3());
  const maxD = Math.max(bb.x, bb.y, bb.z), minD = Math.min(bb.x, bb.y, bb.z);
  // ground-like slabs (runway, decks, fields) get NO contour — a wobbling
  // outline around a flat sheet reads as scribble, not line art
  if (!force && minD < 0.13 && maxD > 3.0) return;
  o.userData._gpDone = true;
  // photoscan GLBs (cars, station, subway, jet) opt into THIN strokes: a light
  // single contour reads hand-drawn on dense decimated panels, where the heavy
  // hull + loose over-stroke turned them into dark scratches
  const thin = !!o.userData._gpThin;
  const mat = thin ? gpBoilLight : maxD > 2.2 ? gpBoilHeavy : maxD > 0.6 ? gpBoilMid : gpBoilLight;
  const line = new THREE.Mesh(o.geometry, mat);
  line.visible = gpOn;               // show at once if we're already drawn-mode
  o.add(line);                       // child: follows every transform for free
  gpOutlines.push(line);
  // buildings and props get the loose second stroke; small items stay clean
  if (!thin && (force || (maxD > 0.6 && o.geometry.attributes.position.count < 2200))) {
    const loose = new THREE.Mesh(o.geometry, gpBoilLoose);
    loose.visible = gpOn;
    o.add(loose);
    gpOutlines.push(loose);
  }
}
function buildGreasePencil() {
  if (gpBuilt) return; gpBuilt = true;
  scene.traverse(addBoilTo);
}
// ── the fills: cel-shaded, not flat. A two-step gradient map is the exact
// ColorRamp-set-to-Constant trick from the tutorial — one lit tone, one
// shade tone, hard edge between them.
const toonRamp = (() => {
  const data = new Uint8Array([120, 255]);          // shade, light
  const t = new THREE.DataTexture(data, 2, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
// ── hand-sketched surface detail, tiled per face: brick patches, plank
// grain, scratches — the interior linework that sells the drawn look
const sketchDetailTex = (() => {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
  const rr = mulberry32(41);
  c.strokeStyle = 'rgba(30,26,36,0.5)'; c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {                    // brick patches
    const x = rr() * S, y = rr() * S, w = 26 + rr() * 40, h = 12 + rr() * 14;
    c.lineWidth = 1.6 + rr() * 1.4;
    c.strokeRect(x, y, w, h);
    if (rr() > 0.5) c.strokeRect(x + w * 0.45, y - h, w * 0.6, h);
  }
  for (let i = 0; i < 34; i++) {                    // stray strokes + scratches
    const x = rr() * S, y = rr() * S, len = 12 + rr() * 46;
    const ang = rr() > 0.6 ? (rr() - 0.5) * 0.4 : Math.PI / 2 + (rr() - 0.5) * 0.3;
    c.lineWidth = 1.2 + rr() * 1.6;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    c.stroke();
  }
  for (let i = 0; i < 14; i++) {                    // little tick clusters
    const x = rr() * S, y = rr() * S;
    c.lineWidth = 1.1;
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.moveTo(x + k * 5, y);
      c.lineTo(x + k * 5 + 3, y + 7 + rr() * 5);
      c.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
// wood grain: long parallel strokes with knots — for trunks, decks, fences
const grainTex = (() => {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
  const rr = mulberry32(23);
  c.strokeStyle = 'rgba(40,26,16,0.42)'; c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const y = rr() * S, len = 90 + rr() * 260, x = rr() * S;
    c.lineWidth = 1.2 + rr() * 1.6;
    c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo(x + len / 2, y + (rr() - 0.5) * 14, x + len, y + (rr() - 0.5) * 8);
    c.stroke();
  }
  for (let i = 0; i < 6; i++) {                     // knots
    const x = rr() * S, y = rr() * S;
    c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(x, y, 7 + rr() * 6, 4 + rr() * 3, rr(), 0, 7); c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
// foliage veins: sparse little kicks and Vs — barely-there, never bricks
const leafTex = (() => {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
  const rr = mulberry32(31);
  c.strokeStyle = 'rgba(20,40,24,0.35)'; c.lineCap = 'round'; c.lineWidth = 1.6;
  for (let i = 0; i < 40; i++) {
    const x = rr() * S, y = rr() * S, l = 8 + rr() * 14, a = rr() * Math.PI;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
    if (rr() > 0.6) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a + 0.7) * l * 0.7, y + Math.sin(a + 0.7) * l * 0.7); c.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
// the marks a surface earns are decided by WHAT IT IS, not how big it is
const GP_DETAIL = { wall: () => sketchDetailTex, wood: () => grainTex, leaf: () => leafTex };
const flatCache = new Map();       // mat → { plain, detailed }
function flatOf(mat) {
  if (!mat || mat.isShaderMaterial) return mat;
  let pair = flatCache.get(mat);
  if (!pair) { pair = {}; flatCache.set(mat, pair); }
  const cat = mat.userData?.gp;
  const key = cat || 'plain';
  if (!pair[key]) {
    if (mat.map) {
      // the city floor and other textured sheets read as clean 2D art —
      // toon-shading them painted dark bands alongside every road
      pair[key] = new THREE.MeshBasicMaterial({
        map: mat.map, color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
        transparent: !!mat.transparent, opacity: mat.opacity ?? 1,
        side: mat.side ?? THREE.FrontSide,
      });
      return pair[key];
    }
    pair[key] = new THREE.MeshToonMaterial({
      color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
      // real maps always win; otherwise the material's TAG decides the marks:
      // wall→bricks, wood→grain, leaf→veins, untagged→clean
      map: mat.map || (GP_DETAIL[cat] && !mat.vertexColors && !mat.transparent ? GP_DETAIL[cat]() : null),
      gradientMap: toonRamp,
      vertexColors: !!mat.vertexColors,
      transparent: !!mat.transparent, opacity: mat.opacity ?? 1,
      side: mat.side ?? THREE.FrontSide,
    });
  }
  return pair[key];
}
function setGreasePencil(on) {
  if (on && !gpBuilt) buildGreasePencil();
  if (on === gpOn) return;
  gpOn = on;
  for (const l of gpOutlines) l.visible = on;
  scene.traverse(o => {
    if (!o.isMesh || gpBoilMats.includes(o.material)) return;
    if (on) {
      if (!o.userData._origMat) {
        o.userData._origMat = o.material;
        o.material = Array.isArray(o.material)
          ? o.material.map(m => flatOf(m))
          : flatOf(o.material);
      }
    } else if (o.userData._origMat) {
      o.material = o.userData._origMat;
      o.userData._origMat = null;
    }
  });
  sky.visible = !on;
  skyStars.visible = !on;
  scene.background = on ? new THREE.Color(0xf2efe7) : null;   // paper backdrop
}
// Bring a model that streamed in AFTER the first grease-pencil build into the
// drawn look: give its meshes boil contours, and if we're already in a drawn
// mode, swap them to flat fills right now (so a car isn't left shaded-3D in a
// scene full of ink). No-op until the player has visited a drawn mode once.
function gpRegister(root, boil = true) {
  // boil = add the inverted-hull contour(s). Skip it for photoscan cars/limo:
  // their decimated, multi-panel geometry turns the hull into dark "scratches"
  // all over the body. They still get the flat grease-pencil fills + the
  // Sketchbook screen-space ink, which read clean.
  if (gpBuilt && boil) root.traverse(addBoilTo);
  if (gpOn) root.traverse(o => {
    if (!o.isMesh || gpBoilMats.includes(o.material) || o.userData._origMat) return;
    o.userData._origMat = o.material;
    o.material = Array.isArray(o.material) ? o.material.map(flatOf) : flatOf(o.material);
  });
}


// ─── main loop ───────────────────────────────────────────────────────────────
const _occRay = new THREE.Raycaster();
const _swR = new THREE.Vector3(), _swM = new THREE.Matrix4();   // subway-interior temps
let _railR = null;   // low-passed rail ride height (train only)
const _oHead = new THREE.Vector3(), _oRay = new THREE.Vector3();
const clock = new THREE.Clock();
let introT = 0;
let navAcc = 0;
const BIRDSEYE = new URLSearchParams(location.search).get('birdseye') === '1';
let camZoom = parseFloat(localStorage.getItem('cam-zoom')) || 1.0;   // 0.5 close … 2.5 far
let camOrbit = 0;                                                    // radians around the character (yaw)
let camPitch = 0;                                                   // vertical orbit: -0.35 low … 1.05 top-down
// drag anywhere on the world to swing the camera around her — see her side / front
{
  const el = renderer.domElement;
  let dragging = false, lx = 0, ly = 0;
  el.addEventListener('pointerdown', e => { if (e.button === 0) { dragging = true; lx = e.clientX; ly = e.clientY; } });
  window.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('pointermove', e => {
    if (!dragging || gameState !== 'play') return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    camOrbit += dx * 0.006;
    camPitch = Math.max(-0.35, Math.min(1.05, camPitch - dy * 0.005));
  });
}
{
  const zs = document.getElementById('zoom-slider'), zv = document.getElementById('zoom-val');
  if (zs) {
    zs.value = camZoom;
    const showZoom = () => { if (zv) zv.textContent = camZoom.toFixed(1) + '×'; };
    showZoom();
    zs.addEventListener('input', () => { camZoom = parseFloat(zs.value); localStorage.setItem('cam-zoom', camZoom); showZoom(); });
  }
  const rl = document.getElementById('rot-left'), rr = document.getElementById('rot-right');
  rl?.addEventListener('click', () => { camOrbit -= Math.PI / 6; });
  rr?.addEventListener('click', () => { camOrbit += Math.PI / 6; });
  // Q / E also rotate
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ') camOrbit -= Math.PI / 12;
    if (e.code === 'KeyE') camOrbit += Math.PI / 12;
  });
}

// ── comfort mode: cut the sensory mismatch that causes sim sickness ──────────
// horizon lock + no camera bob + a turn-tunnel vignette (peripheral dimming, the
// same trick VR uses) + a fixed on-screen reference frame. On by default.
let comfort = localStorage.getItem('planet-comfort');
comfort = comfort === null ? true : comfort === '1';
const comfortBtn = document.getElementById('comfort-toggle');
const comfortFx = document.getElementById('comfort-fx');
function applyComfort() {
  if (comfortBtn) comfortBtn.textContent = comfort ? '🟢 comfort: on' : '⚪ comfort: off';
  document.body.classList.toggle('comfort', comfort);
  if (!comfort && comfortFx) comfortFx.style.opacity = '0';
}
comfortBtn?.addEventListener('click', () => {
  comfort = !comfort;
  localStorage.setItem('planet-comfort', comfort ? '1' : '0');
  applyComfort();
});
applyComfort();
let vignetteA = 0;                 // smoothed turn-tunnel strength
let orbitPrev = 0;                 // last camOrbit, to detect rotate pulses
const _headPrev = new THREE.Vector3(1, 0, 0);
{
  const _qs = new URLSearchParams(location.search);
  if (_qs.get('title') === '0') {
    document.body.classList.remove('title-mode');
    titleEl.classList.add('hide'); title3D.visible = false;
    const tp = _qs.get('transport');
    beginRun(tp && TRANSPORT[tp] ? tp : 'jeep');
    // ?launch=1 rides from the pad; ?launch=0.5 seeks into the flight (dev)
    const lp = _qs.get('launch');
    if (lp !== null) { startLaunch(); launchT = Math.min(0.99, parseFloat(lp) || 0); }
    if (_qs.get('sail') === '1') boardBoat();
  } else if (_qs.get('arrival') !== null) {
    startArrival();                 // ?arrival=1 plays; ?arrival=0.65 seeks (dev)
    const av = parseFloat(_qs.get('arrival'));
    if (av > 0 && av < 1) arrivalT = av;
  } else if (_qs.get('gps')) {
    document.body.classList.remove('title-mode');
    titleEl.classList.add('hide'); title3D.visible = false;
    enterPhone();                   // jump straight to the phone (testing)
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
  if (gpOn) scene.fog.color.setHex(0xe8e4da);   // paper haze
  else scene.fog.color.copy(_fogNight).lerp(_fogDay, dayK);
  skyStars.material.opacity = 0.15 + 0.75 * (1 - dayK);
  lampBulbMat.emissiveIntensity = 0.5 + (1 - dayK) * 1.9;
  // downtown windows come on after dark
  const winGlow = (1 - dayK) * 1.15;
  for (const m of cityWindowMats) m.emissiveIntensity = winGlow;

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

  // downtown lives: cars run their lanes, people walk the kerb
  const _tPos = new THREE.Vector3(), _tNext = new THREE.Vector3(), _tRight = new THREE.Vector3();
  const _tM = new THREE.Matrix4();
  for (const v of traffic) {
    // slow for whatever is in front: the player, or the vehicle ahead
    let block = 1;
    if (v.pos) {
      const gap = dir.angleTo(v.pos) * R;
      if (gap < 2.2) block = Math.max(0, (gap - 0.9) / 1.3);
      for (const o of traffic) {
        if (o === v || o.kind !== v.kind || !o.pos) continue;
        if (Math.abs(o.t - v.t) > 0.08) continue;             // same stretch of road
        const ahead = o.pos.angleTo(v.pos) * R;
        if (ahead < 1.8 && o.t > v.t) block = Math.min(block, Math.max(0, (ahead - 0.8) / 1.0));
      }
    }
    v.t += v.speed * dt * block;
    if (v.t > 1) v.t -= 1;
    const d = slerpDir(v.a, v.b, v.t);
    v.pos = d;
    const dn = slerpDir(v.a, v.b, (v.t + 0.004) % 1);
    _tPos.copy(d).multiplyScalar(Math.max(radiusAt(d), SEA_R) + (v.kind === 'car' ? 0.09 : 0.10));
    _tNext.copy(dn).sub(d.clone().multiplyScalar(d.dot(dn))).normalize();
    _tRight.crossVectors(d, _tNext);
    _tM.makeBasis(_tRight, d, _tNext);
    v.obj.position.copy(_tPos);
    v.obj.quaternion.setFromRotationMatrix(_tM);
    if (v.kind === 'ped') {                       // walk cycle + a little bounce
      v.obj.position.addScaledVector(d, Math.abs(Math.sin(t * 6 + v.phase)) * 0.05);
      walkPerson(v.obj, t + v.phase, 0.5 * block);
    }
    // NOTE: no tyre-spin — the wheel meshes share the car's origin, so rotating
    // them flings the wheel around that origin (it flies off). The drawn-mode
    // look already sells motion; a proper spin needs re-centred wheel pivots.
  }

  for (let i = 0; i < bobbers.length; i++) {          // boats rock at their moorings
    const b = bobbers[i];
    b.rotation.z = Math.sin(t * 1.1 + i) * 0.05;
    b.rotation.x = Math.sin(t * 0.8 + i * 2) * 0.035;
  }

  if (gpOn) for (const m of gpBoilMats) m.uniforms.time.value = t;

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
  renderer.shadowMap.needsUpdate = (++_shFrame & 1) === 0;   // 30Hz shadows

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

  // the arrival cinematic: plane lands, Uber to the hotel, check in
  if (gameState === 'arrival') {
    updateArrival(dt);
    updateWorldAmbient(dt, t);
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
    updateTitle3D(dt);
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
    const off = heading.clone().multiplyScalar(-Math.cos(orbit) * 8.5)
      .addScaledVector(_right, Math.sin(orbit) * 8.5);
    // slide the eye sideways so the critic sits clear of the phone, not behind it
    off.addScaledVector(_right, -3.1);
    flyCameraTo(courier.position.clone().addScaledVector(dir, 4.2).add(off), 0.05, 2.2);
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

  _headPrev.copy(heading);           // comfort: snapshot to measure turn rate
  const spd0 = speed;
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
      // pressing straight BACK aims exactly opposite the heading, and lerping
      // a unit vector toward its own negation passes through zero — normalize
      // can never flip it, which is why reverse never worked. When the target
      // is behind us, swing around the local up at a steady rate instead.
      if (heading.dot(_desired) < -0.72) {
        heading.applyAxisAngle(dir, 3.0 * dt).normalize();
        speed = Math.max(1.2, speed * (1 - dt * 2.2));   // slow through the U-turn
      } else {
        heading.lerp(_desired, turnK).normalize();
        speed = Math.min(TR.max, speed + TR.accel * dt);
      }
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
      collideBVH();
      collideTraffic();
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

  // comfort: drive the turn-tunnel vignette from how hard we're turning/accelerating.
  // dimming the periphery cuts the vection (illusory self-motion) that sickens.
  {
    const invDt = 1 / Math.max(dt, 1e-3);
    const turnRate = _headPrev.angleTo(heading) * invDt;
    const accel = Math.max(0, speed - spd0) * invDt;
    const orbitRate = Math.abs(camOrbit - orbitPrev) * invDt; orbitPrev = camOrbit;
    const vTarget = comfort
      ? Math.min(0.5, turnRate * 0.18 + orbitRate * 0.10 + accel * 0.010)
      : 0;
    // rise fast when a turn starts, ease back out slowly
    vignetteA += (vTarget - vignetteA) * Math.min(1, dt * (vTarget > vignetteA ? 7 : 3));
    if (comfortFx) comfortFx.style.opacity = vignetteA.toFixed(3);
  }

  // ride-height bob: suspension for wheels, a light step for the walker.
  // comfort mode nearly flattens it — bob is a top vestibular-mismatch trigger.
  const bobK = comfort ? 0.12 : 1;
  const bob = (transport === 'walk'
    ? Math.abs(Math.sin(t * 9)) * 0.07 * (speed / TR.max)
    : Math.sin(t * 8.5) * 0.03 * (0.3 + speed / TR.max)) * bobK;
  const groundR = Math.max(radiusAt(dir), SEA_R);
  // rails are graded: the roadbed doesn't follow every terrain ripple, and a
  // subway car doesn't shiver like an engine — low-pass the radius hard and
  // drop the bob so the inside-the-car ride reads glass-smooth
  let rideR = groundR + TR.hover + bob;
  if (TR.rail) {
    _railR = _railR == null ? groundR : THREE.MathUtils.lerp(_railR, groundR, 1 - Math.exp(-dt * 2.5));
    rideR = _railR + TR.hover;
  } else _railR = null;
  courier.position.copy(dir.clone().multiplyScalar(rideR));
  _right.crossVectors(dir, heading);
  _m.makeBasis(_right, dir, heading);
  _q.setFromRotationMatrix(_m);
  courier.quaternion.slerp(_q, 1 - Math.pow(0.001, dt));
  const leanS = comfort ? 0.45 : 1;   // comfort: trim body sway that reads as camera roll
  const leanK = (transport === 'bike' ? 0.22 : transport === 'jeep' ? 0.12 : 0) * leanS;
  courierBody.rotation.z = THREE.MathUtils.lerp(courierBody.rotation.z, -ix * leanK, 0.09);
  courierBody.rotation.x = THREE.MathUtils.lerp(courierBody.rotation.x, iz * 0.07 * (speed / TR.max) * leanS, 0.09);
  for (const w of courierBody.userData.wheels) w.rotation.x += dt * speed / (transport === 'bike' ? 0.85 : 0.34);
  // the rigged critic: walking & biking pump with ground speed; seated rides
  // (jeep/boat/train) and mount/dismount intros play at their own steady rate
  const critic = CRITIC.insts[transport];
  if (critic) {
    if (transport === 'walk' && !critic.intro) {
      // fully procedural, constrained walk (no baked clip)
      procWalk(critic, dt, Math.min(1, speed / TR.max));
    } else {
      let ts = 1;
      if (!critic.intro && transport === 'bike') {
        const gait = Math.min(1, speed / TR.max);
        ts = gait > 0.04 ? (0.45 + gait * 1.6) * 0.55 : 0;   // unhurried pedalling, freeze when stopped
      }
      if (critic.cur) critic.cur.timeScale = ts;
      critic.mixer.update(dt);
    }
  } else {
    courierBody.traverse(o => { if (o.userData && o.userData.limbs) walkPerson(o, t * 1.3, Math.min(1, speed / TR.max) * 0.9); });
  }

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

  if (BIRDSEYE) {
    camera.position.copy(posOn(DOWNTOWN, 46));
    camera.up.set(0, 1, 0);
    camera.lookAt(posOn(DOWNTOWN, 0));
  } else if (transport === 'train' && subwayInt) {
  // RIDING THE EXPRESS FROM INSIDE: the subway car interior wraps the camera.
  // The wrapper rides the courier's transform, the eye sits at seat height in
  // the aisle looking down the car, and the world streams past the windows.
  subwayInt.visible = true;
  courierBody.visible = false;               // don't clip the exterior train shell
  subwayInt.position.copy(courier.position);
  _swR.crossVectors(dir, heading);
  _swM.makeBasis(_swR, dir, heading);
  subwayInt.quaternion.setFromRotationMatrix(_swM);
  camera.position.copy(courier.position).addScaledVector(dir, 1.05).addScaledVector(heading, -0.6);
  camera.up.lerp(dir, 0.3).normalize();
  camera.lookAt(courier.position.clone().addScaledVector(heading, 4).addScaledVector(dir, 0.9));
  } else {
  // chase camera — user zoom scales the distance, user orbit swings it around
  introT = Math.min(1, introT + dt / 2.6);
  const ease = introT * introT * (3 - 2 * introT);
  // heading rotated by the orbit angle, around the local up (dir); camPitch
  // raises/lowers the eye so you can drag up to look down on her, or down to
  // see her face — pitch 0 keeps the original over-the-shoulder framing
  const behind = heading.clone().applyAxisAngle(dir, camOrbit);
  const bd = TR.camD * camZoom;
  const camPos = courier.position.clone()
    .addScaledVector(dir, TR.camH * (0.6 + camZoom * 0.4) + bd * Math.sin(camPitch))
    .addScaledVector(behind, -bd * Math.cos(camPitch));
  flyCameraTo(camPos, (0.02 + 0.05 * ease), 0.9);
  // comfort: snap the up-vector to the planet normal harder so the horizon stays
  // level (no camera roll) — the artificial-horizon trick motion-sickness glasses use.
  camera.up.lerp(dir, comfort ? 0.14 : 0.06).normalize();
  camera.lookAt(courier.position.clone().addScaledVector(dir, 1.1));
  }

  updateWorldAmbient(dt, t);

  // stepping off the Express (any state — dialog, phone, cinematic): put the
  // interior away and show the courier again. Unconditional so no path leaves
  // the subway car parked visibly in the world.
  if (transport !== 'train' && subwayInt && subwayInt.visible) {
    subwayInt.visible = false;
    courierBody.visible = true;
  }

  // walk into Central Station → board the Express. The trigger arms only once
  // you're properly outside (>4 units), so stepping OFF the train doesn't
  // instantly re-board you in a loop.
  if (transport === 'walk' && gameState === 'play' && !dlgOpen && stationG) {
    // the boarding zone is the PLATFORM EDGE — the strip between the station
    // hall and the rails. Coming from the city you physically cross the hall
    // to reach it, so boarding reads as walking through the station.
    if (!window._boardDir) {
      const sd = stationG.position.clone().normalize();
      window._boardDir = slerpDir(sd, STOP_DIRS.central, 0.65);
    }
    const stArc = dir.angleTo(window._boardDir) * R;
    if (stArc > 3.0) window._stationArmed = true;
    else if (stArc < 0.9 && window._stationArmed) {
      window._stationArmed = false;
      showToast('🚇 Through the station hall — all aboard the Museum Express');
      switchRide('train');
    }
  }

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
    p.userData.head.position.y = 0.94 + Math.sin(t * 2 + ph) * 0.02;
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
    rtNormal.setSize(Math.ceil(w / 2), Math.ceil(h / 2));   // edge pass stays half-res
    inkQuad.material.uniforms.res.value.set(w, h);
  }
});

// ─── collision: one merged BVH over every building, precise per-triangle ─────
let collisionMesh = null;
function buildCollisionBVH() {
  scene.updateMatrixWorld(true);
  // EVERYTHING gets physics, not just buildings: trees, lamps, benches, signs,
  // fences, rocks, stations, the moored boat, the rocket, the standing crowd.
  // Skip only things too small or too flat to bump (flowers, rail ties, roads).
  const _bb = new THREE.Box3(), _sz = new THREE.Vector3();
  for (const child of deco.children) {
    _bb.setFromObject(child); _bb.getSize(_sz);
    const tall = Math.max(_sz.x, _sz.y, _sz.z);
    const thin = Math.min(_sz.x, _sz.y, _sz.z);
    if (tall < 0.45) continue;              // flowers, pebbles
    if (tall > 0.8 && thin < 0.09 && !child.isGroup) continue;   // rail ties, planks
    collidables.push(child);
  }
  // central is NOT collidable: you walk through the station hall to board the
  // train (and its GLB replacement streams in after this BVH is baked anyway)
  for (const k of Object.keys(stopStructures)) if (k !== 'central') collidables.push(stopStructures[k]);
  if (typeof mooredBoat !== 'undefined' && mooredBoat) collidables.push(mooredBoat);
  if (typeof rocketG !== 'undefined' && rocketG) collidables.push(rocketG);
  for (const p of npcs) collidables.push(p);
  const geos = [];
  for (const grp of collidables) {
    grp.updateWorldMatrix(true, true);
    grp.traverse(m => {
      if (!m.isMesh || !m.geometry?.attributes?.position) return;
      let bg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      const pos = bg.getAttribute('position').clone();
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', pos);
      ng.applyMatrix4(m.matrixWorld);      // bake world transform, position-only
      geos.push(ng);
    });
  }
  if (!geos.length) return;
  const merged = mergeGeometries(geos, false);
  merged.computeBoundsTree();
  collisionMesh = new THREE.Mesh(merged);
  collisionMesh.matrixAutoUpdate = false;
  camOccluders.push(collisionMesh);
  if (new URLSearchParams(location.search).get('debug') === '1')
    console.log('[bvh] collision tris:', merged.attributes.position.count / 3);
}
// push the character out of any building it overlaps, along the surface
const _cS = new THREE.Sphere(), _cCP = new THREE.Vector3(), _cPush = new THREE.Vector3(), _cN = new THREE.Vector3();
const _cCenter = new THREE.Vector3();
function collideBVH() {
  if (!collisionMesh) return;
  const rad = transport === 'walk' ? 0.42 : 0.72;
  _cCenter.copy(dir).multiplyScalar(Math.max(radiusAt(dir), SEA_R) + TRANSPORT[transport].hover + 0.35);
  _cS.center.copy(_cCenter); _cS.radius = rad;
  _cPush.set(0, 0, 0); let hits = 0;
  collisionMesh.geometry.boundsTree.shapecast({
    intersectsBounds: box => box.intersectsSphere(_cS),
    intersectsTriangle: tri => {
      tri.closestPointToPoint(_cS.center, _cCP);
      const dist = _cCP.distanceTo(_cS.center);
      if (dist < _cS.radius && dist > 1e-5) {
        _cN.subVectors(_cS.center, _cCP).normalize();
        _cPush.addScaledVector(_cN, _cS.radius - dist);
        hits++;
      }
    },
  });
  if (hits) {
    _cCenter.add(_cPush);
    dir.copy(_cCenter).normalize();                       // slide around the wall
    heading.sub(dir.clone().multiplyScalar(heading.dot(dir))).normalize();
    speed *= 0.55;
    targetDir = null;                                     // cancel autopilot into a wall
  }
}

// ─── go ──────────────────────────────────────────────────────────────────────
applyGfx();
applyVibe();
updateQuestHUD();
updateNav();
updateNoteBadge();
if (new URLSearchParams(location.search).get('debug') === '1') {
  let meshes = 0, tris = 0;
  scene.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const idx = o.geometry.index;
    const n = (idx ? idx.count : o.geometry.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });
  console.log(`[perf] meshes=${meshes} tris=${Math.round(tris)} buildMs=${Math.round(performance.now())}`);
}
try { buildCollisionBVH(); } catch (e) { console.warn('BVH build skipped:', e.message); }
progress(1, 'ready!');
animate();
setTimeout(() => loaderEl.classList.add('hide'), 450);
