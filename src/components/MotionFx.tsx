import { useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { motionState } from '../hooks/useBoardStore';

const MAX_BLUR_PX = 1.8;
const BLUR_PER_UNIT = 0.3; // px of blur per world-unit/s — full effect by ~6 wu/s
const BLUR_EASE = 10; // 1/s
/** Scratch overlay peak opacity — deliberately loud, it's the effect. */
const MAX_SCRATCH_OPACITY = 0.6;
/** Chromatic aberration: max px the red/cyan ghosts split at full speed. */
const MAX_RGB_SPLIT_PX = 3.5;
/** Norm speed below which the RGB split is dropped from the filter chain. */
const RGB_SPLIT_MIN = 0.18;
/** Max px of per-frame vertical glitch jitter on the scratch layers. */
const GLITCH_JITTER_PX = 9;
/** Tile size of the scratch SVG textures (keeps offsets bounded). */
const TEXTURE_TILE_PX = 240;

const wrap = (v: number) => ((v % TEXTURE_TILE_PX) + TEXTURE_TILE_PX) % TEXTURE_TILE_PX;

/**
 * Industrial sci-fi motion treatment, driven by pan velocity and applied
 * entirely on the DOM side (splat shaders stay untouched, idle cost zero):
 *  - CSS blur + red/cyan drop-shadow split on the (transparent) canvas, so
 *    the models themselves smear and chromatically fringe at speed
 *  - the scratch overlay's streak layers slide with the drag direction and
 *    jitter vertically each frame — worn-metal scratches with a glitch
 */
export default function MotionFx({
  overlayRef,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const blur = useRef(0);
  const scroll = useRef({ x: 0, y: 0 });

  useFrame((_, delta) => {
    const target = Math.min(motionState.speed * BLUR_PER_UNIT, MAX_BLUR_PX);
    blur.current += (target - blur.current) * (1 - Math.exp(-BLUR_EASE * delta));

    if (blur.current < 0.04 && target === 0) {
      if (gl.domElement.style.filter !== '') {
        gl.domElement.style.filter = '';
        if (overlayRef.current) overlayRef.current.style.opacity = '0';
      }
      blur.current = 0;
      return;
    }

    const norm = Math.min(blur.current / MAX_BLUR_PX, 1);

    // models smear + rgb-split (the canvas is transparent, so drop-shadow
    // ghosts hug the figures instead of the whole viewport)
    const split = norm > RGB_SPLIT_MIN ? (norm * MAX_RGB_SPLIT_PX).toFixed(2) : null;
    gl.domElement.style.filter =
      `blur(${blur.current.toFixed(2)}px)` +
      (split
        ? ` drop-shadow(${split}px 0 0 rgba(0, 229, 255, 0.6)) drop-shadow(-${split}px 0 0 rgba(255, 45, 85, 0.5))`
        : '');

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.opacity = (norm * MAX_SCRATCH_OPACITY).toFixed(3);
      // streaks ride along with the content (content moves opposite the pan)
      scroll.current.x -= motionState.vx * camera.zoom * delta;
      scroll.current.y += motionState.vy * camera.zoom * delta;
      const jitter = (Math.random() - 0.5) * norm * GLITCH_JITTER_PX;
      const x = wrap(scroll.current.x);
      const y = wrap(scroll.current.y);
      // layers: dark scratches, cyan scratches (faster parallax), scanlines
      overlay.style.backgroundPosition =
        `${x.toFixed(1)}px ${(y + jitter).toFixed(1)}px, ` +
        `${(x * 1.7).toFixed(1)}px ${(y - jitter).toFixed(1)}px, 0px 0px`;
    }
    invalidate(); // keep easing until the effect settles back to zero
  });

  return null;
}
