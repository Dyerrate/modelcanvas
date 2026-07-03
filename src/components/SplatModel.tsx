import { Suspense, useEffect } from 'react';
import { Splat } from '@react-three/drei';
import type { SplatEntry } from '../types/manifest';

/** Mounts only once every suspending sibling has resolved — Suspense
 *  resolution is the "splat is ready" signal. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

interface SplatModelProps {
  entry: SplatEntry;
  onReady: () => void;
}

/**
 * Thin wrapper around drei's <Splat>. While the .splat streams in, the
 * fallback is nothing — the CharacterTile keeps its thumbnail plane at full
 * opacity, which acts as the visual placeholder.
 */
export default function SplatModel({ entry, onReady }: SplatModelProps) {
  return (
    <Suspense fallback={null}>
      <Splat src={entry.splatUrl} />
      <ReadySignal onReady={onReady} />
    </Suspense>
  );
}
