import { useBoardStore } from '../hooks/useBoardStore';
import {
  FOCUS_ZOOM,
  MOBILE_BREAKPOINT_PX,
  MOBILE_SHEET_FRACTION,
  PANEL_WIDTH_PX,
} from '../config/board';

/**
 * Pan offset (world units, at FOCUS_ZOOM) that leaves room for the detail
 * panel: side panel on desktop, bottom sheet on mobile. The room it makes is
 * fixed in pixels, so at focus zoom scale s the world offset is this / s.
 */
function panelOffset() {
  if (typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX) {
    return { x: 0, y: -(MOBILE_SHEET_FRACTION / 2) * (window.innerHeight / FOCUS_ZOOM) };
  }
  return { x: PANEL_WIDTH_PX / (2 * FOCUS_ZOOM), y: 0 };
}

/**
 * Select a model and ease the camera onto its placement beside the detail
 * panel. Shared by tile clicks and the nav search.
 */
export function focusPlacement(id: string, x: number, y: number) {
  const store = useBoardStore.getState();
  store.setSelected(id); // also resets focusZoomScale to 1
  const off = panelOffset();
  store.setPanTarget({ x: x + off.x, y: y + off.y });
}

/**
 * Change the focused model's zoom while keeping it on the same spot on
 * screen. Without re-panning, the panel offset (fixed in world units) grows
 * with zoom and pushes the model off the left edge.
 */
export function setFocusZoom(scale: number) {
  const store = useBoardStore.getState();
  const from = store.focusZoomScale;
  store.setFocusZoomScale(scale);
  const to = useBoardStore.getState().focusZoomScale; // clamped
  if (to === from) return;
  // pan = model + off / s  →  shift by off · (1/to − 1/from)
  const off = panelOffset();
  const base = store.panTarget ?? { x: store.panX, y: store.panY };
  const k = 1 / to - 1 / from;
  store.setPanTarget({ x: base.x + off.x * k, y: base.y + off.y * k });
}
