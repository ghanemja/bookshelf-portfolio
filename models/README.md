# models

Drop Blender exports here.

- `bookshelf.glb` — replaces procedural shelf frame. Origin at bottom-center, ~16m wide × 11m tall × 1.6m deep.

main.js calls `gltfLoader.loadAsync('./models/bookshelf.glb')` and silently falls back to procedural if missing.
