import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, inject } from '../core/glsl.js';
import { rng, perlin, fbm } from '../core/util.js';

// Stone: a standard material with procedural colour variation, cavities, cracks and
// bump, plus rock geometry carved from a noisy sphere by random planar cuts.

export const surfaceFragmentPatch = (src) => {
  src = inject(src, '#include <common>', /* glsl */ `
    varying vec3 vObjPos;
    uniform float uBump, uBumpFreq, uBump2, uBumpFreq2, uVar, uVarFreq, uCracks, uCrackFreq, uCavityAmt, uRimPow;
    uniform vec3 uCavity, uRim;
    float crackMask(vec3 p){
      float n = snoise(p * uCrackFreq) + 0.5 * snoise(p * uCrackFreq * 2.3 + 4.1);
      return (1.0 - smoothstep(0.0, 0.05, abs(n))) * smoothstep(-0.2, 0.4, snoise(p * 0.7 + 9.0));
    }
  `);
  src = inject(src, '#include <color_fragment>', /* glsl */ `
    float nv = fbm3(vObjPos * uVarFreq);
    float cav = smoothstep(0.1, -0.5, snoise(vObjPos * uBumpFreq * 0.9 + 2.0));
    diffuseColor.rgb *= mix(1.0 - uVar, 1.0 + uVar, nv * 0.5 + 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, uCavity, cav * uCavityAmt);
    float cracks = uCracks > 0.0 ? crackMask(vObjPos) * uCracks : 0.0;
    diffuseColor.rgb *= 1.0 - cracks * 0.85;
  `);
  src = inject(src, '#include <normal_fragment_maps>', /* glsl */ `
    float hgt = fbm3(vObjPos * uBumpFreq) * uBump + snoise(vObjPos * uBumpFreq2) * uBump2 - cracks * 0.02;
    normal = perturbNormalH(-vViewPosition, normal, hgt);
  `);
  src = inject(src, '#include <emissivemap_fragment>', /* glsl */ `
    float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPow);
    totalEmissiveRadiance += uRim * rimF;
  `);
  return src;
};

export function surfaceMaterial(o = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: o.color ?? '#2a2a2c',
    roughness: o.roughness ?? 0.9,
    metalness: o.metalness ?? 0,
    envMapIntensity: o.env ?? 1,
    side: o.side ?? THREE.FrontSide,
    flatShading: o.flat ?? false,
  });
  if (o.emissive) {
    mat.emissive.set(o.emissive);
    mat.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  const uniforms = {
    uBump: { value: o.bump ?? 0.03 },
    uBumpFreq: { value: o.bumpFreq ?? 2.5 },
    uBump2: { value: o.bump2 ?? 0.008 },
    uBumpFreq2: { value: o.bumpFreq2 ?? 16 },
    uVar: { value: o.variation ?? 0.3 },
    uVarFreq: { value: o.varFreq ?? 0.8 },
    uCracks: { value: o.cracks ?? 0 },
    uCrackFreq: { value: o.crackFreq ?? 1.2 },
    uCavity: { value: new THREE.Color(o.cavity ?? '#000000') },
    uCavityAmt: { value: o.cavityAmt ?? 0 },
    uRim: { value: new THREE.Color(o.rim ?? '#000000') },
    uRimPow: { value: o.rimPow ?? 3 },
  };
  patchMaterial(mat, {
    uniforms,
    key: `surface-${o.key ?? 'default'}`,
    vertex: (src) => inject(inject(src, '#include <common>', 'varying vec3 vObjPos;'), '#include <begin_vertex>', `
      vObjPos = position;
      #ifdef USE_INSTANCING
        vObjPos += instanceMatrix[3].xyz * 0.37;
      #endif
    `),
    fragment: surfaceFragmentPatch,
  });
  mat.userData.fragmentPatch = surfaceFragmentPatch;
  return mat;
}

/** Ground fades into a ragged noisy disc once the camera is far enough away to see its edge. */
export function groundFade(mat, { center = [0, 0], radius }) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  const [cx, cz] = center.map((v) => v.toFixed(2));
  const R = radius.toFixed(2);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.vertexShader = inject(shader.vertexShader, '#include <common>', 'varying vec3 vGF; varying float vGod;');
    shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', `
      vGF = position;
      vGod = smoothstep(${R} * 1.6 + 40.0, ${R} * 3.2 + 80.0, distance(cameraPosition, (modelMatrix * vec4(${cx}, 0.0, ${cz}, 1.0)).xyz));`);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', 'varying vec3 vGF; varying float vGod;');
    shader.fragmentShader = inject(shader.fragmentShader, '#include <clipping_planes_fragment>', `
      if (vGod > 0.001) {
        vec2 gq = (vGF.xz - vec2(${cx}, ${cz})) / ${R};
        float gn = snoise(vec3(gq * 3.0, 4.0)) * 0.5 + 0.5;
        if (length(gq) > mix(1.6, 0.45 + gn * 0.4, vGod)) discard;
      }`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|gf${R}`;
  mat.needsUpdate = true;
  return mat;
}

/** A chunk of rock: noisy sphere, ridged, then planed off by random cuts. */
export function rockGeometry({
  seed = 1, detail = 5, amp = 0.22, freq = 1.3, ridged = 0.12, cuts = 7, cutDepth = 0.62,
  cutJitter = 0.25, scale = [1, 1, 1], micro = 0.025, flat = 0.93,
} = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const noise = perlin(seed);
  const r = rng(seed * 31 + 7);
  const planes = [];
  for (let i = 0; i < cuts; i++) {
    planes.push({ n: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(), d: cutDepth + r() * cutJitter });
  }
  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    let rad = 1 + fbm(noise, dir.x * freq + 3.1, dir.y * freq, dir.z * freq, 4) * amp;
    rad += ridged * (0.5 - Math.abs(noise(dir.x * freq * 2.2 + 9, dir.y * freq * 2.2, dir.z * freq * 2.2)));
    p.copy(dir).multiplyScalar(rad);
    for (const pl of planes) {
      const d = p.dot(pl.n);
      if (d > pl.d) p.addScaledVector(pl.n, -(d - pl.d) * flat);
    }
    p.addScaledVector(dir, noise(p.x * 6 + 1, p.y * 6, p.z * 6) * micro);
    pos.setXYZ(i, p.x * scale[0], p.y * scale[1], p.z * scale[2]);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Many rocks as a few instanced variants. Each spins, bobs and is shoved aside by the cursor
 * ray in the vertex shader.
 */
export function scatterRocks({
  count = 200, seed = 5, bounds, sizeMin = 0.3, sizeMax = 2.2, material, variants = 4, detail = 3,
  placer, spin = 0.08, push = 1, rock = {},
} = {}) {
  const r = rng(seed);
  const group = new THREE.Group();
  const per = Math.ceil(count / variants);
  const extra = { uSpin: { value: spin }, uPush: { value: push } };
  const mat = material.clone();
  patchMaterial(mat, {
    uniforms: { ...(material.userData.uniforms || {}), ...extra },
    key: 'debris',
    vertex: (src) => {
      src = inject(src, '#include <common>', /* glsl */ `
        varying vec3 vObjPos;
        attribute vec4 aSpin;
        uniform float uSpin;
        uniform float uPush;
        mat3 rotAxis(vec3 a, float t){ float c = cos(t), s = sin(t), k = 1.0 - c;
          return mat3(c + a.x*a.x*k, a.y*a.x*k + a.z*s, a.z*a.x*k - a.y*s,
                      a.x*a.y*k - a.z*s, c + a.y*a.y*k, a.z*a.y*k + a.x*s,
                      a.x*a.z*k + a.y*s, a.y*a.z*k - a.x*s, c + a.z*a.z*k); }
      `);
      src = inject(src, '#include <beginnormal_vertex>', `
        mat3 R = rotAxis(normalize(aSpin.xyz - 0.5), uTime * uSpin * (0.3 + aSpin.w));
        objectNormal = R * objectNormal;
      `);
      src = inject(src, '#include <begin_vertex>', `
        vObjPos = position + instanceMatrix[3].xyz * 0.37;
        transformed = R * transformed;
      `);
      src = src.replace('#include <project_vertex>', /* glsl */ `
        vec4 ic = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dist, along;
        vec3 away = cursorAway(ic.xyz, dist, along);
        float sc = length(instanceMatrix[0].xyz);
        float push = exp(-dist * dist / (2.0 + sc * sc * 4.0 + along * 0.05)) * (0.8 + uCursorVel * 2.0) * (1.5 + sc) * uPush;
        vec3 bob = vec3(sin(uTime * 0.21 + aSpin.x * 30.0), sin(uTime * 0.17 + aSpin.y * 30.0), sin(uTime * 0.19 + aSpin.z * 30.0)) * 0.25;
        vec4 mvPosition = vec4(transformed, 1.0);
        mvPosition = instanceMatrix * mvPosition;
        mvPosition = modelMatrix * mvPosition;
        mvPosition.xyz += away * push + bob;
        mvPosition = viewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      `);
      src = src.replace('#include <worldpos_vertex>', `
        #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
          vec4 worldPosition = inverse(viewMatrix) * mvPosition;
        #endif
      `);
      return src;
    },
    fragment: material.userData.fragmentPatch,
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const meshes = [];
  for (let v = 0; v < variants; v++) {
    const geo = rockGeometry({
      seed: seed * 13 + v * 7, detail, amp: 0.25, cuts: 6 + (v % 3),
      scale: [1, 0.8 + r() * 0.3, 0.9 + r() * 0.2], ...rock,
    });
    const inst = new THREE.InstancedMesh(geo, mat, per);
    const spinA = new Float32Array(per * 4);
    for (let i = 0; i < per; i++) {
      if (placer) placer(p, r);
      else p.set((r() - 0.5) * bounds.x, (r() - 0.5) * bounds.y, (r() - 0.5) * bounds.z);
      e.set(r() * 6.28, r() * 6.28, r() * 6.28);
      q.setFromEuler(e);
      const k = sizeMin + r() ** 2.2 * (sizeMax - sizeMin);
      s.set(k, k * (0.7 + r() * 0.5), k * (0.8 + r() * 0.4));
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
      spinA[i * 4] = r(); spinA[i * 4 + 1] = r(); spinA[i * 4 + 2] = r(); spinA[i * 4 + 3] = r();
    }
    geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spinA, 4));
    inst.frustumCulled = false;
    inst.castShadow = false;
    inst.receiveShadow = false;
    group.add(inst);
    meshes.push(inst);
  }
  return { group, meshes, material: mat };
}
