import { create } from 'zustand';

interface BoardState {
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
  setPan: (x: number, y: number) => void;
  setDragging: (dragging: boolean) => void;
  setActiveTile: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setBounds: (x: number, y: number) => void;
  setPanTarget: (target: { x: number; y: number } | null) => void;
}

const clamp = (v: number, limit: number) => Math.min(limit, Math.max(-limit, v));

export const useBoardStore = create<BoardState>((set, get) => ({
  panX: 0,
  panY: 0,
  isDragging: false,
  activeTileId: null,
  selectedId: null,
  bounds: { x: 0, y: 0 },
  panTarget: null,
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
