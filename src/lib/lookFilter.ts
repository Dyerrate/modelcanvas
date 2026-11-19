import { Vector3, Vector4, type IUniform } from 'three';
import type { LookFilter } from '../data/galleryStyles';

/**
 * A gallery room's photographic treatment, as GLSL shared by the frame
 * shader (the piece's still) and the splat composite (the live piece), so
 * both read identically. Works on straight (non-premultiplied) sRGB values;
 * halftone and grain are screen-anchored (gl_FragCoord) so a still and the
 * live splat in the same spot get the very same screen.
 */
export const LOOK_FILTER_GLSL = /* glsl */ `
  uniform float uLookOn;
  uniform vec4 uLookTone; // saturation, contrast, brightness, warmth
  uniform vec4 uLookFx;   // duotone mix, posterize levels, halftone, grain
  uniform vec4 uLookFx2;  // lifted blacks
  uniform vec3 uLookDark;
  uniform vec3 uLookLight;

  float lookHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  vec3 lookFilter(vec3 c, vec2 px) {
    if (uLookOn < 0.5) return c;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, uLookTone.x);
    c = (c - 0.5) * uLookTone.y + 0.5 + uLookTone.z;
    c += uLookTone.w * vec3(0.07, 0.02, -0.06);
    c = uLookFx2.x + c * (1.0 - uLookFx2.x);
    c = clamp(c, 0.0, 1.0);
    if (uLookFx.y > 1.5) c = floor(c * uLookFx.y + 0.5) / uLookFx.y;
    float tone = dot(c, vec3(0.299, 0.587, 0.114));
    if (uLookFx.z > 0.0) {
      // 45° halftone screen: ink dots grow in the shadows
      vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * px / 7.0;
      float r = sqrt(clamp(1.0 - tone, 0.0, 1.0)) * 0.62;
      float ink = 1.0 - smoothstep(r - 0.07, r + 0.07, length(fract(g) - 0.5));
      tone = mix(tone, 1.0 - ink, uLookFx.z);
    }
    c = mix(c, mix(uLookDark, uLookLight, tone), uLookFx.x);
    c += (lookHash(floor(px)) - 0.5) * uLookFx.w;
    return clamp(c, 0.0, 1.0);
  }
`;

export type LookUniforms = {
  uLookOn: IUniform<number>;
  uLookTone: IUniform<Vector4>;
  uLookFx: IUniform<Vector4>;
  uLookFx2: IUniform<Vector4>;
  uLookDark: IUniform<Vector3>;
  uLookLight: IUniform<Vector3>;
};

export const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Identity uniforms (filter off). */
export function lookUniforms(): LookUniforms {
  return {
    uLookOn: { value: 0 },
    uLookTone: { value: new Vector4(1, 1, 0, 0) },
    uLookFx: { value: new Vector4(0, 0, 0, 0) },
    uLookFx2: { value: new Vector4(0, 0, 0, 0) },
    uLookDark: { value: new Vector3(0, 0, 0) },
    uLookLight: { value: new Vector3(1, 1, 1) },
  };
}

/**
 * Write a room's filter into uniforms, blended by `k` from the untouched
 * capture (0) to the full treatment (1) — the gallery fades its treatment
 * in and out with the room. Posterizing can't blend, so it snaps on at k ½.
 */
export function setLook(u: LookUniforms, f: LookFilter, k = 1) {
  const m = (a: number, b: number) => a + (b - a) * k;
  u.uLookOn.value = k > 0.001 ? 1 : 0;
  u.uLookTone.value.set(m(1, f.sat), m(1, f.contrast), m(0, f.bright), m(0, f.warm));
  u.uLookFx.value.set(
    m(0, f.duo ?? 0),
    k > 0.5 ? (f.poster ?? 0) : 0,
    m(0, f.halftone ?? 0),
    m(0, f.grain ?? 0),
  );
  u.uLookFx2.value.set(m(0, f.lift ?? 0), 0, 0, 0);
  u.uLookDark.value.set(...hexRgb(f.duoDark ?? '#000000'));
  u.uLookLight.value.set(...hexRgb(f.duoLight ?? '#ffffff'));
}
