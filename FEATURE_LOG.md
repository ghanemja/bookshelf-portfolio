# Feature request log

A running list of every feature request for this project, newest session first.
Append each new request here as it comes in (see the rule in CLAUDE.md). Format:
`- [status] request — short note`. Status: ✅ done+verified · 🟡 done, needs live
check · ⏳ in progress · 📦 asset staged, not wired · ❌ deferred.

## Session 2026-10-07 (art heist: museum + narrative)

- 🟡 **Art heist overhaul — top-notch museum, less sloppy, fix the narrative.** Done in code, verified by headless screenshots in Classic / Sketchbook / Wasteland; **not yet deployed** (no Netlify CLI/token in the cloud session — run `./deploy.sh` locally).
  - New modelled Downtown Museum (`museum.js`): fluted Greek-revival portico on a 3-tier stylobate, carved inscription, pediment with gilded medallion, balustraded wings with arched windows, ribbed glass rotunda with ONE pane cut out + the thief's rope, ladder on the east wing, police tape, blinking beacons, night searchlights, empty gilded frame on an easel, compass-rose forecourt. Smooth/bevelled throughout; merged per material (~54k tris, few draw calls).
  - Narrative unified into one story ("the vanishing gallery"): phone texts, every NPC is a witness handing over evidence, Director Vivi's line reacts to your progress, Cape Far Side is the getaway shuttle chase, finale = case closed.
  - Fixed dead features: clues could never be collected (`collectClue` was never called) and Cape Far Side never launched (`defStop` dropped `launches`). Clues are now numbered evidence tents; restart clears the case.
  - UI: "skip intro" no longer lingers during play; controls hint no longer hidden under the zoom bar; long landmark labels no longer clip.
  - Dev params: `?at=<landmark>[&atx=&atz=]`, `?shotcam=<landmark>,x,y,z,lookY,lookZ`, `?dlg=<stop>`.

## Session 2026-08-11 (cars, jet, limo, arrival cinematic)

- ✅ Import new car + jet GLBs; cartoon style; physics; cars drive only on road; diverse; light for browser.
- ✅ Use original textures on cars; add bevels (smooth/curved); cars get boil + grease-pencil.
- ✅ Jet gets the same layered boil outline (`_gpForce` bypass for its big meshes).
- ✅ Replace cabin image with a supplied one, then make it crisp/cartoony (not blurry).
- 🟡 Deployable landing gear on the jet (uses `landing_gear.glb`) that deploys on descent.
- 🟡 Airstair that deploys at step-off.
- 🟡 Main character walks out of the plane and into the limo.
- ✅ Replace limo with `limo.glb`; textured + outlines + cartoon effects.
- 🟡 Cars touch the ground (not floating); tyres spin / boil for a sense of motion.
- ✅ Create CLAUDE.md (style, bevels-vs-browser, redeploy-after-each-feature).
- ✅ Keep this running feature-request log; reference it from CLAUDE.md.
- ❌ Main character walk animation swings out-to-in instead of front-to-back (procWalk) — needs live view to fix the bone axis.
- 📦 Replace the bicycle with `yellow_bicycle.glb` and delete the old asset — asset processed; wiring the rigged player vehicle needs a verified pass.
- ✅ Limo not pulling up to the gas station (stops mid-road) — increased forecourt pull-in to ~2.0 so it sits at the pumps.
- 🟡 Cabin→window transition should feel like a head-turn (yaw in place, level), not a flashcard swipe — rewrote as a gaze yaw about the up axis.
- 🟡 Cabin window: turn LEFT not right (seat POV); texture the wall + rim to match the cabin interior; show a city skyline + water outside that scrolls right→left like the plane is cruising over it — done (cabin-wall canvas on the ring, warm tan rim, tiling dusk-skyline canvas scrolled behind the porthole).
- 🟡 Car shading too dark ("angry scratches") — the per-mesh boil hulls scratch on decimated car geometry; cars/limo now skip the hull (keep flat fills + inked edges).
- 🟡 Tyres flying off the cars — removed the tyre-spin (wheels share the car origin, so spinning flung them); wheels stay put now.
- ⏳ **City layout redesign** (foundational): current block layout is a mess. Make it TWO city halves split by a water channel; the boat sails the channel between them; the train runs through both; roads grade smoothly downtown→rural with no random dead-ending spurs. Ref: dense two-sided city split by a river (tutorial: youtube n0i9RHMypfo). We'll fill in specific buildings over time — this is just the layout.
- ✅ Downtown "all blocks to each other, hard to move through" — parcels now greedy-packed biggest-first with a guaranteed 1.4-unit clear street between every footprint (foundation included); fewer, bigger towers, real walkable gaps.
- ⏳ **Intro cinematic needs a total change** — currently plays under the full game HUD, cabin opener renders as a flat blob, ~25s jet circling. Direction pending.
