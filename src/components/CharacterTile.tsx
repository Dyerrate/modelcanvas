import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCursor, useTexture } from '@react-three/drei';
import { SRGBColorSpace, type Group, type MeshBasicMaterial } from 'three';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';
import SplatModel from './SplatModel';

export const TILE_PLANE_H = 1.9;
export const TILE_PLANE_W = TILE_PLANE_H * (256 / 342); // thumbnail aspect
/** World meters mapped to the full tile height — must match REF_HEIGHT_M in
 *  scripts/generate-placeholder-splats.mjs so thumb and splat align. */
const REF_HEIGHT_M = 2.3;
const SPLAT_SCALE = TILE_PLANE_H / REF_HEIGHT_M;
const DEMOTE_GRACE_MS = 300;
const FADE_SECONDS = 0.15;
const CLICK_MAX_DRIFT_PX = 5;
/** Width of the HTML detail panel; the pan target shifts by half of it so a
 *  selected tile centers in the space the panel leaves free. */
const PANEL_WIDTH_PX = 360;

type TileState = 'thumbnail' | 'loading' | 'live' | 'demoting';

interface CharacterTileProps {
  entry: SplatEntry;
  x: number;
  y: number;
}

/**
 * Promote/demote LOD state machine:
 *
 *   thumbnail → loading   hover/click while not dragging
 *   loading   → live      splat Suspense resolved (crossfade starts)
 *   loading   → thumbnail demoted before ready — unmount instantly
 *   live      → demoting  drag started, hover left + grace, or lost the
 *                         active slot (concurrency cap = 1)
 *   demoting  → thumbnail reverse crossfade finished — unmount splat
 *   demoting  → live      re-promoted mid-fade (splat still mounted)
 */
export default function CharacterTile({ entry, x, y }: CharacterTileProps) {
  const [state, setState] = useState<TileState>('thumbnail');
  const [hovered, setHovered] = useState(false);
  const texture = useTexture(entry.thumbUrl, (t) => {
    t.colorSpace = SRGBColorSpace;
  });
  const root = useRef<Group>(null);
  const mat = useRef<MeshBasicMaterial>(null);
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const invalidate = useThree((s) => s.invalidate);

  const isActive = useBoardStore((s) => s.activeTileId === entry.id);
  const isSelected = useBoardStore((s) => s.selectedId === entry.id);
  const isDragging = useBoardStore((s) => s.isDragging);

  useCursor(hovered && !isDragging);

  const promote = useCallback(
    (force = false) => {
      const store = useBoardStore.getState();
      if (store.isDragging && !force) return;
      clearTimeout(grace.current);
      store.setActiveTile(entry.id); // evicts any other live tile
      setState((s) => (s === 'thumbnail' ? 'loading' : s === 'demoting' ? 'live' : s));
      invalidate();
    },
    [entry.id, invalidate]
  );

  const demote = useCallback(() => {
    clearTimeout(grace.current);
    setState((s) => (s === 'live' ? 'demoting' : s === 'loading' ? 'thumbnail' : s));
    const store = useBoardStore.getState();
    if (store.activeTileId === entry.id) store.setActiveTile(null);
    invalidate();
  }, [entry.id, invalidate]);

  const scheduleDemote = useCallback(() => {
    clearTimeout(grace.current);
    grace.current = setTimeout(() => {
      if (useBoardStore.getState().selectedId !== entry.id) demote();
    }, DEMOTE_GRACE_MS);
  }, [entry.id, demote]);

  // concurrency cap: another tile took the active slot
  useEffect(() => {
    if (!isActive) demote();
  }, [isActive, demote]);

  // dragging demotes everything except the tile open in the detail panel
  useEffect(() => {
    if (isDragging && !isSelected) demote();
  }, [isDragging, isSelected, demote]);

  // detail panel closed while the pointer is elsewhere → release the tile
  useEffect(() => {
    if (!isSelected && !hovered) scheduleDemote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelected]);

  useEffect(() => () => clearTimeout(grace.current), []);

  const onReady = useCallback(() => {
    setState((s) => (s === 'loading' ? 'live' : s));
    invalidate();
  }, [invalidate]);

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    promote();
  };

  const onPointerOut = () => {
    setHovered(false);
    if (useBoardStore.getState().selectedId !== entry.id) scheduleDemote();
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > CLICK_MAX_DRIFT_PX) return; // that was a drag, not a click
    e.stopPropagation();
    const store = useBoardStore.getState();
    store.setSelected(entry.id);
    const panelShift =
      typeof window !== 'undefined' && window.innerWidth > 768
        ? PANEL_WIDTH_PX / (2 * e.camera.zoom)
        : 0;
    store.setPanTarget({ x: x + panelShift, y });
    promote(true);
  };

  // manual frustum culling (ortho AABB) + thumbnail crossfade
  useFrame(({ size, camera }, delta) => {
    if (root.current) {
      const { panX, panY } = useBoardStore.getState();
      const halfW = size.width / (2 * camera.zoom) + TILE_PLANE_W;
      const halfH = size.height / (2 * camera.zoom) + TILE_PLANE_H;
      root.current.visible = Math.abs(x - panX) < halfW && Math.abs(y - panY) < halfH;
    }
    const m = mat.current;
    if (!m) return;
    const target = state === 'live' ? 0 : 1;
    const diff = target - m.opacity;
    if (diff === 0) {
      if (state === 'demoting') setState('thumbnail'); // fade finished → unmount
      return;
    }
    const step = Math.sign(diff) * Math.min(Math.abs(diff), delta / FADE_SECONDS);
    m.opacity += step;
    invalidate();
  });

  return (
    <group ref={root} position={[x, y, 0]}>
      {state !== 'thumbnail' && (
        <group scale={SPLAT_SCALE}>
          <SplatModel entry={entry} onReady={onReady} />
        </group>
      )}
      <mesh
        position={[0, 0, 0.4]}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
        onClick={onClick}
      >
        <planeGeometry args={[TILE_PLANE_W, TILE_PLANE_H]} />
        <meshBasicMaterial
          ref={mat}
          map={texture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
