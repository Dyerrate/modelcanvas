// Generates synthetic humanoid .splat files (antimatter15 format, as consumed
// by drei's <Splat>) plus PNG thumbnails, one per entry in model-meta.json.
// These are stand-ins until real Gaussian splat captures are dropped into
// public/splats/. Run: node scripts/generate-placeholder-splats.mjs
//
// .splat row layout (32 bytes per gaussian):
//   float32 x, y, z        — center (loader negates z)
//   float32 sx, sy, sz     — scale (linear)
//   uint8   r, g, b, a     — color
//   uint8   qw, qx, qy, qz — rotation quaternion, encoded (q * 128 + 128)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const META_PATH = path.join(root, 'src', 'data', 'model-meta.json');
const SPLATS_DIR = path.join(root, 'public', 'splats');
const THUMBS_DIR = path.join(root, 'public', 'thumbs');

const THUMB_W = 256;
const THUMB_H = 342;
// World meters mapped to the full thumbnail height. Must match REF_HEIGHT_M
// in CharacterTile.tsx so the thumbnail and the live splat align during the
// crossfade (and taller models read as taller on the board).
const REF_HEIGHT_M = 2.3;

// --- deterministic RNG (mulberry32) seeded from the model id ---------------

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- gaussian scatter helpers ----------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Uniform-ish point inside a unit sphere. */
function spherePoint(rng) {
  let x, y, z;
  do {
    x = rng() * 2 - 1;
    y = rng() * 2 - 1;
    z = rng() * 2 - 1;
  } while (x * x + y * y + z * z > 1);
  return [x, y, z];
}

/**
 * Scatter `count` gaussians inside an ellipsoid.
 * opts: { rgb, alpha, size (base gaussian radius, m), sizeJitter, colorJitter }
 */
function addEllipsoid(out, rng, cx, cy, cz, rx, ry, rz, count, opts) {
  const { rgb, alpha = 235, size = 0.02, sizeJitter = 0.5, colorJitter = 12 } = opts;
  for (let i = 0; i < count; i++) {
    const [px, py, pz] = spherePoint(rng);
    const s = size * (1 + (rng() * 2 - 1) * sizeJitter);
    out.push({
      x: cx + px * rx,
      y: cy + py * ry,
      z: cz + pz * rz,
      s,
      r: clamp8(rgb[0] + (rng() * 2 - 1) * colorJitter),
      g: clamp8(rgb[1] + (rng() * 2 - 1) * colorJitter),
      b: clamp8(rgb[2] + (rng() * 2 - 1) * colorJitter),
      a: alpha,
    });
  }
}

/** Scatter gaussians along a capsule from (x1,y1,z1) to (x2,y2,z2), radius r. */
function addCapsule(out, rng, x1, y1, z1, x2, y2, z2, r, count, opts) {
  for (let i = 0; i < count; i++) {
    const t = rng();
    const [px, py, pz] = spherePoint(rng);
    const cx = x1 + (x2 - x1) * t;
    const cy = y1 + (y2 - y1) * t;
    const cz = z1 + (z2 - z1) * t;
    const rr = typeof r === 'function' ? r(t) : r;
    const { rgb, alpha = 235, size = 0.018, sizeJitter = 0.5, colorJitter = 12 } = opts;
    const s = size * (1 + (rng() * 2 - 1) * sizeJitter);
    out.push({
      x: cx + px * rr,
      y: cy + py * rr,
      z: cz + pz * rr,
      s,
      r: clamp8(rgb[0] + (rng() * 2 - 1) * colorJitter),
      g: clamp8(rgb[1] + (rng() * 2 - 1) * colorJitter),
      b: clamp8(rgb[2] + (rng() * 2 - 1) * colorJitter),
      a: alpha,
    });
  }
}

function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// --- humanoid builder --------------------------------------------------------

/**
 * Builds a stylized standing figure ~heightM tall, feet at y=0, then
 * recenters so the figure's vertical middle sits at y=0.
 */
function buildFigure(meta, rng) {
  const g = [];
  const H = meta.heightCm / 100;
  const u = H / 1.75; // proportional unit vs. reference 1.75 m figure
  const skin = hexToRgb(meta.look.skin);
  const hair = hexToRgb(meta.look.hair);
  const outfit = hexToRgb(meta.look.outfit);
  const style = meta.look.style;
  const denim = [58, 74, 107];

  const hipW = 0.09 * u;

  // legs + feet
  const legColor = style === 'dress' ? skin : style === 'suit' ? outfit : denim;
  for (const side of [-1, 1]) {
    const lx = side * hipW * 0.7;
    addCapsule(g, rng, lx, 0.08 * u, 0, lx, 0.88 * u, 0, (t) => (0.04 + 0.025 * t) * u, 900, {
      rgb: legColor,
    });
    addEllipsoid(g, rng, lx, 0.03 * u, 0.03 * u, 0.05 * u, 0.03 * u, 0.09 * u, 150, {
      rgb: style === 'casual' ? [240, 240, 240] : [30, 26, 24],
    });
  }

  // hips
  addEllipsoid(g, rng, 0, 0.92 * u, 0, 0.15 * u, 0.08 * u, 0.1 * u, 450, {
    rgb: style === 'dress' ? outfit : legColor,
  });

  if (style === 'dress') {
    // flared skirt: waist down to just above the knee
    addCapsule(g, rng, 0, 1.02 * u, 0, 0, 0.55 * u, 0, (t) => (0.1 + 0.14 * t) * u, 1600, {
      rgb: outfit,
      size: 0.024,
    });
  }

  // torso (waist → chest, tapering outward toward shoulders)
  addCapsule(g, rng, 0, 0.98 * u, 0, 0, 1.38 * u, 0, (t) => (0.1 + 0.045 * t) * u, 1300, {
    rgb: outfit,
  });
  // shoulders
  addEllipsoid(g, rng, 0, 1.4 * u, 0, 0.17 * u, 0.05 * u, 0.08 * u, 350, { rgb: outfit });

  // arms
  const armColor = style === 'casual' ? skin : style === 'dress' ? skin : outfit;
  for (const side of [-1, 1]) {
    addCapsule(
      g,
      rng,
      side * 0.19 * u,
      1.38 * u,
      0,
      side * 0.23 * u,
      0.9 * u,
      0.02 * u,
      0.032 * u,
      700,
      { rgb: armColor }
    );
    // hands
    addEllipsoid(g, rng, side * 0.235 * u, 0.86 * u, 0.02 * u, 0.03 * u, 0.045 * u, 0.02 * u, 90, {
      rgb: skin,
    });
  }

  // neck + head
  addCapsule(g, rng, 0, 1.42 * u, 0, 0, 1.5 * u, 0, 0.035 * u, 150, { rgb: skin });
  addEllipsoid(g, rng, 0, 1.585 * u, 0, 0.08 * u, 0.1 * u, 0.085 * u, 900, {
    rgb: skin,
    size: 0.016,
  });

  // hair: cap over the skull; long variant adds strands to the shoulders
  const longHair = rng() < 0.5 && style !== 'suit';
  addEllipsoid(g, rng, 0, 1.63 * u, -0.01 * u, 0.088 * u, 0.085 * u, 0.09 * u, 700, {
    rgb: hair,
    size: 0.016,
  });
  if (longHair) {
    for (const side of [-1, 1]) {
      addCapsule(
        g,
        rng,
        side * 0.075 * u,
        1.6 * u,
        -0.03 * u,
        side * 0.09 * u,
        1.25 * u,
        -0.05 * u,
        0.03 * u,
        350,
        { rgb: hair, size: 0.016 }
      );
    }
  }

  // recenter vertically around the figure's middle
  const midY = (H + 0.06) / 2;
  for (const p of g) p.y -= midY;
  return g;
}

// --- .splat encoding ---------------------------------------------------------

function encodeSplat(gaussians) {
  const buf = Buffer.alloc(gaussians.length * 32);
  gaussians.forEach((p, i) => {
    const o = i * 32;
    // .splat convention is y-down (drei's loader keeps y and negates z), so
    // flip y here to render upright without a corrective rotation in the tile
    buf.writeFloatLE(p.x, o);
    buf.writeFloatLE(-p.y, o + 4);
    buf.writeFloatLE(-p.z, o + 8);
    buf.writeFloatLE(p.s, o + 12);
    buf.writeFloatLE(p.s, o + 16);
    buf.writeFloatLE(p.s, o + 20);
    buf[o + 24] = p.r;
    buf[o + 25] = p.g;
    buf[o + 26] = p.b;
    buf[o + 27] = p.a;
    // identity quaternion (w,x,y,z) encoded as q*128+128
    buf[o + 28] = 255;
    buf[o + 29] = 128;
    buf[o + 30] = 128;
    buf[o + 31] = 128;
  });
  return buf;
}

// --- PNG encoding (RGBA, no deps) ---------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- thumbnail rasterizer ------------------------------------------------------

/** Orthographic front view: splat the gaussians back-to-front onto RGBA. */
function renderThumb(gaussians) {
  const w = THUMB_W;
  const h = THUMB_H;
  const px = new Float32Array(w * h * 4); // premultiplied rgb + alpha
  const pxPerM = h / REF_HEIGHT_M;
  const cx = w / 2;
  const cy = h / 2;

  const sorted = [...gaussians].sort((a, b) => a.z - b.z); // far (−z) first
  for (const p of sorted) {
    const sx = cx + p.x * pxPerM;
    const sy = cy - p.y * pxPerM;
    const sigma = Math.max(0.6, p.s * pxPerM);
    const rad = Math.ceil(sigma * 2.5);
    const a0 = (p.a / 255) * 0.85;
    const x0 = Math.max(0, Math.floor(sx - rad));
    const x1 = Math.min(w - 1, Math.ceil(sx + rad));
    const y0 = Math.max(0, Math.floor(sy - rad));
    const y1 = Math.min(h - 1, Math.ceil(sy + rad));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - sx;
        const dy = yy - sy;
        const alpha = a0 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        if (alpha < 0.01) continue;
        const i = (yy * w + xx) * 4;
        const inv = 1 - alpha;
        px[i] = (p.r / 255) * alpha + px[i] * inv;
        px[i + 1] = (p.g / 255) * alpha + px[i + 1] * inv;
        px[i + 2] = (p.b / 255) * alpha + px[i + 2] * inv;
        px[i + 3] = alpha + px[i + 3] * inv;
      }
    }
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3];
    if (a > 0.004) {
      rgba[i * 4] = clamp8((px[i * 4] / a) * 255);
      rgba[i * 4 + 1] = clamp8((px[i * 4 + 1] / a) * 255);
      rgba[i * 4 + 2] = clamp8((px[i * 4 + 2] / a) * 255);
      rgba[i * 4 + 3] = clamp8(a * 255);
    }
  }
  return encodePng(w, h, rgba);
}

// --- main -----------------------------------------------------------------------

const metas = JSON.parse(await readFile(META_PATH, 'utf8'));
await mkdir(SPLATS_DIR, { recursive: true });
await mkdir(THUMBS_DIR, { recursive: true });

for (const meta of metas) {
  if (meta.source === 'capture') continue; // real imports own these ids
  const rng = mulberry32(hashString(meta.id));
  const gaussians = buildFigure(meta, rng);
  const splat = encodeSplat(gaussians);
  await writeFile(path.join(SPLATS_DIR, `${meta.id}.splat`), splat);
  await writeFile(path.join(THUMBS_DIR, `${meta.id}.png`), renderThumb(gaussians));
  console.log(
    `${meta.id}: ${gaussians.length} gaussians, ${(splat.length / 1024).toFixed(0)} KB`
  );
}
console.log(`\nGenerated ${metas.length} placeholder splats + thumbnails.`);
