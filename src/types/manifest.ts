export interface ModelLook {
  skin: string;
  hair: string;
  outfit: string;
  style: 'dress' | 'suit' | 'casual';
}

export interface ModelMeta {
  id: string;
  /** 'capture' entries are real imported splats (import-real-splats.mjs). */
  source?: 'capture' | 'placeholder';
  /** Which talent board the model belongs to; untagged models (e.g. the
   *  object-capture test models) appear on every board. */
  gender?: 'female' | 'male';
  name: string;
  agency: string;
  city: string;
  heightCm: number;
  weightKg: number;
  bustCm: number;
  waistCm: number;
  hipsCm: number;
  shoeEu: number;
  hair: string;
  eyes: string;
  bio: string;
  /** The model's card as it should print on the cover, [label, value] in
   *  order, when it differs from the metric fields above (e.g. a tailoring
   *  card in inches). */
  stats?: [string, string][];
  look: ModelLook;
  /** A real capture's figure and its board-tile tag. */
  stage?: StageConfig;
  /** Gallery: stills of the model in each look exist under
   *  /looks/<capture>/<garment>.webp (captured from the splat). */
  lookPortraits?: boolean;
  /** Try-on: garments can be dyed onto this capture's own top (the
   *  gallery hangs the model in each). */
  wardrobe?: WardrobeConfig;
  /** Reuse another entry's splat/thumbnail/full tier under this id (a second
   *  board tile for the same capture — see build-splat-manifest.mjs). */
  variantOf?: string;
  /** Lookbook: separate captures of this model in different outfits, in
   *  show order. The first is the entry's own capture; the others are
   *  resolved by build-splat-manifest.mjs and never get board tiles. */
  looks?: LookConfig[];
  /** Copy for the model's cover view (EditorialView), over the defaults
   *  drawn from its card — see lib/editorial.ts. */
  editorial?: Partial<EditorialConfig>;
}

/** Copy for a model's cover view — the look they walk in. */
export interface EditorialConfig {
  /** Collection line, e.g. "Autumn / Winter 2026". */
  season: string;
  /** Look number in the show. */
  look: number;
  /** Headline of the look, e.g. "The Suit". */
  title: string;
  /** A sentence on the look. */
  standfirst: string;
  /** What is worn, most important first. */
  pieces: EditorialPiece[];
  /** Word set behind the figure (defaults to the model's first name). */
  masthead?: string;
}

export interface EditorialPiece {
  /** Category, e.g. "Tailoring". */
  label: string;
  name: string;
  /** Material and make. */
  detail: string;
}

/** One look in a model's lookbook — a capture of its own. */
export interface LookConfig {
  /** Capture id: the basename of its splat assets in /splats. */
  capture: string;
  name: string;
  /** Short styling line, e.g. "Seated · garment-dyed tee". */
  note: string;
  /** Dominant garment color, for the lookbook card. */
  swatch: string;
  /** A sentence on the look for the cover (defaults to `note`). */
  standfirst?: string;
  /** What is worn in it, for the cover. */
  pieces?: EditorialPiece[];
  /** Measured figure range when it differs from the entry's stage one. */
  heightRange?: [number, number];
  /** Gallery room (a galleryStyles ROOMS key) for its piece. */
  room?: string;
}

/** A look as the manifest ships it: config plus its capture's assets. */
export interface LookEntry extends LookConfig {
  thumbUrl: string;
  fullSplatUrl?: string;
  fullTransform?: SplatTransform;
}

export interface StageConfig {
  /** Tile-local height (m, pre-SPLAT_SCALE) of the figure's lowest and
   *  highest visible gaussians: what the cover frames and the curtain spans. */
  heightRange: [number, number];
  /** Board-tile tag, e.g. "HI-RES · SPZ". */
  badge: string;
  /** Second line of the tile tag, e.g. "Look 01". */
  unit: string;
}

/** Per-capture tuning for finding and re-dyeing the garment in the splat
 *  (tile-local meters; see wardrobeFx for what each value does). */
export interface WardrobeConfig {
  /** [neck line height, blend width, skin warmth threshold] */
  mask: [number, number, number];
  /** [knit reference luminance, shading kept, trim luminance, front depth] */
  tone: [number, number, number, number];
  /** planar garment UV [u0, u per m of x, v0, v per m of y] */
  map: [number, number, number, number];
  /** crew-neck band [top at back of neck, slope toward throat, depth, lowest top] */
  collar: [number, number, number, number];
  /** logo patch on the captured garment [cx, cy, rx, ry], dyed with it */
  patch?: [number, number, number, number];
}

export interface SplatEntry {
  id: string;
  splatUrl: string;
  thumbUrl: string;
  sizeBytes: number;
  /** Uncapped Gaussian count, loaded only while this model is focused.
   *  `.splat` renders via drei; `.spz` (source quality, with SH) via Spark. */
  fullSplatUrl?: string;
  /** Present for `.spz` full tiers: places the raw source in the tile frame. */
  fullTransform?: SplatTransform;
  meta?: ModelMeta;
  /** meta.looks with each capture's assets resolved (index 0 = this entry). */
  looks?: LookEntry[];
}

export interface SplatTransform {
  position: [number, number, number];
  /** three.js order: x, y, z, w */
  quaternion: [number, number, number, number];
  scale: number;
}
