// Builds src/data/splat-manifest.json from the .splat files in public/splats/.
// Enforces the per-file GPU budget (exit 1 on violation) and merges per-model
// metadata from src/data/model-meta.json when an entry with a matching id
// exists. The output file is generated — never hand-edit it.

import { readdir, readFile, stat, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLATS_DIR = path.join(root, 'public', 'splats');
const THUMBS_DIR = path.join(root, 'public', 'thumbs');
const META_PATH = path.join(root, 'src', 'data', 'model-meta.json');
const OUT_PATH = path.join(root, 'src', 'data', 'splat-manifest.json');

const MAX_SPLAT_BYTES = 24 * 1024 * 1024; // budget gate for 20–50 live models
const THUMB_EXTENSIONS = ['.png', '.jpg', '.webp'];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

let files = [];
try {
  files = (await readdir(SPLATS_DIR))
    .filter((f) => f.endsWith('.splat') && !f.endsWith('.full.splat'))
    .sort();
} catch {
  console.warn(`warn: ${SPLATS_DIR} does not exist yet — writing an empty manifest`);
}

let metaById = new Map();
if (await exists(META_PATH)) {
  const metas = JSON.parse(await readFile(META_PATH, 'utf8'));
  metaById = new Map(metas.map((m) => [m.id, m]));
}

// runtime alignment for .full.spz tiers (written by import-real-splats.mjs)
const TRANSFORMS_PATH = path.join(root, 'src', 'data', 'splat-transforms.json');
const transforms = (await exists(TRANSFORMS_PATH))
  ? JSON.parse(await readFile(TRANSFORMS_PATH, 'utf8'))
  : {};

// captures that are another model's extra looks (meta.looks) — resolved
// into that model's entry below instead of getting board tiles of their own
const lookCaptures = new Set();
for (const meta of metaById.values()) {
  for (const look of meta.looks ?? []) if (look.capture !== meta.id) lookCaptures.add(look.capture);
}

const entries = [];
const oversized = [];

for (const file of files) {
  const id = path.basename(file, '.splat');
  const { size: sizeBytes } = await stat(path.join(SPLATS_DIR, file));

  if (sizeBytes > MAX_SPLAT_BYTES) {
    oversized.push({ file, sizeBytes });
    continue;
  }

  let thumbUrl = null;
  for (const ext of THUMB_EXTENSIONS) {
    if (await exists(path.join(THUMBS_DIR, `${id}${ext}`))) {
      thumbUrl = `/thumbs/${id}${ext}`;
      break;
    }
  }
  if (!thumbUrl) {
    console.warn(`warn: no thumbnail for ${id} (looked for ${THUMB_EXTENSIONS.join(', ')})`);
    thumbUrl = `/thumbs/${id}.jpg`;
  }

  const meta = metaById.get(id);
  if (!meta && !lookCaptures.has(id)) console.warn(`warn: no model-meta.json entry for ${id}`);

  // optional uncapped tier, loaded only in focus view — exempt from the
  // per-file budget above since it's never downloaded while browsing.
  // .full.spz (raw source + SH, rendered by Spark) wins over .full.splat.
  let fullSplatUrl;
  let fullTransform;
  if (await exists(path.join(SPLATS_DIR, `${id}.full.spz`))) {
    fullSplatUrl = `/splats/${id}.full.spz`;
    fullTransform = transforms[id];
    if (!fullTransform) {
      console.error(`error: ${id}.full.spz has no entry in splat-transforms.json`);
      process.exit(1);
    }
  } else if (await exists(path.join(SPLATS_DIR, `${id}.full.splat`))) {
    fullSplatUrl = `/splats/${id}.full.splat`;
  }

  entries.push({
    id,
    splatUrl: `/splats/${file}`,
    thumbUrl,
    sizeBytes,
    ...(fullSplatUrl ? { fullSplatUrl } : {}),
    ...(fullTransform ? { fullTransform } : {}),
    ...(meta ? { meta } : {}),
  });
}

// lookbooks: attach each look's assets to its model, then drop the extra
// looks' own entries from the board
for (const entry of entries) {
  const looks = entry.meta?.looks;
  if (!looks) continue;
  entry.looks = looks.map((look) => {
    const source = entries.find((e) => e.id === look.capture);
    if (!source) {
      console.error(`error: ${entry.id} look ${look.capture} has no splat in ${SPLATS_DIR}`);
      process.exit(1);
    }
    return {
      ...look,
      thumbUrl: source.thumbUrl,
      ...(source.fullSplatUrl ? { fullSplatUrl: source.fullSplatUrl } : {}),
      ...(source.fullTransform ? { fullTransform: source.fullTransform } : {}),
    };
  });
}
for (let i = entries.length - 1; i >= 0; i--) {
  if (lookCaptures.has(entries[i].id)) entries.splice(i, 1);
}

// variants: extra board entries that reuse another capture's assets (same
// splat, thumbnail and full tier) under their own id and meta — e.g. the
// same scan shown on two differently themed focus stages
for (const meta of metaById.values()) {
  if (!meta.variantOf) continue;
  const source = entries.find((e) => e.id === meta.variantOf);
  if (!source) {
    console.warn(`warn: ${meta.id} is a variant of missing entry ${meta.variantOf}`);
    continue;
  }
  // the lookbook stays with the capture's own tile unless the variant asks for one
  const { looks, ...assets } = source;
  entries.push({ ...assets, id: meta.id, meta, ...(meta.looks && looks ? { looks } : {}) });
}

if (oversized.length > 0) {
  for (const { file, sizeBytes } of oversized) {
    console.error(
      `error: ${file} is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — exceeds the ` +
        `${MAX_SPLAT_BYTES / 1024 / 1024} MB per-file budget`
    );
  }
  process.exit(1);
}

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(entries, null, 2) + '\n');
console.log(`manifest: ${entries.length} entries -> ${path.relative(root, OUT_PATH)}`);
