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

const MAX_SPLAT_BYTES = 8 * 1024 * 1024; // budget gate for 20–50 live models
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
  files = (await readdir(SPLATS_DIR)).filter((f) => f.endsWith('.splat')).sort();
} catch {
  console.warn(`warn: ${SPLATS_DIR} does not exist yet — writing an empty manifest`);
}

let metaById = new Map();
if (await exists(META_PATH)) {
  const metas = JSON.parse(await readFile(META_PATH, 'utf8'));
  metaById = new Map(metas.map((m) => [m.id, m]));
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
  if (!meta) console.warn(`warn: no model-meta.json entry for ${id}`);

  entries.push({
    id,
    splatUrl: `/splats/${file}`,
    thumbUrl,
    sizeBytes,
    ...(meta ? { meta } : {}),
  });
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
