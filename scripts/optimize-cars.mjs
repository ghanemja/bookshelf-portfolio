// Decimate + strip textures + Draco-compress the new car / jet GLBs so they
// are light enough to ship to a browser. Original colours are discarded on
// purpose — the scene re-materials everything with flat cartoon colours.
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const OUT = 'models/opt';
mkdirSync(OUT, { recursive: true });

// Sources live in models/_raw/ (gitignored — kept local for re-optimizing only).
// [source, outName, simplifyRatio]  — cars decimate hard (seen tiny), jet less.
// ev9 is intentionally left out of the scene fleet: 43 material slots give the
// simplifier a hard floor (~280k tris / 2MB), too heavy for background traffic.
const RAW = 'models/_raw';
const JOBS = [
  [`${RAW}/1965_ford_mustang_coupe_289.glb`,                'mustang',   0.10],
  [`${RAW}/2017_kia_picanto_gt-line.glb`,                   'picanto',   0.10],
  [`${RAW}/2024_kia_ev9_gt-line.glb`,                       'ev9',       0.035],
  [`${RAW}/2020_seat_tarraco_e-hybrid.glb`,                 'tarraco',   0.05],
  [`${RAW}/simca_1000_1966.glb`,                            'simca',     0.06],
  [`${RAW}/ford_escort_xr3_i_cabriolet_convertible.glb`,    'escort',    0.08],
  [`${RAW}/orion_skylark_gt.glb`,                           'skylark',   0.10],
  [`${RAW}/2023_faraday_future_ff_91_2.0_futurist_alliance.glb`, 'faraday', 0.12],
  [`${RAW}/2025-pagani-huayra-codalunga-speedster/source/2025 Pagani Huayra Codalunga Speedster.glb`, 'pagani', 0.05],
  [`${RAW}/private-jet/source/самолет.glb`,                 'jet',       0.45],
];

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
await MeshoptSimplifier.ready;

function triCount(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      t += idx ? idx.getCount() / 3 : (p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    }
  return Math.round(t);
}

for (const [src, name, ratio] of JOBS) {
  let doc;
  try { doc = await io.read(src); }
  catch (e) { console.log(`SKIP ${name}: ${e.message}`); continue; }

  const before = triCount(doc);

  // strip every texture: keep material slots + their base colour factor, drop maps
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setBaseColorTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setNormalTexture(null);
    mat.setOcclusionTexture(null);
    mat.setEmissiveTexture(null);
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(0.85);
  }

  await doc.transform(
    dedup(),
    flatten(),
    join(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
    prune({ keepAttributes: false, keepLeaves: false }),
  );

  // drop leftover texture data + tangents/uvs we no longer need
  for (const tex of doc.getRoot().listTextures()) tex.dispose();
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      p.setAttribute('TEXCOORD_0', null);
      p.setAttribute('TEXCOORD_1', null);
      p.setAttribute('TANGENT', null);
    }
  await doc.transform(prune());

  doc.createExtension(KHRDracoMeshCompression).setRequired(true)
    .setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });

  const outPath = `${OUT}/${name}.glb`;
  await io.write(outPath, doc);
  const kb = (statSync(outPath).size / 1024).toFixed(0);
  const srcMB = (statSync(src).size / 1048576).toFixed(1);
  console.log(`${name.padEnd(9)} ${srcMB.padStart(5)}MB -> ${kb.padStart(5)}KB   tris ${before} -> ${triCount(doc)}   mats ${doc.getRoot().listMaterials().length}`);
}
console.log('done');
