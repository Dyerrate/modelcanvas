import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  DoubleSide,
  MeshBasicMaterial,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Group,
  type Texture,
} from 'three';
import { motionState, useBoardStore } from '../hooks/useBoardStore';

/** Matches the focus fade of the thumbnail material in CharacterTile. */
const FOCUS_FADE_SECONDS = 0.35;
const HOVER_EASE = 8; // 1/s
/** Margin around the tile the frame plane covers (world units). */
const PAD = 0.2;
const TAG_W = 0.36;
const TAG_H = TAG_W * (720 / 400);
/** Hang-tag swing: an underdamped spring, so it settles in a few sways. */
const SWING_K = 38;
const SWING_DAMP = 2.0;
/** Board pan velocity (world/s) → lean of the tag, radians per unit. */
const SWING_LEAN = 0.05;
const SWING_HOVER_KICK = 2.6;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMask;
  uniform float uTime;
  uniform float uFade;
  uniform float uHover;
  uniform vec2 uTile;   // tile size, world units
  uniform vec2 uPlane;  // this plane's size, world units
  varying vec2 vUv;

  float band(float x, float a, float b) {
    float w = fwidth(x);
    return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
  }

  void main() {
    vec2 p = (vUv - 0.5) * uPlane;
    vec2 hs = uTile * 0.5;

    // passe-partout: a double hairline that breathes, drawing in on hover
    float breathe = 0.5 + 0.5 * sin(uTime * 1.4);
    vec2 c = hs + mix(0.08 + 0.012 * breathe, 0.04, uHover);
    vec2 q = abs(p);
    float th = 0.0055;
    float outer = band(q.x, c.x - th, c.x) * step(q.y, c.y) + band(q.y, c.y - th, c.y) * step(q.x, c.x);
    vec2 ci = c - 0.026;
    float inner = (band(q.x, ci.x - th * 0.6, ci.x) * step(q.y, ci.y) + band(q.y, ci.y - th * 0.6, ci.y) * step(q.x, ci.x))
      * (0.35 + 0.65 * uHover);
    // solid ink corner blocks where the rules meet
    vec2 cd = abs(q - c + 0.013);
    float corner = 1.0 - step(0.019, max(cd.x, cd.y));

    // satin sheen raking through the figure, masked to its silhouette
    vec2 tuv = p / uTile + 0.5;
    float inTile = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
    float m = texture2D(uMask, clamp(tuv, 0.0, 1.0)).a * inTile;
    float period = mix(4.6, 2.2, uHover);
    float pos = -0.45 + fract(uTime / period) * 2.4;
    float diag = tuv.x * 0.6 + tuv.y;
    float sheen = exp(-pow((diag - pos) / 0.065, 2.0)) * m;

    vec3 ink = vec3(0.08, 0.075, 0.07);
    vec3 col = ink * min(outer + inner, 1.0) + vec3(1.0, 0.98, 0.95) * sheen;
    float a = clamp(min(outer + inner, 1.0) * 0.85 + corner + sheen * 0.5, 0.0, 1.0);
    col = mix(col, ink * a, corner);
    a *= uFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * uFade, a);
  }
`;

/** White hang tag on a black cord: black eyelet, house line, look number. */
function drawTag(label: string, look: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 720;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;

  const paint = () => {
    const g = canvas.getContext('2d');
    if (!g) return;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const top = 130;
    const cut = 46;

    // cord
    g.strokeStyle = '#2b2118';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, 0);
    g.lineTo(cx, top + 48);
    g.stroke();

    // card with chamfered shoulders
    g.beginPath();
    g.moveTo(26 + cut, top);
    g.lineTo(w - 26 - cut, top);
    g.lineTo(w - 26, top + cut);
    g.lineTo(w - 26, h - 14);
    g.lineTo(26, h - 14);
    g.lineTo(26, top + cut);
    g.closePath();
    g.fillStyle = '#f7f6f2';
    g.shadowColor = 'rgba(40, 30, 20, 0.28)';
    g.shadowBlur = 14;
    g.shadowOffsetY = 5;
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = '#1b1814';
    g.lineWidth = 2;
    g.stroke();
    // inner rule
    g.strokeStyle = 'rgba(27, 24, 20, 0.55)';
    g.lineWidth = 1.5;
    g.strokeRect(44, top + 78, w - 88, h - top - 112);

    // eyelet
    g.fillStyle = '#1b1814';
    g.beginPath();
    g.arc(cx, top + 48, 17, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(cx, top + 48, 9, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';

    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#1b1814';
    const spaced = (text: string, font: string, y: number, spacing: string) => {
      g.font = font;
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
      g.fillText(text, cx, y, w - 100);
    };
    spaced('SALONE MILANO', '500 19px Jost, "Futura", "Century Gothic", sans-serif', top + 128, '6px');
    spaced(look, 'italic 400 76px "Bodoni Moda", "Didot", "Bodoni 72", serif', top + 250, '0px');
    g.fillStyle = '#1b1814';
    g.fillRect(cx - 40, top + 290, 80, 2);
    g.fillStyle = '#1b1814';
    const words = label.split(' ');
    words.forEach((word, i) =>
      spaced(word, '600 24px Jost, "Futura", "Century Gothic", sans-serif', top + 352 + i * 38, '7px'),
    );
    g.fillStyle = 'rgba(27, 24, 20, 0.62)';
    spaced('A/I 2026', '400 18px Jost, "Futura", sans-serif', h - 64, '5px');
    tex.needsUpdate = true;
  };
  paint();
  // repaint once the editorial faces arrive (first paint used fallbacks)
  Promise.all([
    document.fonts?.load('italic 400 76px "Bodoni Moda"'),
    document.fonts?.load('600 24px Jost'),
  ]).then(paint, () => {});
  return tex;
}

interface AtelierBadgeProps {
  /** Thumbnail texture; its alpha confines the sheen to the figure. */
  mask: Texture;
  hovered: boolean;
  width: number;
  height: number;
  label: string;
  look: string;
}

/**
 * Board-tile highlight for atelier-staged captures: a breathing double
 * hairline with ink corner blocks, a satin sheen raking through the
 * figure, and a white hang tag on a cord that sways on a spring — it
 * leans against board drags and gets a flick on hover. Hides with the rest
 * of the board in focus mode; the focused model gets AtelierStage instead.
 */
export default function AtelierBadge({ mask, hovered, width, height, label, look }: AtelierBadgeProps) {
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const swing = useRef<Group>(null);
  const plane = useMemo(() => new Vector2(width + PAD * 2, height + PAD * 2), [width, height]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uMask: { value: mask },
          uTime: { value: 0 },
          uFade: { value: 1 },
          uHover: { value: 0 },
          uTile: { value: new Vector2(width, height) },
          uPlane: { value: plane },
        },
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [mask, width, height, plane],
  );
  const tagTex = useMemo(() => drawTag(label, look), [label, look]);
  const tagMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: tagTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    [tagTex],
  );
  useEffect(
    () => () => {
      material.dispose();
      tagMat.dispose();
      tagTex.dispose();
    },
    [material, tagMat, tagTex],
  );

  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const world = useMemo(() => new Vector3(), []);
  const sway = useRef({ angle: 0, vel: 0, wasHovered: false });

  useFrame(({ camera, size }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const u = material.uniforms;
    const store = useBoardStore.getState();
    const target = store.selectedId !== null ? 0 : 1;
    const diff = target - u.uFade.value;
    if (diff !== 0) {
      u.uFade.value += Math.sign(diff) * Math.min(Math.abs(diff), delta / FOCUS_FADE_SECONDS);
    }
    tagMat.opacity = u.uFade.value;
    u.uHover.value += ((hovered ? 1 : 0) - u.uHover.value) * (1 - Math.exp(-HOVER_EASE * delta));
    if (group.current) group.current.visible = u.uFade.value > 0.002;
    if (!group.current?.visible || reduced) return;
    u.uTime.value += delta;

    // hang tag: spring toward a lean against the board's motion, plus a
    // faint draught; hovering the tile flicks it
    const s = sway.current;
    if (hovered && !s.wasHovered) s.vel += SWING_HOVER_KICK;
    s.wasHovered = hovered;
    const lean = Math.max(-0.7, Math.min(0.7, motionState.vx * SWING_LEAN));
    const rest = lean + 0.05 * Math.sin(u.uTime.value * 1.1);
    s.vel += (-SWING_K * (s.angle - rest) - SWING_DAMP * s.vel) * delta;
    s.angle += s.vel * delta;
    if (swing.current) swing.current.rotation.z = s.angle;

    // only keep the demand frameloop spinning while the badge is on screen
    group.current.getWorldPosition(world);
    const halfW = size.width / (2 * camera.zoom) + plane.x;
    const halfH = size.height / (2 * camera.zoom) + plane.y;
    if (
      Math.abs(world.x - camera.position.x) < halfW &&
      Math.abs(world.y - camera.position.y) < halfH
    ) {
      invalidate();
    }
  });

  return (
    <group ref={group}>
      <mesh position={[0, 0, 0.45]} raycast={() => null} material={material}>
        <planeGeometry args={[plane.x, plane.y]} />
      </mesh>
      {/* cord pinned to the frame's bottom rule, near the right corner */}
      <group ref={swing} position={[width / 2 - 0.16, -height / 2 - 0.09, 0.46]}>
        <mesh position={[0, -TAG_H / 2, 0]} raycast={() => null} material={tagMat}>
          <planeGeometry args={[TAG_W, TAG_H]} />
        </mesh>
      </group>
    </group>
  );
}
