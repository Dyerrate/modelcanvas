import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import type { Group } from 'three';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';
import { useDragPan } from '../hooks/useDragPan';
import CharacterTile from './CharacterTile';

export const TILE_SPACING = 2.2;
const PAN_MARGIN = 1.5;
const PAN_EASE = 6; // 1/s, exponential approach to panTarget

const entries = manifest as SplatEntry[];

// warm the texture cache before any tile mounts
for (const entry of entries) useTexture.preload(entry.thumbUrl);

export interface TilePlacement {
  entry: SplatEntry;
  x: number;
  y: number;
}

export function computeGrid(list: SplatEntry[]): TilePlacement[] {
  const cols = Math.ceil(Math.sqrt(list.length));
  const rows = Math.ceil(list.length / cols);
  return list.map((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      entry,
      x: (col - (cols - 1) / 2) * TILE_SPACING,
      y: ((rows - 1) / 2 - row) * TILE_SPACING,
    };
  });
}

export default function Board() {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useDragPan();

  const placements = useMemo(() => computeGrid(entries), []);

  useEffect(() => {
    const cols = Math.ceil(Math.sqrt(entries.length));
    const rows = Math.ceil(entries.length / cols);
    useBoardStore
      .getState()
      .setBounds(
        ((cols - 1) / 2) * TILE_SPACING + PAN_MARGIN,
        ((rows - 1) / 2) * TILE_SPACING + PAN_MARGIN
      );
  }, []);

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
          <CharacterTile key={entry.id} entry={entry} x={x} y={y} />
        ))}
      </Suspense>
    </group>
  );
}
