// Imports real Gaussian-splat captures from public sources and normalizes
// them to the board's conventions (antimatter15 .splat, y-down, vertically
// centered, sized against the REF_HEIGHT_M frame), then renders the matching
// alpha thumbnail. Run: node scripts/import-real-splats.mjs
//
// Downloads are cached in .cache/real-splats/ so re-runs (e.g. to tune a
// rotation) are offline. Each import: prune floaters → importance-downsample
// to the manifest's 8 MB budget → rotate/center/scale → write splat + thumb.
//
// .splat row layout (32 bytes per gaussian):
//   float32 x, y, z        — center (loader negates z)
//   float32 sx, sy, sz     — scale (linear)
//   uint8   r, g, b, a     — color
//   uint8   qw, qx, qy, qz — rotation quaternion, encoded (q * 128 + 128)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(root, '.cache', 'real-splats');
const SPLATS_DIR = path.join(root, 'public', 'splats');
const THUMBS_DIR = path.join(root, 'public', 'thumbs');

const THUMB_W = 256;
const THUMB_H = 342;
/** Must match REF_HEIGHT_M in CharacterTile.tsx (and the placeholder
 *  generator) so thumbnail and live splat align during the crossfade. */
const REF_HEIGHT_M = 2.3;
/** Keep under build-splat-manifest.mjs's 8 MB gate with some headroom. */
const MAX_GAUSSIANS = Math.floor((7.5 * 1024 * 1024) / 32);

/**
 * Captures to import. rotateDeg is applied in file space (y-down) — tune it
 * until the model reads upright on the board, re-running this script.
 * heightM is the vertical extent the object is normalized to inside the
 * REF_HEIGHT_M thumbnail/tile frame.
 */
const CAPTURES = [
  {
    id: 'capture-nike',
    url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat',
    format: 'splat',
    heightM: 0.8, // shoes are long — keep the toe-to-heel span inside the tile
    rotateDeg: [0, 0, 0],
  },
  {
    id: 'capture-plush',
    url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/plush.splat',
    format: 'splat',
    heightM: 1.8,
    rotateDeg: [0, 0, 90], // capture lies on its side
  },
  {
    id: 'capture-luigi',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/luigi/luigi.ply',
    format: 'ply',
    heightM: 1.9,
    rotateDeg: [180, 0, 0], // y-up ply → y-down, and turn to face the camera
  },
];

// --- download ----------------------------------------------------------------

async function fetchCached(url, id) {
  const file = path.join(CACHE_DIR, `${id}${path.extname(new URL(url).pathname)}`);
  if (existsSync(file)) return readFile(file);
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, buf);
  return buf;
}

// --- parsers → array of { x,y,z, sx,sy,sz, r,g,b,a, qw,qx,qy,qz } -------------

function parseSplat(buf) {
  const n = Math.floor(buf.length / 32);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 32;
    out[i] = {
      x: buf.readFloatLE(o),
      y: buf.readFloatLE(o + 4),
      z: buf.readFloatLE(o + 8),
      sx: buf.readFloatLE(o + 12),
      sy: buf.readFloatLE(o + 16),
      sz: buf.readFloatLE(o + 20),
      r: buf[o + 24],
      g: buf[o + 25],
      b: buf[o + 26],
      a: buf[o + 27],
      qw: (buf[o + 28] - 128) / 128,
      qx: (buf[o + 29] - 128) / 128,
      qy: (buf[o + 30] - 128) / 128,
      qz: (buf[o + 31] - 128) / 128,
    };
  }
  return out;
}

const SH_C0 = 0.28209479177387814;
const sigmoid = (v) => 1 / (1 + Math.exp(-v));

/** Binary-little-endian 3DGS .ply (all-float32 properties). */
function parseGaussianPly(buf) {
  const headerEnd = buf.indexOf('end_header\n') + 'end_header\n'.length;
  const header = buf.toString('ascii', 0, headerEnd);
  if (!/format binary_little_endian/.test(header)) throw new Error('unsupported ply format');
  const count = parseInt(header.match(/element vertex (\d+)/)[1], 10);
  const props = [...header.matchAll(/property float (\S+)/g)].map((m) => m[1]);
  const idx = Object.fromEntries(props.map((p, i) => [p, i]));
  for (const req of ['x', 'f_dc_0', 'opacity', 'scale_0', 'rot_0']) {
    if (!(req in idx)) throw new Error(`ply missing property ${req}`);
  }
  const stride = props.length * 4;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = headerEnd + i * stride;
    const f = (name) => buf.readFloatLE(o + idx[name] * 4);
    const q = [f('rot_0'), f('rot_1'), f('rot_2'), f('rot_3')];
    const qn = Math.hypot(...q) || 1;
    out[i] = {
      x: f('x'),
      y: f('y'),
      z: f('z'),
      sx: Math.exp(f('scale_0')),
      sy: Math.exp(f('scale_1')),
      sz: Math.exp(f('scale_2')),
      r: clamp8((0.5 + SH_C0 * f('f_dc_0')) * 255),
      g: clamp8((0.5 + SH_C0 * f('f_dc_1')) * 255),
      b: clamp8((0.5 + SH_C0 * f('f_dc_2')) * 255),
      a: clamp8(sigmoid(f('opacity')) * 255),
      qw: q[0] / qn,
      qx: q[1] / qn,
      qy: q[2] / qn,
      qz: q[3] / qn,
    };
  }
  return out;
}

function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// --- cleanup / normalization ---------------------------------------------------

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const percentile = (sortedArr, p) => sortedArr[Math.floor((sortedArr.length - 1) * p)];

/** Drop near-invisible gaussians and floaters far from the robust center. */
function prune(gaussians) {
  const visible = gaussians.filter((g) => g.a >= 10);
  const cx = median(visible.map((g) => g.x));
  const cy = median(visible.map((g) => g.y));
  const cz = median(visible.map((g) => g.z));
  const dists = visible
    .map((g) => Math.hypot(g.x - cx, g.y - cy, g.z - cz))
    .sort((a, b) => a - b);
  const maxR = percentile(dists, 0.9) * 2.5;
  return visible.filter((g) => Math.hypot(g.x - cx, g.y - cy, g.z - cz) <= maxR);
}

/** Keep the most visually important gaussians (opacity × volume). */
function downsample(gaussians, cap) {
  if (gaussians.length <= cap) return gaussians;
  const scored = gaussians.map((g) => ({
    g,
    w: g.a * Math.cbrt(Math.abs(g.sx * g.sy * g.sz)),
  }));
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, cap).map((s) => s.g);
}

/** Euler XYZ (degrees) → quaternion [w,x,y,z]. */
function eulerToQuat([dx, dy, dz]) {
  const [rx, ry, rz] = [dx, dy, dz].map((d) => (d * Math.PI) / 180 / 2);
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)];
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)];
  const [cz, sz] = [Math.cos(rz), Math.sin(rz)];
  return [
    cx * cy * cz + sx * sy * sz,
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
  ];
}

const quatMul = ([aw, ax, ay, az], [bw, bx, by, bz]) => [
  aw * bw - ax * bx - ay * by - az * bz,
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
];

const rotateVec = (q, [vx, vy, vz]) => {
  // v' = q ⊗ (0,v) ⊗ q*
  const [w, x, y, z] = q;
  const uvx = y * vz - z * vy;
  const uvy = z * vx - x * vz;
  const uvz = x * vy - y * vx;
  const uuvx = y * uvz - z * uvy;
  const uuvy = z * uvx - x * uvz;
  const uuvz = x * uvy - y * uvx;
  return [vx + 2 * (w * uvx + uuvx), vy + 2 * (w * uvy + uuvy), vz + 2 * (w * uvz + uuvz)];
};

/** Rotate, then center on the bounding box, then scale to heightM tall. */
function normalize(gaussians, rotateDeg, heightM) {
  const q = eulerToQuat(rotateDeg);
  for (const g of gaussians) {
    [g.x, g.y, g.z] = rotateVec(q, [g.x, g.y, g.z]);
    [g.qw, g.qx, g.qy, g.qz] = quatMul(q, [g.qw, g.qx, g.qy, g.qz]);
  }
  const xs = gaussians.map((g) => g.x).sort((a, b) => a - b);
  const ys = gaussians.map((g) => g.y).sort((a, b) => a - b);
  const zs = gaussians.map((g) => g.z).sort((a, b) => a - b);
  // robust bbox — a stray floater shouldn't shrink the whole model
  const lo = (s) => percentile(s, 0.005);
  const hi = (s) => percentile(s, 0.995);
  const c = [(lo(xs) + hi(xs)) / 2, (lo(ys) + hi(ys)) / 2, (lo(zs) + hi(zs)) / 2];
  const k = heightM / Math.max(hi(ys) - lo(ys), 1e-6);
  for (const g of gaussians) {
    g.x = (g.x - c[0]) * k;
    g.y = (g.y - c[1]) * k;
    g.z = (g.z - c[2]) * k;
    g.sx *= k;
    g.sy *= k;
    g.sz *= k;
  }
  return gaussians;
}

// --- .splat + thumbnail output --------------------------------------------------

function encodeSplat(gaussians) {
  const buf = Buffer.alloc(gaussians.length * 32);
  gaussians.forEach((g, i) => {
    const o = i * 32;
    buf.writeFloatLE(g.x, o);
    buf.writeFloatLE(g.y, o + 4);
    buf.writeFloatLE(g.z, o + 8);
    buf.writeFloatLE(g.sx, o + 12);
    buf.writeFloatLE(g.sy, o + 16);
    buf.writeFloatLE(g.sz, o + 20);
    buf[o + 24] = g.r;
    buf[o + 25] = g.g;
    buf[o + 26] = g.b;
    buf[o + 27] = g.a;
    buf[o + 28] = clamp8(g.qw * 128 + 128);
    buf[o + 29] = clamp8(g.qx * 128 + 128);
    buf[o + 30] = clamp8(g.qy * 128 + 128);
    buf[o + 31] = clamp8(g.qz * 128 + 128);
  });
  return buf;
}

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
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Orthographic front view in file space: screen-x = +x, screen-y = +y
 * (y-down matches PNG rows), far-first = descending z (the loader negates z,
 * so larger file-z is farther from the board camera).
 */
function renderThumb(gaussians) {
  const w = THUMB_W;
  const h = THUMB_H;
  const px = new Float32Array(w * h * 4);
  const pxPerM = h / REF_HEIGHT_M;
  const cx = w / 2;
  const cy = h / 2;

  const sorted = [...gaussians].sort((a, b) => b.z - a.z);
  for (const p of sorted) {
    const sx = cx + p.x * pxPerM;
    const sy = cy + p.y * pxPerM;
    const meanS = (Math.abs(p.sx) + Math.abs(p.sy) + Math.abs(p.sz)) / 3;
    const sigma = Math.max(0.35, meanS * pxPerM);
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

await mkdir(SPLATS_DIR, { recursive: true });
await mkdir(THUMBS_DIR, { recursive: true });

for (const cap of CAPTURES) {
  console.log(`${cap.id}:`);
  const raw = await fetchCached(cap.url, cap.id);
  let g = cap.format === 'ply' ? parseGaussianPly(raw) : parseSplat(raw);
  const rawCount = g.length;
  g = prune(g);
  const prunedCount = g.length;
  g = downsample(g, MAX_GAUSSIANS);
  normalize(g, cap.rotateDeg, cap.heightM);
  const splat = encodeSplat(g);
  await writeFile(path.join(SPLATS_DIR, `${cap.id}.splat`), splat);
  await writeFile(path.join(THUMBS_DIR, `${cap.id}.png`), renderThumb(g));
  console.log(
    `  ${rawCount} → ${prunedCount} pruned → ${g.length} kept, ` +
      `${(splat.length / 1024 / 1024).toFixed(2)} MB`
  );
}
console.log(`\nImported ${CAPTURES.length} captures. Re-run build-splat-manifest.mjs.`);
