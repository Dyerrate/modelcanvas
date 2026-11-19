import { Vector3, Vector4 } from 'three';
import { create } from 'zustand';
import { lookUniforms } from './lookFilter';

/**
 * The gallery walk. `index` is the piece the visitor has chosen (React
 * state — the HUD renders from it); the continuous position and the live
 * splat's whereabouts are per-frame values in `galleryFx`, written by
 * GalleryStage and read by CharacterTile / SparkSplat without re-renders.
 */
interface GalleryState {
  index: number;
  count: number;
  /** Set when a model is focused: piece count + the piece to open on. */
  open: (count: number, start: number) => void;
  go: (index: number) => void;
  step: (delta: number) => void;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  index: 0,
  count: 1,
  open: (count, start) => {
    galleryFx.pos = start;
    galleryFx.live = start;
    set({ count, index: Math.min(count - 1, Math.max(0, start)) });
  },
  go: (index) => set({ index: Math.min(get().count - 1, Math.max(0, index)) }),
  step: (delta) => get().go(get().index + delta),
}));

export const galleryFx = {
  /** Continuous walk position, in pieces (eases toward the chosen index). */
  pos: 0,
  /** Piece whose frame the live splat currently hangs in. */
  live: 0,
  /** World x offset of the live splat from its tile (it rides its frame). */
  splatOffset: 0,
  /** Live splat parallax tilt (radians), toward the pointer. */
  tiltX: 0,
  tiltY: 0,
  /** Uniforms SparkSplat's composite merges in for the focused model. At
   *  rest (details view) they're identity: opaque, unclipped, unfiltered. */
  composite: {
    /** Live splat opacity. */
    uOpacity: { value: 1 },
    /** Screen-uv rect (x0, y0, x1, y1) the live splat is clipped to: its
     *  frame's mat opening, so the work sits behind the mat. */
    uClip: { value: new Vector4(0, 0, 1, 1) },
    /** The live piece's room treatment. */
    ...lookUniforms(),
    /** Neon room: rim halo around the figure. */
    uGlow: { value: 0 },
    uGlowA: { value: new Vector3(0, 0.9, 1) },
    uGlowB: { value: new Vector3(1, 0.18, 0.48) },
    uShimmer: { value: 0 },
  },
  /** performance.now() when the focused model's splat tier went live; 0 while loading. */
  readyAt: 0,
  /** CSS px per piece at the current zoom (drag → walk conversion). */
  pxPerPiece: 1,
  /** True while a drag owns the walk. */
  dragging: false,
  /** 0..1 — house lights down, one piece held in the spotlight. */
  spot: 0,
  /** Wall-label anchor for the centered frame, CSS px (right edge, top). */
  label: { x: 0, y: 0, below: 0, visible: false },
  /** Dev capture mode: hide the set so only the live splat renders. */
  capture: false,
};

// --- drag (from useDragPan): walk with the pointer, snap on release ----
let vel = 0;
let lastT = 0;
export function galleryDragStart() {
  galleryFx.dragging = true;
  vel = 0;
  lastT = performance.now();
}
export function galleryDragMove(dxPx: number) {
  const { count } = useGalleryStore.getState();
  const d = -dxPx / Math.max(galleryFx.pxPerPiece, 1);
  // rubber-band past the first / last piece
  const over = galleryFx.pos < 0 || galleryFx.pos > count - 1;
  galleryFx.pos += over ? d * 0.35 : d;
  const now = performance.now();
  const dt = Math.max((now - lastT) / 1000, 1e-3);
  lastT = now;
  vel = vel * 0.7 + (d / dt) * 0.3;
}
export function galleryDragEnd() {
  galleryFx.dragging = false;
  // a flick carries on to the next piece
  const target = Math.round(galleryFx.pos + vel * 0.18);
  useGalleryStore.getState().go(target);
}

// dev-only handle for poking the gallery from the console / test tooling
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__galleryFx = galleryFx;
  w.__galleryStore = useGalleryStore;
}
