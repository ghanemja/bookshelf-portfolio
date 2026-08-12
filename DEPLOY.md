# Deploy

Static three.js site, no build step. Hosted on **Netlify** (site `shelfie-jg`,
id `c1677cd8-337d-4500-879c-3aed0433fe67`) → https://shelfie-jg.netlify.app

Deploys are **manual** — this site is NOT git-connected, so `git push` does not
publish. Ship with:

```bash
./deploy.sh
```

`deploy.sh` validates the main character (`scripts/validate-critic.mjs`) before
uploading, so a missing/broken `critic.glb` aborts before anything goes live,
then runs `netlify deploy --prod` against the `shelfie-jg` site id.

## Gotchas

- **Bump the cache token.** `index.html` loads `planet.js?cb=pNN`. Bump `NN`
  whenever `planet.js` changes, or browsers/CDN keep the stale bundle (new CSS +
  old JS = "nothing changed").
- **Check the link.** This folder's Netlify CLI has been mis-linked to other
  sites before. Confirm with `netlify status` (should say `shelfie-jg`);
  `deploy.sh` also pins the site id explicitly.

## Local preview

```bash
python3 -m http.server 5173   # → http://localhost:5173
```
