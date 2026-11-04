import * as THREE from 'three';
import { FOG } from './glsl.js';

/**
 * Six pooled point lights, one shadowed key and a hemisphere, cross-faded between the two
 * chapters either side of the camera. Chapters declare lights; the rig borrows them.
 */
export class LightRig {
  constructor(scene, { shadowSize = 2048 } = {}) {
    this.points = [];
    for (let i = 0; i < 6; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 40, 2);
      scene.add(p);
      this.points.push(p);
    }
    this.key = new THREE.DirectionalLight(0xffffff, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(shadowSize, shadowSize);
    this.key.shadow.bias = -4e-4;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 3;
    scene.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0, 0.3);
    scene.add(this.hemi);
    this.keyOwner = -1;
  }

  assign(lights, offset, weight) {
    for (let i = 0; i < 3; i++) {
      const p = this.points[offset + i];
      const l = lights && lights[i];
      if (!l || weight <= 1e-4) {
        p.intensity = 0;
        continue;
      }
      p.position.copy(l.pos);
      p.color.copy(l.color);
      p.intensity = l.intensity * weight * (l.flicker ? l.flicker() : 1);
      p.distance = l.distance ?? 50;
      p.decay = l.decay ?? 2;
    }
  }

  update(f, chapters, look) {
    const n = chapters.length;
    const a = Math.max(0, Math.min(n - 1, Math.floor(f)));
    const b = Math.min(n - 1, a + 1);
    const t = Math.min(1, Math.max(0, f - a));
    const wa = a === b ? 1 : 1 - t;
    const wb = a === b ? 0 : t;
    const A = chapters[a], B = chapters[b];
    this.assign(A.lights, 0, wa);
    this.assign(B.lights, 3, wb);

    // the key hands over at the midpoint, dipping to nothing so the swap is invisible
    const owner = t < 0.5 ? A : B;
    const kw = a === b ? 1 : t < 0.5 ? 1 - 2 * t : 2 * t - 1;
    const k = owner.key;
    if (k) {
      this.key.position.copy(k.pos);
      this.key.target.position.copy(k.target);
      this.key.color.copy(k.color);
      this.key.intensity = k.intensity * kw ** 0.6;
      if (this.keyOwner !== owner.index) {
        const c = this.key.shadow.camera;
        c.left = -k.box; c.right = k.box; c.top = k.box; c.bottom = -k.box;
        c.near = 0.5;
        c.far = k.far ?? 200;
        c.updateProjectionMatrix();
        this.keyOwner = owner.index;
      }
    } else this.key.intensity = 0;
    this.key.target.updateMatrixWorld();

    const ga = A.glow, gb = B.glow;
    if (ga) {
      FOG.uGlowPos.value.copy(ga.pos);
      FOG.uGlowColor.value.copy(ga.color).multiplyScalar(wa * look.glowMul * (ga.pulse ? ga.pulse() : 1));
    } else FOG.uGlowColor.value.setRGB(0, 0, 0);
    if (gb && wb > 0) {
      FOG.uGlowPos2.value.copy(gb.pos);
      FOG.uGlowColor2.value.copy(gb.color).multiplyScalar(wb * look.glowMul * (gb.pulse ? gb.pulse() : 1));
    } else FOG.uGlowColor2.value.setRGB(0, 0, 0);

    this.hemi.color.copy(look.hemiSky);
    this.hemi.groundColor.copy(look.hemiGround);
    this.hemi.intensity = look.hemi;
  }
}
