import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { garmentById } from '../data/wardrobe';
import { cssRgb, garmentTextures, trimOf } from '../lib/garmentTextures';
import { wardrobeFx } from '../lib/wardrobeFx';
import { captureKey, useLookStore } from '../hooks/useLookStore';
import { useBoardStore } from '../hooks/useBoardStore';
import type { SplatMesh } from '@sparkjsdev/spark';

const entries = manifest as SplatEntry[];
/** Top-down wipe from the old garment to the new one. */
const WIPE_MS = 1100;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Rebinds texture slots; the Spark-side binder lives in the lazy Spark
 *  chunk, so it is loaded on demand the first time a garment is applied. */
let bindTextures: (() => void) | null = null;
const loadBinder = () =>
  import('../lib/wardrobeModifier').then((m) => {
    bindTextures = m.bindWardrobeTextures;
  });

function setSlot(slot: 'From' | 'To', garmentId: string) {
  const g = garmentById(garmentId);
  const t = garmentTextures(g);
  wardrobeFx.tex[`base${slot}`] = t.base;
  wardrobeFx.tex[`print${slot}`] = t.print;
  const [r, gg, b] = cssRgb(trimOf(g));
  wardrobeFx[`uTrim${slot}`].set(r, gg, b, g.trim ? 1 : 0.85);
}

const strength = (garmentId: string) => (garmentById(garmentId).original ? 0 : 1);

/**
 * Applies the focused model's chosen look to its source-quality splat:
 * loads the garment's textures into the try-on modifier and runs a
 * top-down wipe (with a light seam) from the previous garment. Lives in the
 * main canvas next to the stages; renders nothing.
 */
export default function WardrobeDriver() {
  const invalidate = useThree((s) => s.invalidate);
  const st = useRef<{
    mesh: SplatMesh | null;
    shown: string;
    from: string;
    to: string;
    t0: number;
  }>({ mesh: null, shown: 'original', from: 'original', to: 'original', t0: 0 });

  useFrame(() => {
    const mesh = wardrobeFx.mesh;
    const s = st.current;
    if (!mesh) {
      s.mesh = null;
      return;
    }
    const entry = entries.find((e) => e.id === useBoardStore.getState().selectedId);
    if (!entry?.meta?.wardrobe) return;
    const worn = useLookStore.getState().worn[captureKey(entry)] ?? 'original';
    if (!bindTextures) {
      void loadBinder().then(() => invalidate());
      return;
    }

    const commit = () => {
      bindTextures?.();
      mesh.updateVersion();
      invalidate();
    };

    // a freshly mounted splat: dress it as-is, no wipe
    if (s.mesh !== mesh) {
      const w = entry.meta.wardrobe;
      wardrobeFx.uMask.set(w.mask[0], w.mask[1], w.mask[2], wardrobeFx.uMask.w);
      wardrobeFx.uTone.set(...w.tone);
      wardrobeFx.uMap.set(...w.map);
      wardrobeFx.uCollar.set(...w.collar);
      wardrobeFx.uPatch.set(...(w.patch ?? [0, 0, 0, 0]));
      s.mesh = mesh;
      s.shown = s.from = s.to = worn;
      setSlot('From', worn);
      setSlot('To', worn);
      wardrobeFx.uWear.set(strength(worn), strength(worn), -10, 0);
      commit();
      return;
    }

    const now = performance.now();
    if (worn !== s.to && useLookStore.getState().instant) {
      // swapped while out of sight (gallery): dress at once, no wipe
      s.shown = s.from = s.to = worn;
      setSlot('From', worn);
      setSlot('To', worn);
      wardrobeFx.uWear.set(strength(worn), strength(worn), -10, 0);
      commit();
      return;
    }
    if (worn !== s.to) {
      // start (or retarget) a wipe from whatever is fully shown
      s.from = s.shown;
      s.to = worn;
      s.t0 = now;
      setSlot('From', s.from);
      setSlot('To', s.to);
    }
    if (s.shown === s.to) return;

    const [lo] = entry.meta.stage?.heightRange ?? [-0.75, 0.75];
    const top = wardrobeFx.uMask.x + 0.03;
    const p = Math.min(1, (now - s.t0) / WIPE_MS);
    if (p >= 1) {
      s.shown = s.from = s.to;
      setSlot('From', s.to);
      wardrobeFx.uWear.set(strength(s.to), strength(s.to), -10, 0);
    } else {
      const line = top + (lo - 0.05 - top) * easeInOut(p);
      wardrobeFx.uWear.set(strength(s.from), strength(s.to), line, Math.sin(Math.PI * p) * 0.55);
    }
    commit();
  });

  return null;
}
