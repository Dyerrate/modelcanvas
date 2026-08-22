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
  /** Tile opened in the detail panel via click. */
  selectedId: string | null;
  /** Pan clamp half-extents, set by Board from the grid dimensions. */
  bounds: { x: number; y: number };
  /** When set, Board eases the pan toward this point (e.g. centering a
   *  clicked tile). Cleared by dragging or on arrival. */
  panTarget: { x: number; y: number } | null;
  setBoard: (board: TalentBoard) => void;
  setPan: (x: number, y: number) => void;
  setDragging: (dragging: boolean) => void;
  setActiveTile: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setBounds: (x: number, y: number) => void;
  setPanTarget: (target: { x: number; y: number } | null) => void;
}

const clamp = (v: number, limit: number) => Math.min(limit, Math.max(-limit, v));

export const useBoardStore = create<BoardState>((set, get) => ({
  board: 'female',
  panX: 0,
  panY: 0,
  isDragging: false,
  activeTileId: null,
  selectedId: null,
  bounds: { x: 0, y: 0 },
  panTarget: null,
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
  setSelected: (selectedId) => set({ selectedId }),
  setBounds: (x, y) => set({ bounds: { x, y } }),
  setPanTarget: (target) => {
    if (!target) return set({ panTarget: null });
    const { bounds } = get();
    set({ panTarget: { x: clamp(target.x, bounds.x), y: clamp(target.y, bounds.y) } });
  },
}));

// dev-only handles for poking the board from the console / test tooling
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__boardStore = useBoardStore;
  w.__motionState = motionState;
}
