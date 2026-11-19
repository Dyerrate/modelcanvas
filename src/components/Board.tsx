import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import type { Group } from 'three';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore, type TalentBoard } from '../hooks/useBoardStore';
import { useDragPan } from '../hooks/useDragPan';
import CharacterTile from './CharacterTile';
// the gallery set only downloads once a model is focused
const GalleryStage = lazy(() => import('./GalleryStage'));

// spread the models far apart — the board should feel like a space to
// wander, not a contact sheet
export const TILE_SPACING = 6.0;
const JITTER_X = 1.5;
const JITTER_Y = 1.2;
const GRID_WIDEN = 1.15; // bias toward more columns than a square grid
const PAN_MARGIN = 3.0;
const PAN_EASE = 6; // 1/s, exponential approach to panTarget

const entries = manifest as SplatEntry[];

// warm the texture cache before any tile mounts
for (const entry of entries) useTexture.preload(entry.thumbUrl);

/** Roster for a talent board — untagged models appear on every board. */
export function boardEntries(board: TalentBoard): SplatEntry[] {
  return entries.filter((e) => !e.meta?.gender || e.meta.gender === board);
}

export interface TilePlacement {
  entry: SplatEntry;
  x: number;
  y: number;
}

/** Deterministic 0..1 hash so the scatter is stable across reloads. */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 8) & 0xffffff) / 0x1000000;
}

/** The seed folds the board name in, so each talent canvas scatters
 *  differently even while both show the same test models. */
export function computeGrid(list: SplatEntry[], seed: string): TilePlacement[] {
  const cols = Math.ceil(Math.sqrt(list.length) * GRID_WIDEN);
  const rows = Math.ceil(list.length / cols);
  // the wander-y spacing is tuned for a ~dozen-plus roster; small test
  // rosters shrink toward the center so the board never opens on blank white
  const density = Math.min(1, Math.sqrt(list.length / 12));
  const spacing = TILE_SPACING * density;
  return list.map((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      entry,
      x:
        (col - (cols - 1) / 2) * spacing +
        (hash01(`${seed}:${entry.id}:x`) * 2 - 1) * JITTER_X * density,
      y:
        ((rows - 1) / 2 - row) * spacing +
        (hash01(`${seed}:${entry.id}:y`) * 2 - 1) * JITTER_Y * density,
    };
  });
}

export default function Board() {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const board = useBoardStore((s) => s.board);
  useDragPan();

  const placements = useMemo(() => computeGrid(boardEntries(board), board), [board]);

  // a focused model's gallery view hangs its looks; the hang stays mounted
  // through its own exit fade and unmounts itself via onExited
  const selectedId = useBoardStore((s) => s.selectedId);
  const view = useBoardStore((s) => s.view);
  const [stageId, setStageId] = useState<string | null>(null);
  useEffect(() => {
    if (view === 'gallery' && placements.some((p) => p.entry.id === selectedId)) {
      setStageId(selectedId);
    }
  }, [selectedId, view, placements]);
  const staged = placements.find((p) => p.entry.id === stageId);

  useEffect(() => {
    const bx = Math.max(...placements.map((p) => Math.abs(p.x))) + PAN_MARGIN;
    const by = Math.max(...placements.map((p) => Math.abs(p.y))) + PAN_MARGIN;
    useBoardStore.getState().setBounds(bx, by);
    invalidate(); // demand frameloop: paint the freshly-switched canvas
  }, [placements, invalidate]);

  // apply pan imperatively — no React re-render per pointer move — and ease
  // toward panTarget when a tile was selected
  useFrame((_, delta) => {
    const store = useBoardStore.getState();
    if (store.panTarget && !store.isDragging) {
      const { panTarget, panX, panY } = store;
      const k = 1 - Math.exp(-PAN_EASE * delta);
      store.setPan(panX + (panTarget.x - panX) * k, panY + (panTarget.y - panY) * k);
      const now = useBoardStore.getState();
      if (Math.hypot(panTarget.x - now.panX, panTarget.y - now.panY) < 0.005) {
        store.setPanTarget(null);
      }
      invalidate();
    }
    const { panX, panY } = useBoardStore.getState();
    group.current?.position.set(-panX, -panY, 0);
  });

  return (
    <group ref={group}>
      <Suspense fallback={null}>
        {placements.map(({ entry, x, y }) => (
          <CharacterTile key={`${board}:${entry.id}`} entry={entry} x={x} y={y} />
        ))}
      </Suspense>
      {staged && (
        <Suspense fallback={null}>
          <GalleryStage
            key={staged.entry.id}
            entryId={staged.entry.id}
            x={staged.x}
            y={staged.y}
            onExited={() => setStageId(null)}
          />
        </Suspense>
      )}
    </group>
  );
}
