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
  WebGLRenderTarget,
} from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { SplatTransform } from '../types/manifest';

/** Layer the SparkRenderer lives on, so the regular board pass skips it. */
const SPLAT_LAYER = 31;

interface SparkSplatProps {
  src: string;
  transform: SplatTransform;
  onReady: () => void;
}

/** Fullscreen composite of the float splat pass over the board (both premultiplied). */
function createCompositePass() {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  const material = new ShaderMaterial({
    uniforms: { map: { value: target.texture } },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // values are already display-referred sRGB — no colorspace conversion
    fragmentShader:
      'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }',
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
 * Spark sorts on a worker and reports finished sorts through onDirty, which
 * feeds the demand frameloop directly — no fixed invalidate window needed.
 */
export default function SparkSplat({ src, transform, onReady }: SparkSplatProps) {
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
    return m;
  }, [src]);

  useEffect(() => {
    const spark = new SparkRenderer({
      renderer: gl,
      onDirty: () => invalidate(),
      accumExtSplats: true, // don't re-pack to 16 bytes between generate and draw
      // blur stays at Spark's anti-aliased default: with float accumulation it
      // matches standard 3DGS dilation up close, and unlike it doesn't speckle
      // sub-pixel splats at the default focus zoom
    });
    spark.layers.set(SPLAT_LAYER);
    // Spark switches to linear blending when drawing off-screen; pin it to sRGB
    Object.defineProperty(spark.uniforms.encodeLinear, 'value', { get: () => false, set: () => {} });
    scene.add(spark);
    // dev-only handle for tuning render params from test tooling
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__spark = spark;
    return () => {
      scene.remove(spark);
      // a sort may still be reading back depths — disposing mid-flight makes
      // Spark throw "No target", so wait for it to settle
      const disposeWhenIdle = () =>
        spark.sorting ? setTimeout(disposeWhenIdle, 50) : spark.dispose();
      disposeWhenIdle();
    };
  }, [gl, scene, invalidate]);

  const pass = useMemo(createCompositePass, []);
  useEffect(
    () => () => {
      pass.target.dispose();
      pass.quad.geometry.dispose();
      pass.quad.material.dispose();
    },
    [pass]
  );

  // a positive-priority frame callback takes over rendering from R3F
  const scratch = useMemo(() => ({ size: new Vector2(), clear: new Color() }), []);
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera); // the regular board pass (splat layer excluded)

    gl.getDrawingBufferSize(scratch.size);
    if (pass.target.width !== scratch.size.x || pass.target.height !== scratch.size.y) {
      pass.target.setSize(scratch.size.x, scratch.size.y);
    }
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
        readyRef.current();
        invalidate();
      },
      (err) => console.error(`[SparkSplat] failed to load ${src}`, err)
    );
    return () => {
      cancelled = true;
      mesh.dispose();
    };
  }, [mesh, src, invalidate]);

  return (
    <primitive
      object={mesh}
      position={transform.position}
      quaternion={transform.quaternion}
      scale={transform.scale}
    />
  );
}
