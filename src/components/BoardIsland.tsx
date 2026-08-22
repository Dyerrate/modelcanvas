import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, Stats } from '@react-three/drei';
import Board from './Board';
import CameraRig from './CameraRig';
import DetailPanel from './DetailPanel';
import GlassNav from './GlassNav';
import MotionFx from './MotionFx';
import { useBoardStore } from '../hooks/useBoardStore';
import { BASE_ZOOM } from '../config/board';

export default function BoardIsland() {
  return (
    // white lives on the wrapper: the canvas stays transparent so MotionFx's
    // drop-shadow rgb-split hugs the figures instead of the whole viewport,
    // and the aurora blobs painted underneath show through for the glass UI
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#ffffff' }}>
      <div className="aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        // lift the canvas above the aurora layer — without a stacking order
        // the positioned aurora paints over the (in-flow) canvas container
        style={{ position: 'relative', zIndex: 1 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        onPointerMissed={() => {
          const store = useBoardStore.getState();
          if (!store.isDragging) store.setSelected(null); // click on empty board closes details
        }}
      >
        <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={BASE_ZOOM} />
        <Board />
        <CameraRig />
        <MotionFx />
        {import.meta.env.DEV && <Stats />}
      </Canvas>
      <GlassNav />
      <DetailPanel />
    </div>
  );
}
