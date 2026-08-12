# shelfie-jg — a tiny planet

A browser 3D scene (three.js r160, plain ES modules, no build step). `planet.js`
is the whole world; `index.html` hosts it. Deploy is manual Netlify.

## The cartoon art style — non-negotiable

Everything in the world is drawn in a hand-made cartoon style with THREE render
modes (top-right toggle): **Classic** (lit 3D), **Sketchbook** (inked/cel), and
**Wasteland** (grease pencil). Any new model MUST look right in all three.

- **Grease-pencil boil outlines (layered).** Outlines are real geometry: an
  inverted-hull mesh pushed out along normals, drawn with a shader that redraws
  the line ~7×/second with per-vertex wobble so it *boils* like traced-by-hand
  animation. There are **multiple layers** — a firm dark stroke plus a looser,
  lighter over-stroke, out of phase — see `makeBoilMat`, `addBoilTo`, `gpBoilMats`.
  This layered boil is the signature of the look; keep it.
- **Grease-pencil fills.** In Wasteland every material swaps to a flat toon /
  unlit fill (`flatOf`); textured parts keep their map as a flat MeshBasic.
- **Inked mode** is automatic (`scene.overrideMaterial` edge pass) — no per-mesh
  work needed.
- **Streamed-in models must register.** `buildGreasePencil()` runs once; models
  that load later (cars, jet, limo, gear) get skipped unless you call
  **`gpRegister(obj)`** after adding them. Hero/large parts (the jet) also need
  `userData._gpForce = true` to bypass the size/slab skips. If a new thing shows
  up in Wasteland with no ink around it, it wasn't registered.

## Bevels vs. the browser — the balance to hold

The models must read **curved, smooth and real** — bevelled edges, smooth
(not faceted) shading. Faceted low-poly is wrong for this world. BUT this is a
**browser game that must not lag**, so every model is a tradeoff:

- Keep **smooth normals** (`flatShading = false`) and enough geometry that
  silhouettes and bevels stay round — don't over-decimate to the point of facets.
- Counter the cost: hard-decimate photoscans toward ~40–70k tris, shrink every
  texture to **512² WebP**, Draco-compress geometry. Target sub-~1.5MB per model.
- When in doubt, spend polygons on the **silhouette** (curves you see) and save
  them on interior detail you never do.

Judge both at once: if it looks faceted, add geometry; if it stalls on load or
drags the framerate, cut texture size / tris first, not the smoothness.

## Asset pipeline

- Raw source GLBs live in `models/_raw/` (**gitignored, never deployed**).
- `scripts/optimize-cars.mjs` decimates + 512² WebP textures + Draco → `models/opt/*.glb`
  (the only ones shipped). Needs `npm i --no-save @gltf-transform/core
  @gltf-transform/functions @gltf-transform/extensions meshoptimizer draco3dgltf sharp`.
- To add a model: drop it in `models/_raw/`, add a JOBS row (pick a ratio),
  `node scripts/optimize-cars.mjs`, then load `./models/opt/<name>.glb` in
  `planet.js`, normalize with `toTemplate(...)`, `dressCar(...)`, `gpRegister(...)`.
- Vehicles ride the road because they reuse the `traffic[]` lane system.

## Workflow rules

- **Log every feature request** the user makes for this project in
  [`FEATURE_LOG.md`](FEATURE_LOG.md) — append each one as it arrives, with a
  status marker. Keep it current across chats.
- **Redeploy to Netlify after every finished feature request.** Run `./deploy.sh`
  (validates the main character, then `netlify deploy --prod`). A feature isn't
  done until it's live.
- **Bump the cache token** `planet.js?cb=pNN` in `index.html` on every `planet.js`
  edit, or the browser ships stale JS.
- Deploy is manual — `git push` does NOT publish.
