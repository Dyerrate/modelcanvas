import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, Stats } from '@react-three/drei';
import Board from './Board';
import CameraRig from './CameraRig';
import DetailPanel from './DetailPanel';
import MotionFx from './MotionFx';
import { useBoardStore } from '../hooks/useBoardStore';
import { BASE_ZOOM } from '../config/board';

// horizontal-streak turbulence — reads as faint film scratches when its
// opacity rides the pan speed
const SCRATCH_TEXTURE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.28' numOctaves='2' seed='11'/%3E%3CfeColorMatrix values='0 0 0 0 0.25 0 0 0 0 0.25 0 0 0 0 0.25 1.6 0 0 0 -0.9'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23s)'/%3E%3C/svg%3E")`;

export default function BoardIsland() {
  const scratchRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        style={{ background: '#ffffff' }}
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
          backgroundImage: SCRATCH_TEXTURE,
          backgroundRepeat: 'repeat',
          mixBlendMode: 'multiply',
          zIndex: 5,
        }}
      />
      <DetailPanel />
    </div>
  );
}
