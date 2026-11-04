import * as THREE from 'three';
import { patchMaterial, inject } from '../core/glsl.js';
import { rng } from '../core/util.js';

// Instanced grass blades: wind, a wake around the cursor ray, and a shockwave the hero can set off.

const BEND = /* glsl */ `
  vec3 base = (modelMatrix * vec4(aRoot.xyz, 1.0)).xyz;
  float hgt = aRoot.w;
  float kk = clamp(position.y, 0.0, 1.0);
  kk *= kk;
  float cd, ca;
  vec3 away = cursorAway(base + vec3(0.0, hgt * 0.7, 0.0), cd, ca);
  float push = exp(-cd * cd / 2.4) * (0.5 + uCursorVel * 1.5);
  vec3 wind = vec3(sin(uTime * 1.3 + base.x * 0.9 + base.z * 0.3), 0.0, cos(uTime * 1.1 + base.z * 0.8)) * 0.08
            + vec3(snoise(vec3(base.xz * 0.35, uTime * 0.35)), 0.0, snoise(vec3(base.zx * 0.35, uTime * 0.35 + 3.0))) * 0.12;
  away.y = 0.0;
  vec3 disp = (wind * uWind + away * push) * hgt * kk * 1.4;
  if (uShockA > 0.001) {
    vec2 sv = base.xz - uShock.xz;
    float sd = length(sv);
    float band = exp(-pow((sd - uShock.w) / 0.9, 2.0)) + 0.35 * smoothstep(uShock.w, 0.0, sd);
    disp.xz += sv / max(sd, 1e-3) * band * uShockA * hgt * kk * 2.4;
  }
  disp.y -= length(disp) * 0.45 * kk;
  vec4 fw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  fw.xyz += disp;
  vec4 mvPosition = viewMatrix * fw;
  gl_Position = projectionMatrix * mvPosition;
`;

/** One tapered, curved blade from y=0 to y=1. */
function bladeGeometry(segs = 4) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.5 * (1 - t ** 1.5);
    const z = t * t * 0.24;
    const nz = 0.45 - 0.25 * t;
    if (i < segs) {
      pos.push(-w, t, z, w, t, z);
      nrm.push(-0.3, 1, nz, 0.3, 1, nz);
    } else {
      pos.push(0, t, z);
      nrm.push(0, 1, nz);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const k = (segs - 1) * 2;
  idx.push(k, k + 1, k + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

export function createGrass({
  count = 6000, seed = 7, placer, ground = null, tuft = null, hMin = 0.25, hMax = 0.8, width = 0.04, lean = 0.28,
  base = '#07070a', tipA = '#3a3448', tipB = '#2a3a48', glow = '#000000', glowAmt = 0, rim = 0.25, wind = 1,
} = {}) {
  const r = rng(seed);
  const geo = bladeGeometry();
  const uniforms = {
    uWind: { value: wind },
    uShock: { value: new THREE.Vector4(0, 0, 0, 0) },
    uShockA: { value: 0 },
    uBase: { value: new THREE.Color(base) },
    uTipA: { value: new THREE.Color(tipA) },
    uTipB: { value: new THREE.Color(tipB) },
    uGlow: { value: new THREE.Color(glow) },
    uGlowAmt: { value: glowAmt },
    uRimAmt: { value: rim },
  };
  const material = patchMaterial(new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), {
    key: 'grass',
    uniforms,
    vertex: (src) => {
      src = inject(src, '#include <common>', 'uniform float uWind, uShockA; uniform vec4 uShock; attribute vec4 aRoot; attribute float aVar; varying float vBY; varying float vVar;');
      src = inject(src, '#include <begin_vertex>', 'vBY = position.y; vVar = aVar;');
      return src.replace('#include <project_vertex>', BEND);
    },
    fragment: (src) => {
      src = inject(src, '#include <common>', 'uniform vec3 uBase, uTipA, uTipB, uGlow; uniform float uGlowAmt, uRimAmt; varying float vBY; varying float vVar;');
      src = inject(src, '#include <color_fragment>', `
        vec3 tipC = mix(uTipA, uTipB, vVar);
        diffuseColor.rgb = mix(uBase, tipC, smoothstep(0.0, 1.0, vBY)) * (0.4 + 1.0 * fract(vVar * 7.31));
        diffuseColor.rgb *= mix(0.3, 1.0, smoothstep(0.0, 0.45, vBY));
      `);
      return inject(src, '#include <emissivemap_fragment>', `
        float bRim = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.0);
        totalEmissiveRadiance += tipC * bRim * uRimAmt * vBY;
        totalEmissiveRadiance += uGlow * uGlowAmt * pow(vBY, 3.0) * (0.35 + 0.65 * vVar);
      `);
    },
  });

  const mesh = new THREE.InstancedMesh(geo, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const at = new THREE.Vector3();
  const s = new THREE.Vector3();
  const roots = new Float32Array(count * 4);
  const vars = new Float32Array(count);
  const put = (i, x, y, z, h, yaw, pitch, roll, w) => {
    p.set(x, y, z);
    e.set(pitch, yaw, roll);
    q.setFromEuler(e);
    s.set(w, h, h);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    roots[i * 4] = x; roots[i * 4 + 1] = y; roots[i * 4 + 2] = z; roots[i * 4 + 3] = h;
    vars[i] = r();
  };
  let i = 0;
  while (i < count) {
    placer(at, r);
    if (!tuft) {
      const h = hMin + r() * (hMax - hMin);
      put(i++, at.x, at.y - 0.02, at.z, h, r() * 6.283, (r() - 0.3) * lean, (r() - 0.5) * lean * 0.6, width * (0.7 + r() * 0.6));
      continue;
    }
    // a tuft: blades fanning out from a clump, shorter and leaning further at the edge
    const k = 0.75 + r() * 0.5;
    for (let j = 0; j < tuft.n && i < count; j++) {
      const a = r() * 6.283;
      const d = Math.sqrt(r()) * tuft.r * k;
      const x = at.x + Math.cos(a) * d;
      const z = at.z + Math.sin(a) * d;
      const y = ground ? ground(x, z) : at.y;
      const f = d / (tuft.r * k);
      const h = (hMin + r() * (hMax - hMin)) * k * (1 - f * 0.45);
      put(i++, x, y - 0.03, z, h, Math.atan2(Math.cos(a), Math.sin(a)) + (r() - 0.5) * 0.6, lean * (0.3 + f * 1.4) * (0.6 + r() * 0.6), (r() - 0.5) * 0.2, width * (0.7 + r() * 0.6));
    }
  }
  geo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 4));
  geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(vars, 1));
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  return { mesh, group: mesh, material, uniforms };
}
