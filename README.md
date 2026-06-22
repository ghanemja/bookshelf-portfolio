# bookshelf-portfolio

3D bookshelf portfolio. Each repo = one book on a shelf. Click → side panel w/ links.

Built w/ vanilla [three.js](https://threejs.org/) via importmap (no build step).

## Run locally

Any static file server:

```bash
python3 -m http.server 5173
# → http://localhost:5173
```

Or `npx serve .`

## Edit repos

All repo data lives in [`data/repos.json`](data/repos.json). Fields:

| field | required | notes |
|---|---|---|
| `name` | yes | shown on book spine + panel |
| `repo` | yes | github URL |
| `url` | no | deployed/live site URL — hides "visit live" button if absent |
| `visibility` | yes | `PUBLIC` or `PRIVATE` (just shown as label) |
| `tag` | yes | controls book color — `site`, `ai`, `cad`, `ml`, `robotics`, `game`, `tool`, `edu`, `hackathon`, `hobby`, `profile`, `misc` |
| `blurb` | no | one-line description shown in panel |

Add/reorder/recolor freely.

## Swap in Blender models

Default render is procedural (BoxGeometry + canvas spine textures). To drop in custom Blender assets:

1. Model in Blender — units in meters, export as GLB (`File → Export → glTF 2.0`).
2. Save as:
   - `models/bookshelf.glb` — replaces the procedural shelf frame entirely.
   - `models/book.glb` *(planned hook)* — would replace book geometry; not wired up yet (procedural books fit the canvas-texture spine pipeline best for now).
3. Reload page. If `bookshelf.glb` is present, [main.js](main.js) logs `[shelf] custom bookshelf.glb loaded`.

Tips for the Blender shelf:
- Origin at the bottom-center (matches scene floor at y=0).
- Approx footprint: 16 wide × ~11 tall × 1.6 deep (scene units = meters).
- Bake textures into a single material if possible — keeps the GLB small.

## Deploy to GitHub Pages

```bash
gh repo create bookshelf-portfolio --public --source=. --remote=origin --push
gh repo edit --enable-pages --pages-branch main --pages-path /
```

Then enable Pages in repo settings if needed.

## Controls

- **drag** — orbit
- **scroll** — zoom
- **click book** — open detail panel
- **esc** — close panel
