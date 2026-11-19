/**
 * Every piece in the gallery hangs in its own room: wall, light, frame,
 * mat and a photographic treatment ("look filter") that is applied the same
 * way to the piece's still and to the live splat, so the handover between
 * them is seamless. Keyed by garment for try-on captures; other models'
 * pieces take the rooms in order.
 */

export type FrameKind = 'gilt' | 'float' | 'black' | 'steel' | 'oak' | 'walnut' | 'pop' | 'neon';
export type WallPattern = 'paint' | 'damask' | 'concrete' | 'plaster';

export interface LookFilter {
  /** 0 = monochrome, 1 = as captured, >1 = boosted. */
  sat: number;
  contrast: number;
  /** Added after contrast (−0.1…0.1). */
  bright: number;
  /** −1 cool … +1 warm. */
  warm: number;
  /** Lifted blacks of a faded print (0…0.2). */
  lift?: number;
  /** Duotone blend 0…1 between `duoDark` and `duoLight`. */
  duo?: number;
  duoDark?: string;
  duoLight?: string;
  /** Posterize levels (0 = off). */
  poster?: number;
  /** Halftone screen strength 0…1 (works with the duotone). */
  halftone?: number;
  /** Film grain 0…0.1. */
  grain?: number;
}

export interface PieceStyle {
  /** Room name shown on the wall label. */
  room: string;
  wall: string;
  pattern: WallPattern;
  /** Dark rooms switch the gallery chrome to light text. */
  dark: boolean;
  /** Spotlight tint and strength. */
  light: string;
  lightPower: number;
  frame: FrameKind;
  frameColor: string;
  /** Moulding and mat widths (board world units). */
  border: number;
  mat: number;
  matColor: string;
  /** What shows behind the figure inside the opening. */
  ground: string;
  filter: LookFilter;
  /** Neon: tube colors and the halo the live splat gets. */
  neon?: [string, string];
}

export const ROOMS: Record<string, PieceStyle> = {
  oldMasters: {
    room: 'Old Masters',
    wall: '#5a2526',
    pattern: 'damask',
    dark: true,
    light: '#ffd7a1',
    lightPower: 1.25,
    frame: 'gilt',
    frameColor: '#b88a3b',
    border: 0.17,
    mat: 0.035,
    matColor: '#2a1c13',
    ground: '#231812',
    filter: { sat: 0.82, contrast: 1.08, bright: -0.015, warm: 0.65, grain: 0.025 },
  },
  minimal: {
    room: 'Minimal',
    wall: '#f3f2ef',
    pattern: 'paint',
    dark: false,
    light: '#ffffff',
    lightPower: 0.55,
    frame: 'float',
    frameColor: '#ffffff',
    border: 0.012,
    mat: 0.3,
    matColor: '#fdfdfc',
    ground: '#ffffff',
    filter: { sat: 0.92, contrast: 0.92, bright: 0.035, warm: 0 },
  },
  noir: {
    room: 'Noir',
    wall: '#1f1f22',
    pattern: 'paint',
    dark: true,
    light: '#dfe7ff',
    lightPower: 1.4,
    frame: 'black',
    frameColor: '#0b0b0c',
    border: 0.035,
    mat: 0.3,
    matColor: '#f4f2ec',
    ground: '#ebe9e3',
    filter: { sat: 0, contrast: 1.38, bright: -0.03, warm: 0, grain: 0.06 },
  },
  brutalist: {
    room: 'Brutalist',
    wall: '#8e8b85',
    pattern: 'concrete',
    dark: false,
    light: '#f2f5ff',
    lightPower: 0.85,
    frame: 'steel',
    frameColor: '#9aa0a7',
    border: 0.055,
    mat: 0,
    matColor: '#c8c6c1',
    ground: '#c9c7c2',
    filter: { sat: 0.5, contrast: 1.12, bright: 0, warm: -0.45, grain: 0.02 },
  },
  riviera: {
    room: 'Riviera',
    wall: '#a3c5cf',
    pattern: 'plaster',
    dark: false,
    light: '#fff2dc',
    lightPower: 0.8,
    frame: 'oak',
    frameColor: '#c49a62',
    border: 0.065,
    mat: 0.19,
    matColor: '#f7f0e2',
    ground: '#f2e9d7',
    filter: { sat: 0.8, contrast: 0.88, bright: 0.025, warm: 0.5, lift: 0.07, grain: 0.03 },
  },
  desert: {
    room: 'Desert Modern',
    wall: '#c4704b',
    pattern: 'plaster',
    dark: false,
    light: '#ffd9b3',
    lightPower: 0.9,
    frame: 'walnut',
    frameColor: '#4a2b1b',
    border: 0.032,
    mat: 0.22,
    matColor: '#efe5d3',
    ground: '#e9d8c0',
    filter: {
      sat: 0.75,
      contrast: 1.02,
      bright: 0,
      warm: 0.8,
      duo: 0.35,
      duoDark: '#2b170e',
      duoLight: '#f7e3c6',
      grain: 0.02,
    },
  },
  pop: {
    room: 'Pop Art',
    wall: '#f4c21d',
    pattern: 'paint',
    dark: false,
    light: '#ffffff',
    lightPower: 0.5,
    frame: 'pop',
    frameColor: '#e8315b',
    border: 0.09,
    mat: 0,
    matColor: '#2fd6c6',
    ground: '#2fd6c6',
    filter: {
      sat: 1,
      contrast: 1.25,
      bright: 0.02,
      warm: 0,
      duo: 1,
      duoDark: '#1d1a6b',
      duoLight: '#ff78b4',
      poster: 4,
      halftone: 0.6,
    },
  },
  neon: {
    room: 'Neon',
    wall: '#0d0e15',
    pattern: 'paint',
    dark: true,
    light: '#7cf2ff',
    lightPower: 0.55,
    frame: 'neon',
    frameColor: '#16161d',
    border: 0.05,
    mat: 0.16,
    matColor: '#121219',
    ground: '#0b0b11',
    filter: { sat: 1.1, contrast: 1.15, bright: 0, warm: -0.35, grain: 0.03 },
    neon: ['#00e5ff', '#ff2d7a'],
  },
  // lookbook captures (not try-on garments) hang by name — see LookConfig.room
  studio: {
    room: 'Studio',
    wall: '#d8d1c4',
    pattern: 'plaster',
    dark: false,
    light: '#fff3e2',
    lightPower: 0.85,
    frame: 'black',
    frameColor: '#1a1918',
    border: 0.028,
    mat: 0.24,
    matColor: '#f6f2ea',
    ground: '#ece6da',
    filter: { sat: 1.04, contrast: 1.06, bright: 0.01, warm: 0.2, grain: 0.015 },
  },
};

/** Room per Sam look, in rail order. */
const BY_GARMENT: Record<string, keyof typeof ROOMS> = {
  original: 'oldMasters',
  'optic-white': 'minimal',
  'jet-black': 'noir',
  'heather-grey': 'brutalist',
  breton: 'riviera',
  'rust-pocket': 'desert',
  ringer: 'pop',
  graphic: 'neon',
};
/** Rooms in order for models without try-on looks — a lone piece hangs
 *  in the neutral white room. */
const ORDER: (keyof typeof ROOMS)[] = [
  'minimal',
  'noir',
  'oldMasters',
  'brutalist',
  'riviera',
  'desert',
  'pop',
  'neon',
];

export function pieceStyle(garmentId: string | undefined, index: number): PieceStyle {
  const key = (garmentId && BY_GARMENT[garmentId]) || ORDER[index % ORDER.length];
  return ROOMS[key];
}

/** The widest a frame gets (moulding + mat), for spacing and fit. */
export const MAX_FRAME_EXTRA = Math.max(...Object.values(ROOMS).map((s) => s.border + s.mat));
