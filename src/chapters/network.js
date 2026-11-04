import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chapter } from '../world/chapter.js';
import { createClouds, tubeAlong } from '../world/fx.js';
import { createParticles } from '../world/particles.js';
import { patchMaterial, inject, G, FOG, GLOBALS_GLSL, NOISE_GLSL, FOG_GLSL, WORLD_VERT } from '../core/glsl.js';
import { rng } from '../core/util.js';
import { PROJECTS, MORE_WORK } from '../data.js';

// 5x7 dot-matrix font, one row bitmask per line
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12], '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0], '/': [0, 1, 2, 4, 8, 16, 0],
  '>': [8, 4, 2, 1, 2, 4, 8], '·': [0, 0, 0, 4, 0, 0, 0], '+': [0, 4, 4, 31, 4, 4, 0], '%': [24, 25, 2, 4, 8, 19, 3], ' ': [0, 0, 0, 0, 0, 0, 0],
};

/** Text written top-to-bottom as a 7-wide column of dots, as a texture. */
function verticalText(str) {
  const chars = [...str.toUpperCase()];
  const rows = chars.length * 9;
  const data = new Uint8Array(7 * rows);
  chars.forEach((ch, c) => {
    const glyph = FONT[ch] || FONT[' '];
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (glyph[y] & (1 << (4 - x))) {
          const row = rows - 1 - (c * 9 + 1 + y);
          data[row * 7 + (x + 1)] = 255;
        }
      }
    }
  });
  const tex = new THREE.DataTexture(data, 7, rows, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return { tex, rows };
}

const names = PROJECTS.map((p) => p.name).join(' · ');
const TICKER = [
  'ONE THREAD · ONE THREAD · ',
  'ORIGIN > MEMORY > REFRACTION > ',
  'WORK · THRESHOLD · NETWORK · ',
  'NETWORK 06 · ALL CONNECTED · ',
  'SIGNAL 001 · 002 · 003 · ',
  `${names} · `,
  `${MORE_WORK.join(' · ')} · `,
  'EVERYTHING IS CONNECTED · ',
  'AYUSH KUMAR SINGH · PUNE · ',
  'FOLLOW THE RED LINE · ',
  'TOP 2% · 134421 · AMAZON ML · ',
  'THE THREAD HOLDS · ',
];

/** 06 — a red hall hung with thousands of cables, LED tickers, and a ringed platform. */
export function buildNetwork(world) {
  const ch = new Chapter({ id: 'network', index: 5, origin: world.layout.network, yaw: world.layout.networkYaw });
  const r = rng(700);
  const hub = new THREE.Vector3(0, 0, -8);
  const cables = [];
  const addCable = (curve, weight, seed, live, radius, segments) => {
    const g = tubeAlong(curve, { segments, radial: 5, radius: () => radius });
    const n = g.attributes.position.count;
    const uv = g.attributes.uv;
    const aW = new Float32Array(n);
    const aSeed = new Float32Array(n * 2);
    const aL = new Float32Array(n);
    const len = curve.getLength();
    for (let i = 0; i < n; i++) {
      const t = uv.getX(i);
      aW[i] = weight(t);
      aSeed[i * 2] = seed;
      aSeed[i * 2 + 1] = live;
      aL[i] = t * len;
    }
    g.setAttribute('aW', new THREE.BufferAttribute(aW, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 2));
    g.setAttribute('aL', new THREE.BufferAttribute(aL, 1));
    g.deleteAttribute('uv');
    cables.push(g);
  };
  // hanging cables, fixed at the ceiling, free at the end
  for (let i = 0; i < 300; i++) {
    const a = r() * Math.PI * 2, d = 2.2 + r() ** 0.7 * 34;
    const x = hub.x + Math.cos(a) * d, z = hub.z + Math.sin(a) * d * 1.2;
    const len = 14 + r() * 30;
    const kink = new THREE.Vector3((r() - 0.5) * 1.2, 0, (r() - 0.5) * 1.2);
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push(new THREE.Vector3(x + kink.x * t * t, 34 - len * t, z + kink.z * t * t));
    }
    addCable(new THREE.CatmullRomCurve3(pts), (t) => t * t, r(), r() < 0.28 ? 1 : 0, 0.028 + r() * 0.05, 22);
  }
  // swags between two ceiling points
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 4 + r() * 30;
    const A = new THREE.Vector3(hub.x + Math.cos(a) * d, 34 - r() * 4, hub.z + Math.sin(a) * d);
    const b = a + (r() - 0.5) * 1.2, e = d + (r() - 0.5) * 10;
    const B = new THREE.Vector3(hub.x + Math.cos(b) * e, 34 - r() * 4, hub.z + Math.sin(b) * e);
    const sag = 6 + r() * 18;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const p = A.clone().lerp(B, t);
      p.y -= sag * 4 * t * (1 - t);
      pts.push(p);
    }
    addCable(new THREE.CatmullRomCurve3(pts), (t) => Math.sin(Math.PI * t), r(), r() < 0.35 ? 1 : 0, 0.03 + r() * 0.04, 34);
  }
  const cableU = { uPulseCol: { value: new THREE.Color('#ff3a24').multiplyScalar(5) } };
  const cableMesh = new THREE.Mesh(mergeGeometries(cables), patchMaterial(new THREE.MeshStandardMaterial({ color: '#0b0707', roughness: 0.34, metalness: 0.55 }), {
    key: 'cables',
    uniforms: cableU,
    vertex: (src) => inject(inject(src, '#include <common>', 'attribute float aW; attribute vec2 aSeed; attribute float aL; varying float vL; varying vec2 vSeed;'), '#include <begin_vertex>', /* glsl */ `
        vec3 wq = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vec3 sway = vec3(snoise(vec3(aSeed.x * 40.0, uTime * 0.18, 0.0)), 0.0, snoise(vec3(aSeed.x * 40.0, uTime * 0.18, 5.0))) * 0.7;
        sway += vec3(sin(uTime * 0.9 + aSeed.x * 30.0 + transformed.y * 0.15), 0.0, cos(uTime * 0.7 + aSeed.x * 20.0)) * 0.12;
        float cd, ca;
        vec3 away = cursorAway(wq, cd, ca);
        float infl = exp(-cd * cd / (1.6 + ca * 0.02)) * smoothstep(80.0, 0.0, ca);
        vec3 toCam = wq - cameraPosition;
        float dc = length(toCam.xz);
        vec3 camPush = vec3(toCam.x, 0.0, toCam.z) / max(dc, 1e-3) * exp(-dc * dc / 14.0) * 3.2;
        vec3 wdisp = sway + vec3(away.x, 0.0, away.z) * infl * (1.2 + uCursorVel * 2.5) + camPush;
        transformed += transpose(mat3(modelMatrix)) * wdisp * aW;
        vL = aL; vSeed = aSeed;
      `),
    fragment: (src) => inject(inject(src, '#include <common>', 'varying float vL; varying vec2 vSeed; uniform vec3 uPulseCol;'), '#include <emissivemap_fragment>', `
        float sp = 3.0 + vSeed.x * 5.0;
        float pl = pow(fract(vL * 0.08 - uTime * sp * 0.08 + vSeed.x * 7.0), 18.0);
        float pl2 = pow(fract(vL * 0.21 - uTime * 0.9 + vSeed.x * 3.0), 40.0) * 0.6;
        totalEmissiveRadiance += uPulseCol * (pl + pl2) * vSeed.y;
      `),
  }));
  cableMesh.frustumCulled = false;
  cableMesh.castShadow = true;
  ch.group.add(cableMesh);

  const steel = new THREE.MeshStandardMaterial({ color: '#0d0909', roughness: 0.6, metalness: 0.5 });
  const beams = [];
  for (let i = -3; i <= 3; i++) {
    const a = new THREE.BoxGeometry(0.5, 0.5, 90);
    a.translate(i * 10 + hub.x, 34.6, hub.z);
    beams.push(a);
    const b = new THREE.BoxGeometry(90, 0.4, 0.4);
    b.translate(hub.x, 35.2, hub.z + i * 12);
    beams.push(b);
  }
  ch.group.add(new THREE.Mesh(mergeGeometries(beams), steel));

  const tickers = [];
  [
    [-3.4, 9, -14, 0.4], [4.2, 11, -18, -0.3], [-8.5, 12, -4, 0.8], [9.5, 8, -6, -0.9], [-2, 13, -28, 0.1], [13, 13, -20, -0.5],
    [-13, 10, -22, 0.6], [6.5, 7, 6, -0.2], [-7, 8, 12, 0.3], [2.5, 15, -36, 0], [-16, 14, 4, 1.1], [17, 11, -2, -1.2],
  ].forEach(([x, y, z, yaw], i) => {
    const { tex, rows } = verticalText(TICKER[i % TICKER.length].repeat(2));
    const vis = 9 * (16 + (i % 3) * 4);
    const W = 0.55;
    const Hh = (vis / 7) * W;
    const lu = {
      uFont: { value: tex }, uRows: { value: rows }, uVis: { value: vis }, uSpeed: { value: 6 + (i % 4) * 2.5 },
      uCol: { value: new THREE.Color('#ff2a18').multiplyScalar(4.2) }, uHover: { value: 0 }, ...G, ...FOG,
    };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), new THREE.ShaderMaterial({
      uniforms: lu,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: WORLD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFont; uniform float uRows, uVis, uSpeed, uHover; uniform vec3 uCol;
        varying vec2 vUv; varying vec3 vWorld;
        ${GLOBALS_GLSL}
        ${NOISE_GLSL}
        ${FOG_GLSL}
        void main(){
          vec2 cell = vec2(vUv.x * 7.0, vUv.y * uVis);
          vec2 id = floor(cell);
          vec2 f = fract(cell) - 0.5;
          float row = mod(id.y + floor(uTime * uSpeed * (1.0 + uHover * 2.0)), uRows);
          float on = texture2D(uFont, vec2((id.x + 0.5) / 7.0, (row + 0.5) / uRows)).r;
          float dotm = smoothstep(0.42, 0.28, length(f));
          float halo = exp(-dot(f, f) * 9.0) * 0.35;
          float flick = 0.9 + 0.1 * step(0.97, hash12(vec2(floor(uTime * 20.0), id.y)));
          vec3 col = uCol * (on * (dotm * 1.6 + halo) * flick + dotm * 0.025);
          gl_FragColor = vec4(col * fogTransmittance(cameraPosition, vWorld), 1.0);
        }`,
    }));
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.renderOrder = 18;
    ch.group.add(m);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.69, Hh + 0.2, 0.12), steel);
    housing.position.set(x, y, z);
    housing.rotation.y = yaw;
    housing.translateZ(-0.08);
    ch.group.add(housing);
    tickers.push({ m, lu });
  });

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.2, 0.4, 64), patchMaterial(new THREE.MeshStandardMaterial({ color: '#0a0707', roughness: 0.3, metalness: 0.6 }), {
    key: 'net-plat',
    vertex: (src) => inject(inject(src, '#include <common>', 'varying vec3 vPw;'), '#include <begin_vertex>', 'vPw = position;'),
    fragment: (src) => inject(inject(src, '#include <common>', 'varying vec3 vPw;'), '#include <emissivemap_fragment>', `
        vec2 q = vPw.xz;
        float r = length(q);
        float rings = smoothstep(0.03, 0.0, abs(fract(r * 0.8 - uTime * 0.12) - 0.5) - 0.46);
        float spokes = smoothstep(0.02, 0.0, abs(fract(atan(q.y, q.x) / 6.2831853 * 24.0) - 0.5) - 0.47) * step(1.2, r);
        totalEmissiveRadiance += vec3(1.0, 0.12, 0.06) * (rings * 0.9 + spokes * 0.35) * smoothstep(6.0, 1.0, r);
      `),
  }));
  platform.position.set(hub.x, -0.2, hub.z);
  platform.receiveShadow = true;
  ch.group.add(platform);
  ch.slot('figure', [hub.x + 1.4, 0, hub.z + 0.6], { rotY: -0.5, height: 1.8 });
  ch.hub = hub;
  const tmp = new THREE.Vector3();
  ch.floorAt = (p) => {
    const l = ch.group.worldToLocal(tmp.copy(p));
    return Math.hypot(l.x - hub.x, l.z - hub.z) < 7 ? ch.group.position.y + 0.45 : -Infinity;
  };

  ch.group.add(createParticles({
    mode: 'float', count: 2400, seed: 71, center: [hub.x, 12, hub.z], spread: [30, 14, 30], size: 0.03,
    color: '#ff4a30', color2: '#ffb098', intensity: 1.3, speed: 0.3, repel: 2,
  }).points);
  ch.group.add(createParticles({
    mode: 'rise', count: 900, seed: 72, center: [hub.x, -4, hub.z], spread: [18, 1, 18], height: 38, size: 0.02,
    color: '#ff6a50', intensity: 2.4, speed: -0.9, repel: 1,
  }).points);
  ch.group.add(createClouds({
    count: 18, seed: 73, center: [hub.x, 1.5, hub.z], spread: [24, 2, 24], sizeMin: 10, sizeMax: 20,
    lit: '#8a1208', litMul: 1.1, shadow: '#140202', opacity: 0.35, density: 0.45,
  }).mesh);

  ch.addLight([hub.x, 22, hub.z - 26], '#ff2410', 1800, 70);
  ch.addLight([hub.x + 4, 3.5, hub.z + 3], '#ff3a22', 140, 16);
  ch.addLight([hub.x - 16, 10, hub.z + 12], '#ff160a', 600, 44);
  ch.setKey([hub.x, 4, hub.z], [0.3, 0.9, -0.6], '#ff5a44', 0.8, 18, 160);
  ch.setGlow([hub.x, 16, hub.z - 30], '#ff2412', 0.55);

  const door = world.layout.networkDoor;
  ch.thread.push(
    ch.w(door[0] + 0.5, door[1] - 22, door[2] - 12), ch.w(2.5, 20, 30), ch.w(1.2, 8, 18), ch.w(-1.6, 3.5, 6), ch.w(0.8, 1.4, -2),
    ch.w(hub.x, 0.5, hub.z + 0.3), ch.w(hub.x, 3, hub.z), ch.w(hub.x, 20, hub.z), ch.w(hub.x, 60, hub.z - 2), ch.w(hub.x, 150, hub.z - 20),
  );

  const wp = new THREE.Vector3();
  ch.onUpdate(({ raycaster, dt }) => {
    for (const tk of tickers) {
      const d = raycaster.ray.distanceToPoint(tk.m.getWorldPosition(wp));
      tk.lu.uHover.value += ((d < 3 ? 1 : 0) - tk.lu.uHover.value) * Math.min(1, dt * 4);
    }
  });
  return ch;
}
