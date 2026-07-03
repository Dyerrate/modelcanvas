import { useEffect } from 'react';
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
export default function CameraRig() {
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);

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
          state.panX !== prev.panX ||
          state.panY !== prev.panY
        ) {
          invalidate();
        }
      }),
    [invalidate]
  );

  useFrame(({ camera }, delta) => {
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
