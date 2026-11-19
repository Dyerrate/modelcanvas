import { CanvasTexture, SRGBColorSpace, Texture } from 'three';
import type { Garment } from '../data/wardrobe';

/**
 * Procedural tee textures in one shared 512×640 layout (y down, neckline
 * center at y≈70 → v≈0.89). Sam's bust is cropped mid-chest (≈ y 218), so
 * chest prints sit high, between the neckline and y≈205. The rack maps them onto its tee meshes; the
 * splat try-on projects the same layout onto the chest (see the wardrobe
 * `map` config), so stripes and prints land in matching places.
 */
export const TEX_W = 512;
export const TEX_H = 640;

/** Left half of the tee outline (canvas px); mirrored for the right. A
 *  boxy tee (body ≈ 1.45× as long as it is wide); the canvas below the hem
 *  is only used by the splat, whose bust ends well above it. */
const HALF: [number, number][] = [
  [256, 92], // front neckline dip
  [228, 86],
  [212, 74],
  [204, 60], // neck seam at the shoulder
  [116, 84], // shoulder point
  [24, 164], // sleeve top
  [74, 216], // sleeve hem
  [122, 194], // underarm
  [126, 462], // side seam → hem
  [256, 468],
];

/** Closed tee outline path (front neckline). */
export function teePath(g: CanvasRenderingContext2D) {
  g.beginPath();
  HALF.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  for (let i = HALF.length - 1; i >= 0; i--) g.lineTo(TEX_W - HALF[i][0], HALF[i][1]);
  g.closePath();
}

/** Neckline curve (for the rib), shoulder seam to shoulder seam. */
function necklinePath(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(204, 60);
  g.bezierCurveTo(212, 82, 236, 92, 256, 92);
  g.bezierCurveTo(276, 92, 300, 82, 308, 60);
}

// deterministic noise so every visit draws the same yarn
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const shadeHex = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(Math.min(255, Math.max(0, k >= 1 ? v + (255 - v) * (k - 1) : v * k))),
  );
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

export const trimOf = (g: Garment) => g.trim ?? shadeHex(g.color, 0.88);

/** Body fabric: color, yarn texture, stripes (no print, no trim). */
function drawBase(g: CanvasRenderingContext2D, garment: Garment) {
  const r = rng(garment.id.length * 9973 + garment.color.charCodeAt(2));
  g.fillStyle = garment.color;
  g.fillRect(0, 0, TEX_W, TEX_H);

  if (garment.stripes) {
    const [color, period, width] = garment.stripes;
    g.fillStyle = color;
    for (let y = 104; y < TEX_H; y += period) g.fillRect(0, y, TEX_W, width);
  }

  if (garment.original) {
    // cable knit: twisting rope columns with purl channels between
    for (let x = 18; x < TEX_W; x += 44) {
      g.fillStyle = 'rgba(0, 0, 0, 0.28)';
      g.fillRect(x - 3, 0, 4, TEX_H);
      for (let y = 0; y < TEX_H; y += 26) {
        const grad = g.createLinearGradient(x, y, x + 22, y + 22);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(x + 13, y + 13, 9, 13, 0.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // yarn: fine jersey wales + mottling (strong for heathered stock)
  const speck = garment.heather ? 9000 : 2600;
  for (let i = 0; i < speck; i++) {
    const v = r();
    g.fillStyle =
      v > 0.5
        ? `rgba(255,255,255,${garment.heather ? 0.22 : 0.05})`
        : `rgba(0,0,0,${garment.heather ? 0.2 : 0.06})`;
    g.fillRect(r() * TEX_W, r() * TEX_H, 1 + r() * (garment.heather ? 3 : 2), 1);
  }
  g.fillStyle = 'rgba(0, 0, 0, 0.035)';
  for (let x = 0; x < TEX_W; x += 3) g.fillRect(x, 0, 1, TEX_H);
}

/** Chest print on a transparent canvas (front only). */
function drawPrint(g: CanvasRenderingContext2D, garment: Garment) {
  g.clearRect(0, 0, TEX_W, TEX_H);
  if (garment.print === 'wordmark') {
    const ink = '#ecebe5';
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(256, 122, 15, 0, Math.PI * 2);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 13px "Chakra Petch", "Arial Black", sans-serif';
    g.fillText('MC', 256, 123);
    g.font = '800 31px "Chakra Petch", "Arial Black", sans-serif';
    g.fillText('MODEL', 256, 158);
    g.fillText('CANVAS', 256, 188);
    g.font = '600 10px "JetBrains Mono", monospace';
    g.fillText('— STUDIO 26 —', 256, 209);
    // worn screen print: knock speckles out of the ink
    const r = rng(77);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.5})`;
      g.fillRect(190 + r() * 132, 104 + r() * 112, 1 + r() * 3, 1 + r() * 2);
    }
    g.globalCompositeOperation = 'source-over';
  } else if (garment.print === 'pocket') {
    // patch pocket on the wearer's left chest (viewer's right)
    const x = 290;
    const y = 112;
    g.fillStyle = shadeHex(garment.color, 0.84);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 64, y);
    g.lineTo(x + 64, y + 62);
    g.lineTo(x + 32, y + 72);
    g.lineTo(x, y + 62);
    g.closePath();
    g.fill();
    g.strokeStyle = shadeHex(garment.color, 1.35);
    g.setLineDash([5, 4]);
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    g.moveTo(x + 3, y + 9);
    g.lineTo(x + 61, y + 9);
    g.stroke();
    g.setLineDash([]);
  }
}

/** Collar rib + sleeve/body hems, for the rack's tee. */
function drawTrim(g: CanvasRenderingContext2D, garment: Garment) {
  const trim = trimOf(garment);
  g.strokeStyle = trim;
  g.lineCap = 'round';
  g.lineWidth = 15;
  necklinePath(g);
  g.stroke();
  if (garment.original) {
    // the captured sweater's twin tipping stripes
    g.strokeStyle = '#2b3a5c';
    g.lineWidth = 3;
    necklinePath(g);
    g.stroke();
  }
  g.strokeStyle = shadeHex(garment.color, 0.8);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(32, 170);
  g.lineTo(78, 210);
  g.moveTo(TEX_W - 32, 170);
  g.lineTo(TEX_W - 78, 210);
  g.moveTo(130, 452);
  g.lineTo(TEX_W - 130, 452);
  g.stroke();
}

export interface GarmentTextures {
  /** Splat: body fabric (stripes, yarn). */
  base: Texture;
  /** Splat: chest print with alpha. */
  print: Texture;
  /** Rack: front face (fabric + trim + print). */
  front: Texture;
  /** Rack: back face (fabric + trim). */
  back: Texture;
}

const cache = new Map<string, GarmentTextures>();

const canvas = () => {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  return c;
};
const tex = (c: HTMLCanvasElement) => {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

export function garmentTextures(garment: Garment): GarmentTextures {
  const hit = cache.get(garment.id);
  if (hit) return hit;
  const base = canvas();
  drawBase(base.getContext('2d')!, garment);
  const print = canvas();
  drawPrint(print.getContext('2d')!, garment);

  const back = canvas();
  const gb = back.getContext('2d')!;
  gb.drawImage(base, 0, 0);
  drawTrim(gb, garment);
  const front = canvas();
  const gf = front.getContext('2d')!;
  gf.drawImage(back, 0, 0);
  gf.drawImage(print, 0, 0);

  const set: GarmentTextures = {
    base: tex(base),
    print: tex(print),
    front: tex(front),
    back: tex(back),
  };
  // the splat samples raw sRGB values — keep its two layers unconverted
  set.base.colorSpace = '';
  set.print.colorSpace = '';
  cache.set(garment.id, set);
  return set;
}

/** Shared alpha mask of the tee outline (white inside). */
let maskTex: CanvasTexture | null = null;
export function teeMask(): CanvasTexture {
  if (maskTex) return maskTex;
  const c = canvas();
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  teePath(g);
  g.fill();
  maskTex = new CanvasTexture(c);
  return maskTex;
}

/** Parse a CSS color into 0..1 rgb (sRGB values, as the splat uses). */
export function cssRgb(color: string): [number, number, number] {
  const c = document.createElement('canvas').getContext('2d')!;
  c.fillStyle = color;
  const v = c.fillStyle as string; // normalized to #rrggbb or rgb(a)
  if (v.startsWith('#')) {
    const n = parseInt(v.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = v.match(/[\d.]+/g)!.map(Number);
  return [m[0] / 255, m[1] / 255, m[2] / 255];
}
