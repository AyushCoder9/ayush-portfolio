import * as THREE from 'three';

// One "look" per chapter (sky, fog, light, lens, grade). The camera blends between them.

const BASE = {
  skyTop: '#000000', skyHorizon: '#000000', skyBottom: '#000000', skyMul: 1, horizonY: 0, skyK: 3,
  nebA: '#000000', nebB: '#000000', nebAmt: 0, skyFog: 0.3, stars: 0,
  fogColor: '#000000', fogMul: 1, fogDensity: 0.01, fogFalloff: 0.05, fogBase: 0, fogNoise: 0.5,
  glowMul: 1, hemiSky: '#ffffff', hemiGround: '#000000', hemi: 0.3, env: 0.3,
  exposure: 1, contrast: 1.04, saturation: 1, lift: [0, 0, 0], gain: [1, 1, 1], tint: [1, 1, 1],
  bloom: 0.9, threshold: 1, knee: 0.6, bloomRadius: 1, streak: 0.3, streakThreshold: 1.2, streakTint: '#ff5040',
  dirt: 0.6, aperture: 5, farMax: 4, nearMax: 12, maxRadius: 10, ca: 0.003, lens: 0.05, fbm: 0.001,
  grain: 0.07, vignette: 0.55, letterbox: 0, dust: '#ffffff', dustAmt: 0.8, dustSize: 1, chips: 1,
};

const CHAPTER_LOOKS = [
  // 01 origin — deep space, teal nebula, red laser
  {
    skyTop: '#010204', skyHorizon: '#081116', skyBottom: '#04080a', horizonY: -0.12,
    nebA: '#10323d', nebB: '#3c0b0e', nebAmt: 0.6, skyFog: 0.02, stars: 1,
    fogColor: '#05080a', fogDensity: 0.0012, fogFalloff: 0.01, fogBase: -40, fogNoise: 0.1,
    hemiSky: '#5f7f8e', hemiGround: '#050505', hemi: 0.18, env: 0.18,
    exposure: 1, contrast: 1.07, saturation: 1.03, lift: [0.004, 0.008, 0.012],
    bloom: 1.05, threshold: 0.85, streak: 0.55, streakThreshold: 1, streakTint: '#ff4a38', dirt: 0.9,
    aperture: 5, farMax: 2.2, nearMax: 12, ca: 0.0036, lens: 0.06, fbm: 9e-4, grain: 0.075, vignette: 0.62,
    dust: '#a9bec8', dustAmt: 0.9,
  },
  // 02 memory — green night-vision, fog, the old artefact
  {
    skyTop: '#010302', skyHorizon: '#07170c', skyBottom: '#020604', horizonY: -0.05,
    nebA: '#0e3b1d', nebB: '#05180f', nebAmt: 0.22, skyFog: 0.45, stars: 0.18,
    fogColor: '#081a0e', fogDensity: 0.028, fogFalloff: 0.1, fogBase: 0.5, fogNoise: 0.85,
    hemiSky: '#4d8a5c', hemiGround: '#040704', hemi: 0.14, env: 0.2,
    exposure: 1.05, contrast: 1.08, lift: [0, 0.012, 0.004],
    bloom: 0.9, threshold: 1, streak: 0.22, streakTint: '#66ff99', dirt: 0.6,
    aperture: 6, farMax: 5, nearMax: 12, ca: 0.003, lens: 0.05, fbm: 8e-4, grain: 0.085, vignette: 0.66,
    dust: '#9fe0ab', dustAmt: 0.9,
  },
  // 03 refraction — volcanic dusk, the glass frame
  {
    skyTop: '#070102', skyHorizon: '#d23a18', skyBottom: '#1c0503', skyMul: 1.1, horizonY: -0.01, skyK: 7,
    nebA: '#3a0705', nebB: '#7a1606', nebAmt: 0.1, skyFog: 0.12, stars: 0.05,
    fogColor: '#3a0904', fogDensity: 0.016, fogFalloff: 0.2, fogBase: -0.5, fogNoise: 0.5,
    hemiSky: '#ff8a55', hemiGround: '#1a0503', hemi: 0.45, env: 0.7,
    exposure: 1, contrast: 1.05, saturation: 1.06, lift: [0.012, 0, 0],
    bloom: 0.8, threshold: 1.1, streak: 0.2, streakTint: '#ffb080', dirt: 0.5,
    aperture: 5, farMax: 4, nearMax: 12, ca: 0.0042, lens: 0.05, fbm: 0.0026, grain: 0.07, vignette: 0.55,
    dust: '#ffb070', dustAmt: 1,
  },
  // 04 work — black stage, iridescent panels
  {
    skyTop: '#000000', skyHorizon: '#050506', skyBottom: '#000000', horizonY: -0.08,
    nebA: '#141416', nebB: '#08080a', nebAmt: 0.3, skyFog: 0.05, stars: 0,
    fogColor: '#030304', fogDensity: 0.012, fogFalloff: 0.05, fogBase: -6, fogNoise: 0.4,
    hemiSky: '#3c3c48', hemiGround: '#000000', hemi: 0.07, env: 0.16,
    exposure: 1, contrast: 1.12, saturation: 1, lift: [0, 0, 0],
    bloom: 0.9, threshold: 1.15, knee: 0.3, streak: 0.18, streakThreshold: 1.5, streakTint: '#d8d0ff', dirt: 0.4,
    aperture: 5, farMax: 3, nearMax: 12, ca: 0.0024, lens: 0.05, fbm: 0.001, grain: 0.06, vignette: 0.7,
    dust: '#7a7a82', dustAmt: 0, chips: 0,
  },
  // 05 threshold — moonlit dunes, the red door
  {
    skyTop: '#353b41', skyHorizon: '#7d858b', skyBottom: '#15171a', horizonY: -0.03,
    nebA: '#2a3038', nebB: '#3a1c1c', nebAmt: 0.1, skyFog: 0.3, stars: 0.95,
    fogColor: '#596168', fogDensity: 0.006, fogFalloff: 0.06, fogBase: -4, fogNoise: 0.45,
    hemiSky: '#8a939c', hemiGround: '#050505', hemi: 0.3, env: 0.2,
    exposure: 1, contrast: 1.1, lift: [0, 0, 0.004],
    bloom: 1, threshold: 1, streak: 0.5, streakTint: '#ff3020', dirt: 0.7,
    aperture: 4, farMax: 2.5, nearMax: 10, ca: 0.003, lens: 0.05, fbm: 0.0014, grain: 0.08, vignette: 0.6,
    dust: '#c8ccd0', dustAmt: 0.6,
  },
  // 06 network — red cathedral of cables
  {
    skyTop: '#050000', skyHorizon: '#2c0301', skyBottom: '#070000', nebAmt: 0, stars: 0, skyFog: 0.85,
    fogColor: '#3c0502', fogDensity: 0.04, fogFalloff: 0.03, fogBase: 0, fogNoise: 0.9,
    hemiSky: '#ff2a18', hemiGround: '#000000', hemi: 0.15, env: 0.15,
    exposure: 1.05, contrast: 1.12, saturation: 1.1, lift: [0.012, 0, 0],
    bloom: 1.1, threshold: 0.8, streak: 0.35, streakTint: '#ff4030', dirt: 0.8,
    aperture: 6, farMax: 6, nearMax: 12, ca: 0.005, lens: 0.06, fbm: 0.0016, grain: 0.09, vignette: 0.7,
    dust: '#ff6a55', dustAmt: 1,
  },
  // finale — back out to space, the whole thread visible
  {
    skyTop: '#010204', skyHorizon: '#0a0d12', skyBottom: '#030405', horizonY: -0.2,
    nebA: '#122c38', nebB: '#3d0c10', nebAmt: 0.75, skyFog: 0.1, stars: 1,
    fogColor: '#0a0e12', fogDensity: 0.0011, fogFalloff: 0.004, fogBase: -200, fogNoise: 0.2,
    hemiSky: '#6a7f8a', hemiGround: '#050505', hemi: 0.55, env: 0.3,
    exposure: 1.1, contrast: 1.06, lift: [0.004, 0.006, 0.01],
    bloom: 1.2, threshold: 0.8, streak: 0.5, streakThreshold: 0.9, streakTint: '#ff4a38', dirt: 0.9,
    aperture: 2.5, farMax: 1.5, nearMax: 8, ca: 0.004, lens: 0.07, fbm: 8e-4, grain: 0.07, vignette: 0.65,
    dust: '#a9bec8', dustAmt: 0.5,
  },
];

const COLOR_KEYS = ['skyTop', 'skyHorizon', 'skyBottom', 'nebA', 'nebB', 'fogColor', 'hemiSky', 'hemiGround', 'streakTint', 'dust'];
const VEC_KEYS = ['lift', 'gain', 'tint'];

function build(overrides) {
  const raw = { ...BASE, ...overrides };
  const out = {};
  for (const k of Object.keys(raw)) {
    out[k] = COLOR_KEYS.includes(k) ? new THREE.Color(raw[k])
      : VEC_KEYS.includes(k) ? new THREE.Vector3(...raw[k])
      : raw[k];
  }
  for (const k of ['skyTop', 'skyHorizon', 'skyBottom']) out[k].multiplyScalar(raw.skyMul);
  out.fogColor.multiplyScalar(raw.fogMul);
  return out;
}

export const LOOKS = CHAPTER_LOOKS.map(build);
export const makeLook = () => build({});

/** out = mix(a, b, t), field by field. */
export function mixLooks(a, b, t, out) {
  for (const k in out) {
    const x = a[k], y = b[k];
    if (x instanceof THREE.Color) out[k].copy(x).lerp(y, t);
    else if (x instanceof THREE.Vector3) out[k].lerpVectors(x, y, t);
    else if (typeof x === 'number') out[k] = x + (y - x) * t;
  }
  return out;
}
