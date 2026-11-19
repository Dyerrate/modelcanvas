import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { animate, type JSAnimation } from 'animejs';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';
import { useLookStore } from '../hooks/useLookStore';
import { galleryFx } from '../lib/galleryFx';
import { CURTAIN_OVERSHOOT, lookSwapFx, setCurtainSpan } from '../lib/lookSwap';
import { useEditorialStore } from '../lib/editorialFx';

const entries = manifest as SplatEntry[];
/** The band of light takes this long to pass down the figure … */
const UNVEIL_MS = 1500;
/** The page gets at least this long to set its type before the entrance,
 *  even when the splat is already cached. */
const STAGE_MS = 1100;
/** … while the model turns from this yaw (radians) to face the camera. */
const TURN_FROM = -0.5;
const TURN_MS = 2800;
/** Yaw (radians) left in the turn below which it lands. */
const TURN_REST = 0.003;

/**
 * The model's entrance in the cover view. The page sets its type while the
 * splat streams in behind a closed curtain (the lookbook's, see
 * lookSwap.ts); once it is up, anime.js passes a band of light down the
 * figure to unveil it and turns it to face the camera. A drag takes the
 * turn over at any point. (Board-tier splats have no curtain: they fade in
 * over their thumbnail and only turn.) Renders nothing.
 */
export default function EditorialDriver() {
  const invalidate = useThree((s) => s.invalidate);
  const st = useRef<{
    id: string | null;
    phase: 'veiled' | 'unveiling' | 'shown';
    /** Frames spent veiled: the tile reports its tier a frame behind us. */
    frames: number;
    since: number;
    yaw: number;
    anims: JSAnimation[];
  }>({ id: null, phase: 'shown', frames: 0, since: 0, yaw: 0, anims: [] });

  const leave = () => {
    const s = st.current;
    if (!s.id) return;
    s.anims.forEach((a) => a.pause());
    s.anims = [];
    s.id = null;
    s.phase = 'shown';
    lookSwapFx.composite.uCurtain.value.w = 0;
    lookSwapFx.hold = false;
    useEditorialStore.setState({ revealed: false });
  };
  useEffect(() => leave, []);

  useFrame(({ camera }) => {
    const s = st.current;
    const c = lookSwapFx.composite.uCurtain.value;
    const board = useBoardStore.getState();
    const entry = entries.find((e) => e.id === board.selectedId);
    if (!entry || board.view !== 'details') {
      leave();
      return;
    }

    if (s.id !== entry.id) {
      // a new entrance: close the curtain before the splat's first frame
      leave();
      s.id = entry.id;
      s.phase = 'veiled';
      s.frames = 0;
      s.since = performance.now();
      lookSwapFx.hold = true;
      c.set(-CURTAIN_OVERSHOOT, 1, 0, 1);
    }
    if (s.phase === 'shown') return;

    const shown = entry.looks?.[useLookStore.getState().look];
    const [lo, hi] = shown?.heightRange ?? entry.meta?.stage?.heightRange ?? [-1, 1];
    setCurtainSpan(camera, board.anchor ?? { x: 0, y: 0 }, board, lo, hi);
    if (s.phase !== 'veiled') return;
    const staged = performance.now() - s.since > STAGE_MS;
    if (s.frames++ < 2 || !staged || galleryFx.readyAt === 0) {
      if (!staged) invalidate(); // keep the clock running on a demand frameloop
      return;
    }

    s.phase = 'unveiling';
    useEditorialStore.setState({ revealed: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const veil = { p: 0 };
    const unveil = animate(veil, {
      p: 1,
      duration: reduced ? 1 : UNVEIL_MS,
      ease: 'inOutCubic',
      onUpdate: () => {
        c.set(
          -CURTAIN_OVERSHOOT + veil.p * (1 + 2 * CURTAIN_OVERSHOOT),
          1,
          Math.sin(Math.PI * veil.p) * 0.9,
          1
        );
        invalidate();
      },
      onComplete: () => {
        c.w = 0;
        lookSwapFx.hold = false;
        s.phase = 'shown';
        invalidate();
      },
    });
    s.anims = [unveil];
    if (reduced) return;

    const turn = { yaw: TURN_FROM };
    s.yaw = TURN_FROM;
    board.setFocusRotation(TURN_FROM, 0);
    const turning = animate(turn, {
      yaw: 0,
      duration: TURN_MS,
      ease: 'outExpo',
      onUpdate: () => {
        const store = useBoardStore.getState();
        // a drag has moved the model: it's the visitor's now
        if (Math.abs(store.focusYaw - s.yaw) > 1e-4 || store.focusPitch !== 0) {
          turning.pause();
          return;
        }
        // the ease-out's tail is too small to see: land it, so the figure
        // rests and is redrawn at full size without waiting it out
        if (Math.abs(turn.yaw) < TURN_REST) {
          turn.yaw = 0;
          turning.pause();
        }
        s.yaw = turn.yaw;
        store.setFocusRotation(turn.yaw, 0);
        invalidate();
      },
    });
    s.anims.push(turning);
  });

  return null;
}
