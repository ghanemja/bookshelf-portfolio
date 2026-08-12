// Deploy gate: the main character must exist and be a valid rigged, animated
// GLB. Exits non-zero (blocking the deploy) if critic.glb is missing, not a
// GLB, or lacks meshes / a skin / animations. Run in CI before publish, or
// locally with `node scripts/validate-critic.mjs`.
import { readFileSync } from 'node:fs';

const PATH = 'models/critic.glb';
const fail = (m) => { console.error(`✗ MAIN CHARACTER INVALID — deploy blocked: ${m}`); process.exit(1); };

let buf;
try { buf = readFileSync(PATH); } catch { fail(`${PATH} is missing`); }
if (buf.length < 20) fail(`${PATH} is too small to be a GLB (${buf.length} bytes)`);

// GLB header: magic 'glTF' (0x46546C67), then version, then total length.
if (buf.readUInt32LE(0) !== 0x46546C67) fail('not a binary glTF (bad magic)');

// First chunk must be JSON (type 0x4E4F534A = 'JSON').
const jsonLen = buf.readUInt32LE(12);
if (buf.readUInt32LE(16) !== 0x4E4F534A) fail('first chunk is not JSON');

let gltf;
try { gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')); }
catch (e) { fail(`JSON chunk unparseable: ${e.message}`); }

const meshes = gltf.meshes?.length ?? 0;
const skins = gltf.skins?.length ?? 0;
const anims = gltf.animations?.length ?? 0;
if (!meshes) fail('has no meshes');
if (!skins) fail('has no skin (not rigged)');
if (!anims) fail('has no animations');

console.log(`✓ critic.glb OK — ${meshes} mesh(es), ${skins} skin(s), ${anims} animation(s)`);
