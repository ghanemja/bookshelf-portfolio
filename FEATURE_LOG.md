# Feature request log

A running list of every feature request for this project, newest session first.
Append each new request here as it comes in (see the rule in CLAUDE.md). Format:
`- [status] request — short note`. Status: ✅ done+verified · 🟡 done, needs live
check · ⏳ in progress · 📦 asset staged, not wired · ❌ deferred.

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
