import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, inject, NOISE_GLSL } from '../core/glsl.js';
import { smooth } from '../core/util.js';

/** An egg: a sphere narrowed toward the top. `inside` flips it to be seen from within. */
function eggGeometry(inside = false) {
  let g = new THREE.IcosahedronGeometry(1, 30);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 - 0.12 * v.y;
    pos.setXYZ(i, v.x * k, v.y * 1.24, v.z * k);
  }
  g = mergeVertices(g);
  g.computeVertexNormals();
  if (inside) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i++) n[i] = -n[i];
  }
  return g;
}

const SHELL_GLSL = /* glsl */ `
  uniform vec3 uOrigin;
  // cracks: edges of a 3D cell pattern, spreading over the shell from the side facing the
  // lens as uCrack rises; a second, finer set follows the first
  vec2 cells3(vec3 p){
    vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 g = vec3(float(x), float(y), float(z)); vec3 r = g + hash33(i + g) - f; float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return vec2(sqrt(d1), sqrt(d2));
  }
  float crackLines(vec3 obj, float amt){
    if (amt <= 0.0) return 0.0;
    vec3 on = normalize(obj * vec3(1.0, 0.8, 1.0));
    float reach = acos(clamp(dot(on, uOrigin), -1.0, 1.0)) / 3.14159;
    vec3 q = on * 2.6 + vec3(fbm3(on * 3.0) * 0.35);
    vec2 c = cells3(q);
    float big = 1.0 - smoothstep(0.0, 0.035, c.y - c.x);
    vec2 c2 = cells3(q * 2.3 + 5.0);
    float fine = (1.0 - smoothstep(0.0, 0.025, c2.y - c2.x)) * 0.6;
    float grow = smoothstep(reach - 0.05, reach + 0.05, amt * 1.25);
    float grow2 = smoothstep(reach - 0.05, reach + 0.05, amt * 1.25 - 0.35);
    return max(big * grow, fine * grow2);
  }
  float dissolveField(vec3 obj, float amt, vec3 seed){
    vec3 on = normalize(obj * vec3(1.0, 0.8, 1.0));
    float d = acos(clamp(dot(on, uOrigin), -1.0, 1.0)) / 3.14159; // 0 facing the lens, 1 behind
    float n = fbm5(on * 2.4 + seed) * 0.5 + 0.5;
    return d * 0.62 + n * 0.38 - (amt * 1.18 - 0.08);
  }
`;

const LAYERS = [
  {
    key: 'egg-shell', scale: 1, flip: false, renderOrder: 3, lag: 0, seed: [3.1, 7.7, 1.3],
    frost: { freq: 3.2, rough: 0.18, roughVar: 0.12, bump: 0.06, thick: 0.55 },
    mat: {
      color: '#ffffff', ior: 1.52, thickness: 1, dispersion: 1.1, roughness: 0.2, attenuationColor: '#ece4ff', attenuationDistance: 3.2,
      specularIntensity: 0.9, envMapIntensity: 0.55, clearcoat: 0.85, clearcoatRoughness: 0.12, iridescence: 0.22, iridescenceIOR: 1.3,
      iridescenceThicknessRange: [180, 520],
    },
  },
  {
    key: 'egg-mantle', scale: 0.945, flip: true, renderOrder: 2, lag: 0.12, seed: [9.4, 2.2, 5.8],
    frost: { freq: 1.35, rough: 0.2, roughVar: 0.26, bump: 0.12, thick: 0.9 },
    mat: {
      color: '#f3ecff', ior: 1.18, thickness: 0.55, dispersion: 0.35, roughness: 0.55, attenuationColor: '#cdb6ff', attenuationDistance: 1.8,
      specularIntensity: 0.5, envMapIntensity: 0.35,
    },
  },
];

/**
 * A frosted, two-layer glass egg with a glowing membrane inside. It cracks from the side
 * facing the camera, then dissolves away in a hot rim.
 */
export function createEgg() {
  const group = new THREE.Group();
  group.name = 'egg';
  const shared = {
    uCrack: { value: 0 },
    uOrigin: { value: new THREE.Vector3(-0.15, 0.3, 1).normalize() },
    uEdgeCol: { value: new THREE.Color('#f0e2ff').multiplyScalar(3.2) },
    uVeinCol: { value: new THREE.Color('#d8c2ff').multiplyScalar(2.2) },
    uGlowCol: { value: new THREE.Color('#c9a8ff') },
    uGlow: { value: 1 },
    uScanY: { value: 0 },
    uScanCol: { value: new THREE.Color('#9ff0ff').multiplyScalar(2.2) },
  };
  const layers = LAYERS.map((L, i) => {
    const u = {
      ...shared,
      uDissolve: { value: 0 },
      uSeed: { value: new THREE.Vector3(...L.seed) },
      uFrost: { value: new THREE.Vector4(L.frost.freq, L.frost.rough, L.frost.roughVar, L.frost.bump) },
      uThick: { value: L.frost.thick },
      uOuter: { value: i === 0 ? 1 : 0 },
    };
    const mat = new THREE.MeshPhysicalMaterial({ transmission: 1, metalness: 0, side: L.flip ? THREE.DoubleSide : THREE.FrontSide, ...L.mat });
    patchMaterial(mat, {
      key: L.key,
      uniforms: u,
      vertex: (src) => inject(inject(src, '#include <common>', 'varying vec3 vObj;'), '#include <begin_vertex>', 'vObj = position;'),
      fragment: (src) => {
        src = inject(src, '#include <common>', `
          uniform float uCrack, uGlow, uScanY, uDissolve, uThick, uOuter;
          uniform vec3 uEdgeCol, uVeinCol, uGlowCol, uScanCol, uSeed;
          uniform vec4 uFrost;
          varying vec3 vObj;
          ${SHELL_GLSL}`);
        src = inject(src, '#include <clipping_planes_fragment>', `
          float dv = dissolveField(vObj, uDissolve, uSeed);
          if (uDissolve > 0.0 && dv < 0.0) discard;
          // frost: fbm patches, clearer where thin, milky where thick
          vec3 fp = vObj * uFrost.x + uSeed;
          float frost = fbm5(fp) * 0.5 + 0.5;
          float grain = fbm3(fp * 5.3 + 11.0);`);
        src = inject(src, '#include <roughnessmap_fragment>', `
          roughnessFactor = clamp(uFrost.y + (frost - 0.5) * 2.0 * uFrost.z + grain * 0.06, 0.04, 1.0);
          float crk = uOuter * crackLines(vObj, max(uCrack, 0.5)); // hairlines are always there; waking spreads them
          roughnessFactor = mix(roughnessFactor, 0.9, crk);`);
        src = inject(src, '#include <normal_fragment_maps>', `
          vec3 fb = vec3(grain, fbm3(fp * 5.3 + vec3(4.2, 19.0, 7.7)), fbm3(fp * 5.3 + vec3(13.3, 2.9, 23.1)));
          normal = normalize(normal + (fb + (frost - 0.5) * 0.6) * uFrost.w);`);
        src = src.replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace(
          'material.thickness = thickness;',
          'material.thickness = thickness * mix(1.0 - uThick * 0.5, 1.0 + uThick, frost);',
        ));
        return inject(src, '#include <emissivemap_fragment>', `
          float fr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.4);
          totalEmissiveRadiance += uGlowCol * (0.05 + fr * 0.7) * uGlow * mix(0.35, 1.0, uOuter);
          // cracks run through the shell, lit from inside
          totalEmissiveRadiance += uVeinCol * crk * (0.18 + 1.2 * uCrack) * (1.0 - smoothstep(0.0, 0.5, uDissolve));
          // dissolving: a soft hot rim where the frost burns away
          float edge = uDissolve > 0.0 ? 1.0 - smoothstep(0.0, 0.035, dv) : 0.0;
          totalEmissiveRadiance += uEdgeCol * edge * mix(0.55, 1.0, uOuter) * (1.0 - smoothstep(0.75, 1.0, uDissolve));
          // a scan line still passing over the shell
          float sd = (vObj.y - uScanY) / 0.018;
          totalEmissiveRadiance += uScanCol * exp(-sd * sd) * fr * uOuter * (1.0 - smoothstep(0.0, 0.3, uDissolve));
        `);
      },
    });
    const mesh = new THREE.Mesh(eggGeometry(L.flip), mat);
    mesh.scale.setScalar(L.scale);
    mesh.renderOrder = L.renderOrder;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { m: mesh, u, lag: L.lag };
  });

  const inner = {
    uAmt: { value: 1 },
    uCol: { value: new THREE.Color('#b99cff').multiplyScalar(0.75) },
    uCore: { value: new THREE.Color('#f4c8ff').multiplyScalar(1.3) },
    uEdgeCol: shared.uEdgeCol,
    uDissolve: { value: 0 },
    uOrigin: shared.uOrigin,
    uSeed: { value: new THREE.Vector3(5.5, 1.1, 8.3) },
    uTime: { value: 0 },
  };
  const membrane = new THREE.Mesh(eggGeometry(false), new THREE.ShaderMaterial({
    uniforms: inner,
    side: THREE.BackSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vObj;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalize(normalMatrix * normal); vObj = position; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uAmt, uDissolve, uTime; uniform vec3 uCol, uCore, uEdgeCol, uSeed; varying vec3 vN; varying vec3 vV; varying vec3 vObj;
      ${NOISE_GLSL}
      ${SHELL_GLSL}
      void main(){
        float dv = dissolveField(vObj, uDissolve, uSeed);
        if (uDissolve > 0.0 && dv < 0.0) discard;
        float facing = abs(dot(normalize(vN), normalize(vV)));
        vec3 q = vObj * 2.1 + uSeed + vec3(0.0, uTime * 0.03, 0.0);
        float cells = fbm5(q) * 0.5 + 0.5;
        float wisps = fbm3(q * 3.7 - uTime * 0.02) * 0.5 + 0.5;
        float frost = mix(0.78, 1.0, smoothstep(0.2, 0.85, cells)) * mix(0.9, 1.06, wisps);
        vec3 c = uCol * (0.22 + 0.78 * smoothstep(-1.2, 0.8, vObj.y)) * frost + uCore * pow(facing, 3.0) * mix(0.85, 1.05, cells);
        c *= uAmt;
        if (uDissolve > 0.0) c += uEdgeCol * 0.3 * (1.0 - smoothstep(0.0, 0.035, dv)) * (1.0 - smoothstep(0.75, 1.0, uDissolve));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  membrane.scale.setScalar(0.965);
  group.add(membrane);

  const lagged = (x, lag) => Math.min(1, Math.max(0, (x - lag) / (1 - lag)));
  return {
    group,
    outer: layers[0].m,
    inner: membrane,
    uniforms: shared,
    set({ crack = 0, shatter = 0, beat = 0, glow = 1, scanY = 0, t = 0 }) {
      shared.uCrack.value = crack;
      shared.uGlow.value = glow * (0.85 + beat * 0.35);
      shared.uScanY.value = scanY;
      for (const l of layers) {
        l.u.uDissolve.value = lagged(shatter, l.lag);
        l.m.visible = l.u.uDissolve.value < 0.999;
      }
      inner.uDissolve.value = lagged(shatter, 0.2);
      inner.uTime.value = t;
      inner.uAmt.value = (0.8 + beat * 0.3 + crack * 0.45) * (1 - smooth(0.35, 0.95, shatter) * 0.85);
      group.visible = shatter < 0.999;
    },
  };
}
