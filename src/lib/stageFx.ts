import { Quaternion, Vector3, Vector4 } from 'three';
import type { SplatTransform } from '../types/manifest';

/**
 * Tile-local axes of the mounted source-quality splat, for per-gaussian
 * modifiers (wardrobeModifier.ts wraps these exact vectors as Spark dyno
 * uniforms, so mutating them in place is enough). Deliberately Spark-free.
 */
export const stageFx = {
  /** xyz·center + w = tile-local height in meters (pre-orbit). */
  uUp: new Vector4(0, 1, 0, 0),
  /** xyz·center + w = tile-local x in meters (pre-orbit). */
  uSide: new Vector4(1, 0, 0, 0),
  /** xyz·center + w = tile-local z in meters (pre-orbit). */
  uFwd: new Vector4(0, 0, 1, 0),
};

/**
 * Point the height/side/forward axes at the raw source frame. Modifiers
 * run on raw SPZ centers (before the mesh transform), so tile-local axes
 * are pulled back through the normalization: h = s·(q⁻¹ŷ)·c + p.y.
 */
export function setStageAxes(t: SplatTransform) {
  const inv = new Quaternion(...t.quaternion).invert();
  const axis = (x: number, y: number, z: number) =>
    new Vector3(x, y, z).applyQuaternion(inv).multiplyScalar(t.scale);
  const up = axis(0, 1, 0);
  const side = axis(1, 0, 0);
  const fwd = axis(0, 0, 1);
  stageFx.uUp.set(up.x, up.y, up.z, t.position[1]);
  stageFx.uSide.set(side.x, side.y, side.z, t.position[0]);
  stageFx.uFwd.set(fwd.x, fwd.y, fwd.z, t.position[2]);
}
