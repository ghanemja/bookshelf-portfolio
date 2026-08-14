// Deploy gate: every real-model GLB the site hard-requires must exist and be
// big enough to plausibly be the real optimized asset (guards against empty /
// truncated / placeholder files). Any failure exits non-zero, which aborts
// deploy.sh before anything reaches the live site. No fallbacks.
import { statSync } from 'node:fs';

const REQUIRED = [
  // [path, minimum bytes]
  ['models/opt/mustang.glb', 100_000],
  ['models/opt/picanto.glb', 100_000],
  ['models/opt/tarraco.glb', 100_000],
  ['models/opt/simca.glb',   100_000],
  ['models/opt/escort.glb',  100_000],
  ['models/opt/skylark.glb', 100_000],
  ['models/opt/faraday.glb', 100_000],
  ['models/opt/pagani.glb',  100_000],
  ['models/opt/jet.glb',      50_000],
  ['models/opt/limo.glb',     15_000],
  ['models/opt/gear.glb',     50_000],
  ['models/opt/bike.glb',     20_000],
  ['models/opt/station.glb', 300_000],
  ['models/opt/subway.glb',  150_000],
];

let bad = 0;
for (const [path, min] of REQUIRED) {
  let size = -1;
  try { size = statSync(path).size; } catch { /* missing */ }
  if (size < min) {
    console.error(`✗ ${path} ${size < 0 ? 'MISSING' : `only ${size}B (min ${min}B)`}`);
    bad++;
  }
}
if (bad) { console.error(`${bad} asset(s) failed validation — deploy blocked.`); process.exit(1); }
console.log(`✓ all ${REQUIRED.length} real-model assets present`);
