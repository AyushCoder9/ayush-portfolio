import * as THREE from 'three';
import { Chapter } from '../world/chapter.js';
import { surfaceMaterial, rockGeometry } from '../world/rocks.js';
import { laserBeam, holoLabel } from '../world/fx.js';
import { createParticles } from '../world/particles.js';
import { rng, clamp, damp } from '../core/util.js';

/** 01 — a ring of basalt boulders around a red targeting cross, deep in space. */
export function buildOrigin(world) {
  const ch = new Chapter({ id: 'origin', index: 0, origin: world.layout.origin, yaw: world.layout.originYaw });
  const r = rng(100);
  const basalt = surfaceMaterial({
    key: 'basalt', color: '#3b3b40', roughness: 0.8, bump: 0.07, bumpFreq: 1.9, bump2: 0.016, bumpFreq2: 11,
    variation: 0.38, varFreq: 0.65, cavity: '#070708', cavityAmt: 0.55,
  });
  world.materials.basalt = basalt;

  const ring = new THREE.Group();
  ch.group.add(ring);
  const R = 6.3;
  const stones = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (Math.PI / 4) * i + (r() - 0.5) * 0.16;
    const s = 1.75 + r() * 0.85;
    const m = new THREE.Mesh(rockGeometry({
      seed: 100 + i * 3, detail: 5, amp: 0.16, cuts: 11 + (i % 3), cutDepth: 0.46, cutJitter: 0.34, flat: 1,
      scale: [1.22, 0.8 + r() * 0.22, 1],
    }), basalt);
    m.castShadow = true;
    m.receiveShadow = true;
    m.scale.setScalar(s);
    const d = R + (r() - 0.5) * 0.9;
    m.position.set(Math.cos(a) * d, Math.sin(a) * d, 4.4 + (r() - 0.5) * 0.8);
    m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
    ring.add(m);
    stones.push({ m, base: m.position.clone(), rot: m.rotation.clone(), ang: a, spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.12), phase: r() * 10, push: 0 });
  }
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(rockGeometry({ seed: 300 + i, detail: 2, amp: 0.3, cuts: 5 }), basalt);
    m.scale.setScalar(0.08 + r() * 0.22);
    const a = r() * Math.PI * 2;
    const d = R * (0.75 + r() * 0.55);
    m.position.set(Math.cos(a) * d, Math.sin(a) * d, 2.2 + r() * 2.4);
    ring.add(m);
    stones.push({ m, base: m.position.clone(), rot: new THREE.Euler(r() * 6, r() * 6, 0), ang: a, spin: new THREE.Vector3(r(), r(), r()).multiplyScalar(0.8), phase: r() * 10, push: 0, shard: true });
  }

  // the cross: two long beams with tick gaps, plus short ticks
  const reticle = new THREE.Group();
  ch.group.add(reticle);
  const vBeam = laserBeam([0, -8.6, 0], [0, 8.6, 0], { width: 0.34, intensity: 6, centerGap: 0.12, gaps: [2.2, 4.9] });
  const hBeam = laserBeam([-9.2, 0, 0], [9.2, 0, 0], { width: 0.34, intensity: 6, centerGap: 0.12, gaps: [1.2, 3.6, 5.6], spark: 0.7 });
  reticle.add(vBeam.mesh, hBeam.mesh);
  for (const [x, y, h, vertical] of [
    [0, 1.6, 0.34, 0], [0, -1.6, 0.34, 0], [1.6, 0, 0.34, 1], [-1.6, 0, 0.34, 1],
    [0, 3.1, 0.2, 0], [0, -3.1, 0.2, 0], [3.1, 0, 0.2, 1], [-3.1, 0, 0.2, 1],
  ]) {
    const tick = vertical
      ? laserBeam([x, -h, 0], [x, h, 0], { width: 0.12, intensity: 3.5, spark: 0 })
      : laserBeam([-h, y, 0], [h, y, 0], { width: 0.12, intensity: 3.5, spark: 0 });
    reticle.add(tick.mesh);
  }

  const hud = [
    holoLabel(['SYSTEM_TARGET: ORIGIN', 'SECTOR 00 · 0x3F9A'], { w: 3.2, h: 0.52, width: 640, height: 104 }),
    holoLabel(['RANGE 14.20'], { w: 1.6, h: 0.3, width: 320, height: 60 }),
    holoLabel(['THREAD_PROTOCOL: ACTIVE', 'LOCK ▲ 00.0%'], { w: 3.2, h: 0.52, width: 640, height: 104 }),
    holoLabel(['◢ ACQUIRING'], { w: 1.6, h: 0.3, width: 320, height: 60 }),
  ];
  hud[0].position.set(-4.3, 0.48, 0.02);
  hud[1].position.set(3.3, 0.34, 0.02);
  hud[2].position.set(4.5, -0.48, 0.02);
  hud[3].position.set(-3.3, -0.34, 0.02);
  hud.forEach((h) => reticle.add(h));

  const swirl = createParticles({
    mode: 'swirl', count: 900, seed: 21, center: [0, 0, 0], spread: [7.5, 1.6, 7.5], size: 0.03,
    color: '#ff3a22', color2: '#ffb08a', intensity: 3, speed: 0.6, repel: 1.2, twinkle: 0.6,
  });
  swirl.points.rotation.x = Math.PI / 2;
  ch.group.add(swirl.points);
  const motes = createParticles({
    mode: 'float', count: 1400, seed: 22, center: [0, -2, 0], spread: [16, 10, 10], size: 0.025,
    color: '#b8cbd4', intensity: 1.2, speed: 0.4, repel: 1.8,
  });
  ch.group.add(motes.points);

  ch.addLight([0, 0, 0.6], '#ff2410', 520, 24);
  ch.addLight([4, 16, 10], '#b4ccd8', 900, 80);
  ch.addLight([0, -16, -2], '#3d6b7b', 260, 48);
  ch.setKey([0, 0, 0], [0.25, 1, 0.55], '#9db6c4', 0.55, 12, 160);
  ch.setGlow([0, 0, 0], '#ff2412', 0.16, () => 0.9 + 0.1 * Math.sin(performance.now() * 0.004));
  ch.thread.push(ch.w(0, 140, 0), ch.w(0, 40, 0), ch.w(0, 9, 0), ch.w(0, 0, 0), ch.w(0, -9, 0), ch.w(0.5, -24, -3));

  const wp = new THREE.Vector3();
  const rel = new THREE.Vector3();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const aim = new THREE.Vector2();
  let hudTimer = 0;
  ch.onUpdate(({ t, dt, local, raycaster, input }) => {
    ring.rotation.z = -0.5 + local * 0.9 + t * 0.012;
    ring.rotation.y = Math.sin(t * 0.1) * 0.04;
    const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    ring.updateMatrixWorld();
    // boulders are shoved outward from the cursor ray and drift back
    for (const s of stones) {
      wp.copy(s.base).applyMatrix4(ring.matrixWorld);
      rel.copy(wp).sub(ro);
      const along = Math.max(rel.dot(rd), 0);
      const d = rel.addScaledVector(rd, -along).length();
      const target = Math.exp(-(d * d) / 6) * (0.6 + input.energy * 1.6);
      s.push = Number.isFinite(target) ? damp(Number.isFinite(s.push) ? s.push : 0, target, 4, dt) : 0;
      const k = s.push * (s.shard ? 2.2 : 1.2);
      const bob = Math.sin(t * 0.4 + s.phase) * 0.12;
      s.m.position.set(s.base.x + Math.cos(s.ang) * k, s.base.y + Math.sin(s.ang) * k + bob, s.base.z + k * 0.6);
      s.m.rotation.set(s.rot.x + t * s.spin.x + s.push * 0.4, s.rot.y + t * s.spin.y, s.rot.z + t * s.spin.z);
    }
    // the reticle leans toward wherever the cursor meets its plane
    ch.group.getWorldPosition(wp);
    plane.setFromNormalAndCoplanarPoint(ch.dir(0, 0, 1), wp);
    if (raycaster.ray.intersectPlane(plane, hit)) {
      ch.group.worldToLocal(hit);
      aim.set(clamp(hit.x * 0.08, -0.6, 0.6), clamp(hit.y * 0.08, -0.6, 0.6));
    }
    reticle.position.x = damp(reticle.position.x, aim.x, 2.5, dt);
    reticle.position.y = damp(reticle.position.y, aim.y, 2.5, dt);

    const lock = clamp(local * 1.25, 0, 1);
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.12;
      const range = (14.2 - lock * 14.2 + Math.abs(input.ndc.x) * 0.9).toFixed(2);
      hud[1].userData.draw([`RANGE ${range.padStart(5, '0')}`]);
      hud[2].userData.draw(['THREAD_PROTOCOL: ACTIVE', `LOCK ▲ ${(lock * 100).toFixed(1).padStart(4, '0')}%`]);
      hud[3].userData.draw([lock > 0.98 ? '◢ LOCKED' : '◢ ACQUIRING']);
      hud[0].userData.draw(['SYSTEM_TARGET: ORIGIN', `SECTOR 00 · 0x${(16282 + Math.floor((input.ndc.x + 1) * 97)).toString(16).toUpperCase()}`]);
    }
    const pulse = 0.85 + 0.15 * Math.sin(t * 3.1);
    vBeam.uniforms.uOpacity.value = pulse;
    hBeam.uniforms.uOpacity.value = pulse * (0.7 + lock * 0.3);
  });
  return ch;
}
