import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ShaderMaterial, Vector2, type Mesh, type Texture } from 'three';
import { useBoardStore } from '../hooks/useBoardStore';
import { BASE_ZOOM } from '../config/board';

/** Matches the focus fade of the thumbnail material in CharacterTile. */
const FOCUS_FADE_SECONDS = 0.35;

/**
 * Uniforms shared by every tile's scratch material — MotionFx writes them
 * once per frame and all tiles pick the values up in the same render.
 */
export const scratchMotion = {
  /** Effect drive, 0..1 (already includes the peak-opacity cap). */
  uIntensity: { value: 0 },
  /** Scratch-field scroll in tile-pixels; rides along with the drag. */
  uScroll: { value: new Vector2(0, 0) },
  /** Per-frame vertical glitch jitter, tile-pixels. */
  uJitter: { value: 0 },
  /** Seconds of accumulated motion — quantized in-shader to a steppy digital
   *  cadence; only advances while the board moves and resets on settle. */
  uTime: { value: 0 },
};

// dev-only handle for poking the effect from the console / test tooling
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__scratchMotion = scratchMotion;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMask;
  uniform float uIntensity;
  uniform vec2 uScroll;
  uniform float uJitter;
  uniform float uTime;
  uniform float uFade;
  uniform vec2 uPlanePx;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // two-octave noise squashed into long thin horizontal gouges
  float streaks(vec2 px, vec2 freq, float seed) {
    float n = vnoise(px * freq + seed);
    return 0.65 * n + 0.35 * vnoise(px * freq * 2.17 + seed * 1.7 + 31.0);
  }

  // spectral ramp — the diffraction-grating rainbow of a tilted CD
  vec3 spectrum(float t) {
    return clamp(0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67))), 0.0, 1.0);
  }

  // standard "over" compositing, accumulated premultiplied
  void addLayer(inout vec3 rgb, inout float a, vec3 lc, float la) {
    rgb += lc * la * (1.0 - a);
    a += la * (1.0 - a);
  }

  void main() {
    // tile-pixel space (screen px at base zoom) so feature scale is stable
    vec2 px = vUv * uPlanePx;
    // ~24 fps quantized time — the steppy cadence of a corrupted signal
    float tq = floor(uTime * 24.0);

    // 0. digital tear: horizontal slices of the figure slip sideways, sampled
    //    from the thumbnail itself so the ghosts carry the figure's colors
    float bandId = floor(px.y / 9.0);
    float torn = step(1.0 - 0.42 * uIntensity, hash(vec2(bandId * 0.913, tq * 0.317)));
    float amp = (hash(vec2(bandId * 0.417, tq * 0.129)) * 2.0 - 1.0) * 20.0;
    vec2 tUv = vUv + vec2(torn * amp / uPlanePx.x, 0.0);
    vec4 slice = texture2D(uMask, tUv);
    vec2 so = vec2(3.5 / uPlanePx.x, 0.0);
    float ghR = texture2D(uMask, tUv + so).a; // fringe ghosts of the slice
    float ghC = texture2D(uMask, tUv - so).a;

    // torn slices may land outside the original silhouette — gate on both
    float mask = texture2D(uMask, vUv).a;
    float gate = max(smoothstep(0.05, 0.5, mask), torn * slice.a);
    float k = uIntensity * uFade * gate;
    if (k < 0.004) discard;

    vec3 rgb = vec3(0.0);
    float a = 0.0;

    // (frontmost) the torn slice, re-encoded to sRGB, with red/cyan fringes
    vec3 sliceCol = pow(max(slice.rgb, 0.0), vec3(0.4545));
    sliceCol += vec3(0.5, -0.05, -0.15) * ghR * 0.35 + vec3(-0.1, 0.35, 0.5) * ghC * 0.35;
    addLayer(rgb, a, sliceCol, torn * slice.a * 0.9);

    // 1. stray data blocks — sparse bright cells popping over the figure
    float hb = hash(floor(px / 7.0) * 0.37 + tq * 0.113);
    addLayer(rgb, a, vec3(0.55, 0.95, 1.05), step(0.99, hb) * 0.65);

    // 2. broad diffraction sheen — the CD-tilt rainbow wash, sweeps with drag
    float bandT = px.x * 0.02 - px.y * 0.008 + uScroll.x * 0.015 + uScroll.y * 0.006;
    float sheenAmt = 0.2 + 0.15 * vnoise(px * 0.02 + uScroll * 0.01);
    addLayer(rgb, a, spectrum(bandT), sheenAmt);

    // 3. graphite gouges — long dark scratches, worn-metal
    vec2 p1 = px + vec2(uScroll.x, uScroll.y + uJitter);
    float g = smoothstep(0.58, 0.9, streaks(p1, vec2(0.006, 0.22), 11.0));
    addLayer(rgb, a, vec3(0.07, 0.08, 0.10), g * 0.9);

    // 4. micro-scratches that split into spectral color (faster parallax),
    //    biased back toward cyan so the sci-fi accent survives
    vec2 p2 = px + vec2(uScroll.x * 1.7, uScroll.y - uJitter);
    float n2 = streaks(p2, vec2(0.004, 0.35), 37.0);
    float c = smoothstep(0.52, 0.85, n2);
    vec3 iri = spectrum(px.x * 0.012 + uScroll.x * 0.006 + n2 * 0.9);
    iri = mix(iri, vec3(0.4, 0.9, 1.0), 0.25);
    addLayer(rgb, a, iri * 1.55, c);

    // 5. scanlines, screen-fixed, flickering on the digital cadence
    float sl = step(fract(gl_FragCoord.y * 0.25), 0.24);
    sl *= 0.7 + 0.3 * hash(vec2(tq * 0.219, bandId * 0.071));
    addLayer(rgb, a, vec3(0.05, 0.09, 0.12), sl * 0.3);

    gl_FragColor = vec4(rgb * k, a * k); // premultiplied
  }
`;

interface TileScratchProps {
  /** Thumbnail texture; its alpha confines the scratches to the figure. */
  mask: Texture;
  entryId: string;
  width: number;
  height: number;
}

/**
 * Per-tile scratch overlay plane. Sits just in front of the thumbnail/splat
 * and is alpha-masked by the thumbnail, so the drag-scratch effect distorts
 * only the figures — never the empty board. Motion comes in through the
 * shared scratchMotion uniforms; the mesh hides itself whenever the effect
 * is idle so it costs nothing between drags.
 */
export function TileScratch({ mask, entryId, width, height }: TileScratchProps) {
  const mesh = useRef<Mesh>(null);

  // built imperatively: passing a uniforms object through JSX lets r3f's
  // prop diffing clone it, which would sever the shared scratchMotion refs
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uMask: { value: mask },
          uFade: { value: 1 },
          uPlanePx: { value: new Vector2(width * BASE_ZOOM, height * BASE_ZOOM) },
          uIntensity: scratchMotion.uIntensity,
          uScroll: scratchMotion.uScroll,
          uJitter: scratchMotion.uJitter,
          uTime: scratchMotion.uTime,
        },
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [mask, width, height]
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    // follow the focus fade so hidden tiles don't ghost-scratch
    const sel = useBoardStore.getState().selectedId;
    const target = sel !== null && sel !== entryId ? 0 : 1;
    const f = material.uniforms.uFade;
    const diff = target - f.value;
    if (diff !== 0) {
      f.value += Math.sign(diff) * Math.min(Math.abs(diff), delta / FOCUS_FADE_SECONDS);
    }
    if (mesh.current) {
      mesh.current.visible = scratchMotion.uIntensity.value * f.value > 0.003;
    }
  });

  return (
    <mesh ref={mesh} position={[0, 0, 0.5]} visible={false}>
      <planeGeometry args={[width, height]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
