import * as THREE from 'three';
import { G, FOG, GLOBALS_GLSL, NOISE_GLSL, CURSOR_GLSL, FOG_GLSL, WORLD_VERT } from '../core/glsl.js';
import { rng } from '../core/util.js';

// Effects shared by several chapters: volumetric cloud sprites, holographic canvas text,
// laser beams, and the tube helper used by cables, curls and the thread.

/** Billboarded fbm cloud puffs, lit from one side, stirred by the cursor. */
export function createClouds(o = {}) {
  const count = o.count ?? 16;
  const r = rng(o.seed ?? 3);
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.attributes.position);
  geo.setAttribute('uv', plane.attributes.uv);
  const offs = new Float32Array(count * 3);
  const data = new Float32Array(count * 4);
  const spread = o.spread ?? [10, 3, 10];
  const center = o.center ?? [0, 0, 0];
  for (let i = 0; i < count; i++) {
    offs[i * 3] = center[0] + (r() - 0.5) * 2 * spread[0];
    offs[i * 3 + 1] = center[1] + (r() - 0.5) * 2 * spread[1];
    offs[i * 3 + 2] = center[2] + (r() - 0.5) * 2 * spread[2];
    const lo = o.sizeMin ?? 6, hi = o.sizeMax ?? 14;
    data[i * 4] = lo + r() * (hi - lo);
    data[i * 4 + 1] = r() * 100;
    data[i * 4 + 2] = r() * Math.PI * 2;
    data[i * 4 + 3] = (r() - 0.5) * 0.08;
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 3));
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = count;
  const uniforms = {
    uLit: { value: new THREE.Color(o.lit ?? '#8aa3ad').multiplyScalar(o.litMul ?? 1) },
    uShadow: { value: new THREE.Color(o.shadow ?? '#0c1418') },
    uOpacity: { value: o.opacity ?? 0.6 },
    uDensity: { value: o.density ?? 0.5 },
    uLightDir: { value: new THREE.Vector3(...(o.lightDir ?? [0, 1, 0])).normalize() },
    uGlow: { value: new THREE.Color(o.glow ?? '#000000') },
    ...G,
    ...FOG,
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      attribute vec3 aOffset;
      attribute vec4 aData;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vStir;
      varying float vNear;
      ${GLOBALS_GLSL}
      ${CURSOR_GLSL}
      void main(){
        vec3 c = (modelMatrix * vec4(aOffset, 1.0)).xyz;
        c.y += sin(uTime * 0.05 + aData.y) * 0.4;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float a = aData.z + uTime * aData.w;
        vec2 p = position.xy;
        p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
        vec3 wp = c + (right * p.x + up * p.y) * aData.x;
        float dist, along;
        cursorAway(c, dist, along);
        vStir = exp(-dist * dist / (aData.x * aData.x * 0.35)) * (0.35 + uCursorVel);
        vUv = uv;
        vWorld = wp;
        vSeed = aData.y;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vNear = smoothstep(0.5, aData.x * 0.6, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vStir;
      varying float vNear;
      uniform vec3 uLit, uShadow, uGlow, uLightDir;
      uniform float uOpacity, uDensity;
      ${GLOBALS_GLSL}
      ${NOISE_GLSL}
      ${FOG_GLSL}
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        vec3 q = vec3(vUv * 1.9 + vSeed, uTime * 0.022 + vSeed);
        vec2 sw = vec2(snoise(q * 1.2 + 7.0), snoise(q * 1.2 + 3.0)) * (0.3 + vStir * 1.1);
        float n = fbm5(q + vec3(sw, 0.0)) * 0.5 + 0.5;
        float d = n * 1.25 - r * r * 0.95 - (1.0 - uDensity) * 0.55;
        float dens = smoothstep(0.02, 0.5, d) * smoothstep(1.0, 0.7, r);
        float n2 = fbm3(q + vec3(0.0, 0.14, 0.0) + vec3(sw, 0.0)) * 0.5 + 0.5;
        float lit = clamp(0.45 + (n - n2) * 3.5 + p.y * 0.3, 0.0, 1.0);
        vec3 col = mix(uShadow, uLit, lit) + uGlow * vStir * 0.5;
        float T = fogTransmittance(cameraPosition, vWorld);
        col = mix(uFogColor, col, T);
        col += fogScatter(cameraPosition, vWorld, uGlowPos, uGlowColor) * 0.6;
        float alpha = dens * uOpacity * vNear;
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = o.renderOrder ?? 5;
  return { mesh, uniforms };
}

/** A canvas you can redraw lines of text onto, as a texture. */
export function textCanvas(lines, {
  width = 512, height = 128, font = '500 30px "Geist", sans-serif', color = '#ffffff', align = 'left', lineHeight = 1.25, pad = 12, bg = null,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const draw = (rows) => {
    ctx.clearRect(0, 0, width, height);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = align;
    const px = parseFloat(font.match(/(\d+)px/)[1]);
    const x = align === 'left' ? pad : align === 'right' ? width - pad : width / 2;
    rows.forEach((row, i) => ctx.fillText(row, x, pad + i * px * lineHeight));
    texture.needsUpdate = true;
  };
  draw(lines);
  return { texture, canvas, ctx, draw };
}

/** Additive hologram material: scanlines and the odd dropped frame. */
export function holoMaterial(map, color = '#ffffff', intensity = 1, { flicker = 0.1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
      uOpacity: { value: 1 },
      uFlicker: { value: flicker },
      ...G,
      ...FOG,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: WORLD_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity, uFlicker;
      varying vec2 vUv; varying vec3 vWorld;
      ${GLOBALS_GLSL}
      ${NOISE_GLSL}
      ${FOG_GLSL}
      void main(){
        vec4 t = texture2D(map, vUv);
        float fl = 1.0 - uFlicker * step(0.93, hash12(vec2(floor(uTime * 24.0), vWorld.x)));
        float scan = 0.85 + 0.15 * sin(vUv.y * 140.0 + uTime * 6.0);
        vec3 col = uColor * t.rgb * t.a * uOpacity * fl * scan;
        gl_FragColor = vec4(col * fogTransmittance(cameraPosition, vWorld), 1.0);
      }`,
  });
}

/** A floating HUD label. `mesh.userData.draw(lines)` redraws it. */
export function holoLabel(lines, { w = 2.4, h = 0.6, color = '#ff3322', intensity = 2.2, ...canvasOpts } = {}) {
  const tc = textCanvas(lines, canvasOpts);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), holoMaterial(tc.texture, color, intensity));
  mesh.renderOrder = 20;
  mesh.userData.draw = tc.draw;
  return mesh;
}

/**
 * A camera-facing laser line from A to B: hot core, soft glow, optional gaps (tick marks),
 * a dead zone in the middle, and a spark that travels its length.
 */
export function laserBeam(a, b, { width = 0.32, color = '#ff2a18', intensity = 5, gaps = [], centerGap = 0, segments = 96, spark = 1 } = {}) {
  const pos = new Float32Array((segments + 1) * 2 * 3);
  const ts = new Float32Array((segments + 1) * 2);
  const side = new Float32Array((segments + 1) * 2);
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    for (let k = 0; k < 2; k++) {
      ts[i * 2 + k] = i / segments;
      side[i * 2 + k] = k === 0 ? -1 : 1;
    }
    if (i < segments) {
      const j = i * 2;
      idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(idx);
  const gapArr = new Float32Array(8);
  gaps.slice(0, 8).forEach((g, i) => (gapArr[i] = g));
  const uniforms = {
    uA: { value: new THREE.Vector3(...a) },
    uB: { value: new THREE.Vector3(...b) },
    uWidth: { value: width },
    uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
    uGaps: { value: gapArr },
    uGapCount: { value: Math.min(8, gaps.length) },
    uCenterGap: { value: centerGap },
    uOpacity: { value: 1 },
    uSpark: { value: spark },
    ...G,
    ...FOG,
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aT; attribute float aSide;
      uniform vec3 uA, uB; uniform float uWidth;
      varying float vX; varying float vT; varying float vLen; varying vec3 vWorld;
      void main(){
        vec3 A = (modelMatrix * vec4(uA, 1.0)).xyz;
        vec3 B = (modelMatrix * vec4(uB, 1.0)).xyz;
        vec3 P = mix(A, B, aT);
        vec3 dir = normalize(B - A);
        vec3 view = normalize(cameraPosition - P);
        vec3 side = normalize(cross(dir, view));
        float w = uWidth * (1.0 + distance(P, cameraPosition) * 0.004);
        P += side * aSide * w;
        vX = aSide; vT = aT; vLen = length(B - A); vWorld = P;
        gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uGaps[8]; uniform int uGapCount; uniform float uCenterGap, uOpacity, uSpark;
      varying float vX; varying float vT; varying float vLen; varying vec3 vWorld;
      ${GLOBALS_GLSL}
      ${NOISE_GLSL}
      ${FOG_GLSL}
      void main(){
        float x = vX;
        float core = exp(-x * x * 420.0);
        float mid = exp(-x * x * 40.0) * 0.35;
        float glow = exp(-x * x * 5.0) * 0.12;
        float s = (vT - 0.5) * vLen;
        float mask = smoothstep(uCenterGap, uCenterGap + 0.04, abs(s));
        for (int i = 0; i < 8; i++) {
          if (i >= uGapCount) break;
          mask *= smoothstep(0.05, 0.1, abs(abs(s) - uGaps[i]));
        }
        float endFade = smoothstep(0.0, 0.06, vT) * smoothstep(1.0, 0.94, vT);
        float fl = 0.92 + 0.08 * sin(uTime * 53.0 + vT * 9.0) - 0.25 * step(0.97, hash12(vec2(floor(uTime * 30.0), 3.0)));
        float sq = (fract(vT - uTime * 0.23) - 0.5) * vLen * 1.2;
        float sp = exp(-sq * sq) * uSpark;
        vec3 col = uColor * ((core * 3.0 + mid) * mask + glow * (0.6 + 0.4 * mask)) * endFade * fl;
        col += uColor * sp * (core * 6.0 + mid * 2.0) * endFade;
        col *= uOpacity * fogTransmittance(cameraPosition, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 21;
  return { mesh, uniforms };
}

/** Tube along a curve with a per-point radius function; uv.x runs along the curve. */
export function tubeAlong(curve, { segments = 64, radial = 8, radius = () => 0.05, closed = false } = {}) {
  const frames = curve.computeFrenetFrames(segments, closed);
  const pos = [], nrm = [], uvs = [], idx = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const rad = radius(t);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const sn = Math.sin(a), cs = -Math.cos(a);
      n.set(cs * N.x + sn * B.x, cs * N.y + sn * B.y, cs * N.z + sn * B.z).normalize();
      pos.push(p.x + rad * n.x, p.y + rad * n.y, p.z + rad * n.z);
      nrm.push(n.x, n.y, n.z);
      uvs.push(t, j / radial);
    }
  }
  for (let i = 1; i <= segments; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Keep only the named attributes so geometries can be merged. */
export function onlyAttrs(g, keep = ['position', 'normal']) {
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  return g;
}

/** Wireframe stand-in used to preview an empty slot. */
export function slotGhost(h = 1.75, color = '#7dffb0') {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(h * 0.14, h * 0.62, 4, 10),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.35, fog: false }),
  );
  m.position.y = h * 0.5;
  g.add(m);
  return g;
}
