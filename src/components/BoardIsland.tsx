import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, Stats } from '@react-three/drei';
import Board from './Board';
import CameraRig from './CameraRig';
import GlassNav from './GlassNav';
import MotionFx from './MotionFx';
import GalleryHud from './GalleryHud';
import WardrobeDriver from './WardrobeDriver';
import LookSwapDriver from './LookSwapDriver';
import EditorialDriver from './EditorialDriver';
import EditorialView from './EditorialView';
import { useBoardStore } from '../hooks/useBoardStore';
import { BASE_ZOOM } from '../config/board';

export default function BoardIsland() {
  // a focused model re-skins the DOM chrome: its cover view, or the gallery
  // of its looks
  const stage = useBoardStore((s) =>
    s.selectedId === null ? undefined : s.view === 'gallery' ? 'gallery' : 'editorial'
  );
  return (
    // white lives on the wrapper: the canvas stays transparent so MotionFx's
    // drop-shadow rgb-split hugs the figures instead of the whole viewport,
    // and the aurora blobs painted underneath show through for the glass UI
    <div
      className="board-shell"
      data-stage={stage}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#ffffff' }}
    >
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
      >
        <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={BASE_ZOOM} />
        <Board />
        <CameraRig />
        <MotionFx />
        <WardrobeDriver />
        <LookSwapDriver />
        <EditorialDriver />
        {import.meta.env.DEV && <Stats />}
      </Canvas>
      <GlassNav />
      <EditorialView />
      <GalleryHud />
    </div>
  );
}
