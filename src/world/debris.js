import * as THREE from 'three';
import { patchMaterial, inject } from '../core/glsl.js';
import { rng } from '../core/util.js';

/** Small faceted chip of stone: icosa, tetra, or a flattened octa; vertices jittered. */
function chipGeometry(kind, seed) {
  const r = rng(seed);
  let g = kind === 0 ? new THREE.IcosahedronGeometry(1, 0) : kind === 1 ? new THREE.TetrahedronGeometry(1, 0) : new THREE.OctahedronGeometry(1, 0);
  if (g.index) g = g.toNonIndexed();
  const pos = g.attributes.position;
  const jitter = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)}|${pos.getY(i).toFixed(3)}|${pos.getZ(i).toFixed(3)}`;
    let j = jitter.get(key);
    if (!j) {
      j = [0.6 + r() * 0.7, 0.6 + r() * 0.7, 0.6 + r() * 0.7];
      jitter.set(key, j);
    }
    pos.setXYZ(i, pos.getX(i) * j[0], pos.getY(i) * j[1] * (kind === 2 ? 0.32 : 1), pos.getZ(i) * j[2]);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/**
 * Thousands of tumbling stone chips in a box that travels with the camera; the cursor ray
 * scatters them and they light up hot where it passes.
 */
export function createDebris({ count = 9000, box = 26, seed = 5 } = {}) {
  const r = rng(seed);
  const group = new THREE.Group();
  const uniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uBox: { value: box },
    uScale: { value: 1 },
    uRepel: { value: 1 },
    uEmis: { value: new THREE.Color(0, 0, 0) },
    uHot: { value: new THREE.Color('#ffffff') },
  };
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#8d8a86', roughness: 0.55, metalness: 0.25, flatShading: true }), {
    key: 'debris-field',
    uniforms,
    vertex: (src) => inject(inject(src, '#include <common>', /* glsl */ `
        attribute vec3 aPos; attribute vec4 aRot; attribute vec4 aProps;
        uniform vec3 uCamPos; uniform float uBox, uScale, uRepel;
        varying float vTone; varying float vInfl;
      `), '#include <begin_vertex>', /* glsl */ `
        {
          vec3 drift = vec3(uTime * 0.004, uTime * 0.007, uTime * 0.003) * aProps.z;
          vec3 local = fract(aPos + drift - uCamPos / uBox) - 0.5;
          vec3 c = uCamPos + local * uBox;
          vec3 al = abs(local) * 2.0;
          float edge = 1.0 - smoothstep(0.72, 1.0, max(al.x, max(al.y, al.z)));
          float dist, along;
          vec3 away = cursorAway(c, dist, along);
          float infl = exp(-dist * dist / (0.3 + along * 0.014)) * smoothstep(50.0, 0.0, along);
          c += away * infl * (0.45 + uCursorVel * 1.4) * uRepel;
          float nearFade = smoothstep(0.5, 2.2, distance(c, cameraPosition));
          float sc = aProps.x * edge * nearFade * uScale;
          float ang = aRot.w + uTime * aProps.y + infl * (2.6 + sin(uTime * 3.0 + aRot.w) * 0.6);
          vec3 ax = normalize(aRot.xyz);
          vec3 v = transformed * sc;
          float ca = cos(ang), sa = sin(ang);
          v = v * ca + cross(ax, v) * sa + ax * dot(ax, v) * (1.0 - ca);
          transformed = c + v;
          vTone = aProps.w;
          vInfl = infl;
        }
      `),
    fragment: (src) => {
      src = inject(src, '#include <common>', 'varying float vTone; varying float vInfl; uniform vec3 uEmis, uHot;');
      src = inject(src, '#include <color_fragment>', 'diffuseColor.rgb *= mix(0.35, 1.25, vTone);');
      return inject(src, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += uEmis * (0.6 + vTone) + uHot * vInfl * 0.35;');
    },
  });

  const per = Math.ceil(count / 3);
  for (let kind = 0; kind < 3; kind++) {
    const base = chipGeometry(kind, seed * 31 + kind);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('normal', base.attributes.normal);
    const aPos = new Float32Array(per * 3);
    const aRot = new Float32Array(per * 4);
    const aProps = new Float32Array(per * 4);
    for (let i = 0; i < per; i++) {
      aPos[i * 3] = r(); aPos[i * 3 + 1] = r(); aPos[i * 3 + 2] = r();
      aRot[i * 4] = r() - 0.5; aRot[i * 4 + 1] = r() - 0.5; aRot[i * 4 + 2] = r() - 0.5; aRot[i * 4 + 3] = r() * 6.28;
      const k = r();
      aProps[i * 4] = 0.005 + k * k * k * 0.03 + (r() < 0.012 ? 0.025 : 0);
      aProps[i * 4 + 1] = (0.15 + r() * 1.1) * (r() < 0.5 ? -1 : 1);
      aProps[i * 4 + 2] = 0.3 + r() * 1.4;
      aProps[i * 4 + 3] = r();
    }
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
    geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(aRot, 4));
    geo.setAttribute('aProps', new THREE.InstancedBufferAttribute(aProps, 4));
    geo.instanceCount = per;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const tmp = new THREE.Color();
  return {
    group,
    uniforms,
    update(camera, L) {
      uniforms.uScale.value = L.chips ?? 1;
      group.visible = uniforms.uScale.value > 0.01;
      uniforms.uCamPos.value.copy(camera.position);
      mat.color.setRGB(0.3, 0.3, 0.3).lerp(tmp.copy(L.dust).multiplyScalar(0.35), 0.5);
      uniforms.uEmis.value.copy(L.dust).multiplyScalar(0.012 * L.dustAmt);
      uniforms.uHot.value.copy(L.dust).multiplyScalar(0.6);
    },
  };
}
