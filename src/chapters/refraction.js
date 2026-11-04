import * as THREE from 'three';
import { Chapter } from '../world/chapter.js';
import { surfaceMaterial, rockGeometry, scatterRocks, groundFade } from '../world/rocks.js';
import { createGrass } from '../world/grass.js';
import { createClouds } from '../world/fx.js';
import { createParticles } from '../world/particles.js';
import { FrameTags } from '../ui/frameTags.js';
import { DISCIPLINES } from '../data.js';
import { rng, perlin, fbm, smooth, damp } from '../core/util.js';

function roundedRect(x, y, w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** 03 — a tall dispersive glass frame floating over a volcanic plain at dusk. The camera flies through it. */
export function buildRefraction(world) {
  const ch = new Chapter({ id: 'refraction', index: 2, origin: world.layout.refraction, yaw: world.layout.refractionYaw });
  const r = rng(300);
  const noise = perlin(33);
  const H = (x, z) => {
    const d = Math.hypot(x, z);
    return fbm(noise, x * 0.045, 0.3, z * 0.045, 4) * 2.2 + fbm(noise, x * 0.22, 1.7, z * 0.22, 3) * 0.35 + 0.9 * Math.exp(-(d * d) / 26) - 0.4;
  };
  const groundGeo = new THREE.PlaneGeometry(150, 150, 220, 220);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, H(gp.getX(i), gp.getZ(i)));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, groundFade(surfaceMaterial({
    key: 'lava', color: '#1d1a19', roughness: 0.95, bump: 0.06, bumpFreq: 1.6, bump2: 0.02, bumpFreq2: 9,
    variation: 0.4, varFreq: 0.35, cavity: '#060505', cavityAmt: 0.5,
  }), { radius: 75 }));
  ground.receiveShadow = true;
  ch.group.add(ground);

  // a mound of basalt under the frame; grass grows on top of the stones too
  const basalt = world.materials.basalt;
  const mound = [];
  [
    [0, 0.9, 0, 1.9], [-1.9, 0.6, 0.6, 1.3], [1.8, 0.55, 0.4, 1.35], [0.6, 0.5, 1.9, 1.1], [-0.9, 0.45, -1.7, 1.2],
    [1.4, 0.4, -1.5, 1], [-2.9, 0.3, -0.6, 0.9], [2.9, 0.25, 1.4, 0.8], [-0.4, 1.8, 0.1, 1.1], [0.9, 1.6, -0.4, 0.9],
    [-2.4, 0.2, 2.1, 0.7], [3.4, 0.2, -0.8, 0.75], [-1.3, 1.3, -0.3, 0.85], [0.2, 0.3, -3.1, 0.9],
  ].forEach(([x, lift, z, s], i) => {
    const m = new THREE.Mesh(rockGeometry({ seed: 700 + i, detail: 4, amp: 0.18, cuts: 10, cutDepth: 0.5, cutJitter: 0.3, flat: 1, scale: [1.15, 0.78, 1] }), basalt);
    m.position.set(x, H(x, z) + lift * 0.6, z);
    m.scale.setScalar(s);
    m.rotation.set(r() * 0.8, r() * 6.28, r() * 0.8);
    m.castShadow = m.receiveShadow = true;
    ch.group.add(m);
    mound.push({ x, z, s, top: m.position.y + s * 0.62 });
  });
  const field = scatterRocks({
    count: 180, seed: 81, material: basalt, sizeMin: 0.2, sizeMax: 2.4, variants: 5, detail: 3, spin: 0, push: 0.08,
    rock: { amp: 0.16, cuts: 10, cutDepth: 0.48, flat: 1 },
    placer: (v, rand) => {
      const a = rand() * Math.PI * 2, d = 6 + rand() ** 0.8 * 50;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      v.set(x, H(x, z) + 0.1, z);
    },
  });
  field.meshes.forEach((m) => { m.receiveShadow = true; });
  ch.group.add(field.group);

  const spotOnMound = (v, rand) => {
    if (rand() < 0.45) {
      const b = mound[Math.floor(rand() * mound.length)];
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * b.s * 0.55;
      v.set(b.x + Math.cos(a) * d, b.top - 0.12 - (d / b.s) * 0.35, b.z + Math.sin(a) * d);
    } else {
      const a = rand() * Math.PI * 2, d = 1.5 + rand() ** 0.6 * 5.5;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      v.set(x, H(x, z) - 0.03, z);
    }
  };
  const grass = createGrass({
    count: Math.round(10000 * (world.quality.grass ?? 1)), seed: 91,
    placer: (v, rand) => {
      for (let k = 0; k < 12; k++) {
        spotOnMound(v, rand);
        if (noise(v.x * 0.45, 5.5, v.z * 0.45) > -0.05 || k === 11) return;
      }
    },
    hMin: 0.3, hMax: 1.05, width: 0.04, lean: 0.32, base: '#080504', tipA: '#5c2414', tipB: '#6e4a26', glow: '#ff6a2a', glowAmt: 0.07, rim: 0.3,
  });
  ch.group.add(grass.mesh);

  // the frame: an extruded rounded rectangle in dispersive glass
  const FW = 2.7, FH = 4.5, BAR = 0.36;
  const shape = roundedRect(-FW / 2, -FH / 2, FW, FH, 0.06);
  shape.holes.push(roundedRect(-FW / 2 + BAR, -FH / 2 + BAR, FW - 2 * BAR, FH - 2 * BAR, 0.03));
  const frameGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 6 });
  frameGeo.translate(0, 0, -0.16);
  frameGeo.computeVertexNormals();
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.5, ior: 1.5, dispersion: 6,
    attenuationColor: '#ffe7dc', attenuationDistance: 3, specularIntensity: 1, envMapIntensity: 1.1,
  });
  const frame = new THREE.Group();
  frame.position.set(0.05, 4, 0.1);
  frame.rotation.set(0, 0.18, -0.2);
  const frameMesh = new THREE.Mesh(frameGeo, glass);
  frameMesh.castShadow = true;
  frame.add(frameMesh);
  ch.group.add(frame);
  ch.frame = frame;

  ch.group.add(createClouds({
    count: 14, seed: 41, center: [0, 0.4, -22], spread: [34, 1, 8], sizeMin: 8, sizeMax: 16,
    lit: '#c8401c', litMul: 1, shadow: '#1a0402', opacity: 0.22, density: 0.4,
  }).mesh);
  ch.group.add(createParticles({
    mode: 'rise', count: 900, seed: 61, center: [0, -0.3, 0], spread: [9, 1, 9], height: 12, size: 0.022,
    color: '#ff7a2a', color2: '#ffd08a', intensity: 3.2, speed: 0.55, repel: 1.4, twinkle: 0.6,
  }).points);
  ch.group.add(createParticles({
    mode: 'float', count: 1200, seed: 62, center: [0, 2.5, 0], spread: [10, 3.5, 10], size: 0.02,
    color: '#ffc49a', intensity: 1.4, speed: 0.4, repel: 1.8,
  }).points);

  ch.addLight([1.5, 7, -9], '#ff4a16', 1100, 34);
  ch.addLight([-5, 3.5, 6], '#ff9a60', 240, 22);
  ch.addLight([0.2, 3.2, 1.2], '#ffb080', 60, 8);
  ch.setKey([0, 2, 0], [-0.55, 0.6, 0.85], '#ffb48a', 2.1, 10, 160);
  ch.setGlow([0, 2.5, -40], '#ff4012', 0.32);

  // a point on the axis through the frame's opening, `d` units in front (+) or behind (-)
  const through = (d) => new THREE.Vector3(0, 0, d).applyEuler(frame.rotation).add(frame.position);
  const a9 = through(9), a0 = through(0), aBack = through(-12), a4 = through(4);
  ch.thread.push(ch.w(14, 3.5, 34), ch.w(6, 3.2, 18), ch.w(a9.x, a9.y, a9.z), ch.w(a4.x, a4.y, a4.z), ch.w(a0.x, a0.y, a0.z), ch.w(aBack.x, aBack.y, aBack.z), ch.w(-3, 8, -40));
  ch.throughPoint = through;

  const sides = [-1, 1, 1, -1, 1];
  const heights = [1.5, 1.9, -0.4, -1.1, -1.9];
  const tags = new FrameTags(DISCIPLINES.slice(0, 5).map((label, i) => ({
    label, at: new THREE.Vector3((sides[i] * FW) / 2, heights[i], 0), side: sides[i],
  })));
  ch.onHide = () => tags.hide();
  const proj = new THREE.Vector3();
  const screen = new THREE.Vector2();
  let sway = 0;
  ch.onUpdate(({ t, dt, input, camera, local }) => {
    sway = damp(sway, input.ndc.x * 0.05, 2, dt);
    frame.rotation.z = -0.2 + sway + Math.sin(t * 0.5) * 0.005;
    frame.rotation.y = 0.18 + input.ndc.x * 0.04;
    const reveal = smooth(0.22, 0.66, local) * (1 - smooth(0.88, 0.97, local));
    frame.updateMatrixWorld();
    tags.update((at, out) => {
      proj.copy(at).applyMatrix4(frame.matrixWorld).project(camera);
      if (proj.z > 1 || Math.abs(proj.x) > 0.92 || Math.abs(proj.y) > 0.9) return false;
      out.set((proj.x * 0.5 + 0.5) * innerWidth, (-proj.y * 0.5 + 0.5) * innerHeight);
      return true;
    }, reveal, screen);
  });
  return ch;
}
