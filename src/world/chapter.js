import * as THREE from 'three';

/**
 * A chapter is a set placed somewhere in the world. Everything inside is authored in local
 * coordinates; `w()` converts to world space. Chapters declare lights, a key, a fog glow,
 * and the stretch of red thread that runs through them.
 */
export class Chapter {
  constructor({ id, index, origin = [0, 0, 0], yaw = 0 }) {
    this.id = id;
    this.index = index;
    this.group = new THREE.Group();
    this.group.name = id;
    this.group.position.set(...origin);
    this.group.rotation.y = yaw;
    this.group.updateMatrixWorld(true);
    this.origin = this.group.position.clone();
    this.lights = [];
    this.key = null;
    this.glow = null;
    this.thread = [];
    this.slots = {};
    this.updaters = [];
    this.visible = true;
  }

  w(x, y, z) {
    if (Array.isArray(x)) [x, y, z] = x;
    return new THREE.Vector3(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  dir(x, y, z) {
    return new THREE.Vector3(x, y, z).transformDirection(this.group.matrixWorld);
  }

  addLight(pos, color, intensity, distance = 50, extra = {}) {
    this.lights.push({ pos: this.w(pos), color: new THREE.Color(color), intensity, distance, ...extra });
  }

  setKey(target, dir, color, intensity, box = 14, far = 200) {
    const t = this.w(target);
    const d = this.dir(...dir).normalize();
    this.key = { target: t, pos: t.clone().addScaledVector(d, 80), color: new THREE.Color(color), intensity, box, far };
  }

  setGlow(pos, color, amount, pulse) {
    this.glow = { pos: this.w(pos), color: new THREE.Color(color).multiplyScalar(amount), pulse };
  }

  slot(name, pos, { rotY = 0, scale = 1, height = 1.75 } = {}) {
    const g = new THREE.Group();
    g.name = `slot:${name}`;
    g.position.set(...pos);
    g.rotation.y = rotY;
    g.scale.setScalar(scale);
    g.userData.height = height;
    this.group.add(g);
    this.slots[name] = g;
    return g;
  }

  onUpdate(fn) {
    this.updaters.push(fn);
  }

  update(ctx) {
    for (const fn of this.updaters) fn(ctx);
  }
}
