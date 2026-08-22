import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { motionState } from '../hooks/useBoardStore';
import { scratchMotion } from './ScratchFx';

/** Kept low — heavy blur is what smeared the glitch detail into mush. */
const MAX_BLUR_PX = 1.15;
const BLUR_PER_UNIT = 0.3; // px of blur per world-unit/s — full effect by ~4 wu/s
const BLUR_EASE = 10; // 1/s
/** Scratch peak opacity — deliberately loud, it's the effect. */
const MAX_SCRATCH_OPACITY = 0.85;
/** Chromatic aberration: max px the red/cyan ghosts split at full speed. */
const MAX_RGB_SPLIT_PX = 6;
/** Norm speed below which the RGB split is dropped from the filter chain. */
const RGB_SPLIT_MIN = 0.1;
/** Max px of per-frame vertical glitch jitter on the scratch layers. */
const GLITCH_JITTER_PX = 12;
/** World-units/s above which the drag direction is trusted for the split. */
const DIR_MIN_SPEED = 0.5;

/**
 * Industrial sci-fi motion treatment, driven by pan velocity:
 *  - CSS blur + red/cyan drop-shadow split on the (transparent) canvas, so
 *    the models themselves smear and chromatically fringe at speed
 *  - the per-tile scratch shaders (ScratchFx) get their shared uniforms
 *    written here: intensity, drag-direction scroll, and glitch jitter —
 *    the scratches live only on the figures, masked by each thumbnail
 */
export default function MotionFx() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const blur = useRef(0);
  // last trustworthy drag direction — momentum tails are too noisy to read
  const dir = useRef({ x: 1, y: 0 });
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    // dev-only handle for poking the scene from the console / test tooling
    (window as unknown as Record<string, unknown>).__r3fDebug = { gl, scene, camera, invalidate };
  }

  useFrame((_, delta) => {
    const target = Math.min(motionState.speed * BLUR_PER_UNIT, MAX_BLUR_PX);
    blur.current += (target - blur.current) * (1 - Math.exp(-BLUR_EASE * delta));

    if (blur.current < 0.04 && target === 0) {
      if (gl.domElement.style.filter !== '') {
        gl.domElement.style.filter = '';
      }
      blur.current = 0;
      scratchMotion.uIntensity.value = 0;
      // effect fully settled — rewind the accumulators so they never grow
      // unbounded (large values erode the shader hash's float precision)
      scratchMotion.uScroll.value.set(0, 0);
      scratchMotion.uTime.value = 0;
      return;
    }

    const norm = Math.min(blur.current / MAX_BLUR_PX, 1);

    // models smear + rgb-split along the drag direction (the canvas is
    // transparent, so drop-shadow ghosts hug the figures, not the viewport)
    if (motionState.speed > DIR_MIN_SPEED) {
      // content moves opposite the pan; screen y is flipped vs world y
      dir.current.x = -motionState.vx / motionState.speed;
      dir.current.y = motionState.vy / motionState.speed;
    }
    const split = norm > RGB_SPLIT_MIN ? norm * MAX_RGB_SPLIT_PX : 0;
    const ox = (dir.current.x * split).toFixed(2);
    const oy = (dir.current.y * split).toFixed(2);
    gl.domElement.style.filter =
      `blur(${blur.current.toFixed(2)}px)` +
      (split > 0
        ? ` drop-shadow(${ox}px ${oy}px 0 rgba(0, 229, 255, 0.65)) drop-shadow(${-ox}px ${-oy}px 0 rgba(255, 45, 85, 0.55))`
        : '');

    scratchMotion.uIntensity.value = norm * MAX_SCRATCH_OPACITY;
    // streaks ride along with the content (content moves opposite the pan)
    const scroll = scratchMotion.uScroll.value;
    scroll.x -= motionState.vx * camera.zoom * delta;
    scroll.y += motionState.vy * camera.zoom * delta;
    scratchMotion.uJitter.value = (Math.random() - 0.5) * norm * GLITCH_JITTER_PX;
    scratchMotion.uTime.value += delta; // drives the quantized glitch cadence
    invalidate(); // keep easing until the effect settles back to zero
  });

  return null;
}
