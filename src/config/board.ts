/** Shared board tuning constants. */

export const BASE_ZOOM = 80;
/** Ortho zoom the camera eases to while a model is focused. */
export const FOCUS_ZOOM = 150;
export const MOBILE_BREAKPOINT_PX = 768;

export const TILE_PLANE_H = 1.9;
/** World meters mapped to the full tile height — must match REF_HEIGHT_M in
 *  scripts/import-real-splats.mjs so thumb and splat align. */
export const REF_HEIGHT_M = 2.3;
/** Splat meters → board world units. */
export const SPLAT_SCALE = TILE_PLANE_H / REF_HEIGHT_M;

/** Gallery: width of the wall label the centered piece is framed beside. */
export const GALLERY_LABEL_PX = 300;
/** Fraction of the viewport height a gallery frame is zoomed to fill. */
export const GALLERY_FIT = 0.5;
