import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, Stats } from '@react-three/drei';
import Board from './Board';
import CameraRig from './CameraRig';
import DetailPanel from './DetailPanel';
import MotionFx from './MotionFx';
import { useBoardStore } from '../hooks/useBoardStore';
import { BASE_ZOOM } from '../config/board';

// industrial scratch kit, three stacked layers (MotionFx scrolls the first
// two along the drag direction and jitters them for a glitch shimmer):
//  1. long graphite gouges — worn-metal look
//  2. sparser cyan micro-scratches — the sci-fi accent, faster parallax
//  3. static scanlines
const GRAPHITE_SCRATCHES = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.004 0.32' numOctaves='2' seed='11' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.07 0 0 0 0 0.08 0 0 0 0 0.1 2.4 0 0 0 -1.5'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23s)'/%3E%3C/svg%3E")`;
const CYAN_SCRATCHES = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='c'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.0025 0.45' numOctaves='2' seed='37' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0.72 0 0 0 0 0.85 2.8 0 0 0 -2.05'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23c)'/%3E%3C/svg%3E")`;
const SCANLINES =
  'repeating-linear-gradient(0deg, rgba(12, 22, 30, 0.28) 0px, rgba(12, 22, 30, 0.28) 1px, transparent 1px, transparent 4px)';
const SCRATCH_LAYERS = `${GRAPHITE_SCRATCHES}, ${CYAN_SCRATCHES}, ${SCANLINES}`;

export default function BoardIsland() {
  const scratchRef = useRef<HTMLDivElement>(null);

  return (
    // white lives on the wrapper: the canvas stays transparent so MotionFx's
    // drop-shadow rgb-split hugs the figures instead of the whole viewport
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#ffffff' }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        onPointerMissed={() => {
          const store = useBoardStore.getState();
          if (!store.isDragging) store.setSelected(null); // click on empty board closes details
        }}
      >
        <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={BASE_ZOOM} />
        <Board />
        <CameraRig />
        <MotionFx overlayRef={scratchRef} />
        {import.meta.env.DEV && <Stats />}
      </Canvas>
      <div
        ref={scratchRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0,
          backgroundImage: SCRATCH_LAYERS,
          backgroundRepeat: 'repeat',
          mixBlendMode: 'multiply',
          zIndex: 5,
        }}
      />
      <DetailPanel />
    </div>
  );
}
