import * as THREE from 'three';
import { G, FOG, GLOBALS_GLSL, NOISE_GLSL, CURSOR_GLSL, FOG_GLSL } from '../core/glsl.js';
import { rng } from '../core/util.js';

// Point sprites with physical bokeh: out-of-focus motes grow and dim like real lens blur.
// Four motions: wrap (infinite box around the camera), float, rise (spiral column), swirl.

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uMode, uBox, uSize, uAmt, uSpeed, uHeight, uRepel, uBokehAmt, uTwinkle;
uniform vec3 uCenter, uSpread, uCamPos;
varying float vA;
varying vec3 vWorld;
varying float vSeed;
${GLOBALS_GLSL}
${NOISE_GLSL}
${CURSOR_GLSL}
void main(){
  vec3 wp;
  float t = uTime * uSpeed;
  float fade = 1.0;
  if (uMode < 0.5) {
    vec3 drift = vec3(0.0, t * 0.012 * (0.4 + aSeed.x), t * 0.006) + vec3(sin(t * 0.21 + aSeed.y * 6.28), cos(t * 0.17 + aSeed.z * 6.28), sin(t * 0.13 + aSeed.w * 6.28)) * 0.004;
    vec3 local = fract(position + drift - uCamPos / uBox) - 0.5;
    wp = uCamPos + local * uBox;
    vec3 al = abs(local) * 2.0;
    fade = 1.0 - smoothstep(0.75, 1.0, max(al.x, max(al.y, al.z)));
  } else if (uMode < 1.5) {
    vec3 off = (position - 0.5) * 2.0 * uSpread;
    off += vec3(sin(t * 0.3 + aSeed.y * 6.28), sin(t * 0.23 + aSeed.z * 6.28), cos(t * 0.27 + aSeed.w * 6.28)) * (0.3 + aSeed.x * 0.6);
    wp = (modelMatrix * vec4(uCenter + off, 1.0)).xyz;
  } else if (uMode < 2.5) {
    float h = fract(position.y + t * 0.05 * (0.5 + aSeed.x));
    float ang = position.x * 6.2831 + t * 0.2 * (aSeed.y - 0.5) + h * 2.0;
    float rad = sqrt(position.z) * uSpread.x;
    vec3 off = vec3(cos(ang) * rad, h * uHeight, sin(ang) * rad * uSpread.z / max(uSpread.x, 0.001));
    off.x += snoise(vec3(h * 3.0, aSeed.y * 10.0, t * 0.2)) * 0.6;
    off.z += snoise(vec3(h * 3.0, aSeed.z * 10.0, t * 0.2 + 3.0)) * 0.6;
    wp = (modelMatrix * vec4(uCenter + off, 1.0)).xyz;
    fade = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.7, h);
  } else {
    float ang = position.x * 6.2831 + t * (0.15 + aSeed.x * 0.35);
    float rad = mix(0.25, 1.0, position.z) * uSpread.x;
    float yy = (position.y - 0.5) * 2.0 * uSpread.y + sin(t * 0.7 + aSeed.w * 6.28) * 0.3;
    vec3 off = vec3(cos(ang) * rad, yy, sin(ang) * rad);
    wp = (modelMatrix * vec4(uCenter + off, 1.0)).xyz;
  }
  float dist, along;
  vec3 away = cursorAway(wp, dist, along);
  float infl = exp(-dist * dist / (0.9 + along * 0.02)) * smoothstep(90.0, 0.0, along);
  wp += away * infl * uRepel * (0.6 + uCursorVel * 1.8);
  wp.y += infl * uRepel * 0.25 * sin(uTime * 3.0 + aSeed.x * 20.0);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float z = max(-mv.z, 0.01);
  float coc = abs(1.0 - uFocus / z);
  float bokeh = 1.0 + min(coc * 7.0 * uBokehAmt * uBokeh, 22.0);
  float worldSize = uSize * (0.35 + aSeed.x * aSeed.x * 1.6);
  float px = worldSize * uProjScale / z;
  gl_PointSize = clamp(px * bokeh, 1.2 * uPixelRatio, 90.0 * uPixelRatio);
  float tw = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (2.0 + aSeed.y * 5.0) + aSeed.z * 50.0));
  float sizeLoss = px * bokeh / max(gl_PointSize, 1e-3);
  vA = uAmt * fade * tw * smoothstep(0.25, 1.4, z) / (bokeh * bokeh * 0.55 + 0.45) * min(1.0, sizeLoss * 1.5);
  vWorld = wp;
  vSeed = aSeed.w;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColor2;
varying float vA;
varying vec3 vWorld;
varying float vSeed;
${FOG_GLSL}
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = smoothstep(1.0, 0.72, d);
  float rim = smoothstep(0.55, 0.95, d) * disc;
  float a = disc * (0.75 + rim * 0.6);
  vec3 col = mix(uColor, uColor2, vSeed);
  col *= vA * a * fogTransmittance(cameraPosition, vWorld);
  if (col.r + col.g + col.b < 0.0005) discard;
  gl_FragColor = vec4(col, 1.0);
}
`;

const MODES = { wrap: 0, float: 1, rise: 2, swirl: 3 };

export function createParticles(o = {}) {
  const n = o.count ?? 2000;
  const r = rng(o.seed ?? 11);
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r();
    seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const uniforms = {
    uMode: { value: MODES[o.mode ?? 'float'] },
    uBox: { value: o.box ?? 60 },
    uSize: { value: o.size ?? 0.03 },
    uAmt: { value: o.amount ?? 1 },
    uSpeed: { value: o.speed ?? 1 },
    uHeight: { value: o.height ?? 10 },
    uRepel: { value: o.repel ?? 1.4 },
    uBokehAmt: { value: o.bokeh ?? 1 },
    uTwinkle: { value: o.twinkle ?? 0.3 },
    uCenter: { value: new THREE.Vector3(...(o.center ?? [0, 0, 0])) },
    uSpread: { value: new THREE.Vector3(...(o.spread ?? [10, 10, 10])) },
    uCamPos: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color(o.color ?? '#ffffff').multiplyScalar(o.intensity ?? 1) },
    uColor2: { value: new THREE.Color(o.color2 ?? o.color ?? '#ffffff').multiplyScalar(o.intensity ?? 1) },
    ...G,
    ...FOG,
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  return { points, uniforms, material };
}
