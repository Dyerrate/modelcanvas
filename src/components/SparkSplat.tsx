import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  CustomBlending,
  HalfFloatType,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type IUniform,
} from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { SplatTransform } from '../types/manifest';
import { setStageAxes } from '../lib/stageFx';
import { wardrobeFx } from '../lib/wardrobeFx';
import { makeWardrobeModifier } from '../lib/wardrobeModifier';
import { LOOK_FILTER_GLSL, lookUniforms } from '../lib/lookFilter';
import { CURTAIN_GLSL } from '../lib/lookSwap';

/** Layer the SparkRenderer lives on, so the regular board pass skips it. */
const SPLAT_LAYER = 31;

/**
 * Dynamic resolution. Drawing a source-quality capture is fill-rate bound,
 * so while the figure moves (a turn, a zoom, the entrance) the splat pass
 * drops to a fraction of the drawing buffer, just low enough to hold the
 * frame rate on this GPU, and is redrawn at full size as soon as it rests.
 */
const RES_LEVELS = [1, 0.8, 0.65, 0.5, 0.4];
/** A moving frame slower than this (ms) counts against the current level … */
const SLOW_FRAME_MS = 21;
/** … one faster than this counts toward trying a sharper one next time. */
const FAST_FRAME_MS = 17.6;
/** Comfortable frames in one movement that earn the sharper level. */
const FAST_FRAMES_TO_SHARPEN = 45;
/** After a sharper level proves too slow, leave it alone this long (ms). */
const SHARPEN_BACKOFF_MS = 30000;
/** Never go below this many splat pixels per CSS pixel. */
const MIN_PX_RATIO = 0.5;
/** Stillness (ms) after which the figure is redrawn at full size. */
const REST_MS = 140;
/** Kernel cut-off (in standard deviations): Spark's default at rest, a
 *  tighter one on the coarser levels, where the feathered tail of each
 *  gaussian is lost in the upscale anyway. */
const STD_DEV_REST = Math.sqrt(8);
const STD_DEV_MOVING = Math.sqrt(5);

interface SparkSplatProps {
  src: string;
  transform: SplatTransform;
  onReady: () => void;
  /** Attach the try-on modifier (garment re-dye; the gallery's looks). */
  wardrobe?: boolean;
  /** Gallery-owned composite uniforms (opacity, clip rect, room treatment,
   *  halo) merged over the defaults — see galleryFx.composite. */
  gallery?: Record<string, IUniform>;
  /** Curtain uniforms (entrance, lookbook change) — see lookSwapFx.composite. */
  swap?: Record<string, IUniform>;
}

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 uTexel; // one CSS pixel in uv
  uniform float uGlow;
  uniform vec3 uGlowA;
  uniform vec3 uGlowB;
  uniform float uOpacity;
  uniform vec4 uClip;
  ${LOOK_FILTER_GLSL}
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  ${CURTAIN_GLSL}

  void main() {
    if (any(lessThan(vUv, uClip.xy)) || any(greaterThan(vUv, uClip.zw))) discard;
    vec4 c = texture2D(map, vUv);

    // gallery neon room: rim light hugging the silhouette, added on top
    // (alpha kept, so it brightens what is behind instead of veiling it)
    if (uGlow > 0.001) {
      float acc = 0.0;
      for (int i = 0; i < 12; i++) {
        float ang = float(i) * 0.5235988 + 0.26;
        vec2 d = vec2(cos(ang), sin(ang)) * uTexel;
        acc += texture2D(map, vUv + d * 6.0).a + 0.6 * texture2D(map, vUv + d * 15.0).a;
      }
      float halo = smoothstep(0.0, 1.0, acc / 19.2) * (1.0 - c.a) * uGlow;
      c.rgb += mix(uGlowA, uGlowB, smoothstep(0.25, 0.75, vUv.x)) * halo * 0.55;
    }

    // gallery room treatment, on straight color
    if (uLookOn > 0.5 && c.a > 0.002) c.rgb = lookFilter(c.rgb / c.a, gl_FragCoord.xy) * c.a;

    // the curtain of light passing down the figure
    c = lookCurtain(c);

    gl_FragColor = c * uOpacity; // premultiplied: scales color and alpha alike
  }
`;

/** Fullscreen composite of the float splat pass over the board (both
 *  premultiplied). The gallery and the curtain read identity uniforms
 *  unless something drives them, so the plain path is a straight copy. */
function createCompositePass(gallery?: Record<string, IUniform>, swap?: Record<string, IUniform>) {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  const material = new ShaderMaterial({
    uniforms: {
      map: { value: target.texture },
      uTexel: { value: new Vector2(1, 1) },
      uOpacity: { value: 1 },
      uClip: { value: new Vector4(0, 0, 1, 1) },
      ...lookUniforms(),
      uGlow: { value: 0 },
      uGlowA: { value: new Vector3() },
      uGlowB: { value: new Vector3() },
      // identity until an entrance or a lookbook change drives them
      uCurtain: { value: new Vector4(0, 1, 0, 0) },
      uCurtainSpan: { value: new Vector2(1, 0) },
      ...gallery,
      ...swap,
    },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // values are already display-referred sRGB — no colorspace conversion
    fragmentShader: COMPOSITE_FRAG,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  return { target, scene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), quad };
}

/**
 * Source-quality splat for focus view, rendered by Spark instead of drei:
 * every gaussian plus degree-3 spherical harmonics (view-dependent color),
 * decoded at extended (float32) precision. Spark has a native orthographic
 * Jacobian, so none of SplatModel's drei shader patching applies here.
 *
 * Splats are composited in their own RGBA16F pass. Captures like
 * sam-sitting-v1 build skin tone out of thousands of ~1–2%-opacity layers;
 * blended straight into the 8-bit canvas, each layer's contribution rounds
 * away and the coarse base splats underneath show through as green/purple
 * blotches. Blending stays in sRGB space, as in 3DGS training.
 *
 * That pass is by far the most expensive thing on the page, so it only
 * runs when the picture would change (the figure or the camera moved, Spark
 * finished a sort, a modifier re-dyed it) — any other frame re-composites
 * the image it kept — and it runs at a reduced size while the figure moves
 * (see RES_LEVELS).
 *
 * Spark sorts on a worker and reports finished sorts through onDirty, which
 * feeds the demand frameloop directly — no fixed invalidate window needed.
 */
export default function SparkSplat({
  src,
  transform,
  onReady,
  wardrobe,
  gallery,
  swap,
}: SparkSplatProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  const mesh = useMemo(() => {
    const m = new SplatMesh({
      url: src,
      extSplats: true, // keep float32 centers/scales instead of the 16-byte packing
      raycastable: false, // the tile's thumbnail plane owns pointer events
    });
    // Spark only gathers generators whose layers match the camera's
    m.layers.set(SPLAT_LAYER);
    if (wardrobe) {
      setStageAxes(transform);
      m.objectModifiers = [makeWardrobeModifier()];
      m.updateGenerator();
    }
    return m;
    // transform is static per entry; src identifies it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, wardrobe]);

  useEffect(() => {
    if (!wardrobe) return;
    wardrobeFx.mesh = mesh;
    return () => {
      if (wardrobeFx.mesh === mesh) wardrobeFx.mesh = null;
    };
  }, [mesh, wardrobe]);

  // what the splat pass last drew, and how the resolution is holding up
  const res = useMemo(
    () => ({
      spark: null as SparkRenderer | null,
      /** Spark has news (a finished sort, freshly decoded splats). */
      dirty: true,
      /** Frames still to draw regardless, while Spark's pipeline settles. */
      force: 3,
      /** Figure, camera and projection matrices of the kept image. */
      view: new Float64Array(48),
      version: -1,
      /** Index into RES_LEVELS used while moving. */
      level: 0,
      /** Scale the kept image was drawn at (0: nothing kept). */
      drawn: 0,
      movedAt: 0,
      lastFrameAt: 0,
      slow: 0,
      fast: 0,
      /** When a sharper level was last tried, and when one may be again. */
      sharpenedAt: 0,
      sharpenAfter: 0,
    }),
    []
  );

  useEffect(() => {
    const spark = new SparkRenderer({
      renderer: gl,
      onDirty: () => {
        res.dirty = true;
        invalidate();
      },
      accumExtSplats: true, // don't re-pack to 16 bytes between generate and draw
      // blur stays at Spark's anti-aliased default: with float accumulation it
      // matches standard 3DGS dilation up close, and unlike it doesn't speckle
      // sub-pixel splats at the default focus zoom
    });
    spark.layers.set(SPLAT_LAYER);
    // Spark switches to linear blending when drawing off-screen; pin it to sRGB
    Object.defineProperty(spark.uniforms.encodeLinear, 'value', { get: () => false, set: () => {} });
    scene.add(spark);
    res.spark = spark;
    res.dirty = true;
    // dev-only handles for tuning render params from test tooling
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__spark = spark;
      w.__splatRes = res;
    }
    return () => {
      scene.remove(spark);
      if (res.spark === spark) res.spark = null;
      // a sort may still be reading back depths — disposing mid-flight makes
      // Spark throw "No target", so wait for it to settle
      const disposeWhenIdle = () =>
        spark.sorting ? setTimeout(disposeWhenIdle, 50) : spark.dispose();
      disposeWhenIdle();
    };
  }, [gl, scene, invalidate, res]);

  const pass = useMemo(() => createCompositePass(gallery, swap), [gallery, swap]);
  useEffect(() => {
    res.drawn = 0; // a fresh target has nothing in it yet
    return () => {
      pass.target.dispose();
      pass.quad.geometry.dispose();
      pass.quad.material.dispose();
    };
  }, [pass, res]);

  // a positive-priority frame callback takes over rendering from R3F
  const scratch = useMemo(() => ({ size: new Vector2(), clear: new Color() }), []);
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera); // the regular board pass (splat layer excluded)

    const now = performance.now();
    const gap = now - res.lastFrameAt;
    res.lastFrameAt = now;

    // has anything that shapes the splat image changed since it was drawn?
    let moved = false;
    const sources = [mesh.matrixWorld.elements, camera.matrixWorld.elements, camera.projectionMatrix.elements];
    for (let m = 0; m < 3; m++) {
      const e = sources[m];
      for (let i = 0; i < 16; i++) {
        if (res.view[m * 16 + i] !== e[i]) {
          res.view[m * 16 + i] = e[i];
          moved = true;
        }
      }
    }
    const reDyed = mesh.version !== res.version;
    res.version = mesh.version;

    if (moved) {
      if (gap < 100) {
        // back-to-back moving frames: the gap is this GPU's frame time
        if (gap > SLOW_FRAME_MS) {
          res.fast = 0;
          if (++res.slow >= 2) {
            res.slow = 0;
            res.level = Math.min(RES_LEVELS.length - 1, res.level + 1);
            // straight back down after a try at sharper: stop trying for a while
            if (now - res.sharpenedAt < 1500) res.sharpenAfter = now + SHARPEN_BACKOFF_MS;
          }
        } else {
          res.slow = 0;
          if (gap < FAST_FRAME_MS) res.fast++;
        }
      } else {
        // a new movement: if the last one ran comfortably, try a sharper level
        if (res.fast >= FAST_FRAMES_TO_SHARPEN && res.level > 0 && now > res.sharpenAfter) {
          res.level--;
          res.sharpenedAt = now;
        }
        res.fast = res.slow = 0;
      }
      res.movedAt = now;
    }

    gl.getDrawingBufferSize(scratch.size);
    const dpr = gl.getPixelRatio();
    const resting = now - res.movedAt > REST_MS;
    const scale = resting ? 1 : Math.max(Math.min(1, MIN_PX_RATIO / dpr), RES_LEVELS[res.level]);
    const w = Math.max(1, Math.round(scratch.size.x * scale));
    const h = Math.max(1, Math.round(scratch.size.y * scale));
    const fits = pass.target.width === w && pass.target.height === h;
    // a coarse image is kept until the figure rests, then drawn once more
    const stale = res.drawn === 0 || (resting && !fits);

    if (moved || reDyed || res.dirty || res.force > 0 || stale) {
      if (!fits) pass.target.setSize(w, h);
      pass.quad.material.uniforms.uTexel.value.set(dpr / scratch.size.x, dpr / scratch.size.y);
      if (res.spark) res.spark.maxStdDev = scale <= 0.65 ? STD_DEV_MOVING : STD_DEV_REST;
      if (moved || reDyed || res.dirty || stale) res.force = 2;
      else res.force--;
      res.dirty = false;
      res.drawn = scale;

      gl.getClearColor(scratch.clear);
      const clearAlpha = gl.getClearAlpha();
      const layerMask = camera.layers.mask;
      gl.setRenderTarget(pass.target);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      camera.layers.set(SPLAT_LAYER);
      gl.render(scene, camera);
      camera.layers.mask = layerMask;
      gl.setRenderTarget(null);
      gl.setClearColor(scratch.clear, clearAlpha);
    }
    // keep frames coming until the figure has been redrawn at full size
    if (res.drawn !== 1 || res.force > 0) invalidate();

    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(pass.scene, pass.camera);
    gl.autoClear = autoClear;
  }, 1);

  // read through a ref so a new callback identity never disposes the mesh mid-load
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let cancelled = false;
    mesh.initialized.then(
      () => {
        if (cancelled) return;
        res.dirty = true;
        readyRef.current();
        invalidate();
      },
      (err) => console.error(`[SparkSplat] failed to load ${src}`, err)
    );
    return () => {
      cancelled = true;
      mesh.dispose();
    };
  }, [mesh, src, invalidate, res]);

  return (
    <primitive
      object={mesh}
      position={transform.position}
      quaternion={transform.quaternion}
      scale={transform.scale}
    />
  );
}
