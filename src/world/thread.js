import * as THREE from 'three';
import { G, FOG, GLOBALS_GLSL, CURSOR_GLSL, FOG_GLSL } from '../core/glsl.js';

/**
 * The red thread: one closed curve running through every chapter. Pulses race along it,
 * a bright "head" marks where the camera is, and the cursor plucks it like a string.
 */
export function createThread(points, { closed = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal', 0.5);
  const length = curve.getLength();
  const geo = new THREE.TubeGeometry(curve, Math.min(9000, Math.floor(length * 3)), 1, 6, closed);
  const uniforms = {
    uColor: { value: new THREE.Color('#ff2a1a').multiplyScalar(3.2) },
    uRadius: { value: 0.022 },
    uMinPx: { value: 9e-4 },
    uLength: { value: length },
    uHead: { value: 0 },
    uHeadAmt: { value: 1 },
    uPluck: { value: 1 },
    uGain: { value: 1 },
    ...G,
    ...FOG,
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uRadius, uMinPx, uLength, uPluck;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      ${GLOBALS_GLSL}
      ${CURSOR_GLSL}
      void main(){
        // the tube is built with radius 1, so position - normal is the centreline
        vec3 center = position - normal;
        float dist = distance(center, cameraPosition);
        float r = max(uRadius, dist * uMinPx);
        float d, along;
        vec3 away = cursorAway(center, d, along);
        float infl = exp(-d * d / (0.5 + along * 0.01)) * smoothstep(140.0, 0.0, along);
        float L = uv.x * uLength;
        float wob = sin(uTime * 34.0 - L * 1.7) * uCursorVel;
        center += away * infl * (0.12 + 0.5 * uCursorVel + wob * 0.25) * uPluck;
        vec3 wp = center + normal * r;
        vUv = uv;
        vWorld = wp;
        vN = normal;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLength, uHead, uHeadAmt, uGain;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      ${GLOBALS_GLSL}
      ${FOG_GLSL}
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float facing = abs(dot(normalize(vN), V));
        float L = vUv.x * uLength;
        float train = pow(0.5 + 0.5 * sin(L * 0.21 - uTime * 4.2), 36.0);
        float fine = pow(0.5 + 0.5 * sin(L * 1.9 - uTime * 11.0), 12.0) * 0.35;
        float hd = (L - uHead) / 7.0;
        float head = exp(-hd * hd) * uHeadAmt;
        float core = pow(facing, 1.6);
        float near = mix(0.35, 1.0, smoothstep(0.6, 5.0, distance(cameraPosition, vWorld)));
        vec3 col = uColor * uGain * near * (0.45 + 1.3 * core) * (1.0 + train * 2.4 + fine + head * 5.0);
        col += vec3(1.0, 0.82, 0.76) * (train * 0.9 + head * 2.5) * core * uGain * near;
        col = applyFog(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  mesh.frustumCulled = false;

  // nearest arc-length to a point, searched locally around the last answer
  const N = 2400;
  const samples = curve.getSpacedPoints(N);
  let last = 0;
  const tmp = new THREE.Vector3();
  return {
    mesh,
    curve,
    length,
    uniforms,
    nearestL(p) {
      let best = Infinity, bi = last;
      for (let k = -260; k <= 260; k++) {
        let i = last + k;
        if (closed) i = (i + N) % N;
        else if (i < 0 || i > N) continue;
        const d = tmp.copy(samples[i]).sub(p).lengthSq();
        if (d < best) { best = d; bi = i; }
      }
      if (best > 900) {
        for (let i = 0; i < N; i += 4) {
          const d = tmp.copy(samples[i]).sub(p).lengthSq();
          if (d < best) { best = d; bi = i; }
        }
      }
      last = bi;
      return (bi / N) * length;
    },
  };
}
