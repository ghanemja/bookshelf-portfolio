// ─── THE GAME FLOW: title → cold open → the case ────────────────────────────
// The cold open follows the classic adventure-game shape: a few silent,
// letterboxed shots of the crime (≈10s, skippable), then you're in control
// with one buzz of the phone telling you why you're here. After that the game
// never explains a clue — you look, you listen, you decide.
// Act 2 (once you've named the thief): the getaway to Cape Far Side, a launch
// countdown, an ABORT button, the police, and a letterboxed epilogue.
import * as THREE from 'three';
import { R, SEA, arc, radiusAt, settle, yawToFace, nearestRoad, standAt, alignToSurface, slerpDir, isWater, groundAt, ROADS } from './world.js';
import { CAPE, cargoRocket, launchConsole, paintingCrate } from './buildings.js';
import { buildCar } from './player.js';
import { createPhone } from './phone.js';
import { createGuide } from './route.js';
import { buildWalkers, tickWalkers, walkerHome, WALKERS } from './crowd.js';
import { createBumps } from './bump.js';
import { CLUES, PEOPLE, SUSPECTS, PLACES, judge, buildCase, sketchProp } from './story.js';
import { paintPeople, paintThings } from './portraits.js';
import { LOOKS } from './human.js';
import { pose } from './human.js';
import { poseFolk } from './folk.js';
import { ink } from './style.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hide', !on);

export function createGame({ scene, camera, town, player, atmosphere, renderer }) {
  const G = {
    state: 'title', t0: 0, found: new Set(), met: new Set(), talked: new Set(), solved: false, act: 1,
    ui: null, talkIdx: 0, talkWho: null, pickSus: null, pickClues: new Set(),
  };
  const items = buildCase(scene, town);
  // painted portraits + clue sketches for the UI, rendered once from the real models
  const FACE = paintPeople(renderer, LOOKS);
  const SKETCH = paintThings(renderer, Object.fromEntries(CLUES.map(c => [c.id, sketchProp(c.id) || items.find(i => i.id === c.id)?.obj])));
  const face = (id, cls = 'pt') => FACE[id] ? `<img class="${cls}" src="${FACE[id]}" alt="">` : '';
  const sketch = (id, cls = 'pt') => SKETCH[id] ? `<img class="${cls}" src="${SKETCH[id]}" alt="">` : '';
  const mus = town.museum.group;
  const ML = (x, y, z) => mus.localToWorld(new THREE.Vector3(x, y, z));

  // ── a parked jeep you can walk up to ──
  // (a level frame on the planet, with the car inside it pitched/rolled onto its four tyres)
  const parked = new THREE.Group(), parkedBody = player.bodies.jeep.clone(true);
  parked.add(parkedBody); parkedBody.visible = true;
  const seatParked = () => { parked.position.setLength(standAt(parked.position.clone().normalize())); parkedBody.position.y = 0; parkedBody.rotation.set(0, 0, 0); player.fitToGround(parkedBody, parked); };
  // beside the plaza, in view when you start — not behind you where the camera sits —
  // and ON the road, pulled in to the kerb, pointing along it (the car keeps to roads)
  let jeepSpot = town.museumFrame(5.4, 2.2), jeepFace = town.museumFrame(5.4, 12);
  {
    const nr = nearestRoad(jeepSpot);
    if (nr && nr.dist < 6) {
      const lat = new THREE.Vector3().crossVectors(nr.point, nr.tangent).normalize();
      const sg = Math.sign(lat.dot(jeepSpot.clone().sub(nr.point))) || 1;
      jeepSpot = nr.point.clone().multiplyScalar(R).addScaledVector(lat, sg * nr.half * 0.45).normalize();
      jeepFace = jeepSpot.clone().multiplyScalar(R).addScaledVector(nr.tangent, 5).normalize();
    }
  }
  settle(parked, jeepSpot, 1.0, 0, yawToFace(jeepSpot, jeepFace));
  parked.visible = true;                 // the player's car body starts hidden (you're on foot), and so did its clone
  parked.userData.noGround = true;
  scene.add(parked);
  seatParked();
  let jeepDir = jeepSpot.clone();

  // ── the little boat at the harbour: moored by the pier, yours to take out for fun ──
  const moored = new THREE.Group(), mooredBody = player.bodies.boat.clone(true);
  moored.add(mooredBody); mooredBody.visible = true;
  moored.userData.noGround = true;
  let boatDir = town.harbour.boat.clone();
  const moor = (d, face) => { moored.position.copy(d).multiplyScalar(R + SEA); alignToSurface(moored, d, yawToFace(d, face)); };
  moor(boatDir, town.harbour.boatFace);
  scene.add(moored);
  // where you can step off the boat: dry land or the pier, just over the side
  function landingSpot() {
    const here = player.st.dir, h = player.st.heading, side = new THREE.Vector3().crossVectors(h, here).normalize();
    for (const dist of [1.2, 1.6, 2.1]) for (const a of [Math.PI / 2, -Math.PI / 2, 1.0, -1.0, 2.1, -2.1, 0, Math.PI]) {
      const c = here.clone().multiplyScalar(R).addScaledVector(h, Math.cos(a) * dist).addScaledVector(side, Math.sin(a) * dist).normalize();
      if (isWater(c, -0.1) && groundAt(c) < R + SEA + 0.2) continue;            // properly dry (not the waterline), or the pier
      if (town.colliders.some(k => arc(c, k.dir) < k.r + 0.3)) continue;
      return c;
    }
    return null;
  }

  // ── townsfolk out walking, and what happens when the car meets anyone ──
  const walkers = buildWalkers(scene, town);
  const bumps = createBumps({ camera, player });
  const VOICE = {
    vivi: { pitch: 380, line: 'My INSURANCE!' }, otto: { pitch: 150, line: 'I was on my BREAK!' },
    pia: { pitch: 350, line: 'Watch it — I\'m the courier here!' }, rex: { pitch: 190, line: 'Oi! Mind the paintwork!' },
    ezra: { pitch: 135, line: 'Mind my PAPER!' },
  };
  for (const it of items) {
    if (it.kind !== 'person') continue;
    it.homePos = it.obj.position.clone(); it.homeQ = it.obj.quaternion.clone();
    bumps.add(it.obj, { ...VOICE[it.id], home: () => it.dir,
      onAway: () => { it.knocked = true; },
      onBack: () => { it.obj.position.copy(it.homePos); it.obj.quaternion.copy(it.homeQ); it.knocked = false; } });
  }
  for (const w of walkers) bumps.add(w.obj, { pitch: WALKERS[w.id].pitch, line: WALKERS[w.id].line,
    home: () => walkerHome(w), onAway: () => { w.paused = true; }, onBack: () => { w.paused = false; } });

  // ── title ──
  show($('loader'), false);
  show($('title'));
  $('start').onclick = () => startColdOpen();
  // sound can only start from a click or a key: the title's own music comes in on the first one
  const wake = () => { audio.start(); if (G.state === 'title') audio.setScene('title'); };
  addEventListener('pointerdown', wake, { once: true }); addEventListener('keydown', wake, { once: true });
  const sndBtn = $('sndBtn');
  const drawSnd = () => { sndBtn.classList.toggle('off', audio.muted); sndBtn.title = audio.muted ? 'sound off (M)' : 'sound on (M)'; };
  sndBtn.onclick = (e) => { e.stopPropagation(); audio.start(); audio.setMuted(!audio.muted); drawSnd(); sndBtn.blur(); };
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { audio.start(); audio.setMuted(!audio.muted); drawSnd(); } });
  drawSnd();
  addEventListener('keydown', (e) => { if (e.code === 'Enter' && G.state === 'title') startColdOpen(); });

  // ── cold open: three silent shots of last night ──
  const SHOTS = [
    { dur: 3.4, cap: 'Opening night.', from: [0, 26, 42], to: [0, 18, 30], look: [0, 3, -5] },
    { dur: 3.2, cap: '3:07 a.m.', from: [7.5, 12.5, -1.0], to: [5.4, 11.2, -2.6], look: [0.9, 9.2, -6.2] },
    { dur: 3.4, cap: 'Every frame — empty.', from: [4.6, 2.0, 4.6], to: [3.5, 1.7, 3.0], look: [2.2, 1.55, 0.6] },
  ];
  const COLD = SHOTS.reduce((a, s) => a + s.dur, 0);
  function startColdOpen() {
    if (G.state !== 'title') return;
    G.state = 'cold'; G.t0 = performance.now() / 1000; G.coldShot = -1;
    audio.start(); audio.setScene('night');
    show($('title'), false);
    document.body.classList.add('cine');
    show($('skip'));
    atmosphere.setNight(1);
    player.st.enabled = false;
  }
  $('skip').onclick = () => { if (G.state === 'cold') endColdOpen(); };
  function endColdOpen() {
    G.state = 'phone';
    document.body.classList.remove('cine');
    show($('caption'), false); show($('skip'), false);
    atmosphere.fadeTo(0, 1.6);                       // dawn breaks
    audio.setScene('dawn');
    // open looking at the museum: drop any look-drag made over the cold open
    Object.assign(player.st, { camYaw: 0, camPitch: 0, zoomT: 1, zoom: 1, camInit: false });
    player.st.camFwd.copy(player.st.heading);
    setTimeout(openPhone, 900);
  }
  // the opening brief arrives as texts on the critic's own phone: it buzzes, comes up
  // open on Messages, the editor types, and you answer "on it"
  function openPhone() {
    navigator.vibrate?.([60, 80, 60]); audio.buzz(2);
    phone.open('messages');
    phone.setTyping(true);
    G.phoneUp = true;
    // (put the phone away before you've answered and the case simply begins: the texts
    // still land, as unread, but nothing is left waiting on a reply you can't see —
    // that left the game stuck between the phone and play, walking with no E prompts)
    const opening = () => G.state === 'phone';
    setTimeout(() => { phone.setTyping(false); phone.push('Editor', 'You\'re at the museum? Good. All 45 paintings went overnight. The police have nothing.'); if (opening()) phone.setTyping(true); }, 900);
    setTimeout(() => { phone.setTyping(false); phone.push('Editor', 'You know those canvases better than anyone. Find out who — and where they\'re going.');
      if (!opening()) return;
      // three ways to answer; the editor answers back, then you're off
      const BACK = ['Good. Start with Director Vivi — she\'s on the museum steps.',
        'That\'s why I called you. Vivi\'s on the steps — start there.',
        'You\'re the one who reviewed every one of them. Vivi\'s waiting on the steps.'];
      phone.setReply(['on it', 'heading in now', 'why me??'], (i) => {
        if (!phone.state.open) { beginPlay(); return; }
        phone.setTyping(true);
        setTimeout(() => { phone.setTyping(false); phone.push('Editor', BACK[i] ?? BACK[0]); }, 1000);
        setTimeout(() => { if (G.state === 'phone') phone.close(); beginPlay(); }, 3400);         // time to read the answer
      }); }, 2400);
  }
  function beginPlay() {
    if (G.state !== 'phone') return;               // once only (the reply and the put-away can both get here)
    G.state = 'play';
    if (!phone.state.open) { phone.setReply(null); phone.setTyping(false); }   // put away unanswered: no reply left hanging
    audio.setScene('day');
    // start the game looking at the museum, whatever happened over the intro and the texts
    Object.assign(player.st, { camYaw: 0, camPitch: 0, recenter: 0 });
    player.st.camFwd.copy(player.st.heading);
    player.st.enabled = true; player.st.playing = true;
    show($('hud')); show($('nbBtn')); show($('bagBtn')); showKeys();
    phone.state.unread = 0;
    updateGoal();
  }
  // the controls strip: always there (H hides it), and it changes when you drive
  let keysOn = true;
  function showKeys() {
    const k = (t) => `<kbd>${t}</kbd>`;
    $('hint').innerHTML = player.st.mode === 'jeep'
      ? `${k('W')}${k('S')} drive · ${k('A')}${k('D')} steer · ${k('E')} get out · scroll to zoom · ${k('C')} camera behind · ${k('H')} hide`
      : player.st.mode === 'boat'
      ? `${k('W')}${k('S')} throttle · ${k('A')}${k('D')} steer · ${k('E')} get out (by the pier or the shore) · scroll to zoom · ${k('C')} camera behind · ${k('H')} hide`
      : `${k('WASD')} walk · ${k('Shift')} run · ${k('E')} look / talk · ${k('N')} notebook · ${k('B')} backpack · ${k('P')} phone · drag to look · scroll to zoom · ${k('C')} camera · ${k('H')} hide`;
    show($('hint'), keysOn && G.state === 'play');
  }

  // ── what's near you, and what pressing E does ──
  let nearest = null;
  const doors = [];                                   // doorways you press E at: { dir, r, label, act } (the museum's, rooms.js)
  function scan() {
    if (G.room) { nearest = null; return; }           // inside a room: rooms.js has the prompt
    nearest = null;
    if (G.state !== 'play' || G.ui || phone.busy) { show($('prompt'), false); return; }
    const here = player.st.dir;
    let best = 1e9;
    if (player.st.mode === 'walk') {
      for (const it of items) {
        if (it.knocked) continue;                    // can't chat to someone mid-air
        const lim = it.reach ?? (it.kind === 'person' ? 2.4 : 2.1);
        const d = arc(here, it.dir);
        if (d < lim && d < best) { best = d; nearest = it; }
      }
      const dj = arc(here, jeepDir);
      if (dj < 2.6 && (!nearest || dj < best)) { best = dj; nearest = { kind: 'jeep' }; }
      const db = arc(here, boatDir);                  // (it lies ~1.9 off the pier's middle: 2.4 only caught her right at its beam)
      if (db < 3.1 && (!nearest || db < best)) { best = db; nearest = { kind: 'boat' }; }
      if (G.act === 3 && cape.console && arc(here, cape.consoleDir) < 1.9) nearest = { kind: 'console' };
      for (const lm of town.landmarks) { if (lm.decor) continue; const d = arc(here, lm.dir); if (d < 3.6 && d < best) { best = d; nearest = { kind: 'project', lm }; } }
      for (const dr of doors) { const d = arc(here, dr.dir); if (d < dr.r && d < best) { best = d; nearest = { kind: 'door', dr }; } }
    } else if (player.st.mode === 'boat') { const spot = landingSpot(); nearest = spot ? { kind: 'exit', spot } : null; }
    else nearest = { kind: 'exit' };
    const pr = $('prompt');
    if (!nearest) { show(pr, false); return; }
    const label = nearest.kind === 'person' ? `talk to ${PEOPLE.find(p => p.id === nearest.id).name.split(',')[0]}`
      : nearest.kind === 'jeep' ? 'get in the car' : nearest.kind === 'boat' ? 'get in the boat' : nearest.kind === 'exit' ? 'get out'
      : nearest.kind === 'console' ? 'ABORT THE LAUNCH' : nearest.kind === 'project' ? `visit ${nearest.lm.name}`
      : nearest.kind === 'door' ? nearest.dr.label : 'look closer';
    pr.innerHTML = `<kbd>E</kbd>${label}`;
    show(pr);
  }
  $('prompt').onclick = () => act();
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') act();
    if (e.code === 'Escape') closeUI();
    if (e.code === 'KeyN' && G.state === 'play') toggleNotebook();
    if (e.code === 'KeyH' && G.state === 'play') { keysOn = !keysOn; showKeys(); }
  });
  function act() {
    if (G.state !== 'play' || phone.busy) return;
    if (G.ui === 'card') { closeUI(); return; }
    if (G.ui === 'talk') { nextLine(); return; }
    if (G.ui) return;
    if (G.room) return G.room.act();
    if (!nearest) return;
    if (nearest.kind === 'door') return nearest.dr.act();
    if (nearest.kind === 'clue') return openClue(nearest);
    if (nearest.kind === 'person') return openTalk(nearest.id);
    if (nearest.kind === 'console') return abortLaunch();
    if (nearest.kind === 'project') return openProject(nearest.lm);
    if (nearest.kind === 'jeep') { parked.visible = false; player.setMode('jeep'); player.st.heading = new THREE.Vector3(0, 0, 1).applyQuaternion(parked.quaternion); player.st.camFwd.copy(player.st.heading); showKeys(); renderCase(); return; }
    if (nearest.kind === 'boat') {
      moored.visible = false; player.setMode('boat');
      player.st.dir.copy(boatDir);
      player.st.heading = new THREE.Vector3(0, 0, 1).applyQuaternion(moored.quaternion).projectOnPlane(boatDir).normalize();
      player.st.camFwd.copy(player.st.heading); showKeys(); return;
    }
    if (nearest.kind === 'exit' && player.st.mode === 'boat') {
      // leave the boat bobbing where you stopped, and step over the side onto the pier or the bank
      boatDir = player.st.dir.clone();
      moor(boatDir, boatDir.clone().multiplyScalar(R).addScaledVector(player.st.heading, 5).normalize());
      moored.visible = true;
      player.setMode('walk');
      player.st.dir.copy(nearest.spot); player.st.gr = 0;
      showKeys(); return;
    }
    if (nearest.kind === 'exit') {
      player.setMode('walk');
      jeepDir = player.st.dir.clone();
      parked.position.copy(player.root.position); parked.quaternion.copy(player.root.quaternion); parked.visible = true; seatParked();
      // step out beside the car
      const side = new THREE.Vector3().crossVectors(player.st.dir, player.st.heading).normalize();
      player.st.dir.multiplyScalar(40).addScaledVector(side, 1.6).normalize();
      showKeys(); renderCase();
    }
  }
  function closeUI() {
    if (!G.ui || G.ui === 'police') return;                 // the police shot plays out on its own
    if (player.st.camHook === convoCam) { player.st.camHook = null; player.st.camInit = false; }
    show($({ card: 'card', talk: 'talk', nb: 'nb', proj: 'card' }[G.ui]), false);
    const was = G.ui;
    G.ui = null; player.st.enabled = true;
    if (was === 'nb' && G.solved && G.act === 1) startGetaway();
  }

  // ── a found thing ──
  function openClue(it) {
    const c = CLUES.find(c => c.id === it.id);
    const isNew = !G.found.has(c.id);
    audio.knock();
    G.found.add(c.id);
    if (it.glint) it.glint.visible = false;
    if (isNew) {
      if (G.found.size === 1) setTimeout(() => phone.push('Mum', 'saw the museum on the news!! are you safe?? are you eating??'), 2500);
      if (c.id === 'van') setTimeout(() => phone.push('Editor', 'FRAME & CO.? Isn\'t that the framer who hung the whole show?'), 2000);
      if (c.id === 'ticket') phone.addItem('ticket');
      if (G.found.size === 4) setTimeout(() => phone.push('Editor', 'When you\'re sure, take it to Vivi — the police will listen to her. Name a name, show two things.'), 2500);
    }
    $('card').innerHTML = `<div class="ic">${sketch(c.id)}</div><h3>${c.title}</h3><p>${c.text}</p>
      <div class="note">${isNew ? 'noted in your notebook' : 'already in your notebook'}</div><button class="sk" id="cardOk">ok</button>`;
    show($('card')); G.ui = 'card'; player.st.enabled = false;
    $('cardOk').onclick = closeUI;
    updateGoal();
  }
  // ── someone talks ──
  // a conversation is framed over the critic's shoulder: the camera stands behind her and a
  // little to one side, at eye level, so the one talking faces you and she's at the frame's edge
  const conv = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false, side: 1 };
  const _cv = new THREE.Vector3();
  // where the talk camera sits: behind her shoulder on side `sg`, swung round her by `sw` radians
  const _rc = new THREE.Raycaster(); _rc.camera = camera;
  // (k < 1 pulls the camera in toward her, when nothing further out has a clear view)
  function convoSpot(mid, up, ab, dist, sg, sw, k = 1) {
    const a = mid.clone().addScaledVector(ab, -dist / 2);
    const side = new THREE.Vector3().crossVectors(up, ab).normalize().multiplyScalar(sg);
    const off = ab.clone().multiplyScalar(-1.7).addScaledVector(side, 0.95).applyAxisAngle(up, sw * sg).multiplyScalar(k);
    return a.add(off).addScaledVector(up, 1.0 + 0.12 * k);
  }
  // look at the speaker's face, a touch toward her so both read
  const convoLook = (mid, up, ab, dist) => mid.clone().addScaledVector(ab, dist * 0.28).addScaledVector(up, 0.9);
  function convoCam(cam, root) {
    const it = items.find(i => i.id === G.talkWho?.id); if (!it) return;
    const a = root.position, b = it.obj.position;
    const mid = a.clone().add(b).multiplyScalar(0.5), up = mid.clone().normalize();
    const ab = b.clone().sub(a).projectOnPlane(up); const dist = ab.length(); ab.normalize();
    const want = convoSpot(mid, up, ab, dist, conv.side, conv.swing || 0, conv.k ?? 1);
    const look = convoLook(mid, up, ab, dist);
    const now = performance.now() / 1000, dt = conv.init ? Math.min(0.1, now - conv.t) : 0; conv.t = now;
    if (!conv.init) { conv.pos.copy(conv.cut ? want : cam.position); conv.look.copy(look); conv.init = true; }
    conv.pos.lerp(want, 1 - Math.exp(-3.5 * dt)); conv.look.lerp(look, 1 - Math.exp(-6 * dt));
    cam.position.copy(conv.pos); cam.up.copy(up); cam.lookAt(conv.look);
  }
  function startConvo(it) {
    // face them, and put the camera on whichever side isn't inside a building
    const st = player.st, d = it.dir.clone();
    st.heading = d.sub(st.dir.clone().multiplyScalar(st.dir.dot(d))).normalize();
    const mid = player.root.position.clone().add(it.obj.position).multiplyScalar(0.5), up = mid.clone().normalize();
    const ab = it.obj.position.clone().sub(player.root.position).projectOnPlane(up).normalize();
    // try each side and a few swings round the pair; take the first view nothing stands in
    const dist = it.obj.position.clone().sub(player.root.position).projectOnPlane(up).length(), look = convoLook(mid, up, ab, dist);
    const skip = new Set([player.root, it.obj]);
    // the whole shot must be clear, not just its centre: both of you head to foot, and the
    // edges of the frame either side and above — nothing may stand between them and the camera
    const pa = player.root.position, pb = it.obj.position;
    const at = (p, h) => p.clone().addScaledVector(up, h);
    const targets = [look, at(pa, 1.1), at(pb, 1.1), at(pa, 0.2), at(pb, 0.2), look.clone().addScaledVector(ab, 1.7), look.clone().addScaledVector(ab, -1.7), at(mid, 1.6), at(mid, 0.05)];
    // what can stand in the way: the solid things near the pair. Raycasting the whole scene for
    // each candidate froze the game for a second or more — the town is baked into big meshes (a
    // block per material, up to ~30k triangles each) and every person's skin is re-posed per ray.
    // So, once: take the triangles of the solid things near the pair, in world space, into small
    // stand-in meshes, one per metre cell (each ray then skips every cell it doesn't pass near).
    // Anyone else standing nearby counts as two spheres (body, head) — their skinned meshes are
    // far too slow to cast at. The ground never blocks (the big un-inked surfaces: lawns, roads,
    // plazas), and nor do ink hulls or glass.
    // (everyone the car can knock over is registered with the bumps: the cast, walkers, citizens)
    const people = new Set([...bumps.bodies.map(b => b.obj), player.root]);
    const reach = 4.5 + dist * 0.6, near = [], _bs = new THREE.Sphere();
    const others = [...people].filter(o => !skip.has(o) && o.visible && o.position.distanceTo(mid) < reach + 1)
      .flatMap(o => { const u = o.position.clone().normalize(); return [new THREE.Sphere(o.position.clone().addScaledVector(u, 0.45), 0.3), new THREE.Sphere(o.position.clone().addScaledVector(u, 1.0), 0.22)]; });
    const _sp = new THREE.Vector3();
    const a3 = new THREE.Vector3(), b3 = new THREE.Vector3(), c3 = new THREE.Vector3(), cen = new THREE.Vector3();
    const cells = new Map();                                             // stand-in triangles, by cell + material side
    scene.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || !o.visible || o.userData.isInk || o.name === 'planet' || o.name === 'sea' || o.userData.noInk && o.material?.transparent) return;
      for (let q = o; q; q = q.parent) { if (skip.has(q) || people.has(q) || !q.visible) return; }
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      _bs.copy(o.isInstancedMesh ? (o.boundingSphere || (o.computeBoundingSphere(), o.boundingSphere)) : g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (o.userData.noInk && _bs.radius > 6 || _bs.center.distanceTo(mid) > reach + _bs.radius) return;
      if (o.isInstancedMesh) { near.push(o); return; }
      const pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, mat = Array.isArray(o.material) ? o.material[0] : o.material;
      for (let i = 0; i < n; i += 3) {
        a3.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        b3.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
        c3.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
        cen.copy(a3).add(b3).add(c3).divideScalar(3);
        const rad = Math.max(cen.distanceTo(a3), cen.distanceTo(b3), cen.distanceTo(c3));
        if (cen.distanceTo(mid) > reach + rad) continue;
        const key = `${mat.side}|${Math.floor(cen.x)},${Math.floor(cen.y)},${Math.floor(cen.z)}`;
        let out = cells.get(key); if (!out) cells.set(key, out = []);
        out.push(a3.x, a3.y, a3.z, b3.x, b3.y, b3.z, c3.x, c3.y, c3.z);
      }
    });
    const sideMat = [0, 1, 2].map(side => new THREE.MeshBasicMaterial({ side }));
    for (const [key, tri] of cells) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
      near.push(new THREE.Mesh(g, sideMat[+key.split('|')[0]]));
    }
    const hit = (from, to) => {
      const dv = to.clone().sub(from), L = dv.length();
      _rc.set(from, dv.normalize()); _rc.far = Math.max(0.01, L - 0.15);
      if (others.some(sp => _rc.ray.intersectSphere(sp, _sp) && _sp.distanceTo(from) < _rc.far)) return true;
      return _rc.intersectObjects(near, false).length > 0;
    };
    // cast both ways: a ray only meets the faces turned toward it, so one leaving a spot that is
    // inside something (the van), or passing behind a one-sided wall, would see nothing at all
    const blocked = (a, b) => hit(a, b) || hit(b, a);
    // a spot's cost: how much of the shot is hidden (the look point counts triple); stop counting
    // as soon as it can't beat the best spot so far
    const cost = (p, cap) => { let n = 0; for (const t of targets) { if (blocked(p, t)) n += t === look ? 3 : 1; if (n >= cap) break; } return n; };
    const sides = it.id === 'otto' ? [-1, 1] : [1, -1];                  // Otto: from the road side, away from the easels
    conv.side = sides[0]; conv.swing = 0; conv.k = 1;
    let best = 1e9;
    // (never swung so far round that it looks at her face instead of theirs)
    outer: for (const sw of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1]) for (const sg of sides) {
      const c = cost(convoSpot(mid, up, ab, dist, sg, sw), best);
      if (c < best) { best = c; conv.side = sg; conv.swing = sw; }
      if (!c) break outer;
    }
    // nothing fully clear: on the best side, come in toward the pair until they can be seen
    if (best) for (const k of [0.8, 0.62, 0.46, 0.34]) {
      const p = convoSpot(mid, up, ab, dist, conv.side, conv.swing, k);
      conv.k = k;
      if (!blocked(p, look)) break;
    }
    // if gliding there would pass through something (an easel, a wall), cut straight to it
    conv.cut = hit(camera.position, convoSpot(mid, up, ab, dist, conv.side, conv.swing, conv.k));
    for (const m of near) if (!m.parent) m.geometry.dispose();
    sideMat.forEach(m => m.dispose());
    conv.init = false;
    player.st.camHook = convoCam;
  }
  const REX_CAPE = { id: 'rex', name: 'Rex, framer', lines: [
    'Persistent, aren\'t you. Forty-five canvases, one rocket, and a very private collector on the far side of nowhere.',
    'Frames are my life\'s work, you know. Nobody ever looks at the frames.',
    'And you can\'t stop it — the count\'s already running. Ta-ra!'] };
  const REX_CAUGHT = { id: 'rex', name: 'Rex, framer', lines: ['I\'m not coming down.', '…Is there such a thing as a lawyer on the far side?'] };
  function openTalk(id) {
    G.talkWho = id === 'rex' && G.act === 2 ? REX_CAPE : id === 'rex' && G.act >= 4 ? REX_CAUGHT : PEOPLE.find(p => p.id === id); G.talkIdx = 0;
    audio.knock();
    startConvo(items.find(i => i.id === id));
    G.met.add(id);
    const it = items.find(i => i.id === id); if (it?.glint) it.glint.visible = false;
    G.ui = 'talk'; player.st.enabled = false;
    renderTalk();
  }
  function renderTalk() {
    const p = G.talkWho, last = G.talkIdx >= p.lines.length - 1;
    const canAccuseHere = p.id === 'vivi' && canAccuse();
    $('talk').innerHTML = `<div class="face">${face(p.id)}</div><div><b>${p.name}</b><p>${p.lines[G.talkIdx]}</p>
      <div class="row">${canAccuseHere && last ? '<button class="sk" id="tAcc">I know who did it</button>' : ''}<button class="sk" id="tNext">${last ? 'bye' : 'go on'}</button></div></div>`;
    show($('talk'));
    $('tNext').onclick = nextLine;
    if ($('tAcc')) $('tAcc').onclick = () => { closeUI(); openNotebook(true); };
  }
  function nextLine() {
    const p = G.talkWho;
    if (G.talkIdx < p.lines.length - 1) { G.talkIdx++; renderTalk(); return; }
    G.talked.add(p.id);
    closeUI(); updateGoal();
    if (p === REX_CAPE) startCountdown();
    else if (p.id === 'vivi' && G.talked.size === 1) setTimeout(() => phone.push('Editor', 'Three people with keys or reasons. Talk to all three — and look at everything twice.'), 1500);
  }

  // ── the notebook: what you saw, who you met, and (with Vivi) your case ──
  $('nbBtn').onclick = () => toggleNotebook();
  function toggleNotebook() { if (G.ui === 'nb') closeUI(); else if (!G.ui) openNotebook(false); }
  function openNotebook(accusing) {
    G.ui = 'nb'; player.st.enabled = false;
    const notes = CLUES.filter(c => G.found.has(c.id));
    const people = PEOPLE.filter(p => G.met.has(p.id));
    const li = (c) => `<li class="${accusing ? 'pick' : ''} ${G.pickClues.has(c.id) ? 'on' : ''}" data-id="${c.id}"><span class="i">${sketch(c.id, 'pt sm')}</span><span><b>${c.title}.</b> ${c.text}</span></li>`;
    $('nb').innerHTML = `<button class="sk x" id="nbX">close</button><h2>${accusing ? 'Make your case' : 'Notebook'}</h2>
      ${accusing ? `<p>Who did it?</p><div class="who">${Object.entries(SUSPECTS).map(([k, s]) => `<button class="sk ${G.pickSus === k ? 'on' : ''}" data-s="${k}">${face(k, 'pt xs')} ${s.name}</button>`).join('')}</div>
        <p>Pick the two things you found that prove it:</p>` : '<p><b>Things I noticed</b></p>'}
      <ul>${notes.length ? notes.map(li).join('') : '<li class="empty">nothing yet — walk up to anything that catches your eye</li>'}</ul>
      ${accusing ? `<button class="sk" id="nbGo" ${G.pickSus && G.pickClues.size === 2 ? '' : 'disabled style="opacity:.5"'}>show Vivi</button><div id="nbV"></div>`
        : `<p><b>People</b></p><ul>${people.length ? people.map(p => `<li><span class="i">${face(p.id, 'pt sm')}</span><span><b>${p.name}.</b> ${p.lines[p.lines.length - 1]}</span></li>`).join('') : '<li class="empty">no one yet</li>'}</ul>
        ${canAccuse() ? '<button class="sk case" id="nbCase">make your case</button>' : ''}`}`;
    show($('nb'));
    $('nbX').onclick = closeUI;
    if ($('nbCase')) $('nbCase').onclick = () => openNotebook(true);
    if (accusing) {
      $('nb').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { G.pickSus = b.dataset.s; openNotebook(true); });
      $('nb').querySelectorAll('li.pick').forEach(l => l.onclick = () => {
        const id = l.dataset.id;
        if (G.pickClues.has(id)) G.pickClues.delete(id); else if (G.pickClues.size < 2) G.pickClues.add(id);
        openNotebook(true);
      });
      const go = $('nbGo');
      if (go && !go.disabled) go.onclick = () => {
        const v = judge(G.pickSus, [...G.pickClues]);
        $('nbV').innerHTML = `<div class="verdict sk">${v.text}</div>` +
          (v.ok ? `<button class="sk next" id="nbOn">great work — now head to Cape Far Side →</button>` : '');
        if (v.ok) { G.solved = true; G.track = null; updateGoal(); $('nbOn').onclick = closeUI; $('nbOn').scrollIntoView({ block: 'nearest' }); }
      };
    }
  }

  // ── the case board: where you are in the story, who's left, where to look ──
  // It says WHERE things are, never what they mean: finds are counted per place.
  const canAccuse = () => G.talked.has('vivi') && G.found.size >= 2 && !G.solved;
  const WHERE = { vivi: 'on the museum steps', otto: 'by the guard booth beside the museum steps', pia: 'outside Bean There Café, Main Street', rex: 'by his van at Frame & Co., Main Street' };
  const placeDir = {
    museum: town.museum.dir, main: town.townAt([2, 0]), harbour: town.sites.harbour.dir, station: town.sites.station.dir,
    mall: town.mall.dir, cape: town.cape.dir,
  };
  const PLACE_NAME = { ...Object.fromEntries(PLACES.map(p => [p.id, p.name])), mall: 'Maple Plaza', cape: 'Cape Far Side' };
  const personIt = (id) => items.find(i => i.kind === 'person' && i.id === id);
  const placeCount = (pl) => { const all = CLUES.filter(c => c.where === pl); return [all.filter(c => G.found.has(c.id)).length, all.length]; };
  function targetOf(key) {
    const [kind, id] = key.split(':');
    if (kind === 'person') { const it = personIt(id); return it && { dir: it.dir, label: PEOPLE.find(p => p.id === id).name.split(',')[0], near: 2.4, h: 2.75, done: G.act === 1 && G.talked.has(id) && id !== 'vivi' }; }
    if (kind === 'place') { const [n, t] = placeCount(id); return { dir: placeDir[id], label: PLACE_NAME[id], near: id === 'main' ? 6 : id === 'cape' ? 7 : 5, h: 3.2, done: t > 0 && n >= t && G.act === 1 }; }
    if (kind === 'car') return player.st.mode === 'walk' ? { dir: jeepDir, label: 'your car', near: 2.6, h: 1.8, done: false } : null;
    if (kind === 'console') return cape.consoleDir && { dir: cape.consoleDir, label: 'launch console', near: 1.6, h: 2.0, done: G.act !== 3 };
    if (kind === 'lm') { const lm = town.landmarks.find(l => l.key === id); return lm && { dir: lm.dir, label: lm.name, near: 3.5, h: 5.5, done: false }; }
    return null;
  }
  // what the arrow points at: what you picked on the board, or the next lead
  function currentTarget() {
    if (G.act === 3) return targetOf('console');
    if (G.track) { const t = targetOf(G.track); if (t && !t.done) return t; G.track = null; }
    if (G.act === 2) return targetOf('place:cape');
    if (G.act >= 4) return null;
    if (!G.talked.has('vivi')) return targetOf('person:vivi');
    for (const id of ['otto', 'pia', 'rex']) if (!G.talked.has(id)) return targetOf('person:' + id);
    if (canAccuse() && G.found.size >= 4) return targetOf('person:vivi');
    for (const pl of PLACES) { const t = targetOf('place:' + pl.id); if (!t.done) return t; }
    return targetOf('person:vivi');
  }
  function updateGoal() {
    $('nbCount').textContent = G.found.size;
    renderCase();
  }
  // the case board's tab: fold it down to its title + the current step, and remember it
  {
    // folded by default on a phone (it covers a third of a portrait screen); a choice sticks
    let min = matchMedia('(pointer: coarse)').matches && (innerWidth < 700 || innerHeight < 500); try { const v = localStorage.getItem('caseMin'); if (v) min = v === '1'; } catch {}
    const apply = () => { $('hud').classList.toggle('min', min); const b = $('caseTog'); b.textContent = min ? '+' : '–'; b.title = min ? 'expand' : 'minimize'; };
    $('caseTog').onclick = (e) => { e.stopPropagation(); min = !min; try { localStorage.setItem('caseMin', min ? '1' : '0'); } catch {} apply(); };
    apply();
  }
  function renderCase() {
    const el = $('case'), auto = currentTarget();
    const row = (key, html, done = false) => {
      const t = targetOf(key), on = t && auto && t.dir === auto.dir && !done;
      return `<div class="cr ${done ? 'done' : ''} ${on ? 'on' : ''}" data-k="${key}">${html}</div>`;
    };
    let h = '';
    if (G.act >= 4) {
      h = `<div class="st go">Case closed ✓</div><p>All 45 paintings are going home. Rex is going somewhere else.</p>` +
        `<div class="st">Janelle's projects</div><p>Dotted around the planet, out past town, are buildings for her real work. Click one to follow the arrow (most are a drive away), then walk up and press <kbd>E</kbd>.</p>` +
        town.landmarks.filter(lm => !lm.decor).map(lm => row('lm:' + lm.key, `<i>›</i> ${lm.name} <span class="ct">${lm.tag}</span>`)).join('') +
        `<p>…and the rest of her work lives on <a href="https://ghanemja.github.io" target="_blank" rel="noopener">ghanemja.github.io ↗</a> — go walk its streets.</p>`;
    } else if (G.act === 3) {
      h = `<div class="st go">5 · ABORT the launch!</div>` + row('console', `<i>›</i> the launch console — run!`) +
        `<p>Rex is up the gantry. The console's by the road — press <kbd>E</kbd> at it.</p>`;
    } else if (G.act === 2) {
      const there = arc(player.st.dir, town.cape.dir) < 12;
      h = `<div class="st go">4 · Stop the launch at Cape Far Side</div>` +
        row('place:cape', `<i>›</i> Cape Far Side — ${there ? 'find Rex by the crates' : 'the long road round the planet'}`) +
        `<p>${there ? 'Walk up to Rex and press <kbd>E</kbd>.' : 'Take your car — it\'s a long way round. Follow the arrow.'}</p>`;
    } else if (!G.talked.has('vivi')) {
      h = `<div class="st">1 · Find Director Vivi</div>` + row('person:vivi', `<i>›</i>${face('vivi', 'pt xs')} Vivi — ${WHERE.vivi}`) +
        `<p>Follow the arrow. Walk up to her and press <kbd>E</kbd>.</p>`;
    } else {
      h = `<div class="st">2 · Question the three</div>` +
        ['otto', 'pia', 'rex'].map(id => row('person:' + id, `<i>${G.talked.has(id) ? '✓' : '›'}</i>${face(id, 'pt xs')} ${PEOPLE.find(p => p.id === id).name.split(',')[0]} — ${WHERE[id]}`, G.talked.has(id))).join('') +
        `<div class="st">Look around · ${G.found.size} of ${CLUES.length} noticed</div>` +
        PLACES.map(pl => { const [n, t] = placeCount(pl.id); return row('place:' + pl.id, `<i>${n >= t ? '✓' : '›'}</i> ${pl.name} <span class="ct">${n}/${t}</span>`, n >= t); }).join('') +
        (canAccuse()
          ? `<div class="st go">3 · Name the thief</div><p>Tell Vivi — or open your notebook (<kbd>N</kbd>) → make your case. You need a suspect and two things that prove it.</p>`
          : `<p class="soft">Glints mark things worth a closer look. Find two that point at someone.</p>`);
    }
    if (G.act !== 3 && player.st.mode === 'walk') h += row('car', `<i>›</i> your car — <kbd>E</kbd> to drive`);
    if (G.act !== 3) h += `<p class="soft">click a line to follow it · <kbd>P</kbd> phone map</p>`;
    el.innerHTML = h;
    // folded: just the step you're on
    const tmp = document.createElement('div'); tmp.innerHTML = h; const st = [...tmp.querySelectorAll('.st')].find(x => !x.closest('.done')) || tmp.querySelector('.st');
    $('caseMini').textContent = st ? st.textContent.replace(/\s+/g, ' ').trim() : '';
    el.querySelectorAll('.cr').forEach(r => r.onclick = () => { G.track = r.dataset.k; renderCase(); });
  }

  // ── the waypoint: a sketched pin over your lead, or an arrow at the edge ──
  const guide = createGuide({ scene, player });                  // driving: corner map + arrows on the road
  const way = $('way'), _wp = new THREE.Vector3(), _pc = new THREE.Vector3();
  let wayKey = '';
  function updateWaypoint(dt = 0, time = 0) {
    const t = G.state === 'play' && !G.ui && !G.room ? currentTarget() : null;
    guide.update(dt, time, t);
    const dist = t ? arc(player.st.dir, t.dir) : 0;
    if (!t || dist < t.near) { show(way, false); return; }
    _wp.copy(t.dir).multiplyScalar(radiusAt(t.dir) + t.h);
    _pc.copy(_wp).applyMatrix4(camera.matrixWorldInverse);
    const v = _wp.clone().project(camera);
    const W = innerWidth, H = innerHeight, m = 54;
    let x, y, ang;
    if (_pc.z < 0 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88) {
      x = (v.x * 0.5 + 0.5) * W; y = (-v.y * 0.5 + 0.5) * H; ang = 90;               // over it, pointing down
    } else {
      let dx = _pc.x, dy = -_pc.y;
      if (_pc.z > 0) dy = Math.abs(dy) + _pc.z;                                        // behind you: toward the bottom edge
      const a = Math.atan2(dy, dx), c = Math.cos(a), s2 = Math.sin(a);
      const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(c)), (H / 2 - m) / Math.max(1e-3, Math.abs(s2)));
      x = W / 2 + c * k; y = H / 2 + s2 * k; ang = a * 180 / Math.PI;
    }
    way.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    way.firstElementChild.style.transform = `translate(-50%, -50%) rotate(${ang.toFixed(1)}deg)`;
    const label = `${t.label} · ${Math.round(dist * 1.5)} m`;
    if (label !== wayKey) { way.lastElementChild.textContent = label; wayKey = label; }
    // keep the label on screen at the edges: hang it inward from the arrow
    const lb = way.lastElementChild.style;
    lb.transform = `translateX(${x > W - 150 ? -100 : x < 150 ? 0 : -50}%)`;
    lb.top = y > H - 90 ? '-52px' : '26px';
    show(way);
  }

  // ── the phone, in the backpack ──
  const phone = createPhone({ town, player, camera,
    places: () => ['museum', 'main', 'station', 'harbour', 'mall', 'cape'].map(id => ({ key: 'place:' + id, name: PLACE_NAME[id], dir: placeDir[id] })),
    onTrack: (k) => { G.track = k; renderCase(); },
    openNotebook: () => { if (!G.ui) openNotebook(false); },
    isTracked: (k) => { const a = currentTarget(), t = targetOf(k); return !!(a && t && a.dir === t.dir); } });
  phone.setCar(() => jeepDir);
  const placeName = () => {
    let best = 'somewhere on the planet', bd = 9;
    for (const [id, d] of Object.entries(placeDir)) { const a = arc(player.st.dir, d); if (a < bd) { bd = a; best = PLACE_NAME[id]; } }
    return best;
  };

  // ── a project building: what it is, and a link to the real thing ──
  function openProject(lm) {
    const link = lm.url ? `<a class="sk btn" href="${lm.url}" target="_blank" rel="noopener">open ${lm.name} ↗</a>`
      : lm.enter ? `<a class="sk btn" href="${lm.enter}">step inside ↗</a>` : '<p class="note">coming soon</p>';
    $('card').innerHTML = `<h3>${lm.name}</h3><p class="tag">${lm.tag}</p><p>${lm.desc}</p><div class="row">${link}<button class="sk" id="cardOk">back</button></div>`;
    show($('card')); G.ui = 'proj'; player.st.enabled = false;
    $('cardOk').onclick = closeUI;
  }

  // ── ACT 2: the getaway to Cape Far Side ─────────────────────────────────────
  // The moving parts are built at load (hidden until needed) so nothing hitches.
  const UPV = new THREE.Vector3(0, 1, 0);
  const CL = (x, y, z) => town.cape.root.localToWorld(new THREE.Vector3(x, y, z));
  const capeDir = (x, z) => town.cape.at(x, z);
  // put an object on the site in its own frame: local (x, z), turned ry about the up axis
  // set on the ground the site was laid onto (placeOnPlanet: terrain under each point, less its
  // 0.04 sink) — the site's flat local y=0 sits above it out here, so the desk's screen floated
  const capeAttach = (obj, x, z, ry = 0, lift = 0) => {
    const d = capeDir(x, z);
    obj.position.copy(d).multiplyScalar(radiusAt(d) - 0.04 + lift);
    obj.quaternion.copy(town.cape.root.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(UPV, ry));
  };
  const cape = { count: 0, hopT: -1, puffs: [], crates: [], lidT: -1, policeT: -1, shown: -1 };
  {
    const [rx, , rz] = CAPE.rocket, [cx, , cz] = CAPE.console, ry = Math.atan2(cx - rx, cz - rz);
    cape.rocket = cargoRocket(); capeAttach(cape.rocket, rx, rz, 0, 0.16); scene.add(cape.rocket);
    cape.rocketPos = cape.rocket.position.clone(); cape.up = cape.rocketPos.clone().normalize();
    cape.console = launchConsole(); capeAttach(cape.console, cx, cz, ry); scene.add(cape.console);
    // the operator's spot is on the road side of the desk, facing the rocket
    cape.consoleDir = CL(cx + Math.sin(ry) * 0.75, 0, cz + Math.cos(ry) * 0.75).normalize();
    for (let i = 0; i < 3; i++) {
      const c = paintingCrate(i); capeAttach(c, CAPE.crates[0] - 1.15 + i * 1.15, CAPE.crates[2] + (i % 2) * 0.12, 0.08 * (i - 1)); scene.add(c); cape.crates.push(c);
    }
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xf3eee4, transparent: true, opacity: 0.85, depthWrite: false }));
      m.visible = false; m.userData.noInk = true; scene.add(m);
      cape.puffs.push({ m, t: 1 + i / 16, seed: i * 1.7 });
    }
    // the police: a convoy of three, each a level frame with the car inside it, so its wheels
    // can be seated on the ground under them (the site isn't flat) — like your parked car.
    // They pull up short of the CAPE FAR SIDE sign by the road (it now stands further out, by x 6, z 4 — clear of the launch desk)
    cape.police = [[1.7, 6.5, Math.PI, 0], [4.6, 7.0, Math.PI + 0.45, 0.6], [-1.1, 6.8, Math.PI - 0.35, 1.2]].map(([x, z, ry, delay]) => {
      const frame = new THREE.Group(), body = buildCar({ body: 0xf3eee4, police: true });
      frame.add(body); frame.visible = false; frame.userData.noGround = true; scene.add(frame);
      return { frame, body, x, z, ry, delay, lights: body.userData.lights };
    });
  }
  // move a story thing (and its collider and glint) to a spot at the cape
  function relocate(it, x, z, faceX, faceZ) {
    const old = (it.at ?? it.dir).clone(), d = capeDir(x, z);
    for (const c of town.colliders) if (arc(c.dir, old) < 0.05) c.dir.copy(d);
    it.dir.copy(d);
    it.obj.position.copy(d).multiplyScalar(standAt(d));
    alignToSurface(it.obj, d, yawToFace(d, capeDir(faceX, faceZ)));
    it.homePos = it.obj.position.clone(); it.homeQ = it.obj.quaternion.clone();
    if (it.glint) it.glint.position.copy(d).multiplyScalar(standAt(d) + (it.kind === 'person' ? 1.75 : 1.6));
    if (it.at) {                                   // the van: looked at from behind its back doors
      it.at.copy(d); it.obj.updateWorldMatrix(true, false);
      it.dir.copy(it.obj.localToWorld(new THREE.Vector3(0, 0, -2.2))).normalize();
      if (it.glint) it.glint.position.copy(it.obj.localToWorld(new THREE.Vector3(0, 1.15, -1.8)));
    }
  }
  function startGetaway() {
    G.act = 2; G.track = null;
    const rex = personIt('rex'), van = items.find(i => i.id === 'van');
    relocate(rex, CAPE.rex[0], CAPE.rex[2], CAPE.rex[0], CAPE.rex[2] + 5);
    if (rex.glint) rex.glint.visible = true;
    if (van) relocate(van, CAPE.van[0], CAPE.van[2], CAPE.rocket[0], CAPE.rocket[2]);
    atmosphere.fadeTo(0.5, 40);                                  // dusk falls on the way
    phone.push('Editor', 'Vivi\'s called it in — police are forty minutes out. Rex\'s van just tore out of town. There\'s a cargo launch from CAPE FAR SIDE at nine. The coast road goes all the way round. GO.');
    setTimeout(() => phone.push('Vivi', 'Take your car. And please — bring them home.'), 4000);
    setTimeout(() => phone.push('Mum', 'why is there a ROCKET on the local news'), 14000);
    G.track = 'place:cape';
    updateGoal();
    // say it plainly, in the middle of the screen: where to go next, and how
    $('card').innerHTML = `<div class="ic">${face('vivi')}</div><h3>Now head to Cape Far Side</h3>
      <p>“Great work. Rex has the paintings — his van just tore out of town. There's a cargo launch from <b>Cape Far Side</b> at nine.”</p>
      <p class="note">Take your car (press <kbd>E</kbd> by it) and follow the arrow — the coast road goes all the way round the planet.</p>
      <div class="row"><button class="sk next" id="cardOk">let's go →</button></div>`;
    show($('card')); G.ui = 'card'; player.st.enabled = false;
    $('cardOk').onclick = closeUI;
  }
  // Rex bolts up the gantry; the countdown starts; the rocket rumbles
  function startCountdown() {
    G.act = 3; cape.count = 60; cape.shown = -1;
    audio.setScene('tense');
    const rex = personIt('rex'), b = bumps.body(rex.obj);
    if (b) b.immune = true;
    rex.fleeing = { phase: 'run', y: 0 };
    if (rex.glint) rex.glint.visible = false;
    show($('timer'));
    phone.push('Editor', 'Is that a ROCKET?! Stop it!!');
    updateGoal();
  }
  const GANTRY_FOOT = () => capeDir(CAPE.gantry[0] + 0.95, CAPE.gantry[2]);
  function tickRex(dt) {
    const rex = personIt('rex'), F = rex.fleeing; if (!F) return;
    const h = rex.obj.userData.human;
    if (F.phase === 'run') {
      const to = GANTRY_FOOT(), d = arc(rex.dir, to);
      if (d < 0.08) { F.phase = 'climb'; rex.dir.copy(to); }
      else rex.dir.copy(slerpDir(rex.dir, to, Math.min(1, 3.4 * dt / d)));
      rex.obj.position.copy(rex.dir).multiplyScalar(standAt(rex.dir));
      alignToSurface(rex.obj, rex.dir, yawToFace(rex.dir, to));
      if (h) poseFolk(h, dt, 1);
    } else if (F.phase === 'climb') {
      F.y = Math.min(CAPE.gantryTop + 0.04, F.y + 1.5 * dt);
      rex.obj.position.copy(rex.dir).multiplyScalar(standAt(rex.dir) + F.y);
      alignToSurface(rex.obj, rex.dir, yawToFace(rex.dir, capeDir(CAPE.gantry[0], CAPE.gantry[2])));
      if (h) poseFolk(h, dt, 0.9);
      if (F.y >= CAPE.gantryTop + 0.04) {                      // on the platform: step in, turn, gloat
        F.phase = 'top';
        const top = capeDir(CAPE.gantry[0], CAPE.gantry[2]);
        rex.obj.position.copy(top).multiplyScalar(standAt(top) + CAPE.gantryTop + 0.04);
        alignToSurface(rex.obj, top, yawToFace(top, capeDir(CAPE.rocket[0] + 4, CAPE.rocket[2] + 6)));
        rex.homePos = rex.obj.position.clone(); rex.homeQ = rex.obj.quaternion.clone();
        bumps.say(rex.obj, 'Toodle-oo!', 2.0, 'yell');
      }
    } else if (h) poseFolk(h, dt, 0, { talk: 0.6 });
  }
  function tickCape(dt, t) {
    if (G.act < 2) return;
    tickRex(dt);
    const R0 = cape.rocketPos, up = cape.up;
    if (G.act === 3) {
      cape.count -= dt;
      const n = Math.max(0, Math.ceil(cape.count));
      if (n !== cape.shown && cape.hopT < 0) {
        cape.shown = n;
        cape.console.userData.draw(`T-${String(n).padStart(2, '0')}`, n <= 10 ? '#f2a07a' : '#7fe0a8');
        $('timer').textContent = `LAUNCH IN ${n}`;
      }
      if (cape.count <= 0 && cape.hopT < 0) hop();
    }
    // the rocket: rumbles harder as the count runs down; hops if it hits zero
    let lift = 0, shake = 0;
    if (G.act === 3) shake = 0.012 + 0.05 * (1 - Math.min(1, cape.count / 60));
    if (cape.hopT >= 0) {
      cape.hopT += dt;
      const k = cape.hopT / 2.4;
      lift = 1.6 * Math.sin(Math.PI * Math.min(1, k)); shake = 0.08;
      if (k >= 1) { cape.hopT = -1; cape.count = 30; cape.shown = -1; }
    }
    cape.rocket.position.copy(R0).addScaledVector(up, lift);
    if (shake) cape.rocket.position.add(new THREE.Vector3(Math.sin(t * 61) * shake, Math.sin(t * 53) * shake, Math.sin(t * 47) * shake).projectOnPlane(up));
    // smoke: puffs roll out from the base while it's live
    const live = G.act === 3;
    for (const P of cape.puffs) {
      P.t += dt * (0.55 + (cape.hopT >= 0 ? 1.2 : 0));
      if (P.t > 1) { if (!live) { P.m.visible = false; continue; } P.t -= 1; P.a = P.seed + t; }
      if (!live && !P.m.visible) continue;
      const k = P.t, a = P.a ?? P.seed, r = 0.5 + 2.2 * k;
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(town.cape.root.quaternion);
      P.m.position.copy(R0).addScaledVector(side, r).addScaledVector(up, 0.25 + 0.9 * k * k);
      P.m.scale.setScalar(0.35 + 0.9 * k);
      P.m.material.opacity = 0.85 * (1 - k);
      P.m.visible = true;
    }
    // police lights, and the car rolling up the road
    if (cape.policeT >= 0) {
      cape.policeT += dt;
      cape.police.forEach((P, i) => {
        const k = THREE.MathUtils.clamp((cape.policeT - P.delay) / (P.path ? P.dur : 2.5), 0, 1);
        if (k <= 0) return;
        P.frame.visible = true;
        const [red, blue] = P.lights, f = Math.sin(t * 9 + i * 1.3) > 0;
        red.emissiveIntensity = f ? 2.2 : 0.2; blue.emissiveIntensity = f ? 0.2 : 2.2;
        if (P.done) return;
        if (P.path) {
          // along the road in lane, then off it for the last few metres to the parking spot;
          // easing out, and turning to the spot's own heading as it stops
          const s = (1 - (1 - k) ** 2.2) * P.len, { d, ahead } = pathAt(P, s);
          P.frame.position.copy(d).multiplyScalar(R);
          alignToSurface(P.frame, d, yawToFace(d, ahead));
          if (k >= 1) capeAttach(P.frame, P.x, P.z + 9 * (1 - P.stopE), P.ry);
        } else {
          const e = Math.min(1 - (1 - k) ** 3, P.stopE ?? 1);
          capeAttach(P.frame, P.x, P.z + 9 * (1 - e), P.ry);
        }
        P.frame.position.setLength(standAt(P.frame.position.clone().normalize()));    // on the ground…
        player.fitToGround(P.body, P.frame);                                           // …all four wheels down
        if (k >= 1) {
          P.done = true;
          // parked: solid, nose and tail, so you (on foot or driving) can't pass through it
          P.frame.updateWorldMatrix(true, false);
          for (const z of [-0.6, 0.6]) town.colliders.push({ dir: P.frame.localToWorld(new THREE.Vector3(0, 0, z)).normalize(), r: 0.75 });
        }
      });
    }
    // crate lids pop off (the epilogue)
    if (cape.lidT >= 0) {
      cape.lidT += dt;
      cape.crates.forEach((c, i) => {
        const k = THREE.MathUtils.clamp((cape.lidT - i * 0.35) / 0.6, 0, 1), lid = c.userData.lid;
        lid.position.set(0, 0.06 * Math.sin(Math.PI * k), 0.3 * k); lid.rotation.x = 1.45 * k * k;
      });
    }
  }
  // the overloaded rocket coughs, hops and sinks back — forty-five paintings is a lot of cargo
  function hop() {
    cape.hopT = 0;
    cape.console.userData.draw('OVERWEIGHT', '#f2a07a');
    $('timer').textContent = 'TOO HEAVY — RETRYING';
    bumps.say(personIt('rex').obj, 'Come ON!', 2.4, 'yell');
    phone.push('Editor', 'It\'s too heavy to fly — it\'s trying again! The CONSOLE, quick!');
  }
  function abortLaunch() {
    if (G.act !== 3) return;
    G.act = 4; cape.hopT = -1;
    audio.setScene('end');
    const U = cape.console.userData;
    U.draw('ABORTED', '#ff8a7a');
    U.btn.position.y -= 0.045; U.cover.rotation.x = -1.2; U.cover.position.z -= 0.1;
    show($('timer'), false);
    const rex = personIt('rex');
    bumps.say(rex.obj, '…bother.', 3, 'grumble');
    if (rex.fleeing) rex.fleeing.phase = rex.fleeing.phase === 'top' ? 'top' : rex.fleeing.phase;
    rex.dir.copy(GANTRY_FOOT());                                   // shout up at him from the foot of the gantry
    phone.push('Editor', 'You stopped a ROCKET. Front page. Tomorrow. Yours.');
    // the police pull up short of your car (and of each other) instead of driving through it:
    // each stops where its run in along the road would first come within a car's length of it
    {
      const cars = [[player.st.mode === 'jeep' ? player.st.dir.clone() : jeepDir.clone(), 2.8]];   // [where, keep-off]
      for (const P of cape.police) {
        P.stopE = 1;
        for (let e = 0; e <= 1.0001; e += 0.02) {
          const d = capeDir(P.x, P.z + 9 * (1 - e));
          if (cars.some(([c, r]) => arc(c, d) < r)) { P.stopE = Math.max(0, e - 0.04); break; }
        }
        cars.push([capeDir(P.x, P.z + 9 * (1 - P.stopE)), 2.1]);
      }
    }
    policeRoutes();
    cape.policeT = 0;
    updateGoal();
    // …and you SEE them come: a letterboxed shot from beside the pad, looking down the road
    // they arrive by, that follows the convoy in as it pulls up (they used to arrive off in a
    // corner of whatever the camera happened to face). Sirens, low.
    setTimeout(() => {
      if (G.act !== 4 || G.state !== 'play') return;
      G.ui = 'police'; player.st.enabled = false;
      for (const k of ['card', 'talk', 'nb', 'prompt', 'way']) show($(k), false);
      phone.closeAll();
      document.body.classList.add('cine');
      audio.siren(5);
      const t0 = performance.now() / 1000, pos = new THREE.Vector3(), look = new THREE.Vector3();
      player.st.camHook = policeCam = (cam) => {
        const k = Math.min(1, (performance.now() / 1000 - t0) / 6.5), e = k * k * (3 - 2 * k);
        // look at the middle of the convoy (the cars on their way), from up behind the pad,
        // high enough to see the road they come in on and all three arriving
        const c = new THREE.Vector3(); let n = 0;
        for (const P of cape.police) if (P.frame.visible) { c.add(P.frame.position); n++; }
        const park = CL(1.7, 0.3, 6.6), at = n ? c.divideScalar(n).lerp(park, 0.35) : park;
        const want = CL(-2.2 + 0.8 * e, 7.5 - 2.0 * e, -1.5 + 1.5 * e);
        if (!pos.lengthSq()) { pos.copy(want); look.copy(at); }
        pos.lerp(want, 0.08); look.lerp(at, 0.12);
        cam.position.copy(pos); cam.up.copy(cape.up); cam.lookAt(look);
      };
      setTimeout(startEpilogue, 7400);
    }, 1400);
  }
  let policeCam = null;
  // each police car's way in: back up the cape's access road ~18 units, then forward down it
  // in the lane (right of the centre line), leaving it only for the last stretch to its spot
  function policeRoutes() {
    const pad = capeDir(0, 0);
    let rd = null, ci = 0, best = 1e9;                        // the road that reaches the cape: its sample nearest the pad
    for (const r of ROADS) r.pts.forEach((q, i) => { const a = arc(q, pad); if (a < best) { best = a; rd = r; ci = i; } });
    if (!rd || best > 14) return;                              // no road out here: the old straight run-in
    const P0 = rd.pts, away = ci > P0.length / 2 ? -1 : 1;     // walking the samples away from the cape
    for (const P of cape.police) {
      const spot = capeDir(P.x, P.z + 9 * (1 - P.stopE));
      let j = ci, bj = 1e9;                                    // the road sample nearest its spot…
      for (let i = 0; i < P0.length; i++) { const a = arc(P0[i], spot); if (a < bj) { bj = a; j = i; } }
      const pts = []; let L = 0;                               // …and ~18 units of road back from there
      for (let i = j; i >= 0 && i < P0.length; i += away) { pts.unshift(P0[i]); if (pts.length > 1) L += arc(pts[0], pts[1]); if (L > 18) break; }
      const lane = pts.map((q, n) => {                         // shift into the right-hand lane
        const a = pts[Math.max(0, n - 1)], b = pts[Math.min(pts.length - 1, n + 1)];
        const tg = b.clone().sub(a).projectOnPlane(q).normalize(), right = new THREE.Vector3().crossVectors(tg, q).normalize();
        return q.clone().multiplyScalar(R).addScaledVector(right, rd.half * 0.45).normalize();
      });
      lane.push(spot);
      const cum = [0]; for (let n = 1; n < lane.length; n++) cum.push(cum[n - 1] + arc(lane[n - 1], lane[n]));
      Object.assign(P, { path: lane, cum, len: cum[cum.length - 1], dur: 4.4, delay: [0, 1.4, 2.8][cape.police.indexOf(P)] });
    }
  }
  function pathAt(P, s) {
    const { path, cum } = P; let n = 1;
    while (n < cum.length - 1 && cum[n] < s) n++;
    const t = THREE.MathUtils.clamp((s - cum[n - 1]) / Math.max(1e-6, cum[n] - cum[n - 1]), 0, 1);
    const d = slerpDir(path[n - 1], path[n], t);
    const ahead = n < path.length - 1 || t < 0.98 ? slerpDir(path[n - 1], path[n], Math.min(1, t + 0.3)) : path[n].clone().multiplyScalar(2).sub(path[n - 1]).normalize();
    return { d, ahead: arc(ahead, d) < 1e-4 ? path[n] : ahead };
  }

  // ── the epilogue: three letterboxed shots, then the papers ──
  const ARTS = ['art_cows_in_storm.jpg', 'art_IMG_5262.jpg', 'art_IMG_7152.jpg'];
  const EPI = [
    { dur: 4.4, cap: 'Forty-five canvases. Not a scratch.', at: CL, from: [-2.3, 1.5, 2.7], to: [-3.0, 1.15, 1.9], look: [-3.0, 0.6, 0.4] },
    { dur: 3.8, cap: 'Rex Calloway — framed, at last.', at: CL, from: [6.4, 3.0, 5.2], to: [5.4, 3.8, 3.6], look: [2.15, 5.6, -1.6] },
    { dur: 4.4, cap: 'Back on the walls by morning.', at: ML, from: [0, 3.2, 17], to: [0, 4.2, 11.5], look: [0, 3, -5] },
  ];
  function startEpilogue() {
    if (G.state === 'epilogue') return;
    if (player.st.camHook === policeCam) player.st.camHook = null;
    G.state = 'epilogue'; G.ui = null; G.epiT = 0; G.epiShot = -1;
    phone.closeAll();
    for (const k of ['card', 'talk', 'nb', 'prompt', 'way', 'timer']) show($(k), false);
    player.st.enabled = false;
    document.body.classList.add('cine');
    const loader = new THREE.TextureLoader();
    cape.crates.forEach((c, i) => loader.load('./artworks/' + ARTS[i % ARTS.length], (tx) => {
      tx.colorSpace = THREE.SRGBColorSpace;
      c.userData.art.material = new THREE.MeshBasicMaterial({ map: tx });
    }));
    cape.lidT = 0;
  }
  function tickEpilogue(dt) {
    G.epiT += dt;
    let acc = 0, i = 0;
    while (i < EPI.length - 1 && G.epiT > acc + EPI[i].dur) acc += EPI[i++].dur;
    if (i !== G.epiShot) { G.epiShot = i; if (i === 2) atmosphere.fadeTo(0, 1.2); }
    const S = EPI[i], k = Math.min(1, (G.epiT - acc) / S.dur), e = k * k * (3 - 2 * k);
    const from = S.at(...S.from), to = S.at(...S.to);
    camera.position.copy(from.lerp(to, e));
    camera.up.copy(camera.position).normalize();
    camera.lookAt(S.at(...S.look));
    const cap = $('caption');
    if (cap.textContent !== S.cap) { cap.textContent = S.cap; show(cap, false); requestAnimationFrame(() => show(cap)); }
    else show(cap, k > 0.08 && k < 0.92);
    if (G.epiT >= EPI.reduce((a, s) => a + s.dur, 0)) endEpilogue();
  }
  function endEpilogue() {
    G.state = 'play'; G.act = 5;
    document.body.classList.remove('cine'); show($('caption'), false);
    player.st.enabled = true; player.st.camInit = false;
    phone.push('The Chronicle', 'FRONT PAGE: CRITIC CATCHES THE FRAMER — all 45 paintings home safe. Rex Calloway charged. Story & photos: you.');
    setTimeout(() => phone.push('Mum', 'SO proud!!! dinner sunday. bring the newspaper'), 3000);
    $('endcard').innerHTML = `<h2>Case closed.</h2><p>Forty-five paintings, home by morning. Thank you for playing <b>The Vanishing Gallery</b>.</p>
      <p class="soft">The planet's still yours — and the buildings dotted around it, out past town, are Janelle's real projects. Pick one on the case board, follow the arrow, and press <kbd>E</kbd> when you get there. Everything else she's made is at <a href="https://ghanemja.github.io" target="_blank" rel="noopener">ghanemja.github.io ↗</a>.</p>
      <button class="sk" id="endOk">keep exploring</button>`;
    show($('endcard'));
    $('endOk').onclick = () => show($('endcard'), false);
    updateGoal();
  }

  // ── per frame ──
  // the people: breathe, gesture while they talk, turn to face you as you come up
  const _pv = new THREE.Vector3();
  function tickPeople(dt) {
    for (const it of items) {
      if (it.kind !== 'person' || it.knocked || it.fleeing) continue;
      const h = it.obj.userData.human; if (!h) continue;
      const talking = G.ui === 'talk' && G.talkWho?.id === it.id;
      h.talkK = (h.talkK || 0) + ((talking ? 1 : 0) - (h.talkK || 0)) * (1 - Math.exp(-5 * dt));
      pose(h, dt, 0, { talk: h.talkK });
      if (it.seated) continue;                        // on a bench: he looks up from the paper, he doesn't swivel round
      const l = it.obj.worldToLocal(_pv.copy(player.root.position));
      const target = G.state === 'play' && Math.hypot(l.x, l.z) < 4.5 ? Math.atan2(l.x, l.z) : 0;
      const tg = it.obj.userData.turn;
      const d = Math.atan2(Math.sin(target - tg.rotation.y), Math.cos(target - tg.rotation.y));
      tg.rotation.y += d * (1 - Math.exp(-4 * dt));
    }
  }
  function update(dt, t) {
    if (moored.visible) {                                   // the moored boat rides the swell
      mooredBody.position.y = 0.035 * Math.sin(t * 1.7); mooredBody.rotation.z = 0.04 * Math.sin(t * 1.3); mooredBody.rotation.x = 0.02 * Math.sin(t * 1.1);
    }
    tickPeople(dt);
    tickWalkers(walkers, dt);
    tickCape(dt, t);
    phone.tick(dt);
    if (G.state === 'play') bumps.update(dt);
    if (G.state === 'phone' && G.phoneUp && !phone.state.open) beginPlay();   // the opening phone put away unanswered
    if (G.state === 'epilogue') { tickEpilogue(dt); return true; }
    if (G.state === 'cold') {
      const e = performance.now() / 1000 - G.t0;
      let acc = 0, i = 0;
      while (i < SHOTS.length - 1 && e > acc + SHOTS[i].dur) acc += SHOTS[i++].dur;
      const S = SHOTS[i], k = Math.min(1, (e - acc) / S.dur), ease = k * k * (3 - 2 * k);
      if (i !== G.coldShot) { G.coldShot = i; if (i === 1) audio.cue('low'); if (i === 2) audio.cue('swell'); }
      const from = new THREE.Vector3(...S.from), to = new THREE.Vector3(...S.to);
      camera.position.copy(ML(...from.lerp(to, ease).toArray()));
      camera.up.copy(mus.position).normalize();
      camera.lookAt(ML(...S.look));
      const cap = $('caption');
      if (cap.textContent !== S.cap) { cap.textContent = S.cap; show(cap, false); requestAnimationFrame(() => { if (G.state === 'cold') show(cap); }); }
      else show(cap, k > 0.08 && k < 0.92);
      if (e >= COLD) endColdOpen();
      return true;                                  // the camera is ours
    }
    if (G.state === 'title') {
      // the planet turns slowly behind the title page
      // the planet sits low, under the title, like an illustrated book cover. It opens on
      // downtown and the museum (1.57) and turns by frame time (capped), not the clock — or a
      // slow load or a first-frame stall would already have turned it on to the empty fields
      G.titleA = (G.titleA ?? 1.57) + dt * 0.05;
      const a = G.titleA;
      camera.position.set(Math.sin(a) * 96, 30, Math.cos(a) * 96);
      camera.up.set(0, 1, 0); camera.lookAt(0, 30, 0);
      return true;
    }
    // glints bob gently so you notice them without being told
    // …and every few seconds each one gently pops (swells a little and settles back) with a
    // slow shimmer — staggered so they never pulse together: noticeable, never alarming
    for (const it of items) {
      const gl = it.glint; if (!gl?.visible) continue;
      if (gl.userData.base == null) gl.userData.base = gl.scale.x;
      const seed = (it.dir.x * 9.7 + it.dir.z * 4.3) % 1, cyc = (t / 3.4 + seed) % 1;
      const u = cyc < 0.22 ? cyc / 0.22 : 1;                 // the pop: the first ~0.75s of each cycle
      const pop = u < 1 ? Math.sin(Math.PI * u) * (1 - 0.35 * u) : 0;
      gl.scale.setScalar(gl.userData.base * (0.92 + 0.36 * pop + 0.04 * Math.sin(t * 1.3 + seed * 6)));
      gl.material.rotation = Math.sin(t * 1.4 + seed * 9) * 0.18 + pop * 0.35;
      gl.material.opacity = 0.82 + 0.18 * Math.max(pop, 0.5 + 0.5 * Math.sin(t * 0.9 + seed * 7));
    }
    scan();
    updateWaypoint(dt, t);
    return false;
  }
  const afterRender = () => phone.afterRender(renderer, placeName());
  return { G, update, items, doors, FACE, SKETCH, bumps, walkers, phone, afterRender, startGetaway, startCountdown, abortLaunch, jeepSpot: () => jeepDir.clone() };
}
