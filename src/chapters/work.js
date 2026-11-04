import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Chapter } from '../world/chapter.js';
import { rockGeometry } from '../world/rocks.js';
import { createGrass } from '../world/grass.js';
import { createClouds } from '../world/fx.js';
import { G } from '../core/glsl.js';
import { rng, clamp, damp, smooth } from '../core/util.js';
import { PROJECTS } from '../data.js';
import { WorkLabels, WorkModal } from '../ui/work.js';

function loadCover(src, onAspect, onReady) {
  const tex = new THREE.TextureLoader().setCrossOrigin('anonymous').load(src, (t) => {
    onAspect(t.image.width / Math.max(1, t.image.height));
    onReady();
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 04 — floating islands of violet grass, and a ring of glass panels around an egg.
 * Each panel shows one project; point at one and it tilts toward you; click to open it.
 */
export function buildWork(world) {
  const ch = new Chapter({ id: 'work', index: 3, origin: world.layout.work, yaw: world.layout.workYaw });
  const r = rng(330);
  const center = new THREE.Vector3(0, 3.4, 0);
  ch.center = center;
  ch.eggS = null;

  const islands = [];
  [
    [0, 0.35, 0, 2.2, 1], [-9.5, 1.2, -6, 1.6, 0.7], [10.5, 4.4, -4.5, 1.2, 0.6], [-7.5, 6.8, 7.5, 0.9, 0.5],
    [7, -1.6, 9.5, 1.5, 0.7], [-3, -3.5, -11, 2.4, 0.8], [13, 0.5, 6, 0.8, 0.4],
  ].forEach(([x, y, z, s, share], i) => {
    const m = new THREE.Mesh(rockGeometry({ seed: 900 + i, detail: 4, amp: 0.2, cuts: 10, cutDepth: 0.5, flat: 1, scale: [1.35, 0.55, 1.15] }), world.materials.basalt);
    m.position.set(x, y, z);
    m.scale.setScalar(s);
    m.rotation.set(r() * 0.3, r() * 6, r() * 0.3);
    m.castShadow = m.receiveShadow = true;
    ch.group.add(m);
    islands.push({ x, y: y + s * 0.42, z, r: s * 1.05, share });
  });
  const totalShare = islands.reduce((a, b) => a + b.share, 0);
  const grass = createGrass({
    count: Math.round(16000 * (world.quality.grass ?? 1)), seed: 331,
    placer: (v, rand) => {
      let k = rand() * totalShare;
      let isl = islands[0];
      for (const it of islands) {
        k -= it.share;
        if (k <= 0) { isl = it; break; }
      }
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * isl.r;
      v.set(isl.x + Math.cos(a) * d, isl.y - (d / isl.r) * (d / isl.r) * 0.35 * isl.r, isl.z + Math.sin(a) * d * 0.85);
    },
    hMin: 0.15, hMax: 0.95, width: 0.036, lean: 0.38, base: '#030305', tipA: '#5a4a7c', tipB: '#3c4a64', glow: '#b48cff', glowAmt: 0.05, rim: 0.12,
  });
  ch.group.add(grass.mesh);
  ch.grass = grass;
  const gu = grass.uniforms;
  const grassBase = { a: gu.uTipA.value.clone(), b: gu.uTipB.value.clone(), g: gu.uGlow.value.clone() };
  const tints = PROJECTS.map((p) => new THREE.Color(p.color));
  ch.tint = new THREE.Color();
  ch.tintW = 0;
  const hsl = { h: 0, s: 0, l: 0 };
  const tmpC = new THREE.Color();

  ch.group.add(createClouds({
    count: 16, seed: 336, center: [0, -1.5, 0], spread: [16, 1.2, 16], sizeMin: 8, sizeMax: 16,
    lit: '#2c2c34', litMul: 0.8, shadow: '#020203', opacity: 0.18, density: 0.42,
  }).mesh);

  const panels = [];
  const hitMeshes = [];
  const RING = 5.7;
  const lifts = [0.35, -0.3, 0.5, -0.15];
  PROJECTS.forEach((p, i) => {
    const ang = 0.6 + (i / PROJECTS.length) * Math.PI * 2;
    const g = new THREE.Group();
    const base = new THREE.Vector3(Math.sin(ang) * RING, center.y + lifts[i % lifts.length], Math.cos(ang) * RING);
    g.position.copy(base);
    g.lookAt(base.clone().multiplyScalar(2).setY(base.y));
    g.rotateY((i % 2 ? -1 : 1) * 0.22);
    g.rotateX((r() - 0.5) * 0.08);
    g.rotateZ((r() - 0.5) * 0.06);
    const baseRot = g.rotation.clone();
    const tint = new THREE.Color(p.color);
    const tile = new THREE.MeshPhysicalMaterial({
      color: '#0b0a10', roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3,
      specularIntensity: 1, iridescence: 0.35, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 480], emissive: tint, emissiveIntensity: 0.05,
    });
    const slab = new THREE.Mesh(new THREE.BufferGeometry(), tile);
    slab.userData.panel = i;
    slab.castShadow = true;
    g.add(slab);
    hitMeshes.push(slab);
    const mu = {
      map: { value: null },
      uSize: { value: new THREE.Vector2(1, 1) },
      uRad: { value: 0.05 },
      uTint: { value: tint.clone() },
      uReady: { value: 0 },
      uTime: G.uTime,
    };
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: mu,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec2 uSize; uniform float uRad, uReady, uTime; uniform vec3 uTint;
        varying vec2 vUv;
        void main(){
          vec2 q = abs((vUv - 0.5) * uSize) - (uSize * 0.5 - uRad);
          if (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRad > 0.0) discard;
          vec3 idle = uTint * (0.05 + 0.06 * (0.5 + 0.5 * sin(vUv.x * 3.0 + uTime * 0.8)));
          gl_FragColor = vec4(mix(idle, texture2D(map, vUv).rgb, uReady), 1.0);
        }`,
    }));
    g.add(screen);
    const W = 3.4, BORDER = 0.07;
    const panel = { p, k: i, g, base, baseRot, tile, mu, size: new THREE.Vector2(), hover: 0, tiltX: 0, tiltY: 0, phase: r() * 10, ang };
    const fit = (aspect) => {
      const h = W / aspect;
      slab.geometry.dispose();
      slab.geometry = new RoundedBoxGeometry(3.54, h + BORDER * 2, 0.14, 4, 0.065);
      screen.scale.set(W, h, 1);
      screen.position.z = 0.074;
      mu.uSize.value.set(W, h);
      panel.size.set(3.54, h + BORDER * 2);
    };
    mu.map.value = loadCover(p.media[0], fit, () => { mu.uReady.value = 1; });
    ch.group.add(g);
    panels.push(panel);
    fit(16 / 9.4);
  });
  ch.panels = panels;

  // camera shots used by the story: face a panel, or orbit the egg
  ch.panelShot = (i, { dist = 12.6, lead = 0.34, lift = 0.6, mix = 0.28 } = {}) => {
    const pn = panels[i];
    const a = pn.ang + lead;
    return {
      pos: [Math.sin(a) * dist, pn.base.y + lift, Math.cos(a) * dist],
      look: pn.base.clone().lerp(center, mix).toArray(),
      focus: pn.base.toArray(),
      k: i,
    };
  };
  ch.shotS = [];
  ch.orbitShot = (a, dist, lift = 0.4) => ({ pos: [Math.sin(a) * dist, center.y + lift, Math.cos(a) * dist], look: center.toArray() });

  ch.addLight([-4.5, 6.5, -5.5], '#ff5ad8', 380, 30);
  ch.addLight([5, 5.5, -6], '#4fc8ff', 380, 30);
  ch.addLight([0, 4.1, -2.8], '#b98cff', 40, 9);
  ch.lights.forEach((l) => { l.base = l.color.clone(); });
  ch.setKey([0, 3, 0], [0.25, 0.75, -0.65], '#e6e2ff', 0.85, 8, 160);
  ch.setGlow([0, 4, -16], '#4a3a6e', 0.1);
  ch.thread.push(
    ch.w(12, 11, 24), ch.w(5.5, 8.6, 7.5), ch.w(2.6, 6.2, 2.4), ch.w(2.9, 4.6, -1.6), ch.w(0.4, 4.3, -3.4),
    ch.w(-2.9, 3.9, -1.9), ch.w(-3, 3.5, 1.5), ch.w(-1.2, 3.3, 2.6), ch.w(-0.4, 3.25, 1.35), ch.w(0.05, 3.1, 0.62),
    ch.w(0.35, 2.8, -1.3), ch.w(0.7, 1.3, -3.5), ch.w(2.6, -1.4, -9.5),
  );
  ch.threadTouch = 9; // the thread point that passes through the egg

  const modal = new WorkModal(PROJECTS);
  ch.modal = modal;
  const labels = new WorkLabels(PROJECTS, (i) => modal.open(i));
  let hovered = -1;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  addEventListener('click', (e) => {
    if (!ch.group.visible || modal.isOpen || (e.target.closest && e.target.closest('#ui a, #ui button, .work-modal, footer'))) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, world.camera);
    const hit = ray.intersectObjects(hitMeshes, false)[0];
    if (hit) modal.open(hit.object.userData.panel);
  });

  const local = new THREE.Vector3();
  ch.onUpdate(({ t, dt, raycaster, st, awake = 0 }) => {
    const hit = modal.isOpen ? null : raycaster.intersectObjects(hitMeshes, false)[0];
    const h = hit && awake < 0.05 ? hit.object.userData.panel : -1;
    const wake = smooth(0, 1, awake);
    const spread = 1 + wake * 0.9; // panels fly outward as the figure wakes
    if (h !== hovered) {
      hovered = h;
      document.body.classList.toggle('hovering', h >= 0);
    }
    // tint the grass and rim lights toward the project in view
    let wsum = 0;
    ch.tint.setRGB(0, 0, 0);
    for (let i = 0; i < ch.shotS.length; i++) {
      const w = Math.exp(-(((st.s - ch.shotS[i]) / 0.8) ** 2)) * (1 - wake);
      if (w < 0.001) continue;
      ch.tint.r += tints[i].r * w;
      ch.tint.g += tints[i].g * w;
      ch.tint.b += tints[i].b * w;
      wsum += w;
    }
    if (wsum > 0) ch.tint.multiplyScalar(1 / wsum);
    ch.tintW = damp(ch.tintW, Math.min(1, wsum), 3, dt);
    ch.tint.getHSL(hsl);
    tmpC.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), 0.55);
    gu.uGlow.value.copy(grassBase.g).lerp(tmpC, ch.tintW);
    tmpC.setHSL((hsl.h + 0.07) % 1, Math.min(1, hsl.s * 0.7), 0.36);
    gu.uTipA.value.copy(grassBase.a).lerp(tmpC, ch.tintW);
    tmpC.setHSL((hsl.h + 0.92) % 1, Math.min(1, hsl.s * 0.7), 0.3);
    gu.uTipB.value.copy(grassBase.b).lerp(tmpC, ch.tintW);
    for (let i = 0; i < 2; i++) {
      tmpC.setHSL((hsl.h + (i ? -0.06 : 0.05) + 1) % 1, 1, 0.6);
      ch.lights[i].color.copy(ch.lights[i].base).lerp(tmpC, ch.tintW);
    }

    let label = hovered;
    if (label < 0 && !modal.isOpen && awake < 0.05) {
      for (let i = 0; i < ch.shotS.length; i++) if (Math.abs(st.s - ch.shotS[i]) < 0.55) label = i;
    }
    for (const pn of panels) {
      const on = pn.k === hovered ? 1 : 0;
      pn.hover = damp(pn.hover, on, 6, dt);
      let tx = 0, ty = 0;
      if (on && hit) {
        local.copy(hit.point);
        pn.g.worldToLocal(local);
        tx = clamp(local.x / (pn.size.x / 2), -1, 1);
        ty = clamp(local.y / (pn.size.y / 2), -1, 1);
      }
      pn.tiltX = damp(pn.tiltX, -ty * 0.14 * on, 5, dt);
      pn.tiltY = damp(pn.tiltY, tx * 0.18 * on, 5, dt);
      const bob = Math.sin(t * 0.6 + pn.phase) * 0.12;
      pn.g.position.set(pn.base.x * spread, pn.base.y + bob + pn.hover * 0.08 - wake * 1.6, pn.base.z * spread);
      pn.g.rotation.set(
        pn.baseRot.x + pn.tiltX + Math.sin(t * 0.4 + pn.phase) * 0.02,
        pn.baseRot.y + pn.tiltY,
        pn.baseRot.z + Math.sin(t * 0.33 + pn.phase) * 0.015,
      );
      pn.g.scale.setScalar(1 + pn.hover * 0.04);
      pn.tile.emissiveIntensity = 0.05 + pn.hover * 0.3;
    }
    if (label >= 0) labels.show(label, hovered === label);
    else labels.show(-1);
  });
  ch.onHide = () => {
    labels.reset();
    if (hovered >= 0) {
      hovered = -1;
      document.body.classList.remove('hovering');
    }
  };
  return ch;
}
