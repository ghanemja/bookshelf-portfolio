// ─── THE VANISHING GALLERY (v2) — bootstrap + loop ──────────────────────────
import * as THREE from 'three';
import { buildPlanet, buildSky, buildLights, buildClouds, ROADS, ZONES, registerGround, standAt, paintRoadMarkings, LAMPS, collectLamps } from './world.js';
import { styleTick, gpuOnly, bakeScenery } from './style.js';
import { planTown, buildTown } from './town.js';
import { createPlayer } from './player.js';
import { createGame } from './game.js';
import { createCitizens } from './citizens.js';
import { createCuller } from './cull.js';
import { createPlaza } from './plaza.js';
import { createPark } from './park.js';
import { createShopInteriors } from './shopinterior.js';
import { createRooms, ROOM_STYLES } from './rooms.js';
import { createCarParks } from './carparks.js';
import { createTelescope } from './overlook.js';
import { createNorthLife } from './north.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 1.75));   // phones: fewer pixels, cooler GPU
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;          // gouache: colours as painted
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 900);

planTown();                       // reservations + levelled ground first
buildPlanet(scene);
const sky = buildSky(scene);
const lights = buildLights(scene);
const clouds = buildClouds(scene);
const town = buildTown(scene);
collectLamps([scene, ...town.shops.map(sp => sp.root)]);   // every lamp's spot, before the props are baked (the shops' own are in their frames)
// the town's loose props (trees, lamps, benches, planters…), each baked down in place to a fill
// and a hull — before anything reads the ground, so the walk rays index the baked meshes
bakeScenery(scene, new Set(scene.children));

// ── atmosphere: day ↔ night, eased (the cold open is set at night) ──
const DAY = { top: 0xbcd3dc, mid: 0xf2e6cf, low: 0xf6d9bf, hemi: 0xfff6e8, hemiI: 1.35, sunI: 1.6 };
const NIGHT = { top: 0x1f2744, mid: 0x3a3858, low: 0x574766, hemi: 0x8d97c9, hemiI: 0.55, sunI: 0.12 };
const atm = { k: 0, from: 0, to: 0, t: 0, dur: 0 };
const _c = new THREE.Color();
function applyAtmosphere(k) {
  const U = sky.material.uniforms;
  for (const n of ['top', 'mid', 'low']) U[n].value.copy(_c.setHex(DAY[n])).lerp(new THREE.Color(NIGHT[n]), k);
  lights.hemi.color.setHex(DAY.hemi).lerp(new THREE.Color(NIGHT.hemi), k);
  lights.hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * k;
  lights.sun.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * k;
}
const atmosphere = {
  setNight(k) { atm.k = atm.to = k; atm.dur = 0; applyAtmosphere(k); },
  fadeTo(k, secs) { atm.from = atm.k; atm.to = k; atm.t = 0; atm.dur = secs; },
};

registerGround([scene]);          // everything static drawn so far is walkable ground (people come after)
paintRoadMarkings();             // centre lines last: they need every road (and the drawn ground)
const mf = town.museum.frame;
const player = createPlayer(scene, camera, town.colliders, mf(0.8, 3.4), mf(0, -6));
const game = createGame({ scene, camera, town, player, atmosphere, renderer });
registerGround([scene]);          // again, now the case's props (café deck, booth…) are down too
const citizens = createCitizens({ scene, town, game, player, camera });   // bystanders, streamed in after the title is up
const plaza = createPlaza({ scene, town, game, player });                  // Maple Plaza: parked cars, shoppers in and out
const park = createPark({ scene, town, game, player });                    // Lantern Park: strollers, a reader, a coffee
const northLife = createNorthLife({ scene, town, game, player });          // the club's players, the swimmer, the golfer, the Close's neighbours
createCarParks({ scene, town });                                         // the project shops' car parks: a parked car each
const shopInside = createShopInteriors(scene, town.landmarks.filter((l) => l.upper && !ROOM_STYLES.has(l.style)));   // the project shops' living rooms
// YarnFlow, Borrowed Eyes and QR Compass open into whole rooms (rooms.js): walk in at the door.
// The museum's front door is an E prompt on the forecourt: inside is the crime scene.
const rooms = createRooms({ scene, camera, player, game });
for (const o of [lights.hemi, lights.sun, sky]) o.layers.enable(2);       // the rooms are drawn on layer 2
const roomDoors = town.landmarks.filter((l) => ROOM_STYLES.has(l.style)).map((lm) => {
  lm.noLift = true;                                                    // (no cutaway: you go through to the room)
  const _p = new THREE.Vector3();
  return {
    key: lm.style,
    inside: (dir) => { lm.root.worldToLocal(_p.copy(dir).multiplyScalar(40)); return lm.inside(_p.x, _p.z) && _p.z < 2.0; },
    out: () => {                                                        // back on the stoop, facing the street
      const a = lm.root.localToWorld(new THREE.Vector3(0, 0, 3.2)), b = lm.root.localToWorld(new THREE.Vector3(0, 0, 6));
      const dir = a.clone().normalize();
      return { dir, heading: b.sub(a).projectOnPlane(dir).normalize() };
    },
  };
});
game.doors.push({ dir: mf(0, -1.75), r: 1.3, label: 'go inside the museum', act: () => rooms.enter({ key: 'museum', out: () => {
  const dir = mf(0, -1.0);
  return { dir, heading: mf(0, 2).sub(dir).projectOnPlane(dir).normalize() };
} }) });
const telescope = createTelescope({ town, game, player, camera });   // the Summit Overlook's telescope: E for a look at the town
// compile every shader up front, so nothing hitches the first time it comes into view
try { renderer.compile(scene, camera); } catch { /* compiled lazily instead */ }
gpuOnly(scene, renderer, camera); // the world is built: what only the GPU reads leaves the JS heap once uploaded
for (const it of game.items) if (it.kind === 'person') it.obj.position.setLength(standAt(it.obj.position.clone().normalize()));
const culler = createCuller(scene, camera);
window.__v2 = { culler, rooms, scene, camera, renderer, town, player, game, citizens, plaza, park, ROADS, ZONES, LAMPS };

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (atm.dur > 0) {
    atm.t = Math.min(1, atm.t + dt / atm.dur);
    atm.k = atm.from + (atm.to - atm.from) * atm.t * atm.t * (3 - 2 * atm.t);
    applyAtmosphere(atm.k);
    if (atm.t >= 1) atm.dur = 0;
  }
  town.museum.tick(t, 1 - atm.k);
  telescope?.update(dt);
  if (!game.update(dt, t)) { rooms.watch(roomDoors); if (!rooms.update(dt, t)) player.update(dt, t); }
  town.tickShops(player.st.dir);                 // inside a project shop: its upper walls lift away
  // inside a carriage of the parked train: its roof lifts off and the camera rises to look in
  if (town.train) {
    const st = player.st, inT = st.mode === 'walk' && town.train.inside(st.dir);
    for (const r of town.train.roofs) r.visible = !inT;
    if (inT) { if (st.prePitch == null) st.prePitch = st.camPitch; st.camPitch += (0.85 - st.camPitch) * (1 - Math.exp(-3 * dt)); }
    else if (st.prePitch != null) { st.camPitch += (st.prePitch - st.camPitch) * (1 - Math.exp(-3 * dt)); if (Math.abs(st.camPitch - st.prePitch) < 0.01) st.prePitch = null; }
  }
  if (!rooms.inside) {                           // (inside a room the street isn't drawn: its crowds wait)
    citizens.update(dt);
    plaza.update(dt);
    park.update(dt);
    northLife.update(dt);
    shopInside.update(dt, t, player);
  }
  for (const c of clouds.children) c.rotateY(c.userData.spin * dt);
  sky.position.copy(camera.position); sky.material.uniforms.upv.value.copy(camera.up);
  styleTick(t, renderer.domElement.width, renderer.domElement.height);
  if (!rooms.inside) culler.update();                                // people and cars round the far side of the planet aren't drawn
  renderer.render(scene, camera);
  game.afterRender?.();                              // the phone's camera grabs the frame here
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
applyAtmosphere(0);
loop();
