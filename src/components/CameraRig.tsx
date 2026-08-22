import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useBoardStore } from '../hooks/useBoardStore';
import { BASE_ZOOM, FOCUS_ZOOM } from '../config/board';

const ZOOM_EASE = 5; // 1/s

/**
 * Eases the orthographic zoom toward FOCUS_ZOOM while a model is selected
 * and back to BASE_ZOOM when the focus closes. Also kicks the demand
 * frameloop whenever store changes start an animation (selection, drag,
 * programmatic pan) — without this, closing the panel would never render
 * the fade-back.
 */
/** How long to keep painting after the view stops moving — covers the splat
 *  sort worker posting its final order after the last eased frame. */
const SETTLE_PAINT_MS = 700;

export default function CameraRig() {
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  const lastView = useRef({ zoom: 0, x: 0, y: 0, t: 0 });

  // dev-only handle for inspecting the scene from test tooling
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__threeGet = get;
    }
  }, [get]);

  useEffect(
    () =>
      useBoardStore.subscribe((state, prev) => {
        if (
          state.selectedId !== prev.selectedId ||
          state.isDragging !== prev.isDragging ||
          state.board !== prev.board ||
          state.panX !== prev.panX ||
          state.panY !== prev.panY
        ) {
          invalidate();
        }
      }),
    [invalidate]
  );

  useFrame(({ camera }, delta) => {
    // the gaussian sort worker responds async — repaint for a short window
    // after any pan/zoom change so its last result is never left undrawn
    const { panX, panY } = useBoardStore.getState();
    const v = lastView.current;
    if (camera.zoom !== v.zoom || panX !== v.x || panY !== v.y) {
      v.zoom = camera.zoom;
      v.x = panX;
      v.y = panY;
      v.t = performance.now();
    }
    if (performance.now() - v.t < SETTLE_PAINT_MS) invalidate();

    const target = useBoardStore.getState().selectedId ? FOCUS_ZOOM : BASE_ZOOM;
    const diff = target - camera.zoom;
    if (Math.abs(diff) < 0.15) {
      if (camera.zoom !== target) {
        camera.zoom = target;
        camera.updateProjectionMatrix();
        invalidate();
      }
      return;
    }
    camera.zoom += diff * (1 - Math.exp(-ZOOM_EASE * delta));
    camera.updateProjectionMatrix();
    invalidate();
  });

  return null;
}
