import { Texture, Vector4 } from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Shared state for the "My Looks" try-on: which garment textures the
 * focused splat is dyed with, and the wipe between the previous and the
 * newly chosen garment. WardrobeDriver owns the timeline and writes these
 * every frame; wardrobeModifier.ts wraps the exact same vectors/textures as
 * Spark dyno uniforms. Spark-free so the panel UI never pulls in the Spark
 * chunk.
 *
 * Coordinates are tile-local meters (the same frame as stageFx's axes,
 * which SparkSplat points at the raw SPZ source).
 */
export const wardrobeFx = {
  /** The wardrobe-enabled SplatMesh currently mounted, if any. */
  mesh: null as SplatMesh | null,

  /** x: "from" garment strength (0 = original knit), y: "to" garment
   *  strength, z: wipe line height (m) — above it the "to" garment shows,
   *  w: seam glow 0..1 riding the wipe line. */
  uWear: new Vector4(0, 0, -10, 0),
  /** x: neck line height (m) — nothing above it is clothing, y: blend width
   *  below it, z: warmth (r − g) above which a gaussian reads as skin,
   *  w: debug — paint the detected garment magenta. */
  uMask: new Vector4(-0.06, 0.06, 0.03, 0),
  /** x: reference luminance of the captured knit, y: how much of its
   *  shading survives the dye (folds/knit), z: luminance above which a
   *  collar-band gaussian reads as trim, w: depth (m) beyond which a
   *  gaussian faces front (prints only land on the chest, not the back). */
  uTone: new Vector4(0.2, 0.75, 0.32, 0.0),
  /** Planar garment UV: u = x + L.x·y, v = z + L.y·w. */
  uMap: new Vector4(0.5, 0.4, 0.89, 0.31),
  /** Crew-neck ribbing band: x: its top height (m) at the back of the neck
   *  (L.z = −0.25), y: slope dy/dz toward the throat, z: band depth,
   *  w: lowest the top may dip (front of the throat). */
  uCollar: new Vector4(-0.08, -0.6, 0.09, -0.26),
  /** Logo patch on the captured garment, dyed along with it: center xy
   *  (m) and radii zw (m); zero radii disable it. */
  uPatch: new Vector4(0, 0, 0, 0),
  /** Collar/trim color + strength, for the "from" and "to" garments. */
  uTrimFrom: new Vector4(0, 0, 0, 0),
  uTrimTo: new Vector4(0, 0, 0, 0),

  /** Fabric (color, stripes) and chest print (alpha) for both garments. */
  tex: {
    baseFrom: null as Texture | null,
    printFrom: null as Texture | null,
    baseTo: null as Texture | null,
    printTo: null as Texture | null,
  },
  /** Bumped whenever a texture slot is reassigned; the modifier re-binds. */
  texVersion: 0,
};

// dev-only handle for tuning the try-on from the console / test tooling
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__wardrobeFx = wardrobeFx;
}
