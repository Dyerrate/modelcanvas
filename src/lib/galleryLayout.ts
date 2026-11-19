import { GARMENTS, type Garment } from '../data/wardrobe';
import { MAX_FRAME_EXTRA, pieceStyle, ROOMS, type PieceStyle } from '../data/galleryStyles';
import type { SplatEntry } from '../types/manifest';
import { SPLAT_SCALE, TILE_PLANE_H } from '../config/board';
import { captureKey } from '../hooks/useLookStore';

const TILE_PLANE_W = TILE_PLANE_H * (256 / 342); // matches CharacterTile

/**
 * Geometry of the gallery hang for one model, in board world units relative
 * to the model's tile. Every piece shares one picture opening (so the live
 * splat fits any of them); each room's frame adds its own moulding and mat
 * around it. Frames hang in a row along the wall, `spacing` apart, with
 * the live piece's opening centered on the tile.
 */
export interface GalleryLayout {
  /** Picture opening (where the figure / portrait sits). */
  openW: number;
  openH: number;
  /** Opening center height relative to the tile origin. */
  openCy: number;
  /** Outer size of the largest frame in any room. */
  maxOuterW: number;
  maxOuterH: number;
  spacing: number;
  /** Wall/floor junction, relative to the tile origin. */
  floorY: number;
}

export function galleryLayout(entry: SplatEntry): GalleryLayout {
  const range = entry.meta?.stage?.heightRange;
  let openW: number;
  let openH: number;
  let openCy: number;
  if (range) {
    // a measured bust: tight portrait opening, more air above the crown
    const [lo, hi] = range;
    // faint gaussians feather past the measured range, so leave room
    const bottom = lo * SPLAT_SCALE - 0.16;
    const top = hi * SPLAT_SCALE + 0.18;
    openH = top - bottom;
    openCy = (top + bottom) / 2;
    openW = Math.max(openH * 0.82, 1.5);
  } else {
    openW = TILE_PLANE_W + 0.12;
    openH = TILE_PLANE_H + 0.1;
    openCy = 0;
  }
  const maxOuterW = openW + 2 * MAX_FRAME_EXTRA;
  const maxOuterH = openH + 2 * MAX_FRAME_EXTRA;
  return {
    openW,
    openH,
    openCy,
    maxOuterW,
    maxOuterH,
    // the gap holds the wall label of the piece in front of you
    spacing: maxOuterW + 1.75,
    floorY: openCy - maxOuterH / 2 - 0.45,
  };
}

/** One artwork on the wall: a look the model can be shown in. */
export interface GalleryPiece {
  /** Garment worn in this piece (null: the model as captured, no try-on). */
  garment: Garment | null;
  /** Lookbook capture shown in this piece (index into entry.looks; 0 when
   *  the model has no lookbook). */
  look: number;
  title: string;
  /** Styling line for the wall label. */
  note: string | null;
  /** Still of the model in this look, shown while the piece isn't live. */
  portrait: string | null;
  /** The room it hangs in. */
  style: PieceStyle;
}

/** The model's own capture (in each try-on garment, if it has any), then
 *  the other captures of its lookbook. */
export function galleryPieces(entry: SplatEntry): GalleryPiece[] {
  const meta = entry.meta;
  const pieces: GalleryPiece[] = [];
  if (meta?.wardrobe) {
    const key = captureKey(entry);
    GARMENTS.forEach((g, i) =>
      pieces.push({
        garment: g,
        look: 0,
        title: g.original ? `${g.name}, as captured` : g.name,
        note: g.original ? null : g.note,
        portrait: meta.lookPortraits ? `/looks/${key}/${g.id}.webp` : null,
        style: pieceStyle(g.id, i),
      })
    );
  } else {
    pieces.push({
      garment: null,
      look: 0,
      title: 'As captured',
      note: null,
      portrait: null,
      style: pieceStyle(undefined, 0),
    });
  }
  entry.looks?.forEach((look, i) => {
    if (i === 0) return;
    pieces.push({
      garment: null,
      look: i,
      title: look.name,
      note: look.note,
      portrait: meta?.lookPortraits ? `/looks/${look.capture}/original.webp` : null,
      style: (look.room && ROOMS[look.room]) || pieceStyle(undefined, pieces.length),
    });
  });
  return pieces;
}
