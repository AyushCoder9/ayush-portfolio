import * as THREE from 'three';
import { Chapter } from '../world/chapter.js';
import { groundFade } from '../world/rocks.js';
import { createGrass } from '../world/grass.js';
import { createParticles } from '../world/particles.js';
import { patchMaterial, inject, G, FOG, GLOBALS_GLSL, NOISE_GLSL, FOG_GLSL, WORLD_VERT } from '../core/glsl.js';
import { perlin, fbm, clamp, damp } from '../core/util.js';

/** The winding path through the dunes, as x(z). Shared with GLSL. */
export const pathX = (z) => 2.2 * Math.sin(z * 0.045) + 0.8 * Math.sin(z * 0.11 + 1.3);
const PATH_GLSL = 'float pathX(float z){ return 2.2 * sin(z * 0.045) + 0.8 * sin(z * 0.11 + 1.3); }';

/** 05 — moonlit dunes, a glowing seam of a path, and a black doorway full of red weather. */
export function buildThreshold(world) {
  const ch = new Chapter({ id: 'threshold', index: 4, origin: world.layout.threshold, yaw: world.layout.thresholdYaw });
  const noise = perlin(55);
  const ridgeZ = (x) => -60 + 5 * Math.sin(x * 0.03) + 3 * Math.sin(x * 0.071 + 1.2);
  // an asymmetric dune: steep lee face, long windward slope
  const dune = (x, z, crest, height, back, front, width) => {
    const d = z - crest;
    return height * Math.exp(d > 0 ? -d / back : d / front) * Math.exp(-(x * x) / width);
  };
  const H = (x, z) => {
    let h = dune(x, z, ridgeZ(x), 21, 55, 13, 9000);
    h = Math.max(h, dune(x - 40, z, -150 + 12 * Math.sin(x * 0.02), 34, 70, 18, 26000));
    h = Math.max(h, dune(x + 120, z, -40 + 0.35 * x, 16, 40, 10, 5000));
    h = Math.max(h, dune(x - 150, z, -20 - 0.3 * x, 14, 35, 11, 6000));
    return h + fbm(noise, x * 0.025, 0.4, z * 0.025, 3) * 2.4 + fbm(noise, x * 0.09, 2.1, z * 0.09, 2) * 0.35;
  };
  ch.H = H;

  const sandGeo = new THREE.PlaneGeometry(460, 460, 340, 340);
  sandGeo.rotateX(-Math.PI / 2);
  sandGeo.translate(0, 0, -60);
  const sp = sandGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setY(i, H(sp.getX(i), sp.getZ(i)));
  sandGeo.computeVertexNormals();
  const sandU = {
    uPathCol: { value: new THREE.Color('#ff2414').multiplyScalar(3) },
    uDoorZ: { value: ridgeZ(0) },
    uGlint: { value: new THREE.Color('#ffd9c8').multiplyScalar(2.2) },
  };
  const sandMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#15130f', roughness: 0.92, metalness: 0 }), {
    key: 'sand',
    uniforms: sandU,
    vertex: (src) => inject(inject(src, '#include <common>', 'varying vec3 vL; varying vec3 vSW;'), '#include <begin_vertex>', 'vL = position; vSW = (modelMatrix * vec4(position, 1.0)).xyz;'),
    fragment: (src) => {
      src = inject(src, '#include <common>', `varying vec3 vL; varying vec3 vSW; uniform vec3 uPathCol, uGlint; uniform float uDoorZ;\n${PATH_GLSL}`);
      src = inject(src, '#include <normal_fragment_maps>', /* glsl */ `
        // wind ripples, bending with the dune
        vec2 wdir = normalize(vec2(0.35, 1.0) + vec2(snoise(vec3(vL.xz * 0.02, 1.0)), snoise(vec3(vL.xz * 0.02, 7.0))) * 0.35);
        float ph = dot(vL.xz, wdir) * 5.2 + snoise(vec3(vL.xz * 0.35, 3.0)) * 2.2;
        float rip = (sin(ph) * 0.5 + 0.5);
        rip = rip * rip;
        float fine = snoise(vec3(vL.xz * 6.0, 2.0)) * 0.25;
        float dist0 = distance(cameraPosition, vSW);
        float fadeR = smoothstep(80.0, 6.0, dist0);
        normal = perturbNormalH(-vViewPosition, normal, (rip * 0.05 + fine * 0.006) * fadeR);
      `);
      return inject(src, '#include <emissivemap_fragment>', /* glsl */ `
        // the path: a glowing seam in the sand, broken like embers
        float dx = abs(vL.x - pathX(vL.z));
        float onRange = smoothstep(46.0, 38.0, vL.z) * smoothstep(uDoorZ - 1.0, uDoorZ + 2.0, vL.z);
        float breakup = 0.55 + 0.45 * smoothstep(-0.3, 0.4, snoise(vec3(vL.z * 0.4, uTime * 0.25, 1.0)));
        float line = exp(-dx * dx / 0.006) * 2.2 + exp(-dx * dx / 0.08) * 0.6 + exp(-dx * dx / 2.2) * 0.12;
        totalEmissiveRadiance += uPathCol * line * onRange * breakup;
        // the sand warms where you point
        float cd, ca;
        cursorAway(vSW, cd, ca);
        totalEmissiveRadiance += vec3(1.0, 0.25, 0.12) * exp(-cd * cd / 0.9) * (0.25 + uCursorVel * 1.4) * smoothstep(120.0, 10.0, ca);
        // glints that flicker as the camera moves
        vec3 cell = floor(vL * 42.0);
        float gh = hash13(cell);
        float tw = hash13(cell + floor(cameraPosition * 4.0));
        float glint = step(0.9965, gh) * step(0.5, tw) * smoothstep(40.0, 2.0, dist0);
        totalEmissiveRadiance += uGlint * glint;
      `);
    },
  });
  const sand = new THREE.Mesh(sandGeo, groundFade(sandMat, { center: [0, -60], radius: 230 }));
  sand.receiveShadow = true;
  ch.group.add(sand);

  // the door, set into the crest of the dune
  const doorZ = ridgeZ(0);
  const doorY = H(0, doorZ) - 0.4;
  const DOOR_H = 6.4;
  const door = new THREE.Group();
  door.position.set(0, doorY, doorZ);
  ch.group.add(door);
  const jambMat = new THREE.MeshStandardMaterial({ color: '#070707', roughness: 0.32, metalness: 0.7 });
  const jamb = new THREE.BoxGeometry(0.45, 7.3, 0.55);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(jamb, jambMat);
    m.position.set(s * 1.475, 7.3 / 2, 0);
    m.castShadow = true;
    door.add(m);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.45, 0.55), jambMat);
  lintel.position.set(0, 7.075, 0);
  door.add(lintel);
  const doorU = { uPulse: { value: 0 }, uHover: { value: 0 }, uOpen: { value: 0 }, ...G, ...FOG };
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(2.5, DOOR_H, 1, 1), new THREE.ShaderMaterial({
    uniforms: doorU,
    side: THREE.DoubleSide,
    vertexShader: WORLD_VERT,
    fragmentShader: /* glsl */ `
      uniform float uPulse, uHover, uOpen;
      varying vec2 vUv; varying vec3 vWorld;
      ${GLOBALS_GLSL}
      ${NOISE_GLSL}
      ${FOG_GLSL}
      void main(){
        vec2 p = vUv - 0.5;
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float flow = fbm3(vec3(p * vec2(2.0, 5.0), uTime * 0.15)) * 0.5 + 0.5;
        float veins = pow(max(1.0 - abs(fbm3(vec3(p * vec2(5.0, 2.2) + flow, uTime * 0.22)) * 2.0), 0.0), 6.0);
        float core = exp(-dot(p * vec2(2.6, 1.1), p * vec2(2.6, 1.1)) * 3.0);
        float seam = exp(-p.x * p.x * 180.0) * smoothstep(0.5, 0.2, abs(p.y));
        float rim = exp(-edge * 38.0);
        vec3 red = vec3(1.0, 0.07, 0.03);
        // dims as you get close, so the doorway stays red instead of blowing out
        float nearK = 1.0 - 0.55 * smoothstep(12.0, 2.0, distance(cameraPosition, vWorld));
        vec3 col = red * (0.75 + flow * 0.7 + veins * 0.9 + uPulse * 0.35 + uHover * 0.5);
        col += vec3(1.0, 0.3, 0.16) * core * (0.45 + uPulse * 0.2 + uOpen * 0.6);
        col += vec3(1.0, 0.62, 0.5) * (seam * (0.8 + uHover) + rim * 1.1);
        col *= (1.0 + uOpen * 0.4) * nearK;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }`,
  }));
  portal.position.set(0, 3.65, 0.02);
  door.add(portal);
  ch.doorCenter = new THREE.Vector3(0, doorY + DOOR_H / 2 + 0.45, doorZ);
  const tmp = new THREE.Vector3();
  // keeps the flying camera above the sand
  ch.floorAt = (p) => {
    const l = ch.group.worldToLocal(tmp.copy(p));
    return l.z > doorZ + 1.5 ? ch.group.position.y + H(l.x, l.z) + 0.5 : -Infinity;
  };

  const grass = createGrass({
    count: Math.round(7000 * (world.quality.grass ?? 1)), seed: 404, ground: H, tuft: { n: 16, r: 0.32 },
    placer: (v, rand) => {
      const z = doorZ + 3 + rand() * (48 - doorZ);
      const off = (rand() < 0.3 ? 6 + rand() * 22 : 0.9 + rand() ** 1.6 * 6) * (rand() < 0.5 ? -1 : 1);
      const x = pathX(z) + off;
      v.set(x, H(x, z), z);
    },
    hMin: 0.35, hMax: 1.05, width: 0.032, lean: 0.4, base: '#0a0907', tipA: '#5e564a', tipB: '#4a4034', glow: '#ff3a24', glowAmt: 0.03, rim: 0.35,
  });
  ch.group.add(grass.mesh);
  ch.slot('walker', [pathX(-34) + 0.25, H(pathX(-34), -34) - 0.02, -34], { rotY: Math.PI, height: 1.8 });

  ch.group.add(createParticles({
    mode: 'float', count: 1600, seed: 91, center: [0, H(0, 0) + 1.2, -8], spread: [16, 1.6, 50], size: 0.02,
    color: '#ff5a3a', color2: '#ffc0a0', intensity: 1.4, speed: 0.35, repel: 2.2, twinkle: 0.7,
  }).points);
  ch.group.add(createParticles({
    mode: 'swirl', count: 700, seed: 92, center: [0, doorY + 3.5, doorZ + 1], spread: [4.5, 3.4, 4.5], size: 0.022,
    color: '#ff3a24', color2: '#ffb090', intensity: 2.2, speed: 0.3, repel: 1.4,
  }).points);
  ch.group.add(createParticles({
    mode: 'float', count: 1200, seed: 93, center: [0, doorY + 2, doorZ - 6], spread: [60, 5, 20], size: 0.03,
    color: '#9aa4ae', intensity: 0.8, speed: 0.6, repel: 1.5,
  }).points);

  ch.addLight([0, doorY + 2.6, doorZ + 3.5], '#ff2414', 300, 40);
  ch.addLight([0, doorY + 4, doorZ - 4], '#ff1a0c', 180, 26);
  ch.addLight([-30, 60, 60], '#8c96a2', 1600, 220);
  ch.setKey([0, 10, -20], [-0.35, 0.55, 0.75], '#aab4c0', 0.55, 60, 260);
  ch.setGlow([0, doorY + 3.2, doorZ + 0.5], '#ff2412', 0.28, () => 1 + doorU.uPulse.value * 0.4);

  // the thread comes down from the sky, runs the path and dives through the door
  const pts = [ch.w(-11, 56, 134), ch.w(-13, 43, 114), ch.w(-10, 29.5, 94), ch.w(-4, 16, 73), ch.w(pathX(52) + 0.6, H(pathX(52), 52) + 1.4, 52)];
  for (let z = 44; z > doorZ + 2; z -= 7) pts.push(ch.w(pathX(z), H(pathX(z), z) + 0.05, z));
  pts.push(ch.w(0, doorY + 0.55, doorZ + 1.2), ch.w(0, doorY + 0.6, doorZ), ch.w(0, doorY - 0.6, doorZ - 4), ch.w(0, doorY - 8, doorZ - 9));
  ch.thread.push(...pts);
  ch.pathX = pathX;

  const dc = new THREE.Vector3();
  ch.onUpdate(({ t, dt, raycaster, input, camera }) => {
    doorU.uPulse.value = 0.5 + 0.5 * Math.sin(t * 1.3) * Math.sin(t * 0.37 + 1);
    dc.copy(ch.doorCenter).applyMatrix4(ch.group.matrixWorld);
    const d = raycaster.ray.distanceToPoint(dc);
    doorU.uHover.value = damp(doorU.uHover.value, clamp(1 - d / 5, 0, 1) * (0.6 + input.energy), 4, dt);
    doorU.uOpen.value = 1 - clamp((camera.position.distanceTo(dc) - 1.5) / 7, 0, 1);
  });
  return ch;
}
