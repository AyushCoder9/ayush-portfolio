import * as THREE from 'three';
import { Chapter } from '../world/chapter.js';
import { surfaceMaterial, rockGeometry, scatterRocks, groundFade } from '../world/rocks.js';
import { createGrass } from '../world/grass.js';
import { createClouds, textCanvas } from '../world/fx.js';
import { createParticles } from '../world/particles.js';
import { statueGeometry, columnGeometry, reliefGeometry } from '../world/statue.js';
import { G, FOG, GLOBALS_GLSL, NOISE_GLSL, FOG_GLSL, WORLD_VERT } from '../core/glsl.js';
import { rng, perlin, clamp, damp } from '../core/util.js';

// the scanner's hologram of the head: thermal false-colour with a sweep line
const THERMAL_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vWorld; varying vec3 vObj;
  uniform float uGlitch;
  ${GLOBALS_GLSL}
  ${NOISE_GLSL}
  void main(){
    vec3 p = position;
    float band = floor(p.y * 18.0 + uTime * 7.0);
    float g = step(0.9, hash12(vec2(band, floor(uTime * 12.0)))) * uGlitch;
    p.x += g * (hash11(band) - 0.5) * 0.25;
    vObj = p;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const THERMAL_FRAG = /* glsl */ `
  varying vec3 vN; varying vec3 vWorld; varying vec3 vObj;
  uniform float uOpacity, uGlitch;
  ${GLOBALS_GLSL}
  ${NOISE_GLSL}
  ${FOG_GLSL}
  vec3 thermal(float t){
    t = clamp(t, 0.0, 1.0);
    vec3 a = vec3(0.05, 0.9, 0.35), b = vec3(0.95, 0.95, 0.15), c = vec3(1.0, 0.35, 0.05), d = vec3(1.0, 0.1, 0.25);
    return t < 0.4 ? mix(a, b, t / 0.4) : t < 0.75 ? mix(b, c, (t - 0.4) / 0.35) : mix(c, d, (t - 0.75) / 0.25);
  }
  void main(){
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(max(1.0 - abs(dot(normalize(vN), V)), 0.0), 1.6);
    float heat = 0.55 - vObj.y * 0.22 + fbm3(vObj * 2.2 + uTime * 0.15) * 0.35 - fres * 0.45;
    float scan = 0.55 + 0.45 * sin(vObj.y * 160.0 - uTime * 5.0);
    float sweep = smoothstep(0.08, 0.0, abs(fract(vObj.y * 0.3 - uTime * 0.18) - 0.5) - 0.44);
    vec3 col = thermal(heat) * (0.12 + fres * 1.6) * scan;
    col += vec3(0.5, 1.0, 0.7) * sweep * 0.9;
    col *= uOpacity * (1.0 - uGlitch * 0.3 * step(0.5, hash12(vec2(floor(uTime * 20.0), 1.0))));
    gl_FragColor = vec4(col * fogTransmittance(cameraPosition, vWorld), 1.0);
  }`;

/** 02 — a fallen colossal head in a foggy green field, being scanned. */
export function buildMemory(world) {
  const ch = new Chapter({ id: 'memory', index: 1, origin: world.layout.memory, yaw: world.layout.memoryYaw });
  const r = rng(200);
  const noise = perlin(21);
  const stone = surfaceMaterial({
    key: 'stone', color: '#6f6b63', roughness: 0.94, bump: 0.012, bumpFreq: 9, bump2: 0.004, bumpFreq2: 40,
    variation: 0.14, varFreq: 2.2, cracks: 0.8, crackFreq: 1.3, cavity: '#2a2d26', cavityAmt: 0.22,
  });
  const rubbleMat = surfaceMaterial({
    key: 'rubble', color: '#4a4a45', roughness: 0.93, bump: 0.02, bumpFreq: 5, bump2: 0.006, bumpFreq2: 26,
    variation: 0.2, varFreq: 1.6, cavity: '#101310', cavityAmt: 0.3,
  });
  const groundMat = surfaceMaterial({
    key: 'ground', color: '#2a2c27', roughness: 0.97, bump: 0.05, bumpFreq: 1.2, bump2: 0.015, bumpFreq2: 9,
    variation: 0.4, varFreq: 0.3, cavity: '#0a0c0a', cavityAmt: 0.5,
  });
  const H = (x, z) => {
    const d = Math.hypot(x, z);
    return 1.3 * Math.exp(-(d * d) / 38) + noise(x * 0.25, z * 0.25, 0) * 0.35 + noise(x * 0.9, z * 0.9, 3) * 0.08 - 0.2;
  };
  const groundGeo = new THREE.PlaneGeometry(70, 70, 200, 200);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, H(gp.getX(i), gp.getZ(i)));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, groundFade(groundMat, { radius: 35 }));
  ground.receiveShadow = true;
  ch.group.add(ground);

  const rubble = scatterRocks({
    count: 420, seed: 41, material: rubbleMat, sizeMin: 0.05, sizeMax: 0.5, variants: 6, detail: 3, spin: 0, push: 0.12,
    rock: { amp: 0.1, cuts: 12, cutDepth: 0.42, cutJitter: 0.3, flat: 1 },
    placer: (v, rand) => {
      const a = rand() * Math.PI * 2, d = rand() ** 0.7 * 8.5;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      v.set(x, H(x, z) + 0.05, z);
    },
  });
  rubble.meshes.forEach((m) => { m.receiveShadow = true; m.castShadow = true; });
  ch.group.add(rubble.group);

  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(rockGeometry({ seed: 500 + i, detail: 3, amp: 0.08, cuts: 12, cutDepth: 0.42, cutJitter: 0.15, flat: 1, scale: [1.3, 0.7, 1] }), stone);
    const a = r() * Math.PI * 2, d = 2.5 + r() * 5.5;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    m.position.set(x, H(x, z) + 0.15, z);
    m.scale.setScalar(0.35 + r() * 0.5);
    m.rotation.set(r() * 0.6, r() * 6, r() * 0.6);
    m.castShadow = m.receiveShadow = true;
    ch.group.add(m);
  }
  const col1 = new THREE.Mesh(columnGeometry(3), stone);
  col1.position.set(-2.6, H(-2.6, 3.4) + 0.3, 3.4);
  col1.rotation.set(0.1, 0.7, Math.PI / 2 - 0.15);
  const col2 = new THREE.Mesh(columnGeometry(5, { r: 0.3, h: 0.9 }), stone);
  col2.position.set(3.8, H(3.8, -2.4) + 0.4, -2.4);
  col2.rotation.set(0.05, 0.2, 0.08);
  const relief = new THREE.Mesh(reliefGeometry(4), stone);
  relief.position.set(3.4, H(3.4, 2.6) + 0.35, 2.6);
  relief.rotation.set(-1.15, 0.5, 0.25);
  for (const m of [col1, col2, relief]) {
    m.castShadow = m.receiveShadow = true;
    ch.group.add(m);
  }

  const grass = createGrass({
    count: Math.round(7000 * (world.quality.grass ?? 1)), seed: 202, ground: H, tuft: { n: 10, r: 0.24 },
    placer: (v, rand) => {
      for (let k = 0; k < 20; k++) {
        const a = rand() * Math.PI * 2, d = 0.8 + rand() ** 0.75 * 13;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        v.set(x, H(x, z), z);
        if ((Math.hypot(x - 1.2, z - 0.4) > 2.3 && Math.hypot(x + 1.7, z + 1.4) > 0.9 && noise(x * 0.4, z * 0.4, 9) > -0.05) || k === 19) return;
      }
    },
    hMin: 0.2, hMax: 0.7, width: 0.035, lean: 0.35, base: '#060705', tipA: '#3c4c2c', tipB: '#2a3a2c', glow: '#9fe0ab', glowAmt: 0.05, rim: 0.3,
  });
  ch.group.add(grass.mesh);

  // the head, half sunk, tipped on its side
  const sculpt = statueGeometry(7);
  const statue = new THREE.Group();
  const head = new THREE.Mesh(sculpt.geometry, stone);
  head.castShadow = head.receiveShadow = true;
  statue.add(head);
  const curls = new THREE.InstancedMesh(sculpt.curlGeometry, stone, sculpt.curls.length);
  const m4 = new THREE.Matrix4();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  sculpt.curls.forEach((c, i) => {
    qa.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.n);
    qb.setFromAxisAngle(new THREE.Vector3(0, 0, 1), c.spin);
    qa.multiply(qb);
    sc.setScalar(c.s);
    m4.compose(c.p, qa, sc);
    curls.setMatrixAt(i, m4);
  });
  curls.castShadow = curls.receiveShadow = true;
  statue.add(curls);
  statue.scale.setScalar(1.5);
  statue.position.set(1.2, H(1.2, 0.4) + 1.05, 0.4);
  statue.rotation.set(-0.95, 0.42, -0.48, 'YXZ');
  ch.group.add(statue);

  // boulders hanging in the air above the field
  const floaters = [];
  for (const [x, y, z, s, seed] of [[-3.4, 7.2, -2.2, 1.5, 61], [3.8, 8.8, -1.2, 1.9, 62], [0.4, 11, -4.5, 1.2, 63], [-6.5, 9.5, 2.5, 0.8, 64]]) {
    const m = new THREE.Mesh(rockGeometry({ seed, detail: 5, amp: 0.2, cuts: 10, cutDepth: 0.5, flat: 1, scale: [1.2, 0.85, 1] }), world.materials.basalt);
    m.position.set(x, y, z);
    m.scale.setScalar(s);
    m.rotation.set(r() * 6, r() * 6, r() * 6);
    m.castShadow = true;
    ch.group.add(m);
    floaters.push({ m, base: m.position.clone(), rot: m.rotation.clone(), phase: r() * 10, push: 0 });
  }

  // the scanner: a dark glass monitor with a live readout, a hologram of the head above a beam cone
  const scanner = new THREE.Group();
  scanner.position.set(-4.4, 2.5, 1.2);
  scanner.rotation.y = 0.75;
  ch.group.add(scanner);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.86, 1.86, 0.06), new THREE.MeshStandardMaterial({ color: '#0b0f0c', roughness: 0.35, metalness: 0.6 }));
  bezel.position.z = -0.05;
  scanner.add(bezel);
  const screen = textCanvas([], { width: 1024, height: 660 });
  const drawScreen = (t, glitch) => {
    const c = screen.ctx;
    c.clearRect(0, 0, 1024, 660);
    c.strokeStyle = 'rgba(80,255,140,0.18)';
    c.lineWidth = 1;
    for (let x = 0; x <= 1024; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 660); c.stroke(); }
    for (let y = 0; y <= 660; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(1024, y); c.stroke(); }
    c.strokeStyle = 'rgba(120,255,170,0.9)';
    c.lineWidth = 3;
    c.strokeRect(14, 14, 996, 632);
    c.fillStyle = 'rgba(140,255,180,0.95)';
    c.font = '500 26px "Geist", sans-serif';
    c.fillText('LEGACY_SCAN // SYS-01', 34, 54);
    c.font = '400 18px "Geist", sans-serif';
    [
      'ORIGIN   MONOLITH · 2009 CE',
      'MATERIAL HAND-WRITTEN BOILERPLATE',
      `DENSITY  ${(2.31 + Math.sin(t) * 0.02).toFixed(3)} g/cm³`,
      `MESH     ${(918204 + (Math.floor(t * 71) % 999)).toLocaleString('en-US')} pts`,
      `MATCH    ${(96.4 + Math.sin(t * 0.7) * 1.2).toFixed(1)}%`,
    ].forEach((line, i) => c.fillText(line, 34, 96 + i * 28));
    c.fillStyle = 'rgba(140,255,180,0.9)';
    for (let i = 0; i < 48; i++) {
      const h = 10 + Math.abs(Math.sin(i * 0.7 + t * 2.1) * 60 + Math.sin(i * 1.9 - t) * 30) * (1 + glitch);
      c.fillRect(34 + i * 9, 620 - h, 5, h);
    }
    c.fillText('SIGNAL ▲ THREAD LINKED', 34, 470);
    c.strokeStyle = 'rgba(140,255,180,0.9)';
    c.beginPath();
    c.arc(880, 150, 70, -Math.PI / 2, -Math.PI / 2 + ((t * 0.4) % 1) * Math.PI * 2);
    c.stroke();
    c.font = '500 30px "Geist", sans-serif';
    c.fillText(`${Math.floor(((t * 0.4) % 1) * 100)}%`, 846, 162);
    screen.texture.needsUpdate = true;
  };
  drawScreen(0, 0);
  const screenU = { map: { value: screen.texture }, uGlitch: { value: 0 }, ...G, ...FOG };
  scanner.add(new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.74), new THREE.ShaderMaterial({
    uniforms: screenU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: WORLD_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uGlitch;
      varying vec2 vUv; varying vec3 vWorld;
      ${GLOBALS_GLSL}
      ${NOISE_GLSL}
      ${FOG_GLSL}
      void main(){
        vec2 uv = vUv;
        float row = floor(uv.y * 60.0);
        uv.x += (hash12(vec2(row, floor(uTime * 15.0))) - 0.5) * 0.04 * uGlitch * step(0.8, hash12(vec2(row, 3.0)));
        vec4 t = texture2D(map, uv);
        float scan = 0.8 + 0.2 * sin(vUv.y * 500.0 + uTime * 4.0);
        vec3 base = vec3(0.02, 0.09, 0.04) * (0.6 + 0.4 * smoothstep(0.9, 0.2, length(vUv - 0.5)));
        vec3 col = (base + vec3(0.35, 1.0, 0.55) * t.rgb * t.a * 2.2) * scan;
        gl_FragColor = vec4(col * fogTransmittance(cameraPosition, vWorld), 1.0);
      }`,
  })));
  const holoU = { uOpacity: { value: 1 }, uGlitch: { value: 0 }, ...G, ...FOG };
  const holoMat = new THREE.ShaderMaterial({
    uniforms: holoU, vertexShader: THERMAL_VERT, fragmentShader: THERMAL_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const holo = new THREE.Group();
  holo.add(new THREE.Mesh(sculpt.geometry, holoMat));
  const holoCurls = new THREE.InstancedMesh(sculpt.curlGeometry, holoMat, sculpt.curls.length);
  for (let i = 0; i < sculpt.curls.length; i++) {
    curls.getMatrixAt(i, m4);
    holoCurls.setMatrixAt(i, m4);
  }
  holo.add(holoCurls);
  holo.scale.setScalar(0.36);
  holo.position.set(0.55, -0.05, 0.25);
  scanner.add(holo);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 32, 1, true), new THREE.ShaderMaterial({
    uniforms: { ...G, ...FOG },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: WORLD_VERT,
    fragmentShader: `varying vec2 vUv; varying vec3 vWorld; ${GLOBALS_GLSL} ${FOG_GLSL}
      void main(){ float a = pow(1.0 - vUv.y, 1.5) * (0.5 + 0.5 * sin(vUv.x * 60.0 + uTime * 3.0)); gl_FragColor = vec4(vec3(0.2, 1.0, 0.45) * a * 0.35 * fogTransmittance(cameraPosition, vWorld), 1.0); }`,
  }));
  cone.position.set(0.55, -0.62, 0.25);
  scanner.add(cone);

  // a dashed ring on the ground where a person could stand
  const spot = [-1.7, H(-1.7, -1.4), -1.4];
  ch.slot('person', spot, { rotY: 0.9, height: 1.78 });
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 64), new THREE.ShaderMaterial({
    uniforms: { ...G, ...FOG },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: WORLD_VERT,
    fragmentShader: `varying vec2 vUv; varying vec3 vWorld; ${GLOBALS_GLSL} ${FOG_GLSL}
      void main(){ float a = atan(vWorld.z, vWorld.x); float dash = step(0.5, fract(a * 6.0 + uTime * 0.2)); gl_FragColor = vec4(vec3(0.25, 1.0, 0.5) * (0.25 + dash * 0.5) * fogTransmittance(cameraPosition, vWorld), 1.0); }`,
  }));
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(spot[0], spot[1] + 0.04, spot[2]);
  ch.group.add(ringMesh);

  ch.group.add(createClouds({
    count: 22, seed: 31, center: [0, 0.6, -2], spread: [14, 0.8, 10], sizeMin: 6, sizeMax: 14,
    lit: '#2f7a48', shadow: '#041008', opacity: 0.4, density: 0.45,
  }).mesh);
  ch.group.add(createParticles({
    mode: 'float', count: 1600, seed: 51, center: [0, 4, 0], spread: [12, 6, 10], size: 0.028,
    color: '#8dffb0', color2: '#e8fff0', intensity: 1.4, speed: 0.35, repel: 1.6,
  }).points);
  ch.group.add(createParticles({
    mode: 'rise', count: 500, seed: 52, center: [-4.4, 0.5, 1.2], spread: [1.1, 1, 1.1], height: 4, size: 0.02,
    color: '#6dff9a', intensity: 2.2, speed: 0.8, repel: 1,
  }).points);

  ch.addLight([2.5, 11, 3], '#c8ffd4', 420, 36);
  ch.addLight([-1.5, 8, -10], '#35ff74', 650, 30);
  ch.addLight([-3.6, 2.6, 2.4], '#4dff88', 90, 14);
  ch.setKey([0, 1, 0], [0.8, 0.9, 0.25], '#dcffe4', 1.3, 11, 160);
  ch.setGlow([0, 0.4, -7], '#2cff6a', 0.1);
  ch.thread.push(
    ch.w(-9, 26, 12), ch.w(-5.2, 7, 2.2), ch.w(-4.4, 3.5, 1.2), ch.w(-4.3, 1.4, 1.25),
    ch.w(-2.8, 0.75, 3.2), ch.w(1.8, 0.6, 4.6), ch.w(6.5, 1.2, 2.2), ch.w(12, 3.5, -8),
  );

  let screenTimer = 0;
  let glitch = 0;
  const wp = new THREE.Vector3();
  const rel = new THREE.Vector3();
  ch.onUpdate(({ t, dt, raycaster, input }) => {
    const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    for (const f of floaters) {
      f.m.getWorldPosition(wp);
      rel.copy(wp).sub(ro);
      const along = Math.max(rel.dot(rd), 0);
      const d = rel.addScaledVector(rd, -along).length();
      f.push = damp(f.push, Math.exp(-(d * d) / 8) * (0.7 + input.energy * 1.5), 3, dt);
      f.m.position.set(f.base.x, f.base.y + Math.sin(t * 0.35 + f.phase) * 0.35 + f.push * 0.8, f.base.z);
      f.m.rotation.set(f.rot.x + t * 0.03 + f.push * 0.3, f.rot.y + t * 0.05, f.rot.z);
    }
    // the scanner glitches when you point at it
    scanner.getWorldPosition(wp);
    rel.copy(wp).sub(ro);
    const along = Math.max(rel.dot(rd), 0);
    const d = rel.addScaledVector(rd, -along).length();
    glitch = damp(glitch, clamp(Math.exp(-(d * d) / 3) * (0.6 + input.energy * 2), 0, 1), 6, dt);
    holoU.uGlitch.value = glitch;
    screenU.uGlitch.value = glitch;
    holo.rotation.y = t * 0.35 + input.ndc.x * 0.6;
    holo.rotation.x = -input.ndc.y * 0.2;
    screenTimer -= dt;
    if (screenTimer <= 0) {
      screenTimer = 0.1;
      drawScreen(t, glitch);
    }
    statue.rotation.z = -0.48 + Math.sin(t * 0.2) * 0.004;
  });
  return ch;
}
