import { create } from 'zustand';

/**
 * Transient per-frame motion info, deliberately outside React state so the
 * drag hook can write it every pointer move without triggering renders.
 * Smoothed pan velocity/speed in world units/s; MotionFx maps it to the
 * drag scratch/glitch effect.
 */
export const motionState = { speed: 0, vx: 0, vy: 0 };

/** The talent roster the canvas is currently showing. */
export type TalentBoard = 'female' | 'male';

/** A focused model opens on its details (landing) and can step into the
 *  gallery of its looks. */
export type FocusView = 'details' | 'gallery';

interface BoardState {
  /** Active talent board — each board is its own canvas with its own roster. */
  board: TalentBoard;
  /** Camera-style pan over the board, in world units. The board group is
   *  positioned at [-panX, -panY, 0]. */
  panX: number;
  panY: number;
  /** True from first real drag movement until momentum settles — promotion
   *  is suppressed the whole time. */
  isDragging: boolean;
  /** The single tile currently allowed to be live (concurrency cap = 1). */
  activeTileId: string | null;
  /** Tile opened (focused) via click. */
  selectedId: string | null;
  /** Which face of the focused model is showing. */
  view: FocusView;
  /** Board position of the focused tile, for re-framing between views. */
  anchor: { x: number; y: number } | null;
  /** Pan clamp half-extents, set by Board from the grid dimensions. */
  bounds: { x: number; y: number };
  /** When set, Board eases the pan toward this point (e.g. centering a
   *  clicked tile). Cleared by dragging or on arrival. */
  panTarget: { x: number; y: number } | null;
  /** Orbit rotation (radians) applied to the focused tile's splat while a
   *  model is selected — dragging spins it instead of panning the board. */
  focusYaw: number;
  focusPitch: number;
  /** Extra zoom multiplier on top of FOCUS_ZOOM, controlled by the scroll
   *  wheel while a model is selected. */
  focusZoomScale: number;
  setBoard: (board: TalentBoard) => void;
  setPan: (x: number, y: number) => void;
  setDragging: (dragging: boolean) => void;
  setActiveTile: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setView: (view: FocusView) => void;
  setAnchor: (anchor: { x: number; y: number } | null) => void;
  setBounds: (x: number, y: number) => void;
  setPanTarget: (target: { x: number; y: number } | null) => void;
  setFocusRotation: (yaw: number, pitch: number) => void;
  setFocusZoomScale: (scale: number) => void;
}

const clamp = (v: number, limit: number) => Math.min(limit, Math.max(-limit, v));
/** Keep pitch shy of straight up/down so the orbit never flips through the pole. */
const FOCUS_PITCH_LIMIT = 1.3;
// below 1 so a gallery hang can still fit a short window
const MIN_FOCUS_ZOOM_SCALE = 0.45;
const MAX_FOCUS_ZOOM_SCALE = 6;

export const useBoardStore = create<BoardState>((set, get) => ({
  board: 'female',
  panX: 0,
  panY: 0,
  isDragging: false,
  activeTileId: null,
  selectedId: null,
  view: 'details',
  anchor: null,
  bounds: { x: 0, y: 0 },
  panTarget: null,
  focusYaw: 0,
  focusPitch: 0,
  focusZoomScale: 1,
  setBoard: (board) => {
    if (board === get().board) return;
    // fresh canvas: recenter and drop any selection/promotion from the old one
    set({ board, panX: 0, panY: 0, panTarget: null, selectedId: null, activeTileId: null });
  },
  setPan: (x, y) => {
    const { bounds } = get();
    set({ panX: clamp(x, bounds.x), panY: clamp(y, bounds.y) });
  },
  setDragging: (isDragging) => set({ isDragging }),
  setActiveTile: (activeTileId) => set({ activeTileId }),
  // reset the orbit whenever focus opens/closes/switches models
  setSelected: (selectedId) =>
    set({ selectedId, view: 'details', focusYaw: 0, focusPitch: 0, focusZoomScale: 1 }),
  setView: (view) => set({ view, focusYaw: 0, focusPitch: 0 }),
  setAnchor: (anchor) => set({ anchor }),
  setBounds: (x, y) => set({ bounds: { x, y } }),
  setPanTarget: (target) => {
    if (!target) return set({ panTarget: null });
    const { bounds } = get();
    set({ panTarget: { x: clamp(target.x, bounds.x), y: clamp(target.y, bounds.y) } });
  },
  setFocusRotation: (yaw, pitch) =>
    set({ focusYaw: yaw, focusPitch: clamp(pitch, FOCUS_PITCH_LIMIT) }),
  setFocusZoomScale: (scale) =>
    set({
      focusZoomScale: Math.min(MAX_FOCUS_ZOOM_SCALE, Math.max(MIN_FOCUS_ZOOM_SCALE, scale)),
    }),
}));

// dev-only handles for poking the board from the console / test tooling
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__boardStore = useBoardStore;
  w.__motionState = motionState;
}
