import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useBoardStore } from './useBoardStore';

const DRAG_DEAD_ZONE_PX = 4; // movement under this is a tap, not a drag
const VELOCITY_EMA_ALPHA = 0.3;
const MOMENTUM_DAMPING = 5; // ~exp decay constant, 1/s
const SETTLE_EPSILON = 0.001; // world units/s

/**
 * Pointer drag → board pan with inertial momentum. Attaches directly to the
 * WebGL canvas (pointer events cover mouse + touch). Owns all pan input —
 * no OrbitControls anywhere.
 */
export function useDragPan() {
  const { gl, camera, invalidate } = useThree();
  const s = useRef({
    pointerId: null as number | null,
    down: false,
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    totalDist: 0,
    vx: 0,
    vy: 0,
  }).current;

  useEffect(() => {
    const el = gl.domElement;

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      s.pointerId = e.pointerId;
      s.down = true;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.lastT = performance.now();
      s.totalDist = 0;
      s.vx = 0;
      s.vy = 0;
      useBoardStore.getState().setPanTarget(null); // user takes over the camera
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!s.down || e.pointerId !== s.pointerId) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.totalDist += Math.hypot(dx, dy);

      if (!s.dragging && s.totalDist > DRAG_DEAD_ZONE_PX) {
        s.dragging = true;
        useBoardStore.getState().setDragging(true);
      }
      if (!s.dragging) return;

      // ortho camera: world delta = pixel delta / zoom. Content follows the
      // pointer, so the pan (camera) moves the opposite way. Screen y is
      // flipped relative to world y.
      const zoom = camera.zoom;
      const wx = -dx / zoom;
      const wy = dy / zoom;
      const { panX, panY, setPan } = useBoardStore.getState();
      setPan(panX + wx, panY + wy);

      const now = performance.now();
      const dt = Math.max((now - s.lastT) / 1000, 1e-4);
      s.lastT = now;
      s.vx = s.vx * (1 - VELOCITY_EMA_ALPHA) + (wx / dt) * VELOCITY_EMA_ALPHA;
      s.vy = s.vy * (1 - VELOCITY_EMA_ALPHA) + (wy / dt) * VELOCITY_EMA_ALPHA;
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== s.pointerId) return;
      s.down = false;
      s.pointerId = null;
      // momentum keeps isDragging true; the frame loop settles it
      invalidate();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [gl, camera, invalidate, s]);

  useFrame((_, delta) => {
    if (s.down || !s.dragging) return;
    const speed = Math.hypot(s.vx, s.vy);
    if (speed < SETTLE_EPSILON) {
      s.dragging = false;
      s.vx = 0;
      s.vy = 0;
      useBoardStore.getState().setDragging(false);
      return;
    }
    const { panX, panY, setPan } = useBoardStore.getState();
    setPan(panX + s.vx * delta, panY + s.vy * delta);
    // frame-rate-independent decay
    const decay = Math.exp(-MOMENTUM_DAMPING * delta);
    s.vx *= decay;
    s.vy *= decay;
    invalidate();
  });
}
