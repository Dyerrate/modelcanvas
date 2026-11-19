import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { motionState, useBoardStore } from './useBoardStore';
import {
  galleryDragEnd,
  galleryDragMove,
  galleryDragStart,
  useGalleryStore,
} from '../lib/galleryFx';
import { setFocusZoom } from '../lib/focus';

const DRAG_DEAD_ZONE_PX = 4; // movement under this is a tap, not a drag
const VELOCITY_EMA_ALPHA = 0.3;
const MOMENTUM_DAMPING = 5; // ~exp decay constant, 1/s
const SETTLE_EPSILON = 0.001; // world units/s
const ROTATE_SPEED = 0.008; // radians per pixel of drag while a model's details are up
const WHEEL_ZOOM_SPEED = 0.0015; // scale change per wheel deltaY unit there
/** Wheel/trackpad travel (px) that walks the gallery one piece. */
const WHEEL_STEP_PX = 90;
/** Quiet time after a wheel step before the next one can fire (ms). */
const WHEEL_COOLDOWN_MS = 380;

/**
 * Pointer drag → board pan with inertial momentum. Attaches directly to the
 * WebGL canvas (pointer events cover mouse + touch). Owns all pan input —
 * no OrbitControls anywhere. While a model is focused, drags orbit it and
 * the wheel zooms (details view) — or both walk along the hang (gallery).
 */
export function useDragPan() {
  const { gl, camera, invalidate } = useThree();
  const s = useRef({
    pointerId: null as number | null,
    down: false,
    dragging: false,
    walking: false,
    rotating: false,
    wheelAcc: 0,
    wheelAt: 0,
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
      // a focused model captures drags: orbit in details, walk in the gallery
      const { selectedId, view } = useBoardStore.getState();
      s.walking = selectedId !== null && view === 'gallery';
      s.rotating = selectedId !== null && view === 'details';
      if (selectedId === null) useBoardStore.getState().setPanTarget(null); // user takes over the camera
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
        if (s.walking) galleryDragStart();
        else if (!s.rotating) {
          const store = useBoardStore.getState();
          store.setDragging(true);
          // grabbing the board exits focus mode — the user wants to explore
          if (store.selectedId) store.setSelected(null);
        }
      }
      if (!s.dragging) return;

      if (s.walking) {
        galleryDragMove(dx);
        invalidate();
        return;
      }
      if (s.rotating) {
        const { focusYaw, focusPitch, setFocusRotation } = useBoardStore.getState();
        setFocusRotation(focusYaw + dx * ROTATE_SPEED, focusPitch + dy * ROTATE_SPEED);
        invalidate();
        return;
      }

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
      motionState.vx = s.vx;
      motionState.vy = s.vy;
      motionState.speed = Math.hypot(s.vx, s.vy);
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== s.pointerId) return;
      s.down = false;
      s.pointerId = null;
      if (s.walking && s.dragging) {
        galleryDragEnd();
        s.dragging = false; // no board momentum for a gallery walk
      }
      // momentum keeps isDragging true; the frame loop settles it
      invalidate();
    };

    const onWheel = (e: WheelEvent) => {
      const store = useBoardStore.getState();
      if (!store.selectedId) return; // the board itself doesn't scroll
      e.preventDefault();
      if (store.view === 'details') {
        setFocusZoom(store.focusZoomScale * (1 - e.deltaY * WHEEL_ZOOM_SPEED));
        invalidate();
        return;
      }
      // trackpads swipe sideways; mice scroll vertically — either walks
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const now = performance.now();
      if (now - s.wheelAt < WHEEL_COOLDOWN_MS) return;
      s.wheelAcc += d;
      if (Math.abs(s.wheelAcc) >= WHEEL_STEP_PX) {
        useGalleryStore.getState().step(Math.sign(s.wheelAcc));
        s.wheelAcc = 0;
        s.wheelAt = now;
      }
      invalidate();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, camera, invalidate, s]);

  useFrame((_, rawDelta) => {
    if (s.down || !s.dragging) return;
    // clamp the step so a stalled/backgrounded tab can't teleport the pan
    const delta = Math.min(rawDelta, 0.05);
    const speed = Math.hypot(s.vx, s.vy);
    if (speed < SETTLE_EPSILON) {
      s.dragging = false;
      s.vx = 0;
      s.vy = 0;
      motionState.vx = 0;
      motionState.vy = 0;
      motionState.speed = 0;
      useBoardStore.getState().setDragging(false);
      return;
    }
    const { panX, panY, setPan } = useBoardStore.getState();
    setPan(panX + s.vx * delta, panY + s.vy * delta);
    // frame-rate-independent decay
    const decay = Math.exp(-MOMENTUM_DAMPING * delta);
    s.vx *= decay;
    s.vy *= decay;
    motionState.vx = s.vx;
    motionState.vy = s.vy;
    motionState.speed = Math.hypot(s.vx, s.vy);
    invalidate();
  });
}
