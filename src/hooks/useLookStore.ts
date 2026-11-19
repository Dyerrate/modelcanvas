import { create } from 'zustand';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from './useBoardStore';

/** Looks are worn per capture, so variant tiles of one scan (e.g. both Sam
 *  stages) share what he has on. */
export const captureKey = (entry: SplatEntry) => entry.meta?.variantOf ?? entry.id;

/** Lookbook change on the focused model: the shown look leaves ('out'), the
 *  next one streams in ('load'), then walks on ('in'). See LookSwapDriver. */
export type LookSwapPhase = 'idle' | 'out' | 'load' | 'in';

interface LookState {
  /** Garment id worn by each capture ('original' when absent). */
  worn: Record<string, string>;
  /** Whether the latest change should skip the try-on wipe (the gallery
   *  swaps looks while the splat is faded out). */
  instant: boolean;
  wear: (capture: string, garmentId: string, instant?: boolean) => void;
  /** Focused model's lookbook (index into entry.looks): the look on screen,
   *  and the one asked for. Back to the first look whenever focus changes. */
  look: number;
  wantLook: number;
  swap: LookSwapPhase;
  /** Ask for a look; the driver plays the change. */
  pickLook: (index: number) => void;
  /** Show a look at once, no transition (the gallery, while it's faded). */
  showLook: (index: number) => void;
}

export const useLookStore = create<LookState>((set) => ({
  worn: {},
  instant: false,
  wear: (capture, garmentId, instant = false) =>
    set((s) => ({ instant, worn: { ...s.worn, [capture]: garmentId } })),
  look: 0,
  wantLook: 0,
  swap: 'idle',
  pickLook: (wantLook) => set({ wantLook }),
  showLook: (look) => set({ look, wantLook: look, swap: 'idle' }),
}));

// a new (or no) focused model opens on its first look; zustand notifies
// synchronously, so tiles never render the old model's look
useBoardStore.subscribe((s, prev) => {
  if (s.selectedId !== prev.selectedId) useLookStore.getState().showLook(0);
});

// dev-only handle for poking the try-on from the console / test tooling
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__lookStore = useLookStore;
}
