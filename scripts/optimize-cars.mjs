// Shrink the huge photoreal car / jet GLBs enough to ship to a browser WHILE
// keeping their original textures and a smooth, curved silhouette. Levers:
//   • geometry: weld + meshopt simplify to a per-model target (~40-60k tris) —
//     light enough to stay smooth, not so heavy it lags. Smooth normals kept.
//   • textures: resized to 512² and re-encoded to WebP (the real size win).
//   • Draco geometry compression on top.
// Sources live in models/_raw/ (gitignored — kept local only for re-optimizing).
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, flatten, join, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';

const OUT = 'models/opt';
mkdirSync(OUT, { recursive: true });

const RAW = 'models/_raw';
// [source, outName, simplifyRatio] — ratio picked per model to land near ~45k
// tris. ev9 stays OUT of the scene fleet (43 material slots floor the simplifier).
const JOBS = [
  [`${RAW}/1965_ford_mustang_coupe_289.glb`,                'mustang',   0.16],
  [`${RAW}/2017_kia_picanto_gt-line.glb`,                   'picanto',   0.05],
  [`${RAW}/2020_seat_tarraco_e-hybrid.glb`,                 'tarraco',   0.025],
  [`${RAW}/simca_1000_1966.glb`,                            'simca',     0.02],
  [`${RAW}/ford_escort_xr3_i_cabriolet_convertible.glb`,    'escort',    0.024],
  [`${RAW}/orion_skylark_gt.glb`,                           'skylark',   0.03],
  [`${RAW}/2023_faraday_future_ff_91_2.0_futurist_alliance.glb`, 'faraday', 0.5],
  [`${RAW}/2025-pagani-huayra-codalunga-speedster/source/2025 Pagani Huayra Codalunga Speedster.glb`, 'pagani', 0.05],
  [`${RAW}/private-jet/source/самолет.glb`,                 'jet',       0.60],
  [`${RAW}/limo.glb`,                                       'limo',      0.90],
  [`${RAW}/landing_gear.glb`,                               'gear',      0.30],
  [`${RAW}/yellow_bicycle.glb`,                             'bike',      0.60],
  [`${RAW}/train_ride.glb`,                                 'station',   0.10, 0.08],
  [`${RAW}/subway_train_interior.glb`,                      'subway',    0.04],
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

for (const [src, name, ratio, err] of JOBS) {
  let doc;
  try { doc = await io.read(src); }
  catch (e) { console.log(`SKIP ${name}: ${e.message}`); continue; }

  const before = triCount(doc);

  await doc.transform(
    dedup(),
    flatten(),
    join(),
    weld(),
    // keep UVs, normals and tangents — normal maps need them, and smooth
    // normals are what make the low-poly body still read as curved
    simplify({ simplifier: MeshoptSimplifier, ratio, error: err ?? 0.02 }),
    // the actual weight: every texture down to 512² WebP
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 80 }),
    prune(),
  );

  doc.createExtension(KHRDracoMeshCompression).setRequired(true)
    .setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });

  const outPath = `${OUT}/${name}.glb`;
  await io.write(outPath, doc);
  const kb = (statSync(outPath).size / 1024).toFixed(0);
  const srcMB = (statSync(src).size / 1048576).toFixed(1);
  console.log(`${name.padEnd(9)} ${srcMB.padStart(5)}MB -> ${kb.padStart(5)}KB   tris ${before} -> ${triCount(doc)}   tex ${doc.getRoot().listTextures().length}`);
}
console.log('done');
