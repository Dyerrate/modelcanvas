import { DataTexture, RGBAFormat, type Texture } from 'three';
import { dyno } from '@sparkjsdev/spark';
import { stageFx } from './stageFx';
import { wardrobeFx } from './wardrobeFx';

/** 1×1 stand-ins so every sampler is bound before a garment is picked. */
const blank = (r: number, g: number, b: number, a: number) => {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat);
  t.needsUpdate = true;
  return t;
};
const WHITE = blank(255, 255, 255, 255);
const CLEAR = blank(0, 0, 0, 0);

type Sampler = ReturnType<typeof dyno.dynoSampler2D>;
let samplers: Record<keyof typeof wardrobeFx.tex, Sampler> | null = null;

/** Point the shader's samplers at wardrobeFx.tex (call after swapping a
 *  texture slot, then mesh.updateVersion()). */
export function bindWardrobeTextures() {
  if (!samplers) return;
  const t = wardrobeFx.tex;
  const set = (s: Sampler, tex: Texture | null, fallback: Texture) => {
    s.value = tex ?? fallback;
    s.uniform.value = s.value; // the material holds this exact uniform object
  };
  set(samplers.baseFrom, t.baseFrom, WHITE);
  set(samplers.printFrom, t.printFrom, CLEAR);
  set(samplers.baseTo, t.baseTo, WHITE);
  set(samplers.printTo, t.printTo, CLEAR);
}

/**
 * Spark object modifier for the "My Looks" try-on. A gaussian splat has no
 * separate garment mesh, so the shirt is found per gaussian — below the
 * neck line and not skin-warm — and re-dyed: the chosen garment's fabric
 * (planar-projected from the front, so stripes and chest prints land where
 * they would on a tee) multiplied by the capture's own relative shading,
 * which keeps the folds and drape of what Sam is actually wearing.
 *
 * Runs before the stage modifier, so a stage's reveal plays over the
 * dyed garment.
 */
export function makeWardrobeModifier() {
  const s = {
    baseFrom: dyno.dynoSampler2D(WHITE as Texture),
    printFrom: dyno.dynoSampler2D(CLEAR as Texture),
    baseTo: dyno.dynoSampler2D(WHITE as Texture),
    printTo: dyno.dynoSampler2D(CLEAR as Texture),
  };
  samplers = s;
  bindWardrobeTextures();

  const up = dyno.dynoVec4(stageFx.uUp);
  const side = dyno.dynoVec4(stageFx.uSide);
  const fwd = dyno.dynoVec4(stageFx.uFwd);
  const wear = dyno.dynoVec4(wardrobeFx.uWear);
  const mask = dyno.dynoVec4(wardrobeFx.uMask);
  const tone = dyno.dynoVec4(wardrobeFx.uTone);
  const map = dyno.dynoVec4(wardrobeFx.uMap);
  const trimFrom = dyno.dynoVec4(wardrobeFx.uTrimFrom);
  const trimTo = dyno.dynoVec4(wardrobeFx.uTrimTo);
  const collar = dyno.dynoVec4(wardrobeFx.uCollar);
  const patchU = dyno.dynoVec4(wardrobeFx.uPatch);

  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    if (!gsplat) throw new Error('wardrobe modifier: no gsplat input');
    const fx = new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        up: 'vec4',
        side: 'vec4',
        fwd: 'vec4',
        wear: 'vec4',
        mask: 'vec4',
        tone: 'vec4',
        map: 'vec4',
        trimFrom: 'vec4',
        trimTo: 'vec4',
        collar: 'vec4',
        patch: 'vec4',
        baseFrom: 'sampler2D',
        printFrom: 'sampler2D',
        baseTo: 'sampler2D',
        printTo: 'sampler2D',
      },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: {
        gsplat,
        up,
        side,
        fwd,
        wear,
        mask,
        tone,
        map,
        trimFrom,
        trimTo,
        collar,
        patch: patchU,
        ...s,
      },
      statements: ({ inputs, outputs }) => {
        const o = outputs.gsplat;
        const i = inputs;
        return `
          ${o} = ${i.gsplat};
          bool wardrobeOn = ${i.wear}.x > 0.0 || ${i.wear}.y > 0.0 || ${i.mask}.w > 0.5;
          if (wardrobeOn && isGsplatActive(${o}.flags)) {
            vec3 L = vec3(
              dot(${o}.center, ${i.side}.xyz) + ${i.side}.w,
              dot(${o}.center, ${i.up}.xyz) + ${i.up}.w,
              dot(${o}.center, ${i.fwd}.xyz) + ${i.fwd}.w);
            vec3 rgb = ${o}.rgba.rgb;
            float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
            float warm = rgb.r - rgb.g;

            // garment = below the neck line and cooler than skin (the knit
            // reads green; even shadowed skin stays r ≥ g)...
            float below = smoothstep(${i.mask}.x, ${i.mask}.x - ${i.mask}.y, L.y);
            float cloth = 1.0 - smoothstep(${i.mask}.z, ${i.mask}.z + 0.04, warm);
            // ...plus the collar ribbing: bright, colour-neutral, in a band
            // following the crew neck — a ring tilted low at the throat
            float collarTop = clamp(${i.collar}.x + ${i.collar}.y * (L.z + 0.25), ${i.collar}.w, ${i.collar}.x);
            float collarBand = smoothstep(collarTop - ${i.collar}.z - 0.02, collarTop - ${i.collar}.z, L.y)
              * (1.0 - smoothstep(collarTop, collarTop + 0.02, L.y));
            float trimZone = smoothstep(${i.tone}.z, ${i.tone}.z + 0.08, lum)
              * (1.0 - smoothstep(0.03, 0.06, abs(warm))) * collarBand;
            // ...plus any logo patch on the captured garment (front only)
            vec2 pd = (L.xy - ${i.patch}.xy) / max(${i.patch}.zw, vec2(1e-4));
            float patchK = (1.0 - smoothstep(0.75, 1.0, length(pd))) * step(0.15, L.z) * step(1e-4, ${i.patch}.z);
            float m = below * max(max(cloth, trimZone), patchK);

            if (${i.mask}.w > 0.5) {
              ${o}.rgba.rgb = mix(rgb, vec3(1.0, 0.0, 1.0), m);
            } else if (m > 0.0) {
              vec2 uv = vec2(${i.map}.x + L.x * ${i.map}.y, ${i.map}.z + L.y * ${i.map}.w);
              float front = smoothstep(${i.tone}.w - 0.04, ${i.tone}.w + 0.04, L.z);

              vec3 fromC = texture(${i.baseFrom}, uv).rgb;
              vec4 fromP = texture(${i.printFrom}, uv);
              fromC = mix(fromC, fromP.rgb, fromP.a * front);
              fromC = mix(fromC, ${i.trimFrom}.rgb, trimZone * ${i.trimFrom}.a);

              vec3 toC = texture(${i.baseTo}, uv).rgb;
              vec4 toP = texture(${i.printTo}, uv);
              toC = mix(toC, toP.rgb, toP.a * front);
              toC = mix(toC, ${i.trimTo}.rgb, trimZone * ${i.trimTo}.a);

              // the wipe runs top-down: above the line wears the new garment
              float side = step(${i.wear}.z, L.y);
              vec3 dye = mix(fromC, toC, side);
              float strength = mix(${i.wear}.x, ${i.wear}.y, side);

              // keep the capture's relative shading (folds, drape, knit)
              float shade = clamp(mix(1.0, lum / ${i.tone}.x, ${i.tone}.y), 0.22, 1.9);
              // shadows multiply; highlights lift toward white instead of
              // blowing a pale fabric out past 1.0
              vec3 lit = shade < 1.0 ? dye * shade : mix(dye, vec3(1.0), (shade - 1.0) * 0.45);
              ${o}.rgba.rgb = mix(rgb, lit, m * strength);

              float seam = ${i.wear}.w * exp(-abs(L.y - ${i.wear}.z) * 70.0);
              ${o}.rgba.rgb += vec3(0.9, 0.95, 1.0) * seam * m;
            }
          }
        `
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
      },
    });
    return { gsplat: fx.outputs.gsplat };
  });
}
