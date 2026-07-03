import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';
import { useDragPan } from '../hooks/useDragPan';

export const TILE_SPACING = 2.2;
const PAN_MARGIN = 1.5;

const entries = manifest as SplatEntry[];

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

  // apply pan imperatively — no React re-render per pointer move
  useFrame(() => {
    const { panX, panY } = useBoardStore.getState();
    group.current?.position.set(-panX, -panY, 0);
  });

  return (
    <group ref={group}>
      {placements.map(({ entry, x, y }) => (
        <mesh key={entry.id} position={[x, y, 0]}>
          <planeGeometry args={[TILE_SPACING - 0.3, TILE_SPACING - 0.3]} />
          <meshBasicMaterial color="#e8e8e8" />
        </mesh>
      ))}
    </group>
  );
}
