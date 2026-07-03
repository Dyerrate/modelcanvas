import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, Stats } from '@react-three/drei';
import Board from './Board';
import DetailPanel from './DetailPanel';
import { useBoardStore } from '../hooks/useBoardStore';

export default function BoardIsland() {
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
        <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={80} />
        <Board />
        {import.meta.env.DEV && <Stats />}
      </Canvas>
      <DetailPanel />
    </div>
  );
}
