import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import Board from './Board';
import DetailPanel from './DetailPanel';
import { useBoardStore } from '../hooks/useBoardStore';

export default function BoardIsland() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        style={{ background: '#ffffff' }}
        onPointerMissed={() => {
          const store = useBoardStore.getState();
          if (!store.isDragging) store.setSelected(null); // click on empty board closes details
        }}
      >
        <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={80} />
        <Board />
      </Canvas>
      <DetailPanel />
    </div>
  );
}
