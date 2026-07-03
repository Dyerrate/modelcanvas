import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';

export default function BoardIsland() {
  return (
    <Canvas style={{ background: '#ffffff' }}>
      <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={80} />
      <mesh>
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial color="#ff6b6b" />
      </mesh>
    </Canvas>
  );
}
