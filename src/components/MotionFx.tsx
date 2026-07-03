import { useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { motionState } from '../hooks/useBoardStore';

const MAX_BLUR_PX = 2.2;
const BLUR_PER_UNIT = 0.2; // px of blur per world-unit/s of pan speed
const MAX_SCRATCH_OPACITY = 0.16;
const BLUR_EASE = 10; // 1/s

/**
 * Maps pan speed to a subtle motion treatment: a CSS blur on the WebGL
 * canvas plus a film-scratch overlay whose opacity rides the same curve.
 * Both live on the DOM side, so the splat shaders stay untouched and the
 * whole effect costs nothing while the board is idle.
 */
export default function MotionFx({
  overlayRef,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const blur = useRef(0);

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

    gl.domElement.style.filter = `blur(${blur.current.toFixed(2)}px)`;
    if (overlayRef.current) {
      overlayRef.current.style.opacity = (
        Math.min(blur.current / MAX_BLUR_PX, 1) * MAX_SCRATCH_OPACITY
      ).toFixed(3);
    }
    invalidate(); // keep easing until the blur settles back to zero
  });

  return null;
}
