import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import type { FrameKind, PieceStyle, WallPattern } from '../data/galleryStyles';
import { useBoardStore } from '../hooks/useBoardStore';
import { captureKey, useLookStore } from '../hooks/useLookStore';
import { galleryFx, useGalleryStore } from '../lib/galleryFx';
import { galleryLayout, galleryPieces, type GalleryLayout } from '../lib/galleryLayout';
import { hexRgb, LOOK_FILTER_GLSL, lookUniforms, setLook } from '../lib/lookFilter';

const entries = manifest as SplatEntry[];
const MAX_FRAMES = 12; // backdrop bay slots

const ENTER_SECONDS = 1.3;
const EXIT_SECONDS = 0.7;
/** Walk spring (rad/s): critically damped, so a slide glides and stops. */
const WALK_OMEGA = 7.5;
/** Live splat: fade out of the old frame / into the new one. */
const SWAP_OUT_S = 0.16;
const SWAP_IN_S = 0.6;
/** Give the try-on a beat to regenerate before the new piece fades in. */
const DRESS_MS = 140;
/** Spotlight: how long a piece must hold still before the house lights go
 *  down, how slowly they dim, and how quickly they come back for a walk. */
const SPOT_HOLD_S = 0.45;
const SPOT_IN_S = 1.6;
const SPOT_OUT_S = 0.3;
/** How far the house lights drop on the other pieces. */
const HOUSE_DIM = 0.8;

const FRAME_KIND: Record<FrameKind, number> = {
  black: 0,
  gilt: 1,
  oak: 2,
  walnut: 3,
  steel: 4,
  pop: 5,
  neon: 6,
  float: 7,
};
const WALL_PATTERN: Record<WallPattern, number> = { paint: 0, damask: 1, concrete: 2, plaster: 3 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const v3 = (hex: string) => new Vector3(...hexRgb(hex));

// ---------------------------------------------------------------- shaders

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
`;

/** One room's frame: moulding (by kind), mat, ground and the piece's still
 *  through the room's look filter. */
const FRAME_FRAG = /* glsl */ `
  ${LOOK_FILTER_GLSL}
  ${NOISE}
  uniform sampler2D uPortrait;
  uniform float uHasPortrait;
  uniform float uPortraitAlpha;
  uniform vec2 uSize;     // outer frame, world
  uniform vec2 uOpen;     // picture opening, world
  uniform float uBorder;
  uniform float uMat;
  uniform float uKind;
  uniform vec3 uFrameColor;
  uniform vec3 uMatColor;
  uniform vec3 uGround;
  uniform vec3 uNeonA;
  uniform vec3 uNeonB;
  uniform vec3 uLightColor;
  uniform float uFade;
  uniform float uLight;
  uniform float uDim;     // house lights: 1 lit, lower while another piece holds the spot
  varying vec2 vUv;

  vec3 moulding(float t, float along, float lit, vec2 p) {
    int k = int(uKind + 0.5);
    vec3 c = uFrameColor;
    if (k == 1) {
      // carved gilt: coves and beads, an acanthus ripple, worn gesso
      float prof = 0.5 + 0.5 * cos(t * 3.14159 * 3.0);
      float orn = (0.5 + 0.5 * sin(along * 95.0)) * smoothstep(0.32, 0.42, t) * smoothstep(0.7, 0.6, t);
      float bead = (0.5 + 0.5 * sin(along * 210.0)) * smoothstep(0.8, 0.84, t) * smoothstep(0.92, 0.88, t);
      c *= 0.42 + 0.5 * prof + 0.28 * orn + 0.3 * bead;
      c += vec3(0.32, 0.25, 0.12) * lit * prof * 0.5;
      c *= 0.82 + 0.3 * vnoise(p * 60.0);
      c *= 1.0 - 0.45 * smoothstep(0.93, 1.0, t); // shadowed sight edge
    } else if (k == 2 || k == 3) {
      // wood: grain running along each rail, a rounded profile
      float grain = vnoise(vec2(along * 3.0, t * 0.6 + along * 0.2) * vec2(1.0, 26.0));
      float rings = 0.5 + 0.5 * sin((grain * 9.0 + t * 2.0) * 3.14159);
      c *= 0.78 + 0.22 * rings + 0.1 * vnoise(vec2(along * 80.0, t * 3.0));
      c *= 0.82 + 0.25 * sin(t * 3.14159) + 0.12 * lit;
    } else if (k == 4) {
      // brushed steel
      float brush = vnoise(vec2(along * 420.0, t * 5.0));
      c *= 0.78 + 0.3 * brush;
      c += vec3(0.12) * lit * smoothstep(0.1, 0.0, abs(t - 0.15));
      c *= 1.0 - 0.3 * smoothstep(0.85, 1.0, t);
    } else if (k == 5) {
      // pop: flat lacquer, comic-book keylines
      float line = 1.0 - smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.94, t);
      c = mix(c, vec3(0.05), line);
    } else if (k == 6) {
      // neon: a glass tube burning in a dark channel
      float tube = exp(-pow((t - 0.4) / 0.12, 2.0));
      vec3 n = mix(uNeonA, uNeonB, smoothstep(-0.6, 0.6, p.x - p.y));
      c = c + n * tube * 1.3 + vec3(1.0) * pow(tube, 6.0) * 0.6;
    } else if (k == 7) {
      // floating panel: just its crisp edge catching the light
      c = mix(vec3(0.84, 0.84, 0.83), vec3(1.0), lit);
    } else {
      // gallery black: satin, a lit lip on top
      c = c + 0.05 * smoothstep(0.0, 1.0, t) + vec3(0.08) * smoothstep(0.2, 0.0, abs(t - 0.92));
      c += vec3(0.06) * lit;
    }
    return c;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uSize;          // centered, world units
    vec2 q = abs(p);
    vec2 hs = uSize * 0.5;
    vec2 inner = hs - uBorder;              // moulding inner edge
    vec2 open = uOpen * 0.5;
    float px = fwidth(p.x);
    int k = int(uKind + 0.5);

    vec3 col;
    if (q.x > inner.x || q.y > inner.y) {
      float dx = hs.x - q.x, dy = hs.y - q.y;
      bool rail = dy < dx;                    // top / bottom rail
      float t = clamp(min(dx, dy) / max(uBorder, 1e-4), 0.0, 1.0); // 0 outer → 1 inner
      float lit = rail ? step(0.0, p.y) : (p.x < 0.0 ? 0.5 : 0.15);
      col = moulding(t, rail ? p.x : p.y, lit, p);
    } else if (q.x > open.x || q.y > open.y) {
      // mat (or liner)
      col = uMatColor * (1.0 + (hash(floor(p * 900.0)) - 0.5) * 0.02);
      col *= 1.0 - 0.07 * exp(-(inner.y - p.y) / 0.035) - 0.035 * exp(-(inner.x - q.x) / 0.03);
      float cut = max(q.x - open.x, q.y - open.y);
      if (k == 1) {
        // a gilt fillet around the sight
        col = mix(col, uFrameColor * 1.15, 1.0 - smoothstep(0.008, 0.008 + px * 1.5, cut));
      } else if (uMat > 0.05) {
        // 45° bevel: bright core, lower and right faces in shade
        float bevel = 1.0 - smoothstep(0.014, 0.014 + px * 1.5, cut);
        float shade = clamp(step(open.x - 0.02, p.x) + step(p.y, -open.y + 0.02), 0.0, 1.0);
        vec3 core = k == 6 ? uNeonA * 0.5 : vec3(1.0);
        col = mix(col, mix(core, core * 0.86, shade), bevel);
      }
      if (k == 6) {
        // neon spills onto the dark mat
        float spill = exp(-min(inner.x - q.x, inner.y - q.y) / 0.05);
        col += mix(uNeonA, uNeonB, smoothstep(-0.6, 0.6, p.x - p.y)) * spill * 0.35;
      }
    } else {
      // the opening: the room's ground with the still laid over it
      col = uGround;
      if (uMat > 0.05) col *= 1.0 - 0.06 * exp(-(open.y - p.y) / 0.03);
      if (uHasPortrait > 0.5) {
        vec4 t = texture2D(uPortrait, p / uOpen + 0.5);
        col = mix(col, lookFilter(t.rgb, gl_FragCoord.xy), t.a * uPortraitAlpha);
      }
    }

    // the spotlight lifts the piece and tints it a little
    col *= mix(0.88, 1.05, uLight) * mix(vec3(1.0), uLightColor, 0.12 * uLight);
    gl_FragColor = vec4(col * uDim, uFade);
  }
`;

/** Shadow cast on the wall — or, in the neon room, the tube's glow. */
const SHADOW_FRAG = /* glsl */ `
  uniform vec2 uSize;
  uniform vec2 uRect;
  uniform float uFade;
  uniform float uSoft;
  uniform float uStrength;
  uniform float uGlow;
  uniform vec3 uNeonA;
  uniform vec3 uNeonB;
  uniform float uDim;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float dist = length(max(abs(p) - uRect, 0.0));
    if (uGlow > 0.0) {
      float g = exp(-dist / 0.16) * uGlow * uFade * uDim;
      gl_FragColor = vec4(mix(uNeonA, uNeonB, smoothstep(-0.8, 0.8, p.x - p.y)), g);
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, exp(-dist / uSoft) * uStrength * uFade);
    }
  }
`;

/** Little wall plaque beside the pieces that aren't in front of you. */
const PLAQUE_FRAG = /* glsl */ `
  uniform float uFade;
  uniform float uDim;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv;
    float body = step(0.02, p.x) * step(p.x, 0.98) * step(0.04, p.y) * step(p.y, 0.96);
    vec3 col = vec3(0.985, 0.982, 0.975);
    float line = 0.0;
    line += step(0.74, p.y) * step(p.y, 0.82) * step(0.12, p.x) * step(p.x, 0.62);
    line += step(0.56, p.y) * step(p.y, 0.62) * step(0.12, p.x) * step(p.x, 0.82) * 0.6;
    line += step(0.40, p.y) * step(p.y, 0.45) * step(0.12, p.x) * step(p.x, 0.7) * 0.5;
    line += step(0.18, p.y) * step(p.y, 0.23) * step(0.12, p.x) * step(p.x, 0.4) * 0.5;
    col = mix(col, vec3(0.32), line * 0.8);
    gl_FragColor = vec4(col * uDim, body * uFade);
  }
`;

/** The rooms: each frame's bay of wall in its own paint/material and
 *  light, partition corners between them, the ceiling track, and a
 *  polished floor taking a little of each room's color. */
const BACKDROP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const BACKDROP_FRAG = /* glsl */ `
  #define N ${MAX_FRAMES}
  ${NOISE}
  uniform float uPresence;
  uniform vec2 uRes;          // CSS px
  uniform float uFloorY;      // wall/floor junction, px from bottom
  uniform float uCeilY;       // ceiling track, px from bottom
  uniform float uFrameCy;     // frame center, px from bottom
  uniform vec2 uFrameHalf;    // typical frame half size, px
  uniform float uPxPer;       // px between frame centers
  uniform float uFrameX[N];   // frame centers, px from left
  uniform float uLight[N];    // per-frame spotlight level 0..1
  uniform vec3 uWall[N];
  uniform vec3 uLightC[N];
  uniform float uLightP[N];
  uniform float uPattern[N];
  uniform int uCount;
  uniform float uSpot;        // 0 house lights up … 1 one piece in the spotlight
  uniform float uSpotX;       // selected frame center, px from left
  uniform vec2 uSpotHalf;     // selected frame half size, px
  uniform vec3 uSpotC;        // its light color
  uniform float uTime;
  uniform float uMotes;       // drifting dust in the beam (off for reduced motion)
  varying vec2 vUv;

  vec3 wallTex(vec3 c, float pat, vec2 f) {
    int k = int(pat + 0.5);
    if (k == 1) {
      // damask: a soft repeating flourish, tone on tone
      vec2 cell = vec2(56.0, 76.0);
      vec2 g = (fract(f / cell + vec2(0.5 * mod(floor(f.y / cell.y), 2.0), 0.0)) - 0.5) * 2.0;
      float m = smoothstep(0.55, 0.45, length(vec2(abs(g.x) * 1.5, g.y * (1.0 + 0.6 * abs(g.x)))))
              - smoothstep(0.3, 0.2, length(g * vec2(1.3, 0.9))) * 0.6;
      return c * (1.0 + 0.1 * m);
    } else if (k == 2) {
      // board-formed concrete: mottling, form seams, tie holes
      float n = 0.88 + 0.16 * vnoise(f * 0.015) + 0.08 * vnoise(f * 0.12);
      float seam = 1.0 - 0.12 * (1.0 - smoothstep(0.0, 1.4, abs(mod(f.y, 120.0) - 60.0) - 58.0));
      vec2 tie = mod(f, vec2(120.0, 120.0)) - vec2(60.0, 60.0) - 30.0;
      float hole = 1.0 - 0.35 * (1.0 - smoothstep(2.0, 3.5, length(tie)));
      return c * n * seam * hole;
    } else if (k == 3) {
      // trowelled plaster
      return c * (0.95 + 0.08 * vnoise(f * 0.012) + 0.03 * vnoise(f * 0.08));
    }
    return c * (1.0 + (hash(floor(f * 0.5)) - 0.5) * 0.012);
  }

  void main() {
    vec2 f = vUv * uRes;
    int last = uCount - 1;
    float tt = clamp((f.x - uFrameX[0]) / uPxPer, 0.0, float(last));
    int i = int(floor(tt));
    int j = min(i + 1, last);
    float fr = tt - float(i);
    float e = 1.5 / uPxPer;
    float b = smoothstep(0.5 - e, 0.5 + e, fr);
    vec3 baseI = uWall[i];
    vec3 baseJ = uWall[j];
    vec3 base = mix(baseI, baseJ, b);

    // spotlights, each in its own room's color
    vec3 pools = vec3(0.0);
    for (int n = 0; n < N; n++) {
      if (n >= uCount) break;
      float dx = f.x - uFrameX[n];
      vec2 q = vec2(dx / (uFrameHalf.x * 1.55), (f.y - (uFrameCy + uFrameHalf.y * 0.45)) / (uFrameHalf.y * 1.7));
      float pool = exp(-dot(q, q) * 1.5);
      float beamT = clamp((uCeilY - f.y) / max(uCeilY - (uFrameCy + uFrameHalf.y), 1.0), 0.0, 1.0);
      float beamW = mix(8.0, uFrameHalf.x * 1.2, beamT);
      pool += 0.18 * (1.0 - beamT * 0.6) * exp(-pow(dx / beamW, 2.0)) * step(uFrameCy + uFrameHalf.y, f.y);
      pools += uLightC[n] * pool * uLight[n] * uLightP[n];
    }

    vec3 col;
    if (f.y > uFloorY) {
      float h = (f.y - uFloorY) / max(uCeilY - uFloorY, 1.0);
      vec3 w = mix(wallTex(baseI, uPattern[i], f), wallTex(baseJ, uPattern[j], f), b);
      col = w * (1.0 - 0.08 * smoothstep(0.55, 1.2, h));
      col = col * (1.0 + 0.55 * pools) + 0.07 * pools;
      col *= 1.0 - 0.08 * exp(-(f.y - uFloorY) / 26.0); // occlusion at the floor
      if (f.y > uCeilY) col = base * 0.9 - 0.02 * smoothstep(uCeilY, uRes.y, f.y);
      float track = 1.0 - smoothstep(1.5, 2.5, abs(f.y - uCeilY));
      col = mix(col, vec3(0.1), track * 0.85);
      for (int n = 0; n < N; n++) {
        if (n >= uCount) break;
        vec2 c = vec2(uFrameX[n] - uFrameHalf.x * 0.15, uCeilY - 10.0);
        float can = 1.0 - smoothstep(0.85, 1.0, length((f - c) / vec2(7.0, 12.0)));
        col = mix(col, vec3(0.09), can * 0.9);
        float face = 1.0 - smoothstep(0.0, 4.0, length(f - (c + vec2(2.0, -11.0))));
        col += uLightC[n] * face * uLight[n] * 0.8;
      }
      // the partition corner where one room meets the next
      if (i != j) col *= 1.0 - 0.22 * exp(-pow((fr - 0.5) * uPxPer / 5.0, 2.0));
    } else {
      // polished floor, borrowing each room's color, reflecting its light
      float below = uFloorY - f.y;
      float depth = below / max(uFloorY, 1.0);
      // dark rooms get a dark floor; light rooms a pale polished one
      float roomDark = 1.0 - smoothstep(0.12, 0.42, dot(base, vec3(0.299, 0.587, 0.114)));
      col = mix(vec3(0.82, 0.81, 0.79), base * 1.25 + 0.025, mix(0.35, 0.9, roomDark));
      col *= mix(1.0, 0.82, depth);
      col += (hash(floor(f * vec2(0.25, 1.0))) - 0.5) * 0.012;
      for (int n = 0; n < N; n++) {
        if (n >= uCount) break;
        float dx = abs(f.x - uFrameX[n]);
        float fall = exp(-below / (uFrameHalf.y * 0.45));
        float body = 1.0 - smoothstep(uFrameHalf.x * 0.8, uFrameHalf.x * 1.05, dx);
        col -= vec3(0.05) * body * fall * smoothstep(0.0, 6.0, below);
        col += uLightC[n] * 0.06 * uLight[n] * uLightP[n] * exp(-pow(dx / (uFrameHalf.x * 0.9), 2.0)) * fall;
      }
      col *= 1.0 - 0.05 * exp(-below / 5.0);
    }

    // the spotlight: house lights dim, one cone of light holds the piece
    if (uSpot > 0.001) {
      vec2 lamp = vec2(uSpotX - uFrameHalf.x * 0.15, uCeilY - 14.0);
      float span = max(lamp.y - uFloorY, 1.0);
      float t = clamp((lamp.y - f.y) / span, 0.0, 1.0); // 0 at the lamp → 1 at the floor
      float axis = mix(lamp.x, uSpotX, t);
      float halfW = mix(9.0, uSpotHalf.x * 1.4, smoothstep(0.0, 0.7, t));
      float beam = (1.0 - smoothstep(halfW * 0.7, halfW, abs(f.x - axis))) * step(f.y, lamp.y);
      vec2 q = vec2((f.x - uSpotX) / (uSpotHalf.x * 1.24), (f.y - uFrameCy) / (uSpotHalf.y * 1.16));
      float pool = 1.0 - smoothstep(0.7, 1.16, length(q));
      float floorPool = 0.0;
      if (f.y < uFloorY) {
        vec2 fq = vec2((f.x - uSpotX) / (uSpotHalf.x * 1.25), (uFloorY - f.y) / (uSpotHalf.y * 0.32));
        floorPool = 1.0 - smoothstep(0.6, 1.1, length(fq));
      }
      float lit = max(pool, max(beam * 0.5, floorPool * 0.85));
      col *= mix(1.0, mix(0.17, 1.0, lit), uSpot);
      // the beam made visible: haze, drifting dust, a glowing lamp
      float haze = beam * (0.045 + 0.035 * vnoise(vec2(f.x * 0.02, f.y * 0.008 - uTime * 0.12)));
      // dust: sparse soft flecks drifting down through the cone, twinkling
      vec2 g = (f + vec2(sin(uTime * 0.35 + f.y * 0.013) * 7.0, uTime * 9.0)) / 9.0;
      vec2 cell = floor(g);
      vec2 jitter = vec2(hash(cell + 3.1), hash(cell + 9.7)) - 0.5;
      float speck = 1.0 - smoothstep(0.04, 0.11, length(fract(g) - 0.5 - jitter * 0.6));
      float mote = step(0.985, hash(cell)) * speck * (0.35 + 0.65 * sin(uTime * 1.7 + hash(cell + 7.0) * 40.0));
      col += uSpotC * (haze + max(mote, 0.0) * beam * 0.22 * uMotes) * uSpot;
      // dark walls barely show a dimming, so give the pool real light there
      float wallDark = 1.0 - smoothstep(0.1, 0.4, dot(base, vec3(0.299, 0.587, 0.114)));
      col += uSpotC * pool * mix(0.025, 0.085, wallDark) * uSpot;
      col += uSpotC * exp(-length(f - (lamp + vec2(2.0, 3.0))) / 9.0) * 0.6 * uSpot;
      col += uSpotC * floorPool * 0.05 * uSpot;
    }

    vec2 v = vUv - 0.5;
    col *= 1.0 - (0.2 + 0.35 * uSpot) * dot(v, v);
    gl_FragColor = vec4(col, smoothstep(0.0, 0.45, uPresence));
  }
`;

// --------------------------------------------------------------- builders

interface FrameRig {
  root: Group;
  style: PieceStyle;
  outer: Vector2;
  u: Record<string, IUniform>;
  shadowU: Record<string, IUniform>;
  plaqueU: Record<string, IUniform>;
}

function buildHang(
  layout: GalleryLayout,
  pieces: { portrait: string | null; style: PieceStyle }[],
) {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(d: T) => (disposables.push(d), d);
  const loader = new TextureLoader();
  const root = new Group();
  const plaqueGeo = keep(new PlaneGeometry(0.3, 0.18));
  const mat = (frag: string, uniforms: Record<string, IUniform>) =>
    keep(
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: frag,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );

  const frames: FrameRig[] = pieces.map(({ portrait, style }) => {
    const extra = style.border + style.mat;
    const outer = new Vector2(layout.openW + 2 * extra, layout.openH + 2 * extra);
    let tex: Texture | null = null;
    if (portrait) {
      tex = keep(loader.load(portrait));
      tex.colorSpace = ''; // raw sRGB, exactly like the splat composite
      tex.anisotropy = 4;
    }
    const look = lookUniforms();
    setLook(look, style.filter);
    const neon = style.neon ?? ['#000000', '#000000'];
    const u: Record<string, IUniform> = {
      ...look,
      uPortrait: { value: tex },
      uHasPortrait: { value: tex ? 1 : 0 },
      uPortraitAlpha: { value: 1 },
      uSize: { value: outer },
      uOpen: { value: new Vector2(layout.openW, layout.openH) },
      uBorder: { value: style.border },
      uMat: { value: style.mat },
      uKind: { value: FRAME_KIND[style.frame] },
      uFrameColor: { value: v3(style.frameColor) },
      uMatColor: { value: v3(style.matColor) },
      uGround: { value: v3(style.ground) },
      uNeonA: { value: v3(neon[0]) },
      uNeonB: { value: v3(neon[1]) },
      uLightColor: { value: v3(style.light) },
      uFade: { value: 0 },
      uLight: { value: 0 },
      uDim: { value: 1 },
    };
    const frame = new Mesh(keep(new PlaneGeometry(outer.x, outer.y)), mat(FRAME_FRAG, u));
    frame.renderOrder = -10;

    const floating = style.frame === 'float';
    const shadowSize = new Vector2(outer.x + 0.9, outer.y + 0.9);
    const shadowU: Record<string, IUniform> = {
      uSize: { value: shadowSize },
      uRect: { value: new Vector2(outer.x / 2, outer.y / 2) },
      uFade: { value: 0 },
      uSoft: { value: floating ? 0.13 : 0.07 },
      uStrength: { value: floating ? 0.38 : style.dark ? 0.5 : 0.32 },
      uGlow: { value: style.frame === 'neon' ? 0.55 : 0 },
      uNeonA: { value: v3(neon[0]) },
      uNeonB: { value: v3(neon[1]) },
      uDim: u.uDim, // shares the frame's house light
    };
    const shadow = new Mesh(
      keep(new PlaneGeometry(shadowSize.x, shadowSize.y)),
      mat(SHADOW_FRAG, shadowU),
    );
    if (style.frame !== 'neon')
      shadow.position.set(floating ? 0.07 : 0.03, floating ? -0.11 : -0.06, 0);
    shadow.renderOrder = -20;

    const plaqueU = { uFade: { value: 0 }, uDim: u.uDim };
    const plaque = new Mesh(plaqueGeo, mat(PLAQUE_FRAG, plaqueU));
    plaque.position.set(outer.x / 2 + 0.32, -outer.y * 0.18, 0);
    plaque.renderOrder = -10;

    const g = new Group();
    g.add(shadow, frame, plaque);
    for (const m of [frame, shadow, plaque]) m.frustumCulled = false;
    root.add(g);
    return { root: g, style, outer, u, shadowU, plaqueU };
  });

  // the rooms, drawn straight into clip space, behind everything
  const n = Math.min(MAX_FRAMES, pieces.length);
  const pad = <T,>(arr: T[], fill: T) => [...arr, ...new Array(MAX_FRAMES - arr.length).fill(fill)];
  const styles = frames.slice(0, n).map((f) => f.style);
  const backU: Record<string, IUniform> = {
    uPresence: { value: 0 },
    uRes: { value: new Vector2(1, 1) },
    uFloorY: { value: 0 },
    uCeilY: { value: 0 },
    uFrameCy: { value: 0 },
    uFrameHalf: { value: new Vector2(1, 1) },
    uPxPer: { value: 1 },
    uFrameX: { value: new Array(MAX_FRAMES).fill(-1e4) },
    uLight: { value: new Array(MAX_FRAMES).fill(0) },
    uWall: {
      value: pad(
        styles.map((s) => v3(s.wall)),
        new Vector3(),
      ),
    },
    uLightC: {
      value: pad(
        styles.map((s) => v3(s.light)),
        new Vector3(),
      ),
    },
    uLightP: {
      value: pad(
        styles.map((s) => s.lightPower),
        0,
      ),
    },
    uPattern: {
      value: pad(
        styles.map((s) => WALL_PATTERN[s.pattern]),
        0,
      ),
    },
    uCount: { value: n },
    uSpot: { value: 0 },
    uSpotX: { value: 0 },
    uSpotHalf: { value: new Vector2(1, 1) },
    uSpotC: { value: new Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uMotes: { value: 1 },
  };
  const backdrop = new Mesh(
    keep(new PlaneGeometry(2, 2)),
    keep(
      new ShaderMaterial({
        vertexShader: BACKDROP_VERT,
        fragmentShader: BACKDROP_FRAG,
        uniforms: backU,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    ),
  );
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1000;

  return { root, frames, backdrop, backU, dispose: () => disposables.forEach((d) => d.dispose()) };
}

/** Put the live splat's composite back to untouched (details view). */
function restoreComposite() {
  const c = galleryFx.composite;
  c.uOpacity.value = 1;
  c.uClip.value.set(0, 0, 1, 1);
  c.uLookOn.value = 0;
  c.uGlow.value = 0;
  galleryFx.splatOffset = 0;
  galleryFx.tiltX = 0;
  galleryFx.tiltY = 0;
  galleryFx.label.visible = false;
  galleryFx.spot = 0;
}

// -------------------------------------------------------------- component

interface GalleryStageProps {
  entryId: string;
  x: number;
  y: number;
  onExited: () => void;
}

/**
 * The gallery of a model's looks: framed pieces hung along a wall, each in
 * its own room — its own paint, light, frame, mat and photographic
 * treatment. Walking (drag / wheel / keys, see galleryFx) glides the hang
 * sideways. Every frame holds a still of the model in that look, except the
 * one in front of you: there the still gives way to the live splat, dressed
 * in that look and treated like the room's photographs, leaning gently
 * toward the pointer. Entering from the details view the room assembles
 * around the model already on screen; leaving, it melts away again.
 */
export default function GalleryStage({ entryId, x, y, onExited }: GalleryStageProps) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const entry = useMemo(() => entries.find((e) => e.id === entryId)!, [entryId]);
  const layout = useMemo(() => galleryLayout(entry), [entry]);
  const pieces = useMemo(() => galleryPieces(entry), [entry]);
  const hang = useMemo(() => buildHang(layout, pieces), [layout, pieces]);
  useEffect(() => () => hang.dispose(), [hang]);

  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const st = useRef({
    presence: 0,
    exited: false,
    vel: 0,
    phase: 'idle' as 'idle' | 'out' | 'in',
    swap: 1, // live splat's share of the live frame (vs its still)
    dressedAt: 0,
    ready: galleryFx.readyAt > 0 ? 1 : 0,
    spot: 0, // 0 house lights up … 1 the piece in front of you holds the light
    held: 0, // seconds the walk has been still on one piece
    clock: 0,
  });

  // open on the look the model is currently wearing
  useEffect(() => {
    const { worn, look } = useLookStore.getState();
    const garment = worn[captureKey(entry)] ?? 'original';
    const start = Math.max(
      0,
      pieces.findIndex((p) => p.look === look && (look !== 0 || !p.garment || p.garment.id === garment)),
    );
    useGalleryStore.getState().open(pieces.length, start);
  }, [entry, pieces]);
  useEffect(() => restoreComposite, []);

  // pointer → parallax target for the live piece
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.current.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [gl]);

  const tmp = useMemo(() => new Vector3(), []);

  useFrame(({ camera, size }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = st.current;
    const fx = galleryFx;
    const board = useBoardStore.getState();
    const active = board.selectedId === entryId && board.view === 'gallery';
    const { index } = useGalleryStore.getState();

    s.presence = clamp01(s.presence + (active ? dt / ENTER_SECONDS : -dt / EXIT_SECONDS));
    if (!active && s.presence === 0) {
      if (!s.exited) {
        s.exited = true;
        restoreComposite();
        onExited();
      }
      return;
    }
    s.exited = false;
    const pres = s.presence;
    const k = smooth(0, 1, pres); // how much "gallery" the live splat carries

    // walk: critically damped glide to the chosen piece
    if (!fx.dragging) {
      const w = WALK_OMEGA;
      s.vel += (-w * w * (fx.pos - index) - 2 * w * s.vel) * dt;
      fx.pos += s.vel * dt;
      if (Math.abs(fx.pos - index) < 1e-4 && Math.abs(s.vel) < 1e-3) {
        fx.pos = index;
        s.vel = 0;
      }
    } else {
      s.vel = 0;
    }

    // the live splat leaves its old frame and comes alive in the new one
    s.ready = clamp01(s.ready + (fx.readyAt > 0 ? dt / 0.9 : -dt / 0.2));
    const settling = active && !fx.dragging && Math.abs(fx.pos - index) < 0.45;
    if (fx.live !== index && s.phase !== 'out' && settling) s.phase = 'out';
    if (s.phase === 'out') {
      s.swap = Math.max(0, s.swap - dt / SWAP_OUT_S);
      if (s.swap === 0) {
        fx.live = index;
        const piece = pieces[index];
        const looks = useLookStore.getState();
        if (piece?.garment) looks.wear(captureKey(entry), piece.garment.id, true);
        // another capture: it streams in behind the still (s.ready)
        if (piece && piece.look !== looks.look) looks.showLook(piece.look);
        s.dressedAt = performance.now();
        s.phase = 'in';
      }
    } else if (s.phase === 'in') {
      if (fx.live !== index && settling) s.phase = 'out';
      else if (performance.now() - s.dressedAt > DRESS_MS) {
        s.swap = Math.min(1, s.swap + dt / SWAP_IN_S);
        if (s.swap === 1) s.phase = 'idle';
      }
    }
    const liveStyle = pieces[fx.live]?.style ?? pieces[0].style;
    const galleryAlpha = s.swap * s.ready;
    const c = fx.composite;
    c.uOpacity.value = fx.capture ? 1 : 1 + (galleryAlpha - 1) * k;
    setLook(c, liveStyle.filter, fx.capture ? 0 : k);
    c.uGlow.value = liveStyle.neon && !fx.capture ? 0.55 * k * s.swap : 0;
    if (liveStyle.neon) {
      c.uGlowA.value.set(...hexRgb(liveStyle.neon[0]));
      c.uGlowB.value.set(...hexRgb(liveStyle.neon[1]));
    }
    fx.splatOffset = (fx.live - fx.pos) * layout.spacing * k;

    // lean toward the pointer only while settled (stills are straight-on)
    const calm = active && s.phase === 'idle' && !fx.dragging && !fx.capture && !reduced;
    const ease = 1 - Math.exp(-4 * dt);
    fx.tiltY += ((calm ? pointer.current.x * 0.2 : 0) - fx.tiltY) * ease;
    fx.tiltX += ((calm ? pointer.current.y * 0.08 : 0) - fx.tiltX) * ease;

    // the spotlight: once you've stopped in front of a piece (and it's alive
    // in its frame), the house lights slowly go down and a single cone holds
    // it; any walking brings them straight back up
    s.clock += dt;
    const still =
      active &&
      !fx.dragging &&
      !fx.capture &&
      s.phase === 'idle' &&
      fx.live === index &&
      Math.abs(fx.pos - index) < 0.01 &&
      pres > 0.98;
    s.held = still ? s.held + dt : 0;
    s.spot = clamp01(s.spot + (s.held > SPOT_HOLD_S ? dt / SPOT_IN_S : -dt / SPOT_OUT_S));
    const spot = smooth(0, 1, s.spot);
    fx.spot = spot;

    // hang the frames: they drop in and swing to rest, nearest first
    hang.root.visible = !fx.capture;
    hang.backdrop.visible = !fx.capture;
    hang.frames.forEach((f, i) => {
      const rel = i - fx.pos;
      const order = Math.abs(i - index);
      const t = reduced ? (pres > 0.5 ? 1 : 0) : clamp01((pres * 1.7 - 0.2 - order * 0.08) / 0.7);
      const drop = 1 - easeOutBack(t);
      f.root.position.set(rel * layout.spacing, layout.openCy + drop * 0.6, 0);
      f.root.rotation.z = Math.sin(t * 9) * (1 - t) * 0.06;
      const fade = smooth(0, 0.35, t);
      f.u.uFade.value = fade;
      f.shadowU.uFade.value = fade * t;
      const light = reduced ? fade : smooth(0.55, 1, t);
      f.u.uLight.value = light;
      f.u.uPortraitAlpha.value = i === fx.live ? 1 - galleryAlpha * k : 1;
      f.plaqueU.uFade.value = fade * smooth(0.25, 0.7, Math.abs(rel));
      f.u.uDim.value = i === index ? 1 : 1 - HOUSE_DIM * spot;
    });

    // project the hang to screen for the rooms and the wall label
    hang.root.parent?.updateMatrixWorld();
    const toPx = (wx: number, wy: number) => {
      tmp.set(wx, wy, 0).applyMatrix4(hang.root.matrixWorld).project(camera);
      return [((tmp.x + 1) / 2) * size.width, ((tmp.y + 1) / 2) * size.height] as const;
    };
    const [x0Px, cyPx] = toPx(0, layout.openCy);
    const pxPerPiece = toPx(layout.spacing, 0)[0] - toPx(0, 0)[0];
    const pxPerWorld = pxPerPiece / layout.spacing;
    fx.pxPerPiece = pxPerPiece;
    const b = hang.backU;
    b.uPresence.value = fx.capture ? 0 : pres;
    b.uRes.value.set(size.width, size.height);
    b.uFloorY.value = toPx(0, layout.floorY)[1];
    b.uCeilY.value = toPx(0, layout.openCy + layout.maxOuterH / 2 + 0.7)[1];
    b.uFrameCy.value = cyPx;
    b.uFrameHalf.value.set(
      (layout.openW / 2 + 0.25) * pxPerWorld,
      (layout.openH / 2 + 0.25) * pxPerWorld,
    );
    b.uPxPer.value = Math.max(pxPerPiece, 1);
    const xs = b.uFrameX.value as number[];
    const ls = b.uLight.value as number[];
    hang.frames.forEach((f, i) => {
      if (i >= MAX_FRAMES) return;
      xs[i] = x0Px + (i - fx.pos) * pxPerPiece;
      ls[i] = f.u.uLight.value as number;
    });
    const held = hang.frames[index];
    b.uSpot.value = fx.capture ? 0 : spot;
    b.uSpotX.value = x0Px + (index - fx.pos) * pxPerPiece;
    b.uSpotHalf.value.set((held.outer.x / 2) * pxPerWorld, (held.outer.y / 2) * pxPerWorld);
    b.uSpotC.value.set(...hexRgb(held.style.light));
    b.uTime.value = s.clock;
    b.uMotes.value = reduced ? 0 : 1;

    // the live splat is seen through its own frame's opening
    const lx = (fx.live - fx.pos) * layout.spacing;
    const [ax, ay] = toPx(lx - layout.openW / 2, layout.openCy - layout.openH / 2);
    const [bx, by] = toPx(lx + layout.openW / 2, layout.openCy + layout.openH / 2);
    const m = (a: number, z: number) => a + (z - a) * k;
    if (fx.capture) c.uClip.value.set(0, 0, 1, 1);
    else
      c.uClip.value.set(
        m(0, ax / size.width),
        m(0, ay / size.height),
        m(1, bx / size.width),
        m(1, by / size.height),
      );

    // wall label right of the centered frame
    const near = Math.min(hang.frames.length - 1, Math.max(0, Math.round(fx.pos)));
    const nearOuter = hang.frames[near].outer;
    const [rxPx, ryPx] = toPx(
      nearOuter.x / 2 + (near - fx.pos) * layout.spacing,
      layout.openCy + nearOuter.y / 2,
    );
    fx.label.x = rxPx + 28;
    fx.label.y = size.height - ryPx;
    fx.label.below = size.height - (cyPx - (ryPx - cyPx));
    fx.label.visible = active && pres > 0.7 && Math.abs(fx.pos - near) < 0.25 && !fx.capture;

    invalidate(); // the rooms are always gently alive (glide, lean, lights)
  });

  return (
    <group position={[x, y, 0]}>
      <primitive object={hang.backdrop} />
      <primitive object={hang.root} />
    </group>
  );
}
