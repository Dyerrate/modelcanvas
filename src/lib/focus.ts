import { useBoardStore } from '../hooks/useBoardStore';
import {
  FOCUS_ZOOM,
  MOBILE_BREAKPOINT_PX,
  MOBILE_SHEET_FRACTION,
  PANEL_WIDTH_PX,
} from '../config/board';

/**
 * Select a model and ease the camera onto its placement, leaving room for
 * the detail panel (side panel on desktop, bottom sheet on mobile). Shared
 * by tile clicks and the nav search.
 */
export function focusPlacement(id: string, x: number, y: number) {
  const store = useBoardStore.getState();
  store.setSelected(id);
  if (typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX) {
    const sheetShift = (MOBILE_SHEET_FRACTION / 2) * (window.innerHeight / FOCUS_ZOOM);
    store.setPanTarget({ x, y: y - sheetShift });
  } else {
    store.setPanTarget({ x: x + PANEL_WIDTH_PX / (2 * FOCUS_ZOOM), y });
  }
}
