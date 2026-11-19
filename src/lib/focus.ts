import { useBoardStore, type FocusView } from '../hooks/useBoardStore';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import {
  FOCUS_ZOOM,
  GALLERY_FIT,
  GALLERY_LABEL_PX,
  MOBILE_BREAKPOINT_PX,
  SPLAT_SCALE,
  TILE_PLANE_H,
} from '../config/board';
import { galleryLayout } from './galleryLayout';

const entries = manifest as SplatEntry[];
const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX;
const focused = () => entries.find((e) => e.id === useBoardStore.getState().selectedId);
/** Cover view: share of the window the copy sheet covers on phones (keep in
 *  sync with styles/editorial.css). */
const EDITORIAL_SHEET_FRACTION = 0.45;
/** Tile-local height (m) above which a capture reads as full-length rather
 *  than a bust: it stands taller on the cover. */
const FULL_LENGTH_M = 1.6;
const isFullLength = (entry?: SplatEntry) => {
  const r = entry?.meta?.stage?.heightRange;
  return !!r && r[1] - r[0] > FULL_LENGTH_M;
};
/** Room the gallery wall label takes under the frame on phones (CSS px). */
const MOBILE_LABEL_PX = 210;

/**
 * Pan offset (world units, at FOCUS_ZOOM) that leaves room for the view's
 * chrome — details: the cover's copy sheet on phones; gallery: the wall
 * label beside the centered piece (below it on phones). The room is fixed
 * in pixels, so at focus zoom scale s the world offset is this / s.
 */
function chromeOffset(view: FocusView) {
  if (view === 'gallery') {
    if (isMobile()) return { x: 0, y: -MOBILE_LABEL_PX / 2 / FOCUS_ZOOM };
    return { x: (GALLERY_LABEL_PX + 28) / 2 / FOCUS_ZOOM, y: 0 };
  }
  // the cover: the figure holds the middle of the page, set a little low so
  // the head overlaps the masthead (above the copy sheet on phones)
  const vh = window.innerHeight;
  const drop = isMobile()
    ? -(EDITORIAL_SHEET_FRACTION / 2 + 0.01) * vh
    : (isFullLength(focused()) ? 0.035 : 0.055) * vh;
  return { x: 0, y: drop / FOCUS_ZOOM };
}

/** The figure's size and center, board world units relative to its tile:
 *  a measured bust when the capture has one, else the whole tile. */
function figureBox(entry: SplatEntry) {
  const range = entry.meta?.stage?.heightRange;
  if (range) {
    const h = (range[1] - range[0]) * SPLAT_SCALE;
    return { w: h * 0.95, h, cy: ((range[0] + range[1]) / 2) * SPLAT_SCALE };
  }
  return { w: TILE_PLANE_H * (256 / 342), h: TILE_PLANE_H, cy: 0 };
}

/** Zoom scale at which the figure stands on the cover: tall on the page,
 *  but clear of the copy in the margins. A full-length figure is slim, so
 *  it can stand nearly the height of the page. */
function detailsFitScale(entry: SplatEntry) {
  const { w, h } = figureBox(entry);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const full = isFullLength(entry);
  const fw = full ? h * 0.42 : w;
  const s = isMobile()
    ? Math.min(((full ? 0.46 : 0.38) * vh) / (h * FOCUS_ZOOM), (0.84 * vw) / (fw * FOCUS_ZOOM))
    : Math.min(((full ? 0.84 : 0.6) * vh) / (h * FOCUS_ZOOM), (0.36 * vw) / (fw * FOCUS_ZOOM));
  return Math.min(3.4, Math.max(0.8, s));
}

/** Zoom scale at which one framed piece (plus its label) fills the view. */
function galleryFitScale(entry: SplatEntry) {
  const { maxOuterW, maxOuterH } = galleryLayout(entry);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const byH = (isMobile() ? h - MOBILE_LABEL_PX - 140 : h * GALLERY_FIT) / (maxOuterH * FOCUS_ZOOM);
  const byW = isMobile()
    ? (w * 0.86) / (maxOuterW * FOCUS_ZOOM)
    : (w * 0.92 - GALLERY_LABEL_PX - 28) / (maxOuterW * FOCUS_ZOOM);
  return Math.min(byH, byW);
}

/** Ease the camera onto the focused model for the given view. */
function frameView(view: FocusView) {
  const store = useBoardStore.getState();
  const entry = entries.find((e) => e.id === store.selectedId);
  if (!entry || !store.anchor || typeof window === 'undefined') return;
  let cy = 0;
  if (view === 'gallery') {
    store.setFocusZoomScale(galleryFitScale(entry));
    cy = galleryLayout(entry).openCy;
  } else {
    store.setFocusZoomScale(detailsFitScale(entry));
    cy = figureBox(entry).cy;
  }
  const s = useBoardStore.getState().focusZoomScale; // clamped
  const off = chromeOffset(view);
  store.setPanTarget({ x: store.anchor.x + off.x / s, y: store.anchor.y + cy + off.y / s });
}

/**
 * Select a model and ease the camera onto it for its cover — the landing
 * view. Shared by tile clicks and the nav search.
 */
export function focusPlacement(id: string, x: number, y: number) {
  const store = useBoardStore.getState();
  store.setSelected(id); // also resets the view to details and the zoom to 1
  store.setAnchor({ x, y });
  frameView('details');
}

/** Switch the focused model between its details and its gallery. */
export function setFocusView(view: FocusView) {
  const store = useBoardStore.getState();
  if (!store.selectedId || store.view === view) return;
  store.setView(view);
  frameView(view);
}

/**
 * Change the focused model's zoom while keeping it on the same spot on
 * screen. Without re-panning, the chrome offset (fixed in world units)
 * grows with zoom and pushes the model off center.
 */
export function setFocusZoom(scale: number) {
  const store = useBoardStore.getState();
  const from = store.focusZoomScale;
  store.setFocusZoomScale(scale);
  const to = useBoardStore.getState().focusZoomScale; // clamped
  if (to === from) return;
  // pan = model + off / s  →  shift by off · (1/to − 1/from)
  const off = chromeOffset(store.view);
  const base = store.panTarget ?? { x: store.panX, y: store.panY };
  const k = 1 / to - 1 / from;
  store.setPanTarget({ x: base.x + off.x * k, y: base.y + off.y * k });
}
