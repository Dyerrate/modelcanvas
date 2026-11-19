import { Vector2, Vector3, Vector4, type Camera } from 'three';
import { SPLAT_SCALE } from '../config/board';

/**
 * Per-frame values of a lookbook change on the focused model, written by
 * LookSwapDriver and read by SparkSplat's composite (merged in through its
 * `swap` prop) — no React renders per frame. The phase itself lives in
 * useLookStore so the chrome can follow it. The editorial view's unveiling
 * (EditorialDriver) borrows the same curtain.
 */
export const lookSwapFx = {
  /** True while someone other than LookSwapDriver owns the curtain. */
  hold: false,
  composite: {
    /** x: curtain line down the figure (0 top … 1 bottom); y: +1 brings a
     *  look in (shown above the line), −1 takes it away (shown below);
     *  z: strength of the band of light riding the line; w: on. */
    uCurtain: { value: new Vector4(0, 1, 0, 0) },
    /** The figure's top and bottom in screen uv (y up). */
    uCurtainSpan: { value: new Vector2(1, 0) },
  },
};

/** How far past the figure the curtain line runs, so its frayed hem clears. */
export const CURTAIN_OVERSHOOT = 0.12;

const tmp = new Vector3();
/** Stretch the curtain over a figure: `lo`/`hi` are its tile-local height
 *  range (m), `anchor` its tile's board position. */
export function setCurtainSpan(
  camera: Camera,
  anchor: { x: number; y: number },
  pan: { panX: number; panY: number },
  lo: number,
  hi: number
) {
  const toUv = (ly: number) =>
    (tmp.set(anchor.x - pan.panX, anchor.y + ly * SPLAT_SCALE - pan.panY, 0).project(camera).y + 1) /
    2;
  lookSwapFx.composite.uCurtainSpan.value.set(toUv(hi + 0.04), toUv(lo - 0.04));
}

/** GLSL for the composite: fades `c` (premultiplied) behind the curtain.
 *  Needs `hash`, `uTexel` and `vUv` from the host shader. */
export const CURTAIN_GLSL = /* glsl */ `
  uniform vec4 uCurtain;
  uniform vec2 uCurtainSpan;

  vec4 lookCurtain(vec4 c) {
    if (uCurtain.w < 0.5) return c;
    float s = (uCurtainSpan.x - vUv.y) / max(uCurtainSpan.x - uCurtainSpan.y, 1e-4);
    // a frayed hem: fine threads run a little ahead of and behind the line
    float thread = hash(vec2(floor(vUv.x / (uTexel.x * 2.0)), 3.7)) - 0.5;
    float d = (uCurtain.x - s) * uCurtain.y + thread * 0.05;
    float seam = exp(-pow(d / 0.035, 2.0));
    c.rgb += vec3(1.0, 0.95, 0.86) * seam * uCurtain.z * c.a;
    return c * smoothstep(-0.03, 0.03, d);
  }
`;
