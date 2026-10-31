// ─── THE SUMMIT OVERLOOK'S TELESCOPE: E for a look at the whole town ────────────
// roadside.js stands a coin telescope at the end of the overlook road, facing the town.
// Step up behind it and press E: the view narrows to the eyepiece's circle, aimed at the
// town from high over the hill; drag (or the arrow keys / WASD) to look round, E or Esc to step back.
import * as THREE from 'three';
import { groundAt, slerpDir as slerp } from './world.js';

export function createTelescope({ town, game, player, camera }) {
  const T = town.roadside?.telescope;
  if (!T) return null;
  const { G } = game, st = player.st;

  // the eyepiece: a dark ring round a clear circle, and a hand-lettered line under it
  const ov = document.createElement('div');
  ov.id = 'scopeView'; ov.className = 'hide';
  Object.assign(ov.style, { position: 'fixed', inset: '0', zIndex: 60, cursor: 'grab', touchAction: 'none',
    background: 'radial-gradient(circle at 50% 46%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 37vmin, rgba(42,34,48,0.55) 38.5vmin, #2a2230 40vmin)' });
  const cap = document.createElement('div');
  cap.className = 'sk';
  cap.innerHTML = 'the whole town, from up here · drag to look round · <kbd style="font-family:inherit;border:2px solid var(--ink);border-radius:6px;padding:0 7px;background:var(--gold)">E</kbd> step back';
  Object.assign(cap.style, { position: 'absolute', left: '50%', bottom: '5vh', transform: 'translateX(-50%) rotate(-0.8deg)', padding: '6px 16px', fontSize: '19px', whiteSpace: 'nowrap', maxWidth: '92vw', overflow: 'hidden', textOverflow: 'ellipsis', background: '#fffaf0' });
  cap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (G.ui === 'scope') game.closeUI(); });   // (a tap on the line steps back, on touch)
  ov.appendChild(cap);
  document.body.appendChild(ov);

  // the view through it: the town is too far round the planet to see from eye height, so the
  // lens carries you out over the hill — high above the way to the town, looking down on it
  const town0 = T.town.clone().normalize(), here = T.dir.clone().normalize();
  const span = here.angleTo(town0);
  const up = slerp(here, town0, 0.42);
  const eye = up.clone().multiplyScalar(groundAt(up) + 7 + span * 40 * 0.35);
  const aim = town0.clone().multiplyScalar(groundAt(town0)).sub(eye).normalize();
  const toTown = aim.clone().sub(up.clone().multiplyScalar(up.dot(aim))).normalize();
  const side = new THREE.Vector3().crossVectors(toTown, up).normalize();
  const base = { yaw: 0, pitch: Math.asin(THREE.MathUtils.clamp(aim.dot(up), -1, 1)) };
  const herFwd = town0.clone().sub(here.clone().multiplyScalar(here.dot(town0))).normalize();
  const look = { yaw: 0, pitch: 0 }, _d = new THREE.Vector3();
  let fov0 = camera.fov, hudWas = false;
  const hud = document.getElementById('hud');                         // (the to-do list steps aside while you look)

  const cam = (camera) => {
    const y = base.yaw + look.yaw, p = THREE.MathUtils.clamp(base.pitch + look.pitch, -1.3, 0.2);
    _d.copy(toTown).multiplyScalar(Math.cos(y) * Math.cos(p)).addScaledVector(side, Math.sin(y) * Math.cos(p)).addScaledVector(up, Math.sin(p));
    camera.position.copy(eye); camera.up.copy(up); camera.lookAt(_d.add(eye));
  };

  // drag to look round (and the keys, ticked from main's loop)
  let drag = null;
  ov.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; ov.style.cursor = 'grabbing'; ov.setPointerCapture?.(e.pointerId); });
  ov.addEventListener('pointermove', (e) => {
    if (!drag) return;
    look.yaw = THREE.MathUtils.clamp(look.yaw - (e.clientX - drag.x) * 0.0025, -1.2, 1.2);
    look.pitch = THREE.MathUtils.clamp(look.pitch + (e.clientY - drag.y) * 0.0025, -0.5, 0.5);
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; ov.style.cursor = 'grab'; };
  ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);

  function open() {
    if (G.ui || G.state !== 'play') return;
    st.dir.copy(T.stand); st.camFwd.copy(herFwd);                     // she steps up behind it
    look.yaw = 0; look.pitch = 0;
    hudWas = hud && !hud.classList.contains('hide');
    fov0 = camera.fov; camera.fov = 34; hud?.classList.add('hide'); camera.updateProjectionMatrix();
    st.camHook = cam; G.ui = 'scope'; st.enabled = false;
    G.uiClose = () => {
      if (st.camHook === cam) { st.camHook = null; st.camInit = false; }
      camera.fov = fov0; camera.updateProjectionMatrix(); endDrag();
      if (hudWas) hud?.classList.remove('hide');
    };
    ov.classList.remove('hide');
  }
  game.doors.push({ dir: T.stand, r: 1.1, label: 'look through the telescope', act: open });

  return {
    update(dt) {
      if (G.ui !== 'scope') return;
      const k = (...c) => c.some(q => st.keys.has(q)), s = 0.9 * dt;
      if (k('ArrowLeft', 'KeyA')) look.yaw = Math.min(1.2, look.yaw + s);
      if (k('ArrowRight', 'KeyD')) look.yaw = Math.max(-1.2, look.yaw - s);
      if (k('ArrowUp', 'KeyW')) look.pitch = Math.min(0.5, look.pitch + s * 0.6);
      if (k('ArrowDown', 'KeyS')) look.pitch = Math.max(-0.5, look.pitch - s * 0.6);
    },
  };
}
