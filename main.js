import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// cache-buster — bump on every asset change so the browser never serves a stale
// GLB / JSON / image. (.glb especially caches hard across normal refreshes.)
const ASSET_VERSION = 'v25';
const bust = (url) => url + (url.includes('?') ? '&' : '?') + 'cb=' + ASSET_VERSION;

// ─── config ──────────────────────────────────────────────────────────────────
const SHELF_WIDTH = 16;
const SHELF_DEPTH = 1.6;
const SHELF_THICKNESS = 0.34;       // matches Blender shelf plank thickness
const ROW_HEIGHT = 3.83;            // 3 tall rows fill the ~11.8m shelf
const NUM_ROWS = 3;

// chunky, easy-to-click book proportions (meters in scene scale)
const BOOK_DEPTH = 1.3;            // how far book sticks into shelf
const BOOK_THK_MIN = 0.5;          // spine thickness — wide = big click target
const BOOK_THK_MAX = 0.95;
const BOOK_HEIGHT_MIN = 2.7;
const BOOK_HEIGHT_MAX = 3.3;
const BOOK_GAP = 0.08;
const SECTION_GAP = 0.6;           // gap between tag clusters in same row

const TAG_PALETTE = {
  site:      0x4e8eff,
  ai:        0xb265ff,
  cad:       0xff8a3d,
  ml:        0x2dd47b,
  robotics:  0xff4d6e,
  game:      0xffd23d,
  tool:      0x33c9ff,
  edu:       0xe8a350,
  hackathon: 0xff6b2e,
  hobby:     0xff7eb6,
  profile:   0xb5c3d2,
  misc:      0x9ca3af,
};

// row 0 = bottom, row 2 = top. Books assigned to shelves by explicit name.
const SHELF_PLAN = [
  { label: 'research & ML', code: '000', names: [
    'senior-design','RL_Tutorial','ros2_depth_camera_tutorial','qnx_materials',
    'autonomy','autonomous_machines','AnimalFinder','computer_vision',
    'deepracer-analysis','OSDC22-XGBoost','hackathon2022','neo4j_hack' ] },
  { label: 'product demos', code: '500', names: [
    'inbox-zero-board','charterscope','html','portfolio','crochet',
    'pptgpt','agentsannonymous','brain-university' ] },
  { label: 'experiments', code: '900', names: [
    'cadme','caddy','cadme-10k','caddy-query','sketchy','cq_dataset','beanbots',
    'maze','Half-life-3','stencil','jobapp','fitter','role-radar','neovert',
    'processchamp','hashigo','ghanemja.github.io','ghanemja','project' ] },
];

const OUTLINE_COLOR = 0x1a1410;
const OUTLINE_SCALE = 1.025;

// ─── scene ───────────────────────────────────────────────────────────────────
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2e6cf);
// no fog — it washed the mid-room to a cream haze (esp. at night). Room is
// enclosed; depth cueing comes from lighting, not fog.

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);

// fit ROOM to viewport — 3/4 cinematic angle
const ROOM_FIT_W = 46 + 2.0;
const ROOM_FIT_H = 14 + 1.0;
const ROOM_CENTER_Y = 6.0;

function fitCameraToShelf() {
  const aspect = window.innerWidth / window.innerHeight;
  const fov = camera.fov * Math.PI / 180;
  const distForH = (ROOM_FIT_H / 2) / Math.tan(fov / 2);
  const distForW = (ROOM_FIT_W / 2) / (aspect * Math.tan(fov / 2));
  // generous padding — room comfortably fits w/ breathing space
  const d = Math.max(distForH, distForW) + 8;
  camera.position.set(0, ROOM_CENTER_Y + 1.5, d);
  camera.lookAt(0, ROOM_CENTER_Y, 0);
}
fitCameraToShelf();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// cinematic tone mapping for realism
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, ROOM_CENTER_Y, 0);
// allow LIMITED orbit so user can look around
controls.enableRotate = true;
controls.enablePan = false;
controls.minDistance = 8;
controls.maxDistance = 55;
controls.minPolarAngle = Math.PI * 0.26;
controls.maxPolarAngle = Math.PI * 0.56;
// wide swing so the user can look around the whole room
controls.minAzimuthAngle = -Math.PI * 0.55;
controls.maxAzimuthAngle =  Math.PI * 0.55;

// named camera framings
const VIEW_LANDING = { pos: new THREE.Vector3(0, 8.5, 42), tgt: new THREE.Vector3(0, 6, -1) };
const VIEW_SHELF   = { pos: new THREE.Vector3(0, 6.6, 21), tgt: new THREE.Vector3(0, 6.6, -1) };
// start on the wide landing view (whole room)
camera.position.copy(VIEW_LANDING.pos);
controls.target.copy(VIEW_LANDING.tgt);
camera.lookAt(controls.target);

// ─── toon gradient ───────────────────────────────────────────────────────────
function makeToonGradient() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 1;
  const ctx = c.getContext('2d');
  ['#5a4a36', '#a08664', '#d9c8a4', '#fff5e0'].forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(i, 0, 1, 1);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
const TOON_GRADIENT = makeToonGradient();

function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...opts });
}

// ─── lights ──────────────────────────────────────────────────────────────────
// softer, balanced — avoids blown-out cream walls. Intensities tuned down.
const hemi = new THREE.HemisphereLight(0xffe2b5, 0x6b4a30, 0.45);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffd095, 1.1);
sun.position.set(-18, 14, 8);   // from left window angle
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0008;
scene.add(sun);

const fillRight = new THREE.DirectionalLight(0x9fc4f0, 0.18);
fillRight.position.set(12, 9, 4);
scene.add(fillRight);

// pendant lamp pool — over reading chair, Blender (-10.5, -17, 10) → three.js (-10.5, 10, 17)
// pendant over the reading chair — hangs lower now (Blender bulb z≈5.8)
const pendantLight = new THREE.PointLight(0xffce93, 2.0, 26, 1.4);
pendantLight.position.set(-14.4, 5.8, 22);
pendantLight.castShadow = false;
scene.add(pendantLight);
// glowing bulb so the lamp visibly emits
const pendantGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.45, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xfff0c8 })
);
pendantGlow.position.copy(pendantLight.position);
scene.add(pendantGlow);

// floor lamp next to the easel — Blender bulb (20.6,-3.5,7.4) → three.js (20.6, 7.4, 3.5)
const easelLamp = new THREE.PointLight(0xffd9a0, 1.6, 22, 1.5);
easelLamp.position.set(20.6, 7.4, 3.5);
scene.add(easelLamp);
const easelLampGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 14, 10),
  new THREE.MeshBasicMaterial({ color: 0xfff0c8 })
);
easelLampGlow.position.copy(easelLamp.position);
scene.add(easelLampGlow);

// floor + walls live in the GLB room model — no procedural floor here

// ─── spine texture ───────────────────────────────────────────────────────────
function makeSpineTexture(name, baseColor, era = 'paired') {
  const w = 512, h = 2048;                 // hi-res for crisp, big spine text
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = `#${baseColor.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0)');
  grad.addColorStop(0.85, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // era stripe at very top — solo = black, paired = orange
  ctx.fillStyle = era === 'paired' ? '#ff6b2e' : '#1a1410';
  ctx.fillRect(0, 0, w, 72);

  // gold bands
  ctx.fillStyle = '#ffd966';
  ctx.fillRect(0, 150, w, 14);
  ctx.fillRect(0, h - 160, w, 14);

  // title rotated vertically — BIG, fits the wide spine; auto-shrink to fit length
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontPx = 210;
  const maxLen = h - 420;                   // available length along the spine
  ctx.font = `600 ${fontPx}px "Fredoka", "Trebuchet MS", system-ui, sans-serif`;
  while (ctx.measureText(name).width > maxLen && fontPx > 90) {
    fontPx -= 8;
    ctx.font = `600 ${fontPx}px "Fredoka", "Trebuchet MS", system-ui, sans-serif`;
  }
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.fillStyle = '#fff8e6';
  ctx.strokeText(name, 0, 0);
  ctx.fillText(name, 0, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ─── page texture: left=sectioned content, right=screenshot + visit ──────────
// returns { texture, updateWhenImageLoads } — texture has placeholder right page
// until repo.screenshot loads, then updates in place.
// hosted (live) URL — what the CTA links to. Falls back to repo only if none.
function hostedUrl(repo) { return repo.url || null; }

function makePageTexture(repo) {
  // high-res canvas → crisp text on the 3D page plane
  const w = 2000, h = 1280;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  function redraw(screenshotImg) {
    ctx.fillStyle = '#fbf5e2';
    ctx.fillRect(0, 0, w, h);

    // center binding crease
    const bind = ctx.createLinearGradient(w/2 - 70, 0, w/2 + 70, 0);
    bind.addColorStop(0, 'rgba(0,0,0,0)');
    bind.addColorStop(0.5, 'rgba(0,0,0,0.20)');
    bind.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bind;
    ctx.fillRect(w/2 - 70, 0, 140, h);

    const tagColor = TAG_PALETTE[repo.tag] || TAG_PALETTE.misc;
    const tagHex = `#${tagColor.toString(16).padStart(6, '0')}`;
    const FONT = '"Fredoka", "Trebuchet MS", system-ui, sans-serif';

    // ─── LEFT PAGE ────────────────────────────────────────────
    const lx = 110, lw = w/2 - 200;
    let y = 130;

    ctx.fillStyle = tagHex;
    ctx.fillRect(lx, y - 36, 110, 12);
    ctx.fillStyle = '#6b5840';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(`${repo.tag.toUpperCase()}`, lx + 128, y - 24);

    ctx.fillStyle = '#2d2118';
    ctx.font = `700 80px ${FONT}`;
    y += 40;
    y = wrapText(ctx, repo.name, lx, y, lw, 84) + 30;

    // era badge
    const isPaired = repo.era === 'paired';
    const badgeText = isPaired ? 'CLAUDE-PAIRED' : 'SOLO · HAND-CODED';
    ctx.font = `700 26px ${FONT}`;
    const bw = ctx.measureText(badgeText).width + 44;
    ctx.fillStyle = isPaired ? '#ff6b2e' : '#2d2118';
    roundRect(ctx, lx, y, bw, 50, 25); ctx.fill();
    ctx.fillStyle = '#fff8e8';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, lx + 22, y + 26);
    ctx.textBaseline = 'alphabetic';
    y += 80;

    // section helper — BIG readable type
    function section(heading, body) {
      if (!body) return;
      ctx.fillStyle = tagHex;
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText(heading.toUpperCase(), lx, y);
      y += 40;
      ctx.fillStyle = '#3d2f1f';
      ctx.font = `400 33px ${FONT}`;
      y = wrapText(ctx, body, lx, y, lw, 42) + 34;
    }
    section('what it does', repo.description);
    section('how it works', repo.howItWorks);
    section('moat',         repo.moat);
    section('when to use',  repo.whenToUse);
    section("what's next",  repo.future);

    // ─── RIGHT PAGE: screenshot + CTA ─────────────────────────
    const rx = w/2 + 110, rw = w/2 - 220;
    const shotX = rx, shotY = 120, shotW = rw, shotH = h * 0.50;
    ctx.fillStyle = '#f0e4cc';
    ctx.fillRect(shotX - 10, shotY - 10, shotW + 20, shotH + 20);
    ctx.strokeStyle = '#2d2118';
    ctx.lineWidth = 5;
    ctx.strokeRect(shotX - 10, shotY - 10, shotW + 20, shotH + 20);

    if (screenshotImg && screenshotImg.complete && screenshotImg.naturalWidth > 0) {
      const imgRatio = screenshotImg.naturalWidth / screenshotImg.naturalHeight;
      const frameRatio = shotW / shotH;
      let dW, dH;
      if (imgRatio > frameRatio) { dW = shotW; dH = shotW / imgRatio; }
      else { dH = shotH; dW = shotH * imgRatio; }
      ctx.drawImage(screenshotImg, shotX + (shotW - dW)/2, shotY + (shotH - dH)/2, dW, dH);
    } else {
      const g = ctx.createLinearGradient(shotX, shotY, shotX + shotW, shotY + shotH);
      g.addColorStop(0, tagHex); g.addColorStop(1, '#fff8e6');
      ctx.fillStyle = g; ctx.fillRect(shotX, shotY, shotW, shotH);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `700 44px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('preview coming soon', shotX + shotW/2, shotY + shotH/2);
      ctx.textAlign = 'left';
    }

    const live = hostedUrl(repo);
    // caption — show the live host
    ctx.fillStyle = '#6b5840';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(live ? live.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'not deployed yet',
                 rx, shotY + shotH + 56);

    // CTA button — big, always the LIVE site
    const btnY = h - 320, btnH = 96, btnW = rw;
    ctx.fillStyle = tagHex;
    roundRect(ctx, rx, btnY, btnW, btnH, 18); ctx.fill();
    ctx.fillStyle = '#fff8e8';
    ctx.font = `600 40px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(live ? 'visit live site  →' : 'not deployed yet', rx + btnW/2, btnY + 62);
    ctx.textAlign = 'left';

    // secondary line
    ctx.fillStyle = '#8a7660';
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(live ? 'opens the deployed app' : 'no public deployment', rx, btnY + btnH + 52);

    ctx.fillStyle = '#a89880';
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText('press × or click outside to close', rx, h - 90);
  }

  redraw(null);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  if (repo.screenshot) {
    const img = new Image();
    img.onload = () => { redraw(img); tex.needsUpdate = true; };
    img.src = `./screenshots/${repo.screenshot}`;
  }
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lh) {
  if (!text) return y;
  const words = String(text).split(' ');
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line + words[i] + ' ';
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, y);
      line = words[i] + ' ';
      y += lh;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, y);
  return y;
}

// ─── outline (invert-hull) ───────────────────────────────────────────────────
function addOutline(mesh, parent) {
  const outlineMat = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR, side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(mesh.geometry, outlineMat);
  outline.scale.copy(mesh.scale).multiplyScalar(OUTLINE_SCALE);
  outline.position.copy(mesh.position);
  outline.rotation.copy(mesh.rotation);
  outline.userData.isOutline = true;
  parent.add(outline);
  return outline;
}

function outlineGroupMeshes(group) {
  const meshes = [];
  group.traverse(o => { if (o.isMesh && !o.userData.isOutline) meshes.push(o); });
  meshes.forEach(m => addOutline(m, m.parent));
}

// ─── book as Group (cover + spine + pages + interior) ────────────────────────
// local frame:
//   X: spine → fore-edge  (book width / depth in shelf)
//   Y: bottom → top
//   Z: back-cover → front-cover (thickness direction)
// Spine sits on -X face. Front cover swings open around the -X edge.
function makeBookGroup(repo, thickness, height, depth) {
  const group = new THREE.Group();
  group.userData.repo = repo;
  group.userData.type = 'book';

  const tagColor = TAG_PALETTE[repo.tag] || TAG_PALETTE.misc;
  const c = new THREE.Color(tagColor);
  c.offsetHSL(0, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12);
  const baseHex = c.getHex();

  const coverMat = toonMat(baseHex);
  const pagesMat = toonMat(0xfff1d0);
  const spineMat = toonMat(0xffffff, { map: makeSpineTexture(repo.name, baseHex, repo.era) });

  const W = depth;        // book's local X span (width when laid flat)
  const H = height;       // local Y
  const T = thickness;    // local Z (spine thickness)
  const COVER_T = 0.035;
  const SPINE_T = 0.04;

  // back cover at -Z face
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, COVER_T),
    coverMat
  );
  back.position.z = -T/2 + COVER_T/2;
  back.castShadow = true; back.receiveShadow = true;
  group.add(back);

  // interior page block (slightly inset)
  const pageBlock = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.03, H - 0.04, T - 2*COVER_T - 0.02),
    pagesMat
  );
  pageBlock.castShadow = true; pageBlock.receiveShadow = true;
  group.add(pageBlock);

  // spine on -X face
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(SPINE_T, H, T),
    spineMat
  );
  spine.position.x = -W/2 + SPINE_T/2;
  spine.castShadow = true; spine.receiveShadow = true;
  group.add(spine);

  // front cover — pivot at spine edge so it rotates open like a real book
  const coverPivot = new THREE.Group();
  coverPivot.position.set(-W/2 + SPINE_T, 0, T/2 - COVER_T/2);
  group.add(coverPivot);

  const front = new THREE.Mesh(
    new THREE.BoxGeometry(W - SPINE_T, H, COVER_T),
    coverMat
  );
  front.position.x = (W - SPINE_T) / 2;   // extend +X from pivot
  front.castShadow = true; front.receiveShadow = true;
  coverPivot.add(front);

  // raycast hitbox — generous (wider thickness + taller + bulges toward camera)
  // so thin spines are still an easy click target. opacity 0 (not visible:false,
  // which would skip raycasts).
  const hitGeom = new THREE.BoxGeometry(W, H * 1.06, T + 0.3);
  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false,
  });
  const hitbox = new THREE.Mesh(hitGeom, hitMat);
  hitbox.position.z = 0.15;   // bulge forward toward the viewer
  hitbox.userData.bookGroup = group;
  group.add(hitbox);
  group.userData.hitbox = hitbox;

  group.userData.coverPivot = coverPivot;
  group.userData.openAmount = 0;
  group.userData.dims = { W, H, T };

  return group;
}

// ─── shared overlay book: shown when a book is opened ────────────────────────
// PARENTED TO CAMERA — always at same screen-space position regardless of orbit.
const overlayGroup = new THREE.Group();
overlayGroup.visible = false;
scene.add(camera);                       // camera must be in scene graph for children to render
camera.add(overlayGroup);
overlayGroup.position.set(0, 0, -7);   // dead-center in front of camera
// no rotation needed — overlay's local +Z faces camera's local -Z direction... wait,
// since overlay is child of camera, overlay's local axes are camera's local axes.
// Camera looks down its own -Z. Overlay at z=-7 is in front. Overlay's +Z face
// points back toward camera (since overlay center is at z=-7 and camera at z=0
// in this local frame). Plane geometry default normal is +Z so spread plane faces camera. ✓

const OVERLAY_BOOK_W = 6.4;   // visible size of opened book in viewport
const OVERLAY_BOOK_H = 4.1;
const OVERLAY_SPINE_T = 0.18;

const overlayBackCover = new THREE.Mesh(
  new THREE.BoxGeometry(OVERLAY_BOOK_W, OVERLAY_BOOK_H, 0.05),
  toonMat(0xffffff)
);
overlayBackCover.position.z = -0.04;
overlayGroup.add(overlayBackCover);

const overlaySpine = new THREE.Mesh(
  new THREE.BoxGeometry(OVERLAY_SPINE_T, OVERLAY_BOOK_H, 0.06),
  toonMat(0xffffff)
);
overlaySpine.position.set(0, 0, -0.02);
overlayGroup.add(overlaySpine);

const overlaySpread = new THREE.Mesh(
  new THREE.PlaneGeometry(OVERLAY_BOOK_W - 0.1, OVERLAY_BOOK_H - 0.15),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, side: THREE.DoubleSide })
);
overlaySpread.position.z = 0.005;
overlayGroup.add(overlaySpread);

// invisible link hitboxes on the overlay spread
function mkOverlayLink(label, xFrac, yFrac, wFrac, hFrac) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry((OVERLAY_BOOK_W - 0.1) * wFrac, (OVERLAY_BOOK_H - 0.15) * hFrac),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  m.position.set((OVERLAY_BOOK_W - 0.1) * xFrac, (OVERLAY_BOOK_H - 0.15) * yFrac, 0.01);
  m.userData.linkType = label;
  overlayGroup.add(m);
  return m;
}
// CTA button hitbox (aligned to canvas-drawn button at x≈0.55-0.83, y≈0.78-0.86)
const overlayLinkVisit = mkOverlayLink('visit', 0.19, -0.317, 0.28, 0.08);
// secondary repo link area (text below button)
const overlayLinkRepo  = mkOverlayLink('repo',  0.16, -0.395, 0.24, 0.06);
const overlayHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(OVERLAY_BOOK_W * 1.5, OVERLAY_BOOK_H * 1.5, 0.2),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
);
overlayGroup.add(overlayHitbox);

// ─── topic-grouped layout ────────────────────────────────────────────────────
const allBookGroups = [];
const allHitboxes = [];
const bookContainer = new THREE.Group();
scene.add(bookContainer);

async function loadRepos() {
  const res = await fetch(bust('./data/repos.json'));
  return res.json();
}

// BIG label card leaning on the front edge of the plank above this row
function addShelfLabel(rowDef, rowIdx, shelfTopY) {
  const W = 4.4, H = 1.0;
  const cw = 1100, ch = 250;

  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');

  // rounded cream card
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = '#3d2f1f';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, cw - 16, ch - 16);

  // Dewey code in accent box
  ctx.fillStyle = '#c14d1a';
  ctx.fillRect(28, 28, 200, ch - 56);
  ctx.fillStyle = '#fff8e8';
  ctx.font = '700 110px "Fredoka", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(rowDef.code, 128, ch / 2);

  // category label — BIG
  ctx.fillStyle = '#2d2118';
  ctx.font = '700 92px "Fredoka", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(rowDef.label, 270, ch / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true })
  );
  // sit just above the plank's front edge, leaning out a touch toward viewer
  plaque.position.set(
    -SHELF_WIDTH/2 + W/2 + 0.3,
    (rowIdx + 1) * ROW_HEIGHT + SHELF_THICKNESS / 2 + 0.35,
    SHELF_DEPTH / 2 + 0.06
  );
  plaque.rotation.x = -0.12;
  scene.add(plaque);
}

// framed "color key" painting on the back wall, left of the shelf
function addColorLegend() {
  const entries = [
    ['site', 'websites'], ['ai', 'AI / agents'], ['cad', 'CAD'],
    ['ml', 'machine learning'], ['robotics', 'robotics'], ['tool', 'tools'],
    ['edu', 'coursework'], ['hackathon', 'hackathons'], ['game', 'games'],
    ['hobby', 'hobby'], ['profile', 'profile'], ['misc', 'misc'],
  ];
  const cw = 640, ch = 920;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff8e8'; ctx.fillRect(0, 0, cw, ch);

  ctx.fillStyle = '#2d2118';
  ctx.font = '700 64px "Fredoka", system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('colour key', 48, 80);
  ctx.fillStyle = '#7a6850';
  ctx.font = '500 28px "Fredoka", system-ui, sans-serif';
  ctx.fillText('what the spine colours mean', 48, 134);

  const y0 = 200, rowH = (ch - y0 - 40) / entries.length;
  entries.forEach(([tag, meaning], i) => {
    const y = y0 + i * rowH + rowH / 2;
    const col = TAG_PALETTE[tag] || TAG_PALETTE.misc;
    ctx.fillStyle = '#' + col.toString(16).padStart(6, '0');
    ctx.fillRect(48, y - 26, 70, 52);
    ctx.strokeStyle = '#2d2118'; ctx.lineWidth = 3; ctx.strokeRect(48, y - 26, 70, 52);
    ctx.fillStyle = '#2d2118';
    ctx.font = '600 40px "Fredoka", system-ui, sans-serif';
    ctx.fillText(meaning, 150, y);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const W = 4.6, H = W * ch / cw;          // ~4.6 × 6.6
  // frame + canvas on the back wall, left of the shelf, facing the viewer (+Z)
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.4, H + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x4a341a, roughness: 0.8 })
  );
  frame.position.set(-13.5, 6.6, -1.18);
  scene.add(frame);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  plane.position.set(-13.5, 6.6, -1.16);
  scene.add(plane);
}

function layoutBooks(repos) {
  // lookup by name
  const byName = {};
  for (const r of repos) byName[r.name] = r;

  SHELF_PLAN.forEach((rowDef, rowIdx) => {
    const shelfTopY = rowIdx * ROW_HEIGHT + SHELF_THICKNESS;
    const usable = SHELF_WIDTH - 0.5;

    addShelfLabel(rowDef, rowIdx, shelfTopY);

    // this shelf's books, in listed order, as a single cluster
    const shelfRepos = rowDef.names.map(n => byName[n]).filter(Boolean);
    const clusters = shelfRepos.length ? [{ tag: rowDef.label, repos: shelfRepos }] : [];
    if (clusters.length === 0) return;

    // assign realistic widths per book
    const layout = clusters.map(cluster => {
      const widths = cluster.repos.map(() =>
        BOOK_THK_MIN + Math.random() * (BOOK_THK_MAX - BOOK_THK_MIN)
      );
      const booksW = widths.reduce((a, b) => a + b, 0);
      return { ...cluster, widths, booksW };
    });

    const totalBooks = layout.reduce((a, b) => a + b.repos.length, 0);
    const totalBookW = layout.reduce((a, b) => a + b.booksW, 0);

    // spread to fill ~95% of shelf width — minimize wasted space
    const targetSpan = usable * 0.95;
    const minLayoutW = totalBookW + BOOK_GAP * (totalBooks - layout.length) + SECTION_GAP * (layout.length - 1);

    let bookGap = BOOK_GAP, sectionGap = SECTION_GAP, scale = 1;
    if (minLayoutW > usable) {
      // overflow — scale down
      scale = usable / minLayoutW;
    } else if (minLayoutW < targetSpan) {
      // spread — split extra into inter-cluster gaps mostly
      const extra = targetSpan - minLayoutW;
      const interCluster = Math.max(0, layout.length - 1);
      sectionGap = SECTION_GAP + (interCluster > 0 ? extra * 0.7 / interCluster : 0);
      bookGap = BOOK_GAP + extra * 0.3 / Math.max(1, totalBooks - layout.length);
    }

    const finalW = (totalBookW * scale)
      + bookGap * (totalBooks - layout.length)
      + sectionGap * (layout.length - 1);

    let cursor = -finalW / 2;

    layout.forEach((cluster, ci) => {
      cluster.repos.forEach((repo, i) => {
        const thk = cluster.widths[i] * scale;
        const h = BOOK_HEIGHT_MIN + Math.random() * (BOOK_HEIGHT_MAX - BOOK_HEIGHT_MIN);
        const d = BOOK_DEPTH;

        const book = makeBookGroup(repo, thk, h, d);
        // rotate so spine (local -X face) faces world +Z (toward camera)
        // R_y(+π/2): local +X → world -Z (fore-edge into shelf)
        //            local -X → world +Z (SPINE toward camera) ✓
        book.rotation.y = Math.PI / 2;

        const x = cursor + thk / 2;
        const y = shelfTopY + h / 2;
        const z = -SHELF_DEPTH / 2 + d / 2 + 0.1;
        book.position.set(x, y, z);

        // gentle tilt: occasionally lean
        if (Math.random() < 0.12) {
          const tilt = (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.10);
          book.rotation.z = tilt;
        }

        book.userData.homePosition = book.position.clone();
        book.userData.homeRotation = book.rotation.clone();

        bookContainer.add(book);
        outlineGroupMeshes(book);

        allBookGroups.push(book);
        allHitboxes.push(book.userData.hitbox);

        cursor += thk + bookGap;
      });
      cursor += -bookGap + sectionGap;   // remove trailing book-gap, add section-gap
    });
  });
}

// ─── shelf ───────────────────────────────────────────────────────────────────
const shelfGroup = new THREE.Group();
scene.add(shelfGroup);

function buildProceduralShelf() {
  const totalH = NUM_ROWS * ROW_HEIGHT + SHELF_THICKNESS;
  const SIDE_THK = 0.4;
  const woodMat = toonMat(0xea8d40);
  const accentMat = toonMat(0xc7572a);
  const backMat = toonMat(0x2e6b88);

  const leftSide = new THREE.Mesh(
    new THREE.BoxGeometry(SIDE_THK, totalH, SHELF_DEPTH), woodMat);
  leftSide.position.set(-SHELF_WIDTH/2 - SIDE_THK/2, totalH/2, 0);
  leftSide.castShadow = leftSide.receiveShadow = true;
  shelfGroup.add(leftSide);

  const rightSide = leftSide.clone();
  rightSide.position.x = SHELF_WIDTH/2 + SIDE_THK/2;
  shelfGroup.add(rightSide);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(SHELF_WIDTH + SIDE_THK*2, totalH, 0.08), backMat);
  back.position.set(0, totalH/2, -SHELF_DEPTH/2 + 0.04);
  back.receiveShadow = true;
  shelfGroup.add(back);

  for (let i = 0; i <= NUM_ROWS; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(SHELF_WIDTH + SIDE_THK*2, SHELF_THICKNESS, SHELF_DEPTH),
      woodMat);
    plank.position.set(0, i * ROW_HEIGHT + SHELF_THICKNESS/2, 0);
    plank.castShadow = plank.receiveShadow = true;
    shelfGroup.add(plank);
  }

  // crown
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(SHELF_WIDTH + SIDE_THK*2 + 0.25, 0.32, SHELF_DEPTH + 0.15),
    accentMat);
  crown.position.set(0, totalH + 0.16, 0);
  crown.castShadow = crown.receiveShadow = true;
  shelfGroup.add(crown);
}

// ─── GLB swap ────────────────────────────────────────────────────────────────
const gltfLoader = new GLTFLoader();

async function tryLoadCustomShelf() {
  try {
    const gltf = await gltfLoader.loadAsync(bust('./models/bookshelf.glb'));
    shelfGroup.clear();
    gltf.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const oldMat = o.material;
        // PRESERVE textured materials (the real paintings) — only re-skin plain
        // colored furniture with toon shading. Otherwise paintings render blank.
        if (oldMat && oldMat.map) {
          oldMat.map.colorSpace = THREE.SRGBColorSpace;
          oldMat.roughness = 0.85;
          oldMat.metalness = 0.0;
          oldMat.side = THREE.DoubleSide;   // painting planes show regardless of normal
          oldMat.needsUpdate = true;
          // keep oldMat as-is (textured)
        } else {
          const baseColor = oldMat && oldMat.color ? oldMat.color.getHex() : 0xea8d40;
          o.material = toonMat(baseColor);
        }
      }
    });
    shelfGroup.add(gltf.scene);
    // intentionally no outlineGroupMeshes(shelfGroup) — shelf outlines made
    // pieces look disconnected. only books get outlines.
    console.log('[shelf] custom bookshelf.glb loaded');
    return true;
  } catch (e) {
    console.warn('[shelf] no GLB, using procedural:', e.message);
    return false;
  }
}

// ─── picking + open animation ────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
let openBook = null;
let openCloseTween = null;

const tooltip = document.getElementById('tooltip');
const closeBookBtn = document.getElementById('close-book');
closeBookBtn.addEventListener('click', () => closeBook());

// ─── art gallery overlay ─────────────────────────────────────────────────────
const galleryEl = document.getElementById('gallery');
const gImg = document.getElementById('g-img');
const gCollection = document.getElementById('g-collection');
const gTitle = document.getElementById('g-title');
const gDesc = document.getElementById('g-desc');
const gMedium = document.getElementById('g-medium');
const gYear = document.getElementById('g-year');
const gCounter = document.getElementById('g-counter');
let artworks = [];
let galleryIdx = 0;

async function loadArtworks() {
  try {
    const res = await fetch(bust('./data/artworks.json'));
    artworks = await res.json();
  } catch { artworks = []; }
  // build the gallery hall NOW (in the shared scene) so it's visible through
  // the doorway from the start — not black until the first time you enter it.
  buildGallery();
}
loadArtworks();

// ─── 3D clickable hitboxes for easel + wall painting ─────────────────────────
// invisible planes aligned to objects in the room model — raycast → openGallery
const galleryHitboxes = [];

function addGalleryHitbox(pos, size, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size[0], size[1]),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.userData.isGalleryEntry = true;
  scene.add(m);
  galleryHitboxes.push(m);
  return m;
}

// easel by the gallery door, Blender (18,-3,5.2) → three.js (18, 5.2, 3).
// faces the room (+Z); clicking it enters the gallery.
addGalleryHitbox([18, 5, 3], [6, 7]);
// the DOORWAY itself — Blender (x=13, back wall y≈1.35, h 0..8) → three.js (13, 4, -1.35)
// faces +Z toward the viewer; clicking it walks you into the hall
addGalleryHitbox([13, 4, -1.3], [5, 8]);

// ═══════════════════════════════════════════════════════════════════════════
// WALKABLE 3D ART GALLERY — built INTO the main scene behind the back-wall
// doorway, so you SEE the lit hall through the door from the studio. Clicking
// the doorway walks you in (camera transition), no scene swap.
// ═══════════════════════════════════════════════════════════════════════════
const texLoader = new THREE.TextureLoader();

// hall geometry placed behind the Blender back-wall doorway.
// Blender doorway: x=13, back wall y≈1.35, h=8  →  three.js x=13, z≈-1.35, y 0..8
const DOOR_X = 13;
const DOOR_Z = -1.35;          // back-wall plane in three.js
const HALL_HALF = 6;           // hall half-width (walls at x=7 and x=19)
const HALL_H = 11;
const SPACING = 6.0;
const WALL_PAD = 7;
const GAL_EYE_Y = 5.2;

let galleryBuilt = false;
let galleryLen = 0;
const galleryPaintings = [];
const galleryClickTargets = [];

// state machine: 'off' | 'entering' | 'walking' | 'exiting'
let galleryState = 'off';
const gNav = { z: DOOR_Z - 4, yaw: 0, pitch: 0, focus: null };
let savedRoomPos = new THREE.Vector3();
let savedRoomQuat = new THREE.Quaternion();
let savedFog = null;

function buildGallery() {
  if (galleryBuilt || !artworks.length) return;
  galleryBuilt = true;

  const perWall = Math.ceil(artworks.length / 2);
  const L = WALL_PAD * 2 + (perWall - 1) * SPACING;
  galleryLen = L;
  const farZ = DOOR_Z - L;                 // deepest point
  const midZ = (DOOR_Z + farZ) / 2;

  const g = new THREE.Group();
  g.name = 'GalleryHall';
  scene.add(g);

  // floor — dark polished concrete
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_HALF * 2, L + 6),
    new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.3, metalness: 0.25 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(DOOR_X, 0.02, midZ);
  floor.receiveShadow = true;
  g.add(floor);
  // subtle light runner down the center of the floor
  const runner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, L),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.2, metalness: 0.5,
      emissive: 0x14141a, emissiveIntensity: 0.5 })
  );
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(DOOR_X, 0.03, midZ);
  g.add(runner);

  // ceiling
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_HALF * 2, L + 6),
    new THREE.MeshStandardMaterial({ color: 0x101013, roughness: 1 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(DOOR_X, HALL_H, midZ);
  g.add(ceil);

  // walls — soft warm gallery grey (not near-white, so it doesn't clip to a void)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb3a593, roughness: 0.97 });
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(L + 6, HALL_H), wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(DOOR_X - HALL_HALF, HALL_H / 2, midZ);
  g.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(L + 6, HALL_H), wallMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(DOOR_X + HALL_HALF, HALL_H / 2, midZ);
  g.add(rightWall);
  // far end wall + a spotlit plinth/sculpture
  const endWall = new THREE.Mesh(new THREE.PlaneGeometry(HALL_HALF * 2, HALL_H), wallMat);
  endWall.position.set(DOOR_X, HALL_H / 2, farZ);
  g.add(endWall);
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 2.2, 24),
    new THREE.MeshStandardMaterial({ color: 0xe8e5dd, roughness: 0.8 })
  );
  plinth.position.set(DOOR_X, 1.1, farZ + 2);
  g.add(plinth);
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.8, 2),
    new THREE.MeshStandardMaterial({ color: 0xffd9a0, roughness: 0.4, metalness: 0.3,
      emissive: 0x553311, emissiveIntensity: 0.4 })
  );
  orb.position.set(DOOR_X, 3.0, farZ + 2);
  g.add(orb);

  // hall lighting — soft ambient + a few range-limited warm track lights (local)
  const amb = new THREE.PointLight(0xfff1dc, 0.0); // placeholder; use distance lights below
  const nLights = Math.max(3, Math.round(L / 13));
  for (let i = 0; i < nLights; i++) {
    const lz = DOOR_Z - 2 - (i + 0.5) * (L / nLights);
    const pl = new THREE.PointLight(0xfff0d8, 0.32, 20, 1.8);
    pl.position.set(DOOR_X, HALL_H - 0.8, lz);
    g.add(pl);
    const fix = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.16, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.6,
        emissive: 0xfff0d0, emissiveIntensity: 0.25 })
    );
    fix.position.set(DOOR_X, HALL_H - 0.1, lz);
    g.add(fix);
  }
  // gentle ambient fill just for the hall
  const hallAmbient = new THREE.PointLight(0xede8df, 0.22, 70, 0.6);
  hallAmbient.position.set(DOOR_X, HALL_H - 2, midZ);
  g.add(hallAmbient);

  // hang paintings, alternating walls
  artworks.forEach((a, i) => {
    const wallSide = (i % 2 === 0) ? -1 : 1;     // -1 left (x=7), +1 right (x=19)
    const idxOnWall = Math.floor(i / 2);
    const z = DOOR_Z - WALL_PAD - idxOnWall * SPACING;
    hangPainting(g, a, wallSide, z);
  });
}

function hangPainting(parent, a, wallSide, z) {
  const x = DOOR_X + wallSide * (HALL_HALF - 0.05);
  const yCenter = GAL_EYE_Y;
  const maxW = 3.6, maxH = 2.9;

  const group = new THREE.Group();
  group.position.set(x, yCenter, z);
  group.rotation.y = (wallSide === -1) ? Math.PI / 2 : -Math.PI / 2;  // face into hall
  parent.add(group);

  const canvasMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(maxW, maxH),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.8 })
  );
  canvasMesh.userData.group = group;
  group.add(canvasMesh);
  galleryClickTargets.push(canvasMesh);

  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(maxW + 0.45, maxH + 0.45),
    new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5 })
  );
  frame.position.z = -0.03;
  group.add(frame);

  // picture-light bar (visual)
  const pic = new THREE.Mesh(
    new THREE.BoxGeometry(maxW * 0.55, 0.08, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1d, emissive: 0xfff0d0, emissiveIntensity: 0.5 })
  );
  pic.position.set(0, maxH / 2 + 0.45, 0.35);
  group.add(pic);

  const label = makeGalleryLabel(a);
  label.position.set(0, -(maxH / 2) - 0.62, 0.02);
  group.add(label);

  const standOff = 6.0;
  group.userData = {
    data: a,
    focusPos: new THREE.Vector3(x + wallSide * standOff, yCenter, z),
    lookAt: new THREE.Vector3(x, yCenter, z),
    canvasMesh, frame, label,
  };
  galleryPaintings.push(group);

  texLoader.load(`./artworks/${a.image}`, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const ar = (tex.image.width || 1) / (tex.image.height || 1);
    let w = maxW, h = maxW / ar;
    if (h > maxH) { h = maxH; w = maxH * ar; }
    canvasMesh.geometry.dispose();
    canvasMesh.geometry = new THREE.PlaneGeometry(w, h);
    canvasMesh.material.dispose();
    canvasMesh.material = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5,
      roughness: 0.6, metalness: 0,
    });
    frame.geometry.dispose();
    frame.geometry = new THREE.PlaneGeometry(w + 0.4, h + 0.4);
  });
}

function makeGalleryLabel(a) {
  const cw = 512, ch = 150;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '700 36px "Fredoka", system-ui, sans-serif';
  ctx.fillText(a.title || 'Untitled', cw / 2, 48);
  ctx.fillStyle = '#b9b3a6';
  ctx.font = '400 24px "Fredoka", system-ui, sans-serif';
  ctx.fillText(`${(a.medium || 'acrylic')}${a.year ? ' · ' + a.year : ''}`, cw / 2, 88);
  ctx.fillStyle = '#8d8a80';
  ctx.font = '400 19px "Fredoka", system-ui, sans-serif';
  ctx.fillText('jangogh art', cw / 2, 122);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.70),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  return mesh;
}

// ── enter / exit ──
const galleryHUD = document.getElementById('gallery-3d-hud');
const gInfo = document.getElementById('gallery-info');

function enterGallery() {
  if (!artworks.length || galleryState !== 'off') return;
  buildGallery();
  savedRoomPos.copy(camera.position);
  savedRoomQuat.copy(camera.quaternion);
  savedFog = scene.fog;
  scene.fog = null;                       // don't fog out the hall
  controls.enabled = false;
  galleryState = 'entering';
  gNav.z = DOOR_Z - 4; gNav.yaw = 0; gNav.pitch = 0; gNav.focus = null;
  document.body.classList.add('in-gallery');
  if (galleryHUD) galleryHUD.classList.add('show');
  hideGalleryInfo();
}
function exitGallery() {
  if (galleryState === 'off') return;
  gNav.focus = null;
  galleryState = 'exiting';
  if (galleryHUD) galleryHUD.classList.remove('show');
  hideGalleryInfo();
}
function openGallery() { enterGallery(); }   // keep old call sites working

function showGalleryInfo(a) {
  if (!gInfo) return;
  gInfo.querySelector('.gi-title').textContent = a.title || 'Untitled';
  gInfo.querySelector('.gi-meta').textContent = `${a.medium || 'acrylic'}${a.year ? ' · ' + a.year : ''}`;
  gInfo.querySelector('.gi-desc').textContent = a.description || '';
  gInfo.classList.add('show');
}
function hideGalleryInfo() { if (gInfo) gInfo.classList.remove('show'); }

const galleryActive = () => galleryState !== 'off';

// scroll = walk down the hall
renderer.domElement.addEventListener('wheel', (e) => {
  if (galleryState !== 'walking') return;
  e.preventDefault();
  if (gNav.focus) return;
  gNav.z -= e.deltaY * 0.012;
  gNav.z = Math.max(DOOR_Z - galleryLen - 1, Math.min(DOOR_Z - 2.5, gNav.z));
}, { passive: false });

// drag = look around
let gDown = false, gLX = 0, gLY = 0, gMoved = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!galleryActive()) return;
  gDown = true; gLX = e.clientX; gLY = e.clientY; gMoved = 0;
});
window.addEventListener('pointermove', (e) => {
  if (!gDown || galleryState !== 'walking') return;
  const dx = e.clientX - gLX, dy = e.clientY - gLY;
  gLX = e.clientX; gLY = e.clientY;
  gMoved += Math.abs(dx) + Math.abs(dy);
  if (!gNav.focus) {
    gNav.yaw -= dx * 0.004;
    gNav.pitch -= dy * 0.004;
    gNav.pitch = Math.max(-0.5, Math.min(0.5, gNav.pitch));
  }
});
window.addEventListener('pointerup', (e) => {
  if (!galleryActive()) { gDown = false; return; }
  const wasDrag = gMoved > 6;
  gDown = false;
  if (wasDrag || galleryState !== 'walking') return;
  galleryPointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  galleryPointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  galleryRay.setFromCamera(galleryPointer, camera);
  const hit = galleryRay.intersectObjects(galleryClickTargets, false)[0];
  if (hit) {
    gNav.focus = hit.object.userData.group;
    showGalleryInfo(gNav.focus.userData.data);
  } else if (gNav.focus) {
    gNav.focus = null;
    hideGalleryInfo();
  }
});
const galleryRay = new THREE.Raycaster();
const galleryPointer = new THREE.Vector2();

window.addEventListener('keydown', (e) => {
  if (!galleryActive()) return;
  if (e.key === 'Escape') {
    if (gNav.focus) { gNav.focus = null; hideGalleryInfo(); }
    else exitGallery();
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight')
    gNav.z = Math.max(DOOR_Z - galleryLen - 1, gNav.z - SPACING);
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')
    gNav.z = Math.min(DOOR_Z - 2.5, gNav.z + SPACING);
});

document.getElementById('open-gallery').addEventListener('click', enterGallery);
const galleryExitBtn = document.getElementById('gallery-exit');
if (galleryExitBtn) galleryExitBtn.addEventListener('click', exitGallery);

// ── per-frame camera driver for all gallery states ──
const _gLook = new THREE.Vector3();
const _walkStart = new THREE.Vector3(DOOR_X, GAL_EYE_Y, DOOR_Z - 4);
function updateGalleryCamera() {
  if (galleryState === 'entering') {
    camera.position.lerp(_walkStart, 0.12);
    _gLook.set(DOOR_X, GAL_EYE_Y, DOOR_Z - 20);
    camera.lookAt(_gLook);
    if (camera.position.distanceTo(_walkStart) < 0.4) {
      galleryState = 'walking';
      gNav.z = camera.position.z;
    }
    return;
  }
  if (galleryState === 'exiting') {
    camera.position.lerp(savedRoomPos, 0.12);
    camera.quaternion.slerp(savedRoomQuat, 0.12);
    if (camera.position.distanceTo(savedRoomPos) < 0.4) {
      camera.position.copy(savedRoomPos);
      camera.quaternion.copy(savedRoomQuat);
      scene.fog = savedFog;
      controls.enabled = true;
      document.body.classList.remove('in-gallery');
      galleryState = 'off';
    }
    return;
  }
  // walking
  if (gNav.focus) {
    camera.position.lerp(gNav.focus.userData.focusPos, 0.10);
    _gLook.lerp(gNav.focus.userData.lookAt, 0.12);
    camera.lookAt(_gLook);
  } else {
    const target = new THREE.Vector3(DOOR_X, GAL_EYE_Y, gNav.z);
    camera.position.lerp(target, 0.18);
    camera.rotation.set(gNav.pitch, gNav.yaw, 0, 'YXZ');
  }
}


function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function intersectBook(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(allHitboxes, false);
  return hits[0] ? hits[0].object.userData.bookGroup : null;
}

renderer.domElement.addEventListener('pointermove', e => {
  if (galleryActive()) return;
  if (openBook) { tooltip.classList.remove('show'); return; }
  const hit = intersectBook(e);
  // also check gallery hitboxes
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const gHit = raycaster.intersectObjects(galleryHitboxes, false)[0];

  if (hit !== hovered) {
    hovered = hit;
  }
  renderer.domElement.style.cursor = (hit || gHit) ? 'pointer' : 'grab';

  if (hit) {
    tooltip.textContent = hit.userData.repo.name;
    tooltip.style.left = e.clientX + 'px';
    tooltip.style.top = e.clientY + 'px';
    tooltip.classList.add('show');
  } else if (gHit) {
    tooltip.textContent = '🎨 browse artwork';
    tooltip.style.left = e.clientX + 'px';
    tooltip.style.top = e.clientY + 'px';
    tooltip.classList.add('show');
  } else {
    tooltip.classList.remove('show');
  }
});

let downX = 0, downY = 0, downT = 0;
renderer.domElement.addEventListener('pointerdown', e => {
  downX = e.clientX; downY = e.clientY; downT = performance.now();
});
renderer.domElement.addEventListener('pointerup', e => {
  if (galleryActive()) return;   // gallery has its own pointer handling
  const dt = performance.now() - downT;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (dt >= 350 || moved >= 5) return;

  if (openBook) {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    // any CTA area → LIVE site (falls back to repo only when there is no
    // deployed site, e.g. private projects). Never an explicit code-only link.
    const r = openBook.userData.repo;
    const visitHit = raycaster.intersectObject(overlayLinkVisit, false)[0];
    const repoHit = raycaster.intersectObject(overlayLinkRepo, false)[0];
    if (visitHit || repoHit) {
      window.open(r.url || r.repo, '_blank', 'noopener');
      return;
    }
    // click on overlay body itself does nothing; click outside → close
    const inOverlay = raycaster.intersectObject(overlayHitbox, false)[0];
    if (!inOverlay) closeBook();
  } else {
    // check gallery hitboxes first (easel + wall painting)
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const gHit = raycaster.intersectObjects(galleryHitboxes, false)[0];
    if (gHit) { enterGallery(); return; }

    const hit = intersectBook(e);
    if (hit) openBookAnim(hit);
  }
});

window.addEventListener('keydown', e => { if (e.key === 'Escape' && openBook) closeBook(); });

// linear interp helpers
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpVec(out, a, b, t) {
  out.x = lerp(a.x, b.x, t); out.y = lerp(a.y, b.y, t); out.z = lerp(a.z, b.z, t);
}

let overlayOpacity = 0;
let overlayTargetOpacity = 0;

function openBookAnim(book) {
  openBook = book;
  tooltip.classList.remove('show');

  const repo = book.userData.repo;
  const tagColor = TAG_PALETTE[repo.tag] || TAG_PALETTE.misc;

  // tint overlay covers + spine to book color
  overlayBackCover.material.color.setHex(tagColor);
  overlaySpine.material.color.setHex(tagColor);

  // set page texture
  overlaySpread.material.map = makePageTexture(repo);
  overlaySpread.material.needsUpdate = true;

  // book floats slightly forward as visual cue
  book.userData.targetPos = book.userData.homePosition.clone().add(new THREE.Vector3(0, 0, 0.7));
  book.userData.targetRot = book.userData.homeRotation.clone();
  book.userData.targetOpen = 1;

  overlayGroup.visible = true;
  overlayTargetOpacity = 1;
  closeBookBtn.classList.add('show');
  // hide HUD chrome so nothing overlaps the open book
  document.body.classList.add('book-open');
}

function closeBook() {
  if (!openBook) return;
  const book = openBook;
  book.userData.targetPos = book.userData.homePosition.clone();
  book.userData.targetRot = book.userData.homeRotation.clone();
  book.userData.targetOpen = 0;
  openBook = null;
  overlayTargetOpacity = 0;
  closeBookBtn.classList.remove('show');
  document.body.classList.remove('book-open');
}

// animation loop ──────────────────────────────────────────────────────────────
const tmpStart = new THREE.Vector3();
const tmpStartRot = new THREE.Euler();

function animate() {
  requestAnimationFrame(animate);

  for (const b of allBookGroups) {
    const data = b.userData;

    // tween position/rotation if target present
    if (data.targetPos) {
      const stiff = 0.10;
      b.position.x += (data.targetPos.x - b.position.x) * stiff;
      b.position.y += (data.targetPos.y - b.position.y) * stiff;
      b.position.z += (data.targetPos.z - b.position.z) * stiff;
      b.rotation.x += (data.targetRot.x - b.rotation.x) * stiff;
      b.rotation.y += (data.targetRot.y - b.rotation.y) * stiff;
      b.rotation.z += (data.targetRot.z - b.rotation.z) * stiff;

      // open amount tween
      const targetOpen = data.targetOpen || 0;
      data.openAmount += (targetOpen - data.openAmount) * 0.12;
    }

    // hover pop (only if not selected/animating)
    if (!data.targetPos || (data.targetOpen === 0 && Math.abs(data.openAmount) < 0.02)) {
      const baseZ = data.homePosition.z;
      const targetZ = (b === hovered) ? baseZ + 0.2 : baseZ;
      if (!data.targetPos) {
        b.position.z += (targetZ - b.position.z) * 0.18;
      }
    }

    // (cover open animation removed — overlay shows the open spread instead)

    // day/night surfacing — books "in their time" stand tall, others recede
    if (data.surfaceTarget !== undefined && !openBook) {
      const cur = b.scale.x;
      const ns = cur + (data.surfaceTarget - cur) * 0.06;
      b.scale.setScalar(ns);
    }
  }

  // overlay opacity tween (positioning handled by camera parent)
  overlayOpacity += (overlayTargetOpacity - overlayOpacity) * 0.14;
  if (overlayOpacity < 0.01 && overlayTargetOpacity === 0) {
    overlayGroup.visible = false;
  } else {
    overlayGroup.visible = true;
    overlayBackCover.material.transparent = true;
    overlayBackCover.material.opacity = overlayOpacity;
    overlaySpine.material.transparent = true;
    overlaySpine.material.opacity = overlayOpacity;
    overlaySpread.material.opacity = overlayOpacity;
    // slight scale-up on entry
    const s = 0.85 + overlayOpacity * 0.15;
    overlayGroup.scale.setScalar(s);
  }

  // ── one scene; gallery drives the same camera when active ──
  if (galleryState !== 'off') {
    updateGalleryCamera();
  } else if (camAnim) {
    const raw = Math.min(1, (performance.now() - camAnim.start) / camAnim.dur);
    const e = raw < 0.5 ? 2*raw*raw : 1 - Math.pow(-2*raw + 2, 2) / 2;  // easeInOutQuad
    camera.position.lerpVectors(camAnim.p0, camAnim.p1, e);
    controls.target.lerpVectors(camAnim.t0, camAnim.t1, e);
    camera.lookAt(controls.target);
    if (raw >= 1) camAnim = null;
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // don't reset the camera on resize — that would yank the user's view
});

// ─── camera fly tween (landing → shelf) ──────────────────────────────────────
let camAnim = null;
function flyCameraTo(pos, target, dur = 1.5) {
  camAnim = {
    p0: camera.position.clone(), p1: pos.clone(),
    t0: controls.target.clone(), t1: target.clone(),
    start: performance.now(), dur: dur * 1000,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME-OF-DAY SYSTEM — outside-window sky + scene lighting tracks real EST
// + day/night book surfacing
// ═══════════════════════════════════════════════════════════════════════════

// outside-window sky plane — sized just larger than the window hole so it
// doesn't poke above the wall.
const SKY_W = 9, SKY_H = 8;
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 512; skyCanvas.height = 768;
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
skyTex.flipY = false;   // plane is rotated 90° — un-flip so the moon sits up high
const skyPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(SKY_W, SKY_H),
  new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.DoubleSide })
);
// OUTSIDE the left wall (wall inner ≈ -22.7), behind the window cutout, so it
// shows through the window instead of floating inside the room over the piano.
// Window center lowered (Blender y=-7,z=6) → three.js (-22.7, 6, 7).
skyPlane.position.set(-23.4, 6, 7);
skyPlane.rotation.y = Math.PI / 2;
scene.add(skyPlane);

// ─── phase definitions ──────────────────────────────────────────────────────
const PHASES = [
  { start: 0,  end: 5,  name: 'deep night',  top:'#080820', bot:'#1a1a4a', sunY:0.35, sunSize:0.05, sunCol:'#e8eaf6', sunHex:0x9fa8da, sunInt:0.18, ambHex:0x1a237e, bgHex:0x0e0f23 },
  { start: 5,  end: 7,  name: 'dawn',        top:'#7e5a8e', bot:'#ffb285', sunY:0.92, sunSize:0.08, sunCol:'#ffd180', sunHex:0xff9966, sunInt:0.6,  ambHex:0xff8a65, bgHex:0xffb285 },
  { start: 7,  end: 10, name: 'morning',     top:'#87ceeb', bot:'#fff3b0', sunY:0.75, sunSize:0.08, sunCol:'#fff3a3', sunHex:0xffe082, sunInt:1.1,  ambHex:0xbbdefb, bgHex:0xe3f2fd },
  { start: 10, end: 16, name: 'midday',      top:'#4fc3f7', bot:'#cfe7f5', sunY:0.92, sunSize:0.08, sunCol:'#fffaf0', sunHex:0xfff0d6, sunInt:1.35, ambHex:0xd6eef7, bgHex:0xeaf4fb },
  { start: 16, end: 18, name: 'golden hour', top:'#ffa726', bot:'#ffeb3b', sunY:0.45, sunSize:0.11, sunCol:'#ffb74d', sunHex:0xffd095, sunInt:1.3,  ambHex:0xffe0b2, bgHex:0xfff3e0 },
  { start: 18, end: 20, name: 'sunset',      top:'#7e2c5a', bot:'#ff7043', sunY:0.20, sunSize:0.14, sunCol:'#ff5722', sunHex:0xff6a3d, sunInt:0.95, ambHex:0xff8a65, bgHex:0xffccbc },
  { start: 20, end: 22, name: 'dusk',        top:'#311b92', bot:'#7e2c5a', sunY:0.08, sunSize:0.08, sunCol:'#ff7043', sunHex:0x7e57c2, sunInt:0.4,  ambHex:0x5e35b1, bgHex:0x3949ab },
  { start: 22, end: 24, name: 'night',       top:'#0a0a2e', bot:'#1a1a4a', sunY:0.70, sunSize:0.05, sunCol:'#e8eaf6', sunHex:0x9fa8da, sunInt:0.22, ambHex:0x1a237e, bgHex:0x121530 },
];

function getCurrentESTHour() {
  // EST = UTC - 5. Use ET (DST-aware) via Intl
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const parts = fmt.formatToParts(now);
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value);
    if (p.type === 'minute') m = parseInt(p.value);
  }
  if (h === 24) h = 0;
  return h + m / 60;
}

function getPhase(hour) {
  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i];
    if (hour >= p.start && hour < p.end) {
      const next = PHASES[(i + 1) % PHASES.length];
      const progress = (hour - p.start) / (p.end - p.start);
      return { current: p, next, progress };
    }
  }
  return { current: PHASES[0], next: PHASES[1], progress: 0 };
}

function blendCol(c1, c2, t) {
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  return a.lerp(b, t);
}

function drawSky(top, bot, sunX, sunY, sunSize, sunColor) {
  const w = skyCanvas.width, h = skyCanvas.height;
  const ctx = skyCanvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // sun/moon disc + halo
  const sx = sunX * w, sy = (1 - sunY) * h;
  const sr = sunSize * h;
  const haloHex = sunColor + (sunColor.length === 7 ? 'aa' : '');
  const haloFade = sunColor + (sunColor.length === 7 ? '00' : '');
  const gr = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 2.5);
  gr.addColorStop(0, haloHex); gr.addColorStop(1, haloFade);
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(sx, sy, sr * 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sunColor;
  ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
  skyTex.needsUpdate = true;
}

// HUD elements
const todHUD = document.createElement('div');
todHUD.id = 'tod-hud';
todHUD.innerHTML = `
  <div class="tod-time">--:--</div>
  <div class="tod-phase">—</div>
  <div class="tod-mode">—</div>
  <div class="tod-toggle" role="group" aria-label="surface mode">
    <button data-mode="auto" class="active">auto</button>
    <button data-mode="all">all</button>
    <button data-mode="day">day</button>
    <button data-mode="night">night</button>
  </div>`;
document.body.appendChild(todHUD);

// surface mode state — also FORCES the scene lighting/sky for day/night
let surfaceMode = 'auto';   // 'auto' | 'all' | 'day' | 'night'
todHUD.querySelectorAll('.tod-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    surfaceMode = btn.dataset.mode;
    todHUD.querySelectorAll('.tod-toggle button').forEach(b => b.classList.toggle('active', b === btn));
    updateTimeOfDay();        // day/night visibly relights the whole room
    updateBookSurfacing();
  });
});

// 'day' pins to bright midday, 'night' to deep night; otherwise real EST time.
function getEffectiveHour() {
  if (surfaceMode === 'day') return 13;
  if (surfaceMode === 'night') return 23;
  return getCurrentESTHour();
}

function updateTimeOfDay() {
  const hour = getEffectiveHour();
  const { current, next, progress } = getPhase(hour);

  const topCol = '#' + blendCol(current.top, next.top, progress).getHexString();
  const botCol = '#' + blendCol(current.bot, next.bot, progress).getHexString();
  const sunX = Math.max(0.08, Math.min(0.92, hour / 24));
  const sunY = current.sunY * (1 - progress) + next.sunY * progress;
  drawSky(topCol, botCol, sunX, sunY, current.sunSize, current.sunCol);

  // update directional sun
  sun.color.setHex(blendCol(current.sunHex, next.sunHex, progress).getHex());
  sun.intensity = current.sunInt * (1 - progress) + next.sunInt * progress;
  const sunAngle = (hour / 24 - 0.25) * Math.PI * 2;   // 6am at horizon-east, 6pm at horizon-west
  sun.position.set(-18 + Math.cos(sunAngle) * 4, 12 + Math.sin(sunAngle) * 8, 6);

  // scene background tint subtle
  scene.background.setHex(blendCol(current.bgHex, next.bgHex, progress).getHex());

  // lamps: bright pool at night, dim by day; glows track them
  const isNight = isCurrentlyNight();
  pendantLight.intensity = isNight ? 5.5 : 0.8;
  pendantGlow.material.color.setHex(isNight ? 0xfff0c8 : 0xddd4c0);
  easelLamp.intensity = isNight ? 4.0 : 0.6;
  easelLampGlow.material.color.setHex(isNight ? 0xfff0c8 : 0xddd4c0);

  // HUD
  const h12 = Math.floor(hour);
  const m = Math.floor((hour - h12) * 60);
  const ampm = h12 >= 12 ? 'PM' : 'AM';
  const h12disp = ((h12 + 11) % 12) + 1;
  todHUD.querySelector('.tod-time').textContent = `${h12disp}:${String(m).padStart(2,'0')} ${ampm}  ET`;
  todHUD.querySelector('.tod-phase').textContent = current.name;
  todHUD.querySelector('.tod-mode').textContent = isNight ? '🌙 creative mode' : '☀️ tech mode';
  todHUD.classList.toggle('night', isNight);
}

setInterval(updateTimeOfDay, 60_000);
updateTimeOfDay();

// ─── day/night book surfacing ───────────────────────────────────────────────
// books matching current mode scale up + drift forward; others recede slightly
function isCurrentlyNight() {
  if (surfaceMode === 'day') return false;
  if (surfaceMode === 'night') return true;
  const h = getCurrentESTHour();
  return h < 7 || h >= 18;
}

function updateBookSurfacing() {
  let mode = surfaceMode;
  if (mode === 'auto') mode = isCurrentlyNight() ? 'night' : 'day';
  for (const b of allBookGroups) {
    const dn = b.userData.repo.dayNight;
    // 'all' mode: every book full scale
    // specific mode: matching books full, non-matching softly recede (still readable)
    let target;
    if (mode === 'all') target = 1.0;
    else if (dn === 'all' || dn === mode) target = 1.0;
    else target = 0.88;   // softer (was 0.6) — still legible + clickable
    b.userData.surfaceTarget = target;
  }
}
setInterval(updateBookSurfacing, 60_000);
setTimeout(updateBookSurfacing, 500);   // run shortly after books load

// ─── boot ────────────────────────────────────────────────────────────────────
function showBootError(stage, err) {
  const el = document.getElementById('loading');
  el.style.flexDirection = 'column';
  el.style.gap = '8px';
  el.innerHTML = `<div style="color:#c33;font-weight:700">boot failed at: ${stage}</div>
    <pre style="color:#444;font-size:11px;max-width:80vw;white-space:pre-wrap;text-align:left">${String(err && err.stack || err)}</pre>`;
  console.error('[boot]', stage, err);
}

window.addEventListener('error', e => showBootError('window.error', e.error || e.message));
window.addEventListener('unhandledrejection', e => showBootError('unhandledrejection', e.reason));

// click on open book → navigate to its url/repo
renderer.domElement.addEventListener('dblclick', () => {
  if (openBook) {
    const r = openBook.userData.repo;
    window.open(r.url || r.repo, '_blank', 'noopener');
  }
});

(async () => {
  let repos;
  try { repos = await loadRepos(); }
  catch (e) { return showBootError('loadRepos', e); }

  let usedGlb = false;
  try { usedGlb = await tryLoadCustomShelf(); }
  catch (e) { return showBootError('tryLoadCustomShelf', e); }

  try {
    if (!usedGlb) {
      buildProceduralShelf();
      // no shelf outline (see GLB branch for reasoning)
    }
  } catch (e) { return showBootError('procedural shelf', e); }

  try { layoutBooks(repos); addColorLegend(); }
  catch (e) { return showBootError('layoutBooks', e); }

  document.getElementById('loading').classList.add('hide');
  document.body.classList.add('landing');     // show the browse-choice overlay
  animate();
})();

// ─── landing: browse tech vs browse art ──────────────────────────────────────
const landingEl = document.getElementById('landing');
function leaveLanding() { document.body.classList.remove('landing'); }
document.getElementById('btn-tech')?.addEventListener('click', () => {
  leaveLanding();
  flyCameraTo(VIEW_SHELF.pos, VIEW_SHELF.tgt, 1.6);
});
document.getElementById('btn-art')?.addEventListener('click', () => {
  leaveLanding();
  enterGallery();
});
