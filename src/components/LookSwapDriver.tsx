import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';
import { useLookStore } from '../hooks/useLookStore';
import { galleryFx } from '../lib/galleryFx';
import { CURTAIN_OVERSHOOT as OVERSHOOT, lookSwapFx, setCurtainSpan } from '../lib/lookSwap';

const entries = manifest as SplatEntry[];
/** The curtain takes the old look away … */
const OUT_S = 0.6;
/** … the show card holds at least this long, even if the next look is
 *  already cached, so it reads as a beat of the show rather than a flicker … */
const CARD_MIN_S = 0.7;
/** … and the curtain brings the new one in. */
const IN_S = 1.0;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Plays a lookbook change on the focused model's splat (details view): a
 * band of light passes down the figure and takes the current look with it,
 * the next capture streams in behind the show card (LookRail), then the
 * band passes again and leaves the new look standing. The gallery changes
 * looks itself, behind its own frame fades. Renders nothing.
 */
export default function LookSwapDriver() {
  const invalidate = useThree((s) => s.invalidate);
  const st = useRef({ t: 0, loadFrom: 0, hiddenAt: 0 });

  // demand frameloop: a pick has to wake the canvas to start playing
  useEffect(
    () =>
      useLookStore.subscribe((s, prev) => {
        if (s.wantLook !== prev.wantLook) invalidate();
      }),
    [invalidate]
  );

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = st.current;
    const c = lookSwapFx.composite.uCurtain.value;
    const board = useBoardStore.getState();
    const looks = useLookStore.getState();
    const entry = entries.find((e) => e.id === board.selectedId);

    if (!entry?.looks || board.view !== 'details') {
      // the gallery (or a closed focus) settles any change at once
      if (looks.swap !== 'idle' || looks.look !== looks.wantLook) looks.showLook(looks.wantLook);
      if (!lookSwapFx.hold) c.w = 0;
      return;
    }

    const now = performance.now();
    const set = useLookStore.setState;
    switch (looks.swap) {
      case 'idle':
        if (looks.wantLook === looks.look) {
          if (!lookSwapFx.hold) c.w = 0;
          return;
        }
        if (galleryFx.readyAt > 0) {
          s.t = 0;
          set({ swap: 'out' });
        } else {
          // nothing on screen to take away yet — go straight to the next one
          s.loadFrom = s.hiddenAt = now;
          set({ swap: 'load', look: looks.wantLook });
        }
        break;
      case 'out':
        s.t = Math.min(1, s.t + dt / OUT_S);
        if (s.t === 1) {
          s.loadFrom = s.hiddenAt = now;
          set({ swap: 'load', look: looks.wantLook });
        }
        break;
      case 'load':
        if (looks.wantLook !== looks.look) {
          // changed their mind while it streamed
          s.loadFrom = now;
          set({ look: looks.wantLook });
        } else if (galleryFx.readyAt > s.loadFrom && now - s.hiddenAt > CARD_MIN_S * 1000) {
          s.t = 0;
          set({ swap: 'in' });
        }
        break;
      case 'in':
        s.t = Math.min(1, s.t + dt / IN_S);
        if (s.t === 1) set({ swap: 'idle' });
        break;
    }

    // drive the curtain over the figure of the look it's acting on
    const phase = useLookStore.getState().swap;
    const p = phase === 'load' ? 1 : easeInOut(s.t);
    c.set(
      -OVERSHOOT + p * (1 + 2 * OVERSHOOT),
      phase === 'in' ? 1 : -1,
      phase === 'load' ? 0 : Math.sin(Math.PI * p) * 0.85,
      phase === 'idle' ? 0 : 1
    );
    const shown = entry.looks[useLookStore.getState().look];
    const [lo, hi] = shown?.heightRange ?? entry.meta?.stage?.heightRange ?? [-1, 1];
    setCurtainSpan(camera, board.anchor ?? { x: 0, y: 0 }, board, lo, hi);
    invalidate();
  });

  return null;
}
