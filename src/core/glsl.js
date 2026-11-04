import * as THREE from 'three';

// Uniforms shared by every custom shader in the world: time, the cursor ray, depth-of-field
// focus and the projection scale points need to size themselves.
export const G = {
  uTime: { value: 0 },
  uRayO: { value: new THREE.Vector3() },
  uRayD: { value: new THREE.Vector3(0, 0, -1) },
  uCursor: { value: new THREE.Vector2() },
  uCursorVel: { value: 0 },
  uFocus: { value: 10 },
  uBokeh: { value: 1 },
  uPixelRatio: { value: 1 },
  uViewH: { value: 1000 },
  uProjScale: { value: 1000 },
};

// Height fog + two glowing point sources that scatter light through it.
export const FOG = {
  uFogColor: { value: new THREE.Color(0) },
  uFogDensity: { value: 0.01 },
  uFogBase: { value: 0 },
  uFogFalloff: { value: 0.02 },
  uFogNoise: { value: 0.5 },
  uGlowPos: { value: new THREE.Vector3() },
  uGlowColor: { value: new THREE.Color(0) },
  uGlowPos2: { value: new THREE.Vector3() },
  uGlowColor2: { value: new THREE.Color(0) },
  uFogTime: G.uTime,
};

export const GLOBALS_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uRayO;
uniform vec3 uRayD;
uniform vec2 uCursor;
uniform float uCursorVel;
uniform float uFocus;
uniform float uBokeh;
uniform float uPixelRatio;
uniform float uViewH;
uniform float uProjScale;
`;

export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogBase;
uniform float uFogFalloff;
uniform float uFogNoise;
uniform vec3 uGlowPos;
uniform vec3 uGlowColor;
uniform vec3 uGlowPos2;
uniform vec3 uGlowColor2;
uniform float uFogTime;

float fogHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fogNoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fogHash(i), fogHash(i + vec3(1,0,0)), f.x), mix(fogHash(i + vec3(0,1,0)), fogHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fogHash(i + vec3(0,0,1)), fogHash(i + vec3(1,0,1)), f.x), mix(fogHash(i + vec3(0,1,1)), fogHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// analytic transmittance through exponential height fog, broken up by drifting noise near the lens
float fogTransmittance(vec3 ro, vec3 p){
  vec3 rd = p - ro;
  float dist = length(rd);
  rd /= max(dist, 1e-4);
  float b = max(uFogFalloff, 1e-4);
  float e0 = exp(clamp(-(ro.y - uFogBase) * b, -30.0, 5.0));
  float k = rd.y * b;
  float kd = clamp(dist * k, -12.0, 60.0);
  float integral = abs(k) > 1e-5 ? e0 * (1.0 - exp(-kd)) / k : e0 * dist;
  float n = 1.0;
  if (uFogNoise > 0.0) {
    vec3 q = p * 0.05 + vec3(uFogTime * 0.013, -uFogTime * 0.021, uFogTime * 0.017);
    float nn = fogNoise(q) * 0.65 + fogNoise(q * 2.63 + 3.1) * 0.35;
    n = mix(1.0, 0.25 + nn * 1.5, uFogNoise * smoothstep(420.0, 40.0, dist));
  }
  return exp(-uFogDensity * max(integral, 0.0) * n);
}

// in-scattering from a point light along the view ray (closed form)
vec3 fogScatter(vec3 ro, vec3 p, vec3 L, vec3 col){
  vec3 rd = p - ro;
  float dist = length(rd);
  rd /= max(dist, 1e-4);
  vec3 q = ro - L;
  float bq = dot(rd, q);
  float h2 = max(dot(q, q) - bq * bq, 0.04);
  float s = inversesqrt(h2);
  return col * (s * (atan((dist + bq) * s) - atan(bq * s))) * exp(-sqrt(h2) * 0.045);
}

vec3 applyFog(vec3 col, vec3 p){
  float T = fogTransmittance(cameraPosition, p);
  vec3 c = mix(uFogColor, col, T);
  c += fogScatter(cameraPosition, p, uGlowPos, uGlowColor);
  c += fogScatter(cameraPosition, p, uGlowPos2, uGlowColor2);
  return c;
}
`;

export const NOISE_GLSL = /* glsl */ `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1)), h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

// Ashima simplex noise
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * snoise(p); p = p * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; } return s; }
float fbm5(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * snoise(p); p = p * 2.01 + vec3(7.1, 13.7, 3.2); a *= 0.5; } return s; }
float vfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.07 + vec3(5.3, 1.7, 8.9); a *= 0.5; } return s / 0.9375; }
`;

// Closest-approach of a world point to the cursor ray: lets anything in the world flinch from the pointer.
export const CURSOR_GLSL = /* glsl */ `
vec3 cursorAway(vec3 wp, out float dist, out float along){
  vec3 toP = wp - uRayO;
  along = max(dot(toP, uRayD), 0.0);
  vec3 cp = uRayO + uRayD * along;
  vec3 away = wp - cp;
  dist = length(away);
  return away / max(dist, 1e-4);
}
`;

// Bump-map a normal from a procedural height using screen-space derivatives.
export const BUMP_GLSL = /* glsl */ `
vec3 perturbNormalH(vec3 surf_pos, vec3 surf_norm, float h){
  vec3 vSigmaX = dFdx(surf_pos);
  vec3 vSigmaY = dFdy(surf_pos);
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec2 dHdxy = vec2(dFdx(h), dFdy(h));
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

// Replace three's fog with the height fog above, for every built-in material that has fog on.
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif
`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
  ${FOG_GLSL}
#endif
`;
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogWorldPos);
#endif
`;
THREE.Material.prototype.onBeforeCompile = function (shader) {
  Object.assign(shader.uniforms, FOG);
};

/** Insert `code` right after (or before) an `#include` anchor. */
export const inject = (src, anchor, code, after = true) =>
  src.replace(anchor, after ? `${anchor}\n${code}` : `${code}\n${anchor}`);

let patchId = 0;
/**
 * Patch a built-in material: shared uniforms + noise/cursor helpers everywhere, plus
 * optional vertex/fragment rewrites. Mirrors onBeforeCompile with a stable cache key.
 */
export function patchMaterial(mat, { uniforms = {}, vertex, fragment, key } = {}) {
  const id = key || `patch-${patchId++}`;
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FOG, G, uniforms);
    if (vertex) shader.vertexShader = vertex(shader.vertexShader);
    if (fragment) shader.fragmentShader = fragment(shader.fragmentShader);
    const head = `${GLOBALS_GLSL}\n${NOISE_GLSL}\n${CURSOR_GLSL}\n`;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${head}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${head}\n${BUMP_GLSL}`);
  };
  mat.customProgramCacheKey = () => id;
  return mat;
}

// Shared vertex shader for simple world-space quads.
export const WORLD_VERT = /* glsl */ `varying vec2 vUv; varying vec3 vWorld; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
