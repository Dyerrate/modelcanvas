import { Suspense, useCallback, useLayoutEffect, useRef } from 'react';
import { Splat } from '@react-three/drei';
import type { Group, Mesh, ShaderMaterial } from 'three';
import type { SplatEntry } from '../types/manifest';

/**
 * drei's Splat shader (v10.7.7) sizes gaussians with a perspective Jacobian
 * (focal / camspace.z) — under our orthographic camera at z=10 that shrinks
 * every splat to ~1/10 of its true screen size. In ortho projection the
 * world→pixel scale is just `focal` (the loader already derives it from the
 * projection matrix each frame), so we swap the Jacobian in place. If a
 * future drei changes this shader the regex simply won't match.
 */
const PERSPECTIVE_J = /mat3 J = mat3\([\s\S]*?\);/;
const ORTHO_J = 'mat3 J = mat3(focal, 0., 0., 0., focal, 0., 0., 0., 0.);';
// perfectly isotropic gaussians (like our placeholders) project to an exactly
// circular covariance, where the eigenvector below is normalize(vec2(0,0)) —
// NaN — and the whole quad vanishes; guard the degenerate case
const EIGENVECTOR = 'vec2 diagonalVector = normalize(vec2(offDiagonal, lambda1 - diagonal1));';
const EIGENVECTOR_SAFE =
  'vec2 dvRaw = vec2(offDiagonal, lambda1 - diagonal1);\n' +
  '      vec2 diagonalVector = dot(dvRaw, dvRaw) > 0.0 ? normalize(dvRaw) : vec2(0.0, 1.0);';

function patchForOrthoCamera(root: Group) {
  root.traverse((obj) => {
    const mat = (obj as Mesh).material as ShaderMaterial | undefined;
    if (mat?.isShaderMaterial && mat.uniforms?.focal && PERSPECTIVE_J.test(mat.vertexShader)) {
      mat.vertexShader = mat.vertexShader
        .replace(PERSPECTIVE_J, ORTHO_J)
        .replace(EIGENVECTOR, EIGENVECTOR_SAFE);
      mat.needsUpdate = true;
    }
  });
}

/** Mounts only once every suspending sibling has resolved — Suspense
 *  resolution is the "splat is ready" signal. Patches the material before
 *  the browser paints the first ready frame. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  useLayoutEffect(() => {
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
  const group = useRef<Group>(null);

  const handleReady = useCallback(() => {
    if (group.current) patchForOrthoCamera(group.current);
    onReady();
  }, [onReady]);

  return (
    <group ref={group}>
      <Suspense fallback={null}>
        <Splat src={entry.splatUrl} />
        <ReadySignal onReady={handleReady} />
      </Suspense>
    </group>
  );
}
