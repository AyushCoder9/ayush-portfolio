import * as THREE from 'three';
import { G, FOG, GLOBALS_GLSL, NOISE_GLSL, FOG_GLSL } from './glsl.js';
import { rng } from './util.js';

/** Gradient sky with a domain-warped nebula that parts around the cursor, plus a star field. */
export function createSky() {
  const u = {
    uSkyTop: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSkyBottom: { value: new THREE.Color() },
    uNebA: { value: new THREE.Color() },
    uNebB: { value: new THREE.Color() },
    uNebAmt: { value: 0.5 },
    uSkyFog: { value: 0.3 },
    uHorizonY: { value: 0 },
    uSkyK: { value: 3 },
    ...FOG,
    ...G,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSkyTop, uSkyHorizon, uSkyBottom, uNebA, uNebB;
      uniform float uNebAmt, uSkyFog, uHorizonY, uSkyK;
      ${GLOBALS_GLSL}
      ${NOISE_GLSL}
      ${FOG_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y - uHorizonY;
        vec3 col = y > 0.0
          ? mix(uSkyHorizon, uSkyTop, 1.0 - exp(-y * uSkyK))
          : mix(uSkyHorizon, uSkyBottom, 1.0 - exp(y * uSkyK * 1.6));
        if (uNebAmt > 0.001) {
          vec3 q = d * 1.65;
          float cd = max(dot(d, uRayD), 0.0);
          q -= uRayD * pow(cd, 10.0) * 0.28 * (0.4 + uCursorVel);
          q += vec3(uTime * 0.0035, uTime * 0.001, uTime * 0.002);
          vec3 w = vec3(fbm3(q + 1.7), fbm3(q + 9.2), fbm3(q + 4.4));
          float n = fbm5(q * 1.25 + w * 1.7);
          float neb = smoothstep(-0.15, 0.8, n);
          neb = neb * neb * (0.55 + 0.45 * smoothstep(-0.2, 0.5, w.y));
          vec3 nc = mix(uNebA, uNebB, smoothstep(-0.25, 0.45, w.x));
          float fil = pow(max(1.0 - abs(fbm3(q * 3.1 + w * 2.2)), 0.0), 7.0);
          col += nc * (neb * 1.4 + fil * 0.5) * uNebAmt;
          col *= 1.0 - smoothstep(0.15, 0.7, fbm3(q * 2.3 - w * 1.3)) * 0.6 * uNebAmt;
        }
        col = mix(col, uFogColor, uSkyFog * (1.0 - smoothstep(0.0, 0.55, abs(y))));
        vec3 far = cameraPosition + d * 1800.0;
        col += fogScatter(cameraPosition, far, uGlowPos, uGlowColor);
        col += fogScatter(cameraPosition, far, uGlowPos2, uGlowColor2);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;

  const N = 5200;
  const r = rng(7);
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    pos[i * 3] = Math.cos(a) * s;
    pos[i * 3 + 1] = z;
    pos[i * 3 + 2] = Math.sin(a) * s;
    seed[i * 2] = r();
    seed[i * 2 + 1] = r() ** 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const su = { uStars: { value: 1 }, uHorizonY: u.uHorizonY, ...G };
  const stars = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: su,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec2 aSeed;
      varying float vA;
      varying vec3 vCol;
      uniform float uStars, uHorizonY;
      ${GLOBALS_GLSL}
      void main(){
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position * 10.0, 1.0);
        gl_Position = p.xyww;
        float tw = 0.65 + 0.35 * sin(uTime * (1.0 + aSeed.x * 3.0) + aSeed.x * 40.0);
        float big = aSeed.y;
        gl_PointSize = (1.0 + big * 3.2) * uPixelRatio;
        vA = uStars * tw * (0.35 + big * 2.2) * smoothstep(-0.08, 0.12, position.y - uHorizonY * 0.5);
        vCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), aSeed.x);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying vec3 vCol;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vCol * vA * a * 3.0, 1.0);
      }`,
  }));
  stars.frustumCulled = false;
  stars.renderOrder = -999;

  const group = new THREE.Group();
  group.add(dome, stars);
  return {
    group,
    update(camera, L) {
      group.position.copy(camera.position);
      u.uSkyTop.value.copy(L.skyTop);
      u.uSkyHorizon.value.copy(L.skyHorizon);
      u.uSkyBottom.value.copy(L.skyBottom);
      u.uNebA.value.copy(L.nebA);
      u.uNebB.value.copy(L.nebB);
      u.uNebAmt.value = L.nebAmt;
      u.uSkyFog.value = L.skyFog;
      u.uHorizonY.value = L.horizonY;
      u.uSkyK.value = L.skyK;
      su.uStars.value = L.stars;
      stars.visible = L.stars > 0.01;
    },
  };
}
