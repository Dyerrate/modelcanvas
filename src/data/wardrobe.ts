/**
 * "My Looks" rail: the tees a model can try on. Fabric, trim and print are
 * drawn procedurally (lib/garmentTextures.ts) into one shared layout, so the
 * tee on the rack and the tee dyed onto the splat carry the same stripes and
 * the same chest print in the same place.
 */
export interface Garment {
  id: string;
  name: string;
  /** Short fabric/fit line for the rack's tag card. */
  note: string;
  /** Body color. */
  color: string;
  /** Collar/rib color (defaults to a shade of the body). */
  trim?: string;
  /** Horizontal stripes [color, period px, stripe px] in the texture. */
  stripes?: [string, number, number];
  /** Heathered (mottled) yarn. */
  heather?: boolean;
  /** Chest print drawn on the front only. */
  print?: 'wordmark' | 'pocket';
  /** The captured garment itself: on the splat it means "no dye". */
  original?: boolean;
}

export const GARMENTS: Garment[] = [
  {
    id: 'original',
    name: 'Cable Knit',
    note: 'As captured · bottle green',
    color: '#24402f',
    trim: '#e9e2cf',
    original: true,
  },
  { id: 'optic-white', name: 'Optic White Tee', note: 'Heavy jersey · 240 gsm', color: '#f1efe9' },
  { id: 'jet-black', name: 'Jet Black Tee', note: 'Garment-dyed jersey', color: '#18181b' },
  {
    id: 'heather-grey',
    name: 'Heather Grey Tee',
    note: 'Marled cotton',
    color: '#a2a4a7',
    heather: true,
  },
  {
    id: 'breton',
    name: 'Breton Stripe',
    note: 'Ecru / navy · yarn-dyed',
    color: '#efe8d8',
    trim: '#1f2d4c',
    stripes: ['#1f2d4c', 26, 9],
  },
  {
    id: 'rust-pocket',
    name: 'Rust Pocket Tee',
    note: 'Slub jersey · patch pocket',
    color: '#9f4528',
    print: 'pocket',
  },
  {
    id: 'ringer',
    name: 'Ringer Tee',
    note: 'White / black contrast rib',
    color: '#f3f1ec',
    trim: '#141416',
  },
  {
    id: 'graphic',
    name: 'Canvas Graphic Tee',
    note: 'Black · screen print',
    color: '#151517',
    print: 'wordmark',
  },
];

export const garmentById = (id: string) => GARMENTS.find((g) => g.id === id) ?? GARMENTS[0];
