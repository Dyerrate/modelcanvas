# Splat Board

A draggable white-canvas board displaying character-scale Gaussian splat models of runway models. Hovering a tile promotes its lightweight thumbnail to a live 3D splat; clicking opens a detail panel with the model's stats (height, weight, measurements, etc.).

Built as an Astro 5 static site with a single React Three Fiber island (`client:only` — no Three.js ever runs at build time).

## Stack

- Astro 5 (`output: 'static'`), React 19 island
- three 0.170 + @react-three/fiber 9 + @react-three/drei 10 (`<Splat>`)
- zustand for board state (pan, drag, active/selected tile)
- One shared WebGL context, orthographic camera, `frameloop="demand"`

## Commands

| Command | Action |
|---|---|
| `npm run dev` | Dev server (manifest is rebuilt first via `predev`) |
| `npm run build` | Static production build into `dist/` |
| `npm run manifest` | Regenerate `src/data/splat-manifest.json` from `public/splats/` |
| `npm run splats:placeholder` | Regenerate the synthetic placeholder splats + thumbnails |

## Asset pipeline

- **Delivery format:** `.splat` files in `public/splats/` (antimatter15 layout, what drei's `<Splat>` consumes). Per-file budget: **8 MB** — `npm run manifest` fails the build if exceeded.
- **Thumbnails:** `public/thumbs/{id}.png` (transparent background), shown until a tile is promoted.
- **Metadata:** `src/data/model-meta.json` — hand-editable stats per model (`id` must match the `.splat` basename). Merged into the generated manifest.
- **`src/data/splat-manifest.json` is generated — never hand-edit.**

### Replacing the placeholders with real captures

The current `.splat` files are synthetic mannequins produced by `scripts/generate-placeholder-splats.mjs`. To use real captures (Polycam, Luma AI, Postshot — check licenses):

1. Convert/export the capture as `.splat` (y-down convention) and drop it in `public/splats/<id>.splat`, keeping it under 8 MB.
2. Add a `<id>.png`/`.jpg` thumbnail in `public/thumbs/` (transparent PNG looks best on the white board).
3. Add a matching entry in `src/data/model-meta.json`.
4. `npm run manifest`. Source `.ply` files belong in `assets-src/` (gitignored), never in `public/`.

Scale reference: the tile maps 2.3 m of world height to the tile plane (`REF_HEIGHT_M` in `CharacterTile.tsx` and the generator) — size real captures in meters with the figure's feet-to-head midpoint at the origin.

## Architecture notes

- `BoardIsland.tsx` owns the single `<Canvas>`; `DetailPanel.tsx` is a plain HTML overlay driven by the same zustand store.
- `CharacterTile.tsx` is a promote/demote state machine (`thumbnail → loading → live → demoting`), with a concurrency cap of one live splat enforced through `activeTileId`.
- `useDragPan.ts` owns all pointer input (no OrbitControls): drag pans the board with frame-rate-independent momentum decay; dragging demotes live tiles.
- Idle boards render zero frames (`frameloop="demand"`); offscreen tiles are AABB-culled manually.

## Deploy

`dist/` is fully static. `vercel.json` and `netlify.toml` both set immutable long-max-age cache headers for `/splats/*` and `/thumbs/*`.
