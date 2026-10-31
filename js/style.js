// ─── THE HAND-DRAWN LOOK ─────────────────────────────────────────────────────
// One style, applied to everything, in a single render pass:
//   • gouache fills: flat cel bands (light / mid / shadow), never glossy
//   • paper: a fixed grain + a soft pencil hatch that only bites in shadow
//   • ink: outlines of constant on-screen width (like a real pen), with a
//     gentle wobble redrawn a few times a second — alive, not shimmering
// No environment maps, no specular, no shadow maps: shapes are read from
// their ink and their cel bands, the way an illustrator would draw them.
import * as THREE from 'three';

// ── palette: muted gouache on warm paper ──
export const PAL = {
  paper: 0xf3ead7, ink: 0x2a2230,
  grass: 0xb4c58f, grassDeep: 0x93ad74, meadow: 0xc9d39a,
  sand: 0xead7ad, earth: 0xd9c29a, rock: 0xb8ab98, snow: 0xf6f1e6,
  water: 0x8fc3c9, waterDeep: 0x6fa6b4,
  road: 0x8a8392, kerb: 0xefe5cf, dash: 0xf6eedb,
  cream: 0xf1e4c8, terracotta: 0xd58b63, dusty: 0x93abc0, sage: 0xa8b994,
  mustard: 0xe1b95c, rose: 0xdc9e9a, lilac: 0xb7a3c6, teal: 0x7fb3a8,
  roofRed: 0xb85a3e, roofSlate: 0x6f7d92, roofGreen: 0x6f9a7c,
  leaf: 0x86a868, leafLight: 0xa5c27f, bark: 0x8a6448,
  accent: 0xe8604c, gold: 0xe4b84f,
};

// ── a 3-band toon ramp: shadow / mid / light, hard edges between them ──
const ramp = (a, b, c) => {
  const d = new Uint8Array([a, b, c]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};
const RAMP = ramp(105, 175, 255);
// a gentler ramp for skin and hair: the default mid band darkens a light skin tone to the
// colour of her hair (her chin read as hair), and blotches a pale bob with dark patches
const RAMP_SOFT = ramp(196, 228, 255);

// paper grain + hatching, injected at the very end of every fill shader. It
// works in SCREEN space (like ink on a page) so it never swims on a surface.
const PAPER_GLSL = /* glsl */`
  {
    vec2 fc = gl_FragCoord.xy;
    // grain: two octaves of cheap hash noise, very low contrast
    float g1 = fract(sin(dot(floor(fc / 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    float g2 = fract(sin(dot(floor(fc / 7.0), vec2(39.346, 11.135))) * 24634.6345);
    float grain = (g1 - 0.5) * 0.035 + (g2 - 0.5) * 0.025;
    // how lit is this pixel compared to its own pigment? (the cel band)
    float lumC = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
    float lumD = max(1e-3, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
    float shade = clamp(lumC / lumD, 0.0, 1.5);
    // pencil hatch: diagonal strokes, only in the shadow band, broken up so
    // it reads hand-made rather than a ruled pattern
    float diag = fract((fc.x + fc.y) / 6.0);
    float brk = step(0.35, fract(sin(floor((fc.x - fc.y) / 23.0) * 91.7) * 4375.85));
    float hatch = step(0.82, diag) * brk * (1.0 - smoothstep(0.45, 0.62, shade));
    gl_FragColor.rgb *= 1.0 + grain;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.78, hatch * uHatch);
    // gouache: lift the darks a touch so shadows stay coloured, never black
    gl_FragColor.rgb = gl_FragColor.rgb * 0.94 + diffuseColor.rgb * 0.06;
  }
`;

const _matCache = new Map();
// paint(color, { hatch, flat, map, side, opacity }) → shared gouache material
export function paint(color, o = {}) {
  const key = [color, o.hatch ?? 1, o.map?.uuid, o.side, o.opacity, o.emissive, o.vertexColors, o.soft ? 's' : ''].join('|');
  if (_matCache.has(key) && !o.unique) return _matCache.get(key);
  const m = new THREE.MeshToonMaterial({
    color, gradientMap: o.soft ? RAMP_SOFT : RAMP, map: o.map || null, side: o.side ?? THREE.FrontSide,
    transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1,
    vertexColors: !!o.vertexColors,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissive ? 1 : 0,
  });
  m.userData.hatch = o.hatch ?? 1;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHatch = { value: m.userData.hatch };
    sh.fragmentShader = 'uniform float uHatch;\n' + sh.fragmentShader
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + PAPER_GLSL);
  };
  m.customProgramCacheKey = () => 'paper' + (m.userData.hatch > 0 ? 'h' : '');
  if (!o.unique) _matCache.set(key, m);
  return m;
}

// ── INK: inverted hull pushed out in CLIP space, so the stroke is the same
// width in pixels near or far (a pen, not a shell). Weight varies slowly along
// the line and the whole drawing is re-traced ~4×/s by a tiny amount.
export const inkUniforms = {
  uTime: { value: 0 },
  uRes: { value: new THREE.Vector2(1280, 800) },
  uWidth: { value: 1.7 },                    // px at weight 1
};
function makeInk(weight = 1, color = PAL.ink) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { ...inkUniforms, uWeight: { value: weight }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */`
      uniform float uTime, uWidth, uWeight; uniform vec2 uRes;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec3 nv = normalize(normalMatrix * normal);
        vec2 n2 = normalize((projectionMatrix * vec4(nv, 0.0)).xy + 1e-5);
        float tick = floor(uTime * 4.0);
        // weight swells/thins slowly along the stroke (low-frequency, per area)
        float along = h(floor(position * 2.5) + 0.37);
        float boil = h(position * 7.0 + tick) - 0.5;
        float w = uWidth * uWeight * (0.8 + 0.45 * along + 0.12 * boil);
        clip.xy += n2 * w * 2.0 / uRes * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  });
}
const INK = { heavy: makeInk(1.25), mid: makeInk(1.0), fine: makeInk(0.7) };
// the same stroke, faded per vertex by an `inkW` attribute (no line where one part grows out of another)
const INK_FADE = {};
function fadeInk(weight) {
  if (INK_FADE[weight]) return INK_FADE[weight];
  const m = (INK[weight] || INK.mid).clone();
  m.uniforms = { ...inkUniforms, uWeight: (INK[weight] || INK.mid).uniforms.uWeight, uColor: (INK[weight] || INK.mid).uniforms.uColor };
  m.vertexShader = m.vertexShader.replace('uniform float uTime,', 'attribute float inkW;\n      uniform float uTime,')
    .replace('float w = uWidth * uWeight *', 'float w = inkW * uWidth * uWeight *');
  return (INK_FADE[weight] = m);
}

// ink(obj): give every mesh under obj its outline. Hull reuses the mesh's own
// geometry (no copy), so the cost is one extra draw per inked mesh.
const NO_RAY = () => {};                     // a shared no-op raycast (a closure would keep its maker's scope alive)
// gpuOnly(scene): once the world is built, the JS copies of what only the GPU reads — normals,
// uvs, vertex colours, an ink hull's index — are let go as soon as they're uploaded (the heap
// held them all twice over: ~60% of every static mesh). The ground rays and the talk camera
// read positions + indices only: each mesh raycasts through a proxy geometry that shares
// exactly those. Skinned people, instanced and animated (point) meshes, the planet and the
// sea are left as they are; so is anything added later (it may still be built from).
const _freeArr = function () { this.array = null; };
const _rayGeo = new WeakMap();                // mesh → its positions-and-index proxy (not in userData: clone() would copy it)
function _rayThrough(raycaster, hits) {
  const g = this.geometry; this.geometry = _rayGeo.get(this);
  try { THREE.Mesh.prototype.raycast.call(this, raycaster, hits); } finally { this.geometry = g; }
}
export function gpuOnly(root, renderer, camera) {
  const done = new Set();
  // (people are left whole: their rigid parts — shoes, buttons, hair — come from shared
  // builder caches that later people, and the critic streaming in, are cloned from)
  const people = new Set(root.children.filter(t => { let sk = false; t.traverse(q => { if (q.isSkinnedMesh) sk = true; }); return sk || t.userData.human; }));
  const skip = (o) => { for (let q = o; q; q = q.parent) if (people.has(q)) return true; return false; };
  root.traverse(o => {
    if (o.isMesh && skip(o)) return;
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.name === 'planet' || o.name === 'sea') return;
    const g = o.geometry; if (!g?.attributes?.position || g.morphAttributes?.position) return;
    if (!o.userData.isInk && o.raycast === THREE.Mesh.prototype.raycast) {
      const r = new THREE.BufferGeometry(); r.setAttribute('position', g.attributes.position); if (g.index) r.setIndex(g.index);
      if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
      r.boundingSphere = g.boundingSphere; r.boundingBox = g.boundingBox;
      _rayGeo.set(o, r); o.raycast = _rayThrough;
    }
    if (done.has(g)) return; done.add(g);
    if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
    for (const k of ['normal', 'uv', 'color']) { const a = g.attributes[k]; if (a) a.onUpload(_freeArr); }
  });
  // upload it all now, while loading (one tiny off-screen frame with nothing culled): a thing
  // first seen much later would otherwise keep its copies until then
  if (renderer && camera) {
    // (the renderer uploads an object's buffers as it gathers it, before it looks at whether its
    // material is visible: with every material hidden for one pass, it all goes up and nothing
    // is drawn — the frame costs no shading at all)
    const culled = [], mats = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.visible) mats.add(m);
    });
    for (const m of mats) m.visible = false;
    try { renderer.render(root, camera); }
    finally { for (const m of mats) m.visible = true; for (const o of culled) o.frustumCulled = true; }
  }
}
// bakeScenery(scene, only): the town's loose props — trees, bushes, lamps, benches, planters,
// signs, each set down as its own little group of parts — are baked down in place, each into
// one mesh per kind of paint (colours per vertex) plus its hull: a tree that was trunk, crown,
// highlight and their hulls is a fill and a hull. Only plain scenery is touched: a group whose
// parts carry no data beyond build records (anything the game keeps a handle on, moves, hides
// or animates is marked some other way, or isn't in `only` — the town as first built).
const INERT_PROP = new Set(['foots', 'conform', 'noInk', 'isInk', 'lamp', 'lampMark', 'lamps']);   // (lamp: a bulb's tag, read by nothing; lampMark/lamps: where a lamp stands, read once by collectLamps before the bake)
function plainProp(o) {
  for (const k of Object.keys(o.userData)) if (!INERT_PROP.has(k)) return false;
  if (!o.visible) return false;
  if (o.isMesh) {
    if (o.isSkinnedMesh || o.isInstancedMesh || o.isPoints || o.isLine || Array.isArray(o.material)) return false;
    const g = o.geometry; if (!g?.attributes?.position || !g.attributes.normal || Object.keys(g.morphAttributes).length) return false;
    if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  } else if (!(o.isGroup || o.type === 'Object3D')) return false;
  for (const c of o.children) if (!plainProp(c)) return false;
  return true;
}
const _bb = new THREE.Box3(), _bs = new THREE.Sphere();
export function bakeScenery(scene, only) {
  let n = 0;
  for (const top of scene.children) {
    if (!only.has(top) || top.name || !top.children.length || !plainProp(top)) continue;
    let meshes = 0; top.traverse(o => { if (o.isMesh) meshes++; }); if (meshes < 3) continue;
    // props and small buildings; a big thing only if it's made of many parts (the harbour) — a
    // street block, already baked per material, stays culled part by part
    _bb.setFromObject(top); if (_bb.getBoundingSphere(_bs).radius > 8 && meshes < 24) continue;
    mergeStatic(top, [], { vc: true }); n++;
  }
  return n;
}
// one hull for a whole static thing. Its parts (siblings under one parent: a building baked
// one mesh per material) are moved onto ONE shared vertex buffer — each keeps only its own
// index into it — and their ink hulls, drawn in the same ink, become a single mesh indexing
// that same buffer. A building that was ~12 fills + ~12 hull draws is ~12 + 1, and costs no
// more memory than before (the hull copies nothing but indices).
function mergeHulls(parent) {
  const fills = parent.children.filter(o => o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.userData.isInk && o.visible &&
    o.matrix.equals(_ID) && o.geometry.attributes.position && o.geometry.attributes.normal && !o.geometry.attributes.inkW &&
    !Object.keys(o.geometry.morphAttributes).length);
  const hullsOf = (o) => o.children.filter(h => h.isMesh && h.userData.isInk && h.geometry === o.geometry && h.matrix.equals(_ID));
  const byMat = new Map();
  for (const o of fills) for (const h of hullsOf(o)) { let b = byMat.get(h.material); if (!b) byMat.set(h.material, b = []); b.push(o); }
  if (![...byMat.values()].some(b => b.length > 1)) { mergeLooseHulls(parent); return; }
  const withUv = fills.some(o => o.geometry.attributes.uv), withCol = fills.some(o => o.geometry.attributes.color);
  let nv = 0; for (const o of fills) nv += o.geometry.attributes.position.count;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = withUv ? new Float32Array(nv * 2) : null;
  const col = withCol ? new Float32Array(nv * 3).fill(1) : null;
  const IDX = nv > 65535 ? Uint32Array : Uint16Array, base = new Map();
  let vb = 0;
  // (plain float arrays copy straight across; anything packed or interleaved goes value by value)
  const copy = (dst, A, size, at) => {
    if (!A) return;
    if (A.array instanceof Float32Array && A.itemSize === size && !A.isInterleavedBufferAttribute && !A.normalized) { dst.set(A.array.subarray(0, A.count * size), at * size); return; }
    for (let i = 0; i < A.count; i++) for (let c = 0; c < size; c++) dst[(at + i) * size + c] = A.getComponent(i, c);
  };
  for (const o of fills) {
    const g = o.geometry, n = g.attributes.position.count;
    copy(pos, g.attributes.position, 3, vb); copy(nor, g.attributes.normal, 3, vb);
    if (uv) copy(uv, g.attributes.uv, 2, vb);
    if (col && g.attributes.color?.itemSize === 3) copy(col, g.attributes.color, 3, vb);
    if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
    base.set(o, vb); vb += n;
  }
  const A = { position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nor, 3) };
  if (uv) A.uv = new THREE.BufferAttribute(uv, 2);
  if (col) A.color = new THREE.BufferAttribute(col, 3);
  const indexOf = (o) => { const g = o.geometry, b = base.get(o), n = g.index ? g.index.count : g.attributes.position.count, out = new IDX(n); if (g.index) { const I = g.index.array; for (let k = 0; k < n; k++) out[k] = b + I[k]; } else for (let k = 0; k < n; k++) out[k] = b + k; return out; };
  // (bounds: a part's own, as it had them — the shared buffer spans the whole thing)
  const shared = (idx, box) => { const g = new THREE.BufferGeometry(); for (const [k, a] of Object.entries(A)) g.setAttribute(k, a); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingBox = box.clone(); g.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); return g; };
  const own = new Map(fills.map(o => [o, indexOf(o)]));
  // the hulls first (they read each part's old index), then the parts move onto the shared buffer
  for (const [mat, parts] of byMat) {
    let n = 0; for (const o of parts) n += own.get(o).length;
    const idx = new IDX(n), box = new THREE.Box3(); let at = 0;
    for (const o of parts) { idx.set(own.get(o), at); at += own.get(o).length; box.union(o.geometry.boundingBox); for (const h of hullsOf(o)) if (h.material === mat) h.removeFromParent(); }
    const m = new THREE.Mesh(shared(idx, box), mat);
    m.userData.isInk = true; m.raycast = NO_RAY; m.renderOrder = -1;
    parent.add(m);
  }
  for (const o of fills) { const old = o.geometry; o.geometry = shared(own.get(o), old.boundingBox); old.dispose(); }
  mergeLooseHulls(parent);
}
// the rest of a static thing's hulls — parts that sit with their own transform under it — are
// copied out, transform baked in, into one hull per ink (GPU-only: the copy is let go once
// uploaded). Only for things that never move part by part (ink(…, { merge: true })).
function mergeLooseHulls(parent) {
  const byMat = new Map();
  for (const o of parent.children) {
    if (!o.isMesh || o.isSkinnedMesh || o.userData.isInk || !o.visible || o.matrix.equals(_ID)) continue;
    for (const h of o.children) if (h.isMesh && h.userData.isInk && !h.isSkinnedMesh && h.matrix.equals(_ID) && !h.geometry.attributes.inkW && h.geometry.attributes.normal) {
      let b = byMat.get(h.material); if (!b) byMat.set(h.material, b = []); b.push(h);
    }
  }
  const free = function () { this.array = null; };
  for (const [mat, hs] of byMat) {
    if (hs.length < 2) continue;
    let nv = 0, ni = 0;
    for (const h of hs) { const g = h.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vb = 0, ib = 0;
    for (const h of hs) {
      const g = h.geometry, a = g.attributes, n = a.position.count, M = h.parent.matrix; _n3.getNormalMatrix(M);
      for (let i = 0; i < n; i++) {
        _v3.fromBufferAttribute(a.position, i).applyMatrix4(M); P[(vb + i) * 3] = _v3.x; P[(vb + i) * 3 + 1] = _v3.y; P[(vb + i) * 3 + 2] = _v3.z;
        _v3.fromBufferAttribute(a.normal, i).applyMatrix3(_n3).normalize(); N[(vb + i) * 3] = _v3.x; N[(vb + i) * 3 + 1] = _v3.y; N[(vb + i) * 3 + 2] = _v3.z;
      }
      const flip = M.determinant() < 0;
      const tri = (x, y, z) => { I[ib++] = vb + x; if (flip) { I[ib++] = vb + z; I[ib++] = vb + y; } else { I[ib++] = vb + y; I[ib++] = vb + z; } };
      if (g.index) for (let k = 0; k < g.index.count; k += 3) tri(g.index.getX(k), g.index.getX(k + 1), g.index.getX(k + 2)); else for (let k = 0; k < n; k += 3) tri(k, k + 1, k + 2);
      vb += n; h.removeFromParent();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3).onUpload(free)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3).onUpload(free));
    g.setIndex(new THREE.BufferAttribute(I, 1).onUpload(free));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat); m.userData.isInk = true; m.raycast = NO_RAY; m.renderOrder = -1;
    parent.add(m);
  }
}
const _ID = new THREE.Matrix4();
// a person's rigid parts (eyes, brows, lids, hair tufts, glasses, buttons…) each rode their
// bone as their own mesh + hull: a face alone was a dozen draws. Under each bone they're baked
// together, one mesh per material in the bone's frame (mergeStatic), so they still move with
// it. Anything the person's code keeps a handle on (a held pen, a newspaper, a board) is left
// alone, and so are the bones below.
// labels a part carries from its model or builder — nothing acts on them once it's built
const INERT_PART = new Set(['isInk', 'noInk', 'part', 'role', 'name']);
function mergeOnBones(root) {
  const keep = new Set();
  const hold = (v) => { if (v && v.isObject3D) keep.add(v); else if (Array.isArray(v)) v.forEach(hold); };
  for (const ud of [root.userData, root.userData.human].filter(Boolean)) for (const v of Object.values(ud)) hold(v);
  const held = (o) => { for (let q = o; q; q = q.parent) if (keep.has(q)) return true; return false; };
  // (every node that isn't itself a mesh: bones, and the model's plain nodes — a GLB hangs a
  // pair of eyes off an empty node under the head)
  const bones = []; root.traverse(o => { if (!o.isMesh && o !== root) bones.push(o); });
  for (const b of bones) {
    const kids = b.children.filter(c => c.isMesh && !c.isSkinnedMesh && !c.userData.isInk);
    if (kids.length < 2 || kids.some(held)) continue;
    let animated = false; for (const k of kids) k.traverse(q => { if (keep.has(q) || q.isBone || q.isSkinnedMesh || Object.keys(q.userData).some(x => !INERT_PART.has(x))) animated = true; });
    if (animated) continue;
    mergeStatic(b, b.children.filter(c => c.isBone || c.isSkinnedMesh || !kids.includes(c) && !c.userData.isInk), { vc: true, gpu: true });
  }
}
// a person's skinned hulls — one per body part, drawn in the same ink weight — become one
// skinned hull (a body was up to ~12 hull draws; now 1). Each part's own bind matrix is baked
// into its vertices and the parts' bones gathered into one skeleton (an "attached" skinned mesh
// cancels its own transform, so where the merged hull hangs doesn't matter). A part whose bones
// were bound differently keeps its own hull. The merged copy is the GPU's alone: its arrays go
// once uploaded. (A plain hull merged with fading ones gets a fade of 1: the same stroke.)
const _m4a = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _v3 = new THREE.Vector3();
const _near = (a, b) => { for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-4 * (1 + Math.abs(a.elements[i]))) return false; return true; };
// plain gouache: a flat-coloured paint() (no texture, no glow, opaque) — parts in it can share
// one mesh with the colour carried per vertex (the toon shader multiplies it in exactly where
// the material's colour went)
const isPlainPaint = (m) => m && m.isMeshToonMaterial && m.userData.hatch != null && !m.map && !m.vertexColors && !m.transparent &&
  (m.opacity ?? 1) === 1 && !(m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b));
const _SOFT_RAMP = () => paint(0xffffff, { soft: true }).gradientMap;
const vcPaint = (m) => paint(0xffffff, { vertexColors: true, hatch: m.userData.hatch, side: m.side, soft: m.gradientMap === _SOFT_RAMP() });
// merge skinned meshes that draw the same way into one skinned mesh: hulls by ink weight; fills
// by kind of paint (plain colours carried per vertex) or by material (already vertex-coloured).
// Each part's own bind matrix is baked into its vertices and the parts' bones gathered into one
// skeleton (an "attached" skinned mesh cancels its own transform, so where the merged mesh
// hangs doesn't matter). A part bound in a different pose of the whole model (its bone
// inverses all off by one common transform C) is carried by C; one whose offset isn't common
// keeps its own mesh. The merged copy is the GPU's alone: its arrays go once uploaded.
function mergeSkinned(skins, hull) {
  const groups = new Map();
  for (const h of skins) {
    const g = h.geometry, m = h.material;
    if (Object.keys(g.morphAttributes).length || !g.attributes.skinIndex || !g.attributes.skinWeight || !g.attributes.normal || h.bindMode !== 'attached' || !h.visible || Array.isArray(m)) continue;
    let k;
    if (hull) k = m.uniforms?.uWeight?.value ?? m.uuid;
    else if (isPlainPaint(m)) k = `vc|${m.side}|${m.userData.hatch}|${m.gradientMap === _SOFT_RAMP() ? 's' : ''}|${h.frustumCulled}`;
    else if (m.vertexColors && !m.map && !m.transparent && g.attributes.color) k = m.uuid + '|' + h.frustumCulled;
    else continue;
    let b = groups.get(k); if (!b) groups.set(k, b = []); b.push(h);
  }
  const free = function () { this.array = null; };
  for (const all of groups.values()) {
    if (all.length < 2) continue;
    const bones = [], inv = [], at = new Map(), hs = [], carry = new Map();
    for (const h of all) {
      const sk = h.skeleton; let C = null, ok = true;
      for (let i = 0; i < sk.bones.length && ok; i++) {
        const k = at.get(sk.bones[i]); if (k == null) continue;
        const c = inv[k].clone().invert().multiply(sk.boneInverses[i]);
        if (!C) C = c; else if (!_near(C, c)) ok = false;
      }
      if (!ok) continue;
      C = C || new THREE.Matrix4();
      const Ci = C.clone().invert();
      for (let i = 0; i < sk.bones.length; i++) { const b = sk.bones[i]; if (!at.has(b)) { at.set(b, bones.length); bones.push(b); inv.push(sk.boneInverses[i].clone().multiply(Ci)); } }
      carry.set(h, C.multiply(h.bindMatrix)); hs.push(h);
    }
    if (hs.length < 2) continue;
    const fade = hull && hs.some(h => h.geometry.attributes.inkW);
    const colour = !hull;                                 // fills carry their colour per vertex
    let nv = 0, ni = 0;
    for (const h of hs) { const g = h.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4);
    const W = fade ? new Float32Array(nv).fill(1) : null, COL = colour ? new Float32Array(nv * 3).fill(1) : null;
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vb = 0, ib = 0;
    for (const h of hs) {
      const g = h.geometry, a = g.attributes, n = a.position.count, map = h.skeleton.bones.map(b => at.get(b));
      const mc = colour && isPlainPaint(h.material) ? h.material.color : null, gc = colour && !mc ? a.color : null;
      _m4a.copy(carry.get(h)); _n3.getNormalMatrix(_m4a);
      const flip = _m4a.determinant() < 0;
      for (let i = 0; i < n; i++) {
        const j = vb + i;
        _v3.fromBufferAttribute(a.position, i).applyMatrix4(_m4a); P[j * 3] = _v3.x; P[j * 3 + 1] = _v3.y; P[j * 3 + 2] = _v3.z;
        _v3.fromBufferAttribute(a.normal, i).applyMatrix3(_n3).normalize(); N[j * 3] = _v3.x; N[j * 3 + 1] = _v3.y; N[j * 3 + 2] = _v3.z;
        for (let c = 0; c < 4; c++) { SI[j * 4 + c] = map[a.skinIndex.getComponent(i, c)] ?? 0; SW[j * 4 + c] = a.skinWeight.getComponent(i, c); }
        if (W && a.inkW) W[j] = a.inkW.getX(i);
        if (mc) { COL[j * 3] = mc.r; COL[j * 3 + 1] = mc.g; COL[j * 3 + 2] = mc.b; }
        else if (gc) { COL[j * 3] = gc.getX(i); COL[j * 3 + 1] = gc.getY(i); COL[j * 3 + 2] = gc.getZ(i); }
      }
      const tri = (x, y, z) => { I[ib++] = vb + x; if (flip) { I[ib++] = vb + z; I[ib++] = vb + y; } else { I[ib++] = vb + y; I[ib++] = vb + z; } };
      if (g.index) for (let k = 0; k < g.index.count; k += 3) tri(g.index.getX(k), g.index.getX(k + 1), g.index.getX(k + 2));
      else for (let k = 0; k < n; k += 3) tri(k, k + 1, k + 2);
      vb += n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    if (W) g.setAttribute('inkW', new THREE.BufferAttribute(W, 1));
    if (COL) g.setAttribute('color', new THREE.BufferAttribute(COL, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    for (const a of [...Object.values(g.attributes), g.index]) a.onUpload(free);
    const h0 = hs[0], m0 = h0.material;
    const mat = hull ? skinnedInkFor(m0, fade) : isPlainPaint(m0) ? vcPaint(m0) : m0;
    const m = new THREE.SkinnedMesh(g, mat);
    h0.parent.add(m);
    m.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4());
    m.computeBoundingSphere(); m.computeBoundingBox();         // (now, while it has its arrays: the renderer culls/sorts by it)
    if (hull) { m.userData.isInk = true; m.raycast = NO_RAY; m.frustumCulled = false; }
    else { m.frustumCulled = h0.frustumCulled; m.renderOrder = h0.renderOrder; }
    m.renderOrder = h0.renderOrder;
    for (const h of hs) h.removeFromParent();
  }
}
// merge: the thing never moves and none of its parts are shown/hidden on their own — its
// hulls become one draw (see mergeHulls)
export function ink(root, weight = 'mid', { merge = false } = {}) {
  const mat = INK[weight] || INK.mid;
  const list = [];
  root.traverse(o => {
    if (!o.isMesh || o.userData.noInk || o.userData.isInk || o.userData.gpSkip) return;
    if (o.material?.blending === THREE.AdditiveBlending || o.material?.transparent && (o.material.opacity ?? 1) < 0.5) return;
    if (!o.geometry?.attributes?.normal) return;
    list.push(o);
  });
  const skins = [];
  for (const o of list) {
    const line = new THREE.Mesh(o.geometry, o.geometry.attributes.inkW ? fadeInk(weight) : mat);
    line.userData.isInk = true;
    line.raycast = NO_RAY;
    line.renderOrder = -1;
    if (o.isSkinnedMesh) {                       // a skinned hull must skin too
      // (a geometry with an `inkW` attribute fades its stroke per vertex — limbs use it so
      // no line is drawn where an arm or leg grows out of the body)
      const sk = new THREE.SkinnedMesh(o.geometry, skinnedInk(weight, !!o.geometry.attributes.inkW));
      sk.bind(o.skeleton, o.bindMatrix);
      sk.userData.isInk = true; sk.raycast = NO_RAY; sk.frustumCulled = false;
      o.parent.add(sk);
      sk.position.copy(o.position); sk.quaternion.copy(o.quaternion); sk.scale.copy(o.scale);
      skins.push(sk);
      continue;
    }
    o.add(line);
  }
  if (merge) { const parents = new Set(list.filter(o => !o.isSkinnedMesh).map(o => o.parent)); for (const p of parents) mergeHulls(p); }
  if (skins.length > 1) mergeSkinned(skins, true);
  // the fills too — except on the critic's own model, whose parts are looked up by name later
  // (her backpack straps are traced over the 'sweater')
  const fills = list.filter(o => o.isSkinnedMesh && o.parent);
  if (fills.length > 1 && !fills.some(o => o.userData.part)) mergeSkinned(fills, false);
  if (skins.length) mergeOnBones(root);
  return root;
}
// mergeStatic(obj): bake a finished, inked thing that never moves (a parked car) into one
// mesh per material — its fills and its ink hulls alike — so it costs a handful of draws
// instead of hundreds (a built car is ~235). Every merged mesh shares ONE set of vertex
// buffers (each has only its own index), so a hull costs no extra memory, as before.
// The ink is screen-space, so it looks the same. `keep`: parts that move on their own (a
// car's wheels) — left as they are.
// bounds from just the vertices an index uses (merged meshes share one big vertex buffer)
function tightBounds(g, pos, idx) {
  const bb = new THREE.Box3(), v = new THREE.Vector3();
  for (const t of idx) bb.expandByPoint(v.set(pos[t * 3], pos[t * 3 + 1], pos[t * 3 + 2]));
  const sp = bb.getBoundingSphere(new THREE.Sphere()); let r2 = 0;
  for (const t of idx) r2 = Math.max(r2, sp.center.distanceToSquared(v.set(pos[t * 3], pos[t * 3 + 1], pos[t * 3 + 2])));
  sp.radius = Math.sqrt(r2); g.boundingBox = bb; g.boundingSphere = sp;
}
// vc: plain-paint parts share one mesh per kind of paint, their colour carried per vertex
// gpu: the merged copy is the GPU's alone (nothing raycasts or measures it again) — its arrays
// go once uploaded
export function mergeStatic(root, keep = [], { vc = false, keepMats = [], gpu = false } = {}) {
  const ownMat = new Set(keepMats);
  const skip = new Set(keep);
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), m4 = new THREE.Matrix4(), nm = new THREE.Matrix3();
  const parts = [], used = new Set();
  const walk = (o) => {
    if (skip.has(o) || (o !== root && !o.visible)) return;
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.userData.isInk && !o.geometry.morphAttributes.position) {
      // its hulls: ink children drawn from this same geometry (a fading hull keeps its own mesh)
      const inks = o.children.filter(c => c.isMesh && c.userData.isInk && c.geometry === o.geometry && !o.geometry.attributes.inkW && c.visible);
      inks.forEach(c => used.add(c)); used.add(o);
      parts.push({ o, inks });
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  if (!parts.length) return root;
  const withUv = parts.some(p => p.o.material.map);
  // each part's vertices: only those its index uses (an already-merged part shares a big
  // buffer with its siblings — copy just its own)
  const used_ = parts.map(({ o }) => { const g = o.geometry, I = g.index, n = g.attributes.position.count;
    if (!I) return null; const seen = new Int32Array(n).fill(-1); let k = 0; const IA = I.array; for (let t = 0; t < I.count; t++) { const x = IA[t]; if (seen[x] < 0) seen[x] = k++; } return { seen, k }; });
  let nv = 0; parts.forEach((p, i) => { nv += used_[i] ? used_[i].k : p.o.geometry.attributes.position.count; });
  const asVc = (o) => vc && isPlainPaint(o.material) && !ownMat.has(o.material);
  const withCol = parts.some(p => p.o.geometry.attributes.color || asVc(p.o));
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = withUv ? new Float32Array(nv * 2) : null;
  const col = withCol ? new Float32Array(nv * 3).fill(1) : null;      // (a part without colours: white — its material ignores them)
  const buckets = new Map();                                // material + order → triangle indices
  const into = (mat, order, ink, tris) => { const k = mat.uuid + ':' + order; let b = buckets.get(k); if (!b) buckets.set(k, b = { mat, order, ink, idx: [] }); for (const t of tris) b.idx.push(t); };
  const v = new THREE.Vector3();
  let base = 0;
  parts.forEach(({ o, inks }, pi) => {
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color && g.attributes.color.itemSize >= 3 ? g.attributes.color : null, MC = asVc(o) ? o.material.color : null, n = P.count, I = g.index, map = used_[pi];
    m4.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(m4);
    // (straight off the arrays when they're plain floats: this runs over every vertex of every prop)
    const flat = (A) => A && A.array instanceof Float32Array && !A.isInterleavedBufferAttribute && !A.normalized;
    const e = m4.elements, q = nm.elements, PA = flat(P) && P.itemSize === 3 ? P.array : null, NA = flat(N) && N.itemSize === 3 ? N.array : null;
    for (let i = 0; i < n; i++) {
      const at = map ? map.seen[i] : i; if (at < 0) continue;
      const j = (base + at) * 3;
      if (PA) { const x = PA[i * 3], y = PA[i * 3 + 1], z = PA[i * 3 + 2], w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        pos[j] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w; pos[j + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w; pos[j + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w; }
      else { v.fromBufferAttribute(P, i).applyMatrix4(m4); pos[j] = v.x; pos[j + 1] = v.y; pos[j + 2] = v.z; }
      if (NA) { const x = NA[i * 3], y = NA[i * 3 + 1], z = NA[i * 3 + 2];
        let a = q[0] * x + q[3] * y + q[6] * z, b2 = q[1] * x + q[4] * y + q[7] * z, c = q[2] * x + q[5] * y + q[8] * z; const l = Math.hypot(a, b2, c) || 1;
        nor[j] = a / l; nor[j + 1] = b2 / l; nor[j + 2] = c / l; }
      else if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[j] = v.x; nor[j + 1] = v.y; nor[j + 2] = v.z; }
      if (uv && U && o.material.map) { uv[(base + at) * 2] = U.getX(i); uv[(base + at) * 2 + 1] = U.getY(i); }
      if (col && MC) { col[j] = MC.r; col[j + 1] = MC.g; col[j + 2] = MC.b; } else if (col && C) { col[j] = C.getX(i); col[j + 1] = C.getY(i); col[j + 2] = C.getZ(i); }
    }
    const tris = [];
    if (I) { const IA = I.array; for (let k = 0; k < I.count; k++) tris.push(base + map.seen[IA[k]]); } else for (let k = 0; k < n; k++) tris.push(base + k);
    if (m4.determinant() < 0) for (let k = 0; k < tris.length; k += 3) { const t = tris[k + 1]; tris[k + 1] = tris[k + 2]; tris[k + 2] = t; }   // a mirrored part keeps its facing
    into(asVc(o) ? vcPaint(o.material) : o.material, o.renderOrder, false, tris);
    for (const h of inks) into(h.material, h.renderOrder, true, tris);
    base += map ? map.k : n;
  });
  const A = { position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nor, 3) };
  if (uv) A.uv = new THREE.BufferAttribute(uv, 2);
  if (col) A.color = new THREE.BufferAttribute(col, 3);
  if (gpu) for (const a of Object.values(A)) a.onUpload(_freeArr);
  // out with the old: the merged parts and their hulls, then any group left empty
  for (const o of used) o.removeFromParent();
  const prune = (o) => { for (const c of [...o.children]) prune(c); if (o !== root && !skip.has(o) && o.type === 'Group' && !o.children.length) o.removeFromParent(); };
  prune(root);
  for (const { mat, order, ink, idx } of buckets.values()) {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(A)) g.setAttribute(k, a);
    g.setIndex(idx);
    tightBounds(g, pos, idx);                               // (the shared buffer spans every part: bound just this one's)
    if (gpu) g.index.onUpload(_freeArr);
    const m = new THREE.Mesh(g, mat); m.renderOrder = order;
    if (ink) { m.userData.isInk = true; m.raycast = NO_RAY; }      // (a module-level no-op: a closure here would keep the whole merge's scratch alive)
    root.add(m);
  }
  return root;
}
const _skinInk = {};
// the plain/fading variant of a skinned ink material, at the same weight
const skinnedInkFor = (mat, fade) => { for (const [k, m] of Object.entries(_skinInk)) if (m === mat) return skinnedInk(k.split(':')[0], fade); return mat; };
function skinnedInk(weight, fade = false) {
  const key = weight + (fade ? ':fade' : '');
  if (_skinInk[key]) return _skinInk[key];
  const base = INK[weight] || INK.mid;
  const m = base.clone();
  m.uniforms = { ...inkUniforms, uWeight: base.uniforms.uWeight, uColor: base.uniforms.uColor };
  m.vertexShader = base.vertexShader
    .replace('void main() {', '#include <common>\n#include <skinning_pars_vertex>\nvoid main() {\n#include <skinbase_vertex>\n#include <begin_vertex>\n#include <skinning_vertex>\nvec3 beginN = normal;\n#include <beginnormal_vertex>\n#include <skinnormal_vertex>')
    .replace('vec4(position, 1.0)', 'vec4(transformed, 1.0)')
    .replace('normalize(normalMatrix * normal)', 'normalize(normalMatrix * objectNormal)')
    .replace('floor(position * 2.5)', 'floor(transformed * 2.5)').replace('position * 7.0', 'transformed * 7.0');
  if (fade) m.vertexShader = m.vertexShader
    .replace('uniform float uTime,', 'attribute float inkW;\n      uniform float uTime,')
    .replace('float w = uWidth * uWeight *', 'float w = inkW * uWidth * uWeight *');
  _skinInk[key] = m;
  return m;
}

// ── a soft contact shadow: a dark wash under things instead of shadow maps ──
const _blobTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, 'rgba(60,40,70,0.42)'); g.addColorStop(0.6, 'rgba(60,40,70,0.18)'); g.addColorStop(1, 'rgba(60,40,70,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); return t;
})();
const _blobMat = new THREE.MeshBasicMaterial({ map: _blobTex, transparent: true, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
const _blobGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
export function blobShadow(rx, rz = rx) {
  const m = new THREE.Mesh(_blobGeo, _blobMat);
  m.scale.set(rx, 1, rz); m.position.y = 0.02; m.userData.noInk = true; m.raycast = () => {};
  return m;
}

// tick: advance the ink boil + keep strokes pixel-true after a resize
export function styleTick(t, w, h) {
  inkUniforms.uTime.value = t;
  inkUniforms.uRes.value.set(w, h);
}
