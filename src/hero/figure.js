import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchMaterial, inject } from '../core/glsl.js';
import { clamp, damp, lerp, smooth } from '../core/util.js';

const DEG = Math.PI / 180;

// Our rig names → the Mixamo bones in the model.
const BONE_MAP = {
  spine: 'mixamorigSpine', spine1: 'mixamorigSpine1', chest: 'mixamorigSpine2', neck: 'mixamorigNeck', head: 'mixamorigHead',
  shoulderL: 'mixamorigLeftShoulder', shoulderR: 'mixamorigRightShoulder',
  upper_armL: 'mixamorigLeftArm', upper_armR: 'mixamorigRightArm',
  forearmL: 'mixamorigLeftForeArm', forearmR: 'mixamorigRightForeArm',
  handL: 'mixamorigLeftHand', handR: 'mixamorigRightHand',
  thighL: 'mixamorigLeftUpLeg', thighR: 'mixamorigRightUpLeg',
  shinL: 'mixamorigLeftLeg', shinR: 'mixamorigRightLeg',
  footL: 'mixamorigLeftFoot', footR: 'mixamorigRightFoot',
};

// Three poses as world-axis euler offsets (deg, YXZ) from an arms-down rest pose.
// EMBRYO: curled in the egg. POWER: standing, chest open. FLY: leaning into the wind.
const EMBRYO = {
  spine: [16, 0, 2], spine1: [16, 0, 1], chest: [11, 2, 0], neck: [15, 0, 0], head: [16, 5, -3],
  shoulderL: [0, -10, 3], shoulderR: [0, 10, -3], upper_armL: [-52, -12, 8], upper_armR: [-46, 10, -10],
  forearmL: [-80, -22, 0], forearmR: [-86, 24, 0], handL: [12, 0, 6], handR: [10, 0, -6],
  thighL: [-100, -4, 5], thighR: [-92, 4, -4], shinL: [116, 0, 0], shinR: [108, 0, 0], footL: [30, 0, 2], footR: [26, 0, -2],
};
const POWER = {
  spine: [-4, 0, 0], spine1: [-5, 0, 0], chest: [-7, 0, 0], neck: [-1, 0, 0], head: [-3, 0, 0],
  shoulderL: [0, 6, 8], shoulderR: [0, -6, -8], upper_armL: [10, 0, 24], upper_armR: [10, 0, -24],
  forearmL: [-62, 8, 0], forearmR: [-62, -8, 0], handL: [-12, 0, 0], handR: [-12, 0, 0],
  thighL: [-14, 0, 11], thighR: [-14, 0, -11], shinL: [26, 0, 0], shinR: [26, 0, 0], footL: [14, 0, -6], footR: [14, 0, 6],
};
const FLY = {
  spine: [-6, 0, 0], spine1: [-7, 0, 0], chest: [-8, 0, 0], neck: [-28, 0, 0], head: [-26, 0, 0],
  shoulderL: [0, 8, 6], shoulderR: [0, -8, -6], upper_armL: [30, 0, 14], upper_armR: [30, 0, -14],
  forearmL: [-16, 0, 0], forearmR: [-16, 0, 0], handL: [-4, 0, 0], handR: [-4, 0, 0],
  thighL: [6, 0, 6], thighR: [3, 0, -6], shinL: [22, 0, 0], shinR: [12, 0, 0], footL: [44, 0, 0], footR: [40, 0, 0],
};
const NAMES = Object.keys(EMBRYO);

// Rest-pose arm directions (model space) the poses above were authored against: arms hanging
// ~15° out from the body, forearms slightly forward.
const REST_DIRS = {
  upper_armL: new THREE.Vector3(0.263, -0.965, 0.015), forearmL: new THREE.Vector3(0.113, -0.941, 0.32),
  upper_armR: new THREE.Vector3(-0.263, -0.965, 0.015), forearmR: new THREE.Vector3(-0.113, -0.941, 0.32),
};
const CHILD = { upper_armL: 'forearmL', forearmL: 'handL', upper_armR: 'forearmR', forearmR: 'handR' };

function eyeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,245,190,0.85)');
  g.addColorStop(0.45, 'rgba(255,210,60,0.25)');
  g.addColorStop(1, 'rgba(255,190,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The figure: a rigged mannequin posed procedurally — blended between curled, standing and
 * flying, reaching toward the cursor, looking at the lens, with eyes that ignite and a
 * surge of light that climbs it as it wakes.
 */
export function createFigure({ url = '/models/figure.glb', scale = 2 } = {}) {
  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);
  const uniforms = {
    uRim: { value: 0 },
    uRimCol: { value: new THREE.Color('#b9b2ff') },
    uShade: { value: 1 },
    uSpec: { value: 0.12 },
    uCharge: { value: 0 },
    uChargeT: { value: 0 },
    uYRange: { value: new THREE.Vector2(0, 1) },
  };
  const state = {
    ready: false, charge: 0, model: null, bones: {}, rest: {}, head: null, eyes: [], halos: [], headScale: 1,
    ctrl: { reachL: 0, reachR: 0, kick: 0, open: 0, lookW: 0 },
  };
  let eyeMat, haloMat;

  const ready = new Promise((resolve) => {
    new GLTFLoader().load(url, (gltf) => {
      try {
        setup(gltf);
      } catch (e) {
        console.error(e);
      }
      resolve();
    }, undefined, (e) => {
      console.warn('[figure]', e);
      resolve();
    });
  });

  function aimBone(bone, child, dirModel) {
    bone.updateWorldMatrix(true, true);
    const bp = bone.getWorldPosition(new THREE.Vector3());
    const cp = child.getWorldPosition(new THREE.Vector3());
    const cur = cp.sub(bp).normalize();
    const want = dirModel.clone().normalize();
    const dq = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const wq = bone.getWorldQuaternion(new THREE.Quaternion());
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq)));
    bone.updateWorldMatrix(false, true);
  }

  function setup(gltf) {
    const scene = gltf.scene;
    const skinned = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    if (!skinned.length) return;
    // normalise: 1.9 tall, centred on the origin, like the rig the poses were made for
    const box = new THREE.Box3().setFromObject(scene);
    const k = 1.9 / (box.max.y - box.min.y);
    const norm = new THREE.Group();
    scene.scale.setScalar(k);
    scene.position.y = -box.min.y * k - 0.95;
    norm.add(scene);
    const model = new THREE.Group();
    model.add(norm);
    model.updateMatrixWorld(true);

    const bones = {};
    for (const [ours, theirs] of Object.entries(BONE_MAP)) {
      const b = scene.getObjectByName(theirs);
      if (b) bones[ours] = b;
    }
    // T-pose → arms down
    for (const name of ['upper_armL', 'upper_armR', 'forearmL', 'forearmR']) {
      if (bones[name] && bones[CHILD[name]]) aimBone(bones[name], bones[CHILD[name]], REST_DIRS[name]);
    }
    model.updateMatrixWorld(true);

    const wq = new THREE.Quaternion();
    for (const name of NAMES) {
      const b = bones[name];
      if (!b) continue;
      b.getWorldQuaternion(wq);
      state.rest[name] = { L0: b.quaternion.clone(), W0: wq.clone(), W0inv: wq.clone().invert(), pos: b.getWorldPosition(new THREE.Vector3()) };
    }
    const toLocal = (name, v) => v.clone().applyQuaternion(state.rest[name].W0inv).normalize();
    state.rest.head.fLocal = toLocal('head', new THREE.Vector3(0, 0, 1));
    state.rest.neck.fLocal = toLocal('neck', new THREE.Vector3(0, 0, 1));
    for (const s of ['L', 'R']) {
      const ua = state.rest[`upper_arm${s}`], fa = state.rest[`forearm${s}`];
      ua.fLocal = toLocal(`upper_arm${s}`, fa.pos.clone().sub(ua.pos));
    }
    state.bones = bones;

    // glowing eyes, parented to the head
    const head = bones.head;
    const headInv = new THREE.Matrix4().copy(head.matrixWorld).invert();
    const tex = eyeGlowTexture();
    eyeMat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(0, 0, 0), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
    haloMat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(0, 0, 0), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
    const eyeL = scene.getObjectByName('mixamorigLeftEye');
    const eyeR = scene.getObjectByName('mixamorigRightEye');
    const eyePts = eyeL && eyeR
      ? [eyeL.getWorldPosition(new THREE.Vector3()), eyeR.getWorldPosition(new THREE.Vector3())]
      : [new THREE.Vector3(-0.039, 0.8, 0.128), new THREE.Vector3(0.039, 0.8, 0.128)];
    for (const p of eyePts) {
      p.z += 0.03; // sit just proud of the face
      const local = p.clone().applyMatrix4(headInv);
      const eye = new THREE.Sprite(eyeMat);
      eye.position.copy(local);
      eye.renderOrder = 31;
      head.add(eye);
      state.eyes.push(eye);
      const halo = new THREE.Sprite(haloMat);
      halo.position.copy(local);
      halo.renderOrder = 30;
      head.add(halo);
      state.halos.push(halo);
    }
    state.head = head;

    // matte clay with a rim light and the waking surge
    const yr = new THREE.Box3();
    for (const m of skinned) {
      m.geometry.computeBoundingBox();
      yr.union(m.geometry.boundingBox);
    }
    uniforms.uYRange.value.set(yr.min.y, yr.max.y);
    skinned.forEach((m, i) => {
      const joints = /joint/i.test(m.name);
      const mat = new THREE.MeshStandardMaterial({ color: joints ? '#2b2b30' : '#ffffff', side: THREE.DoubleSide, metalness: 0, roughness: 1, envMapIntensity: 0.35 });
      if (!joints) mat.color.setScalar(0.72);
      patchMaterial(mat, {
        key: `figure-skin-${i}`,
        uniforms,
        vertex: (src) => inject(inject(src, '#include <common>', 'varying vec3 vObjP;'), '#include <begin_vertex>', 'vObjP = position;'),
        fragment: (src) => {
          src = inject(src, '#include <common>', 'uniform float uRim, uShade, uSpec, uCharge, uChargeT; uniform vec3 uRimCol; uniform vec2 uYRange; varying vec3 vObjP;');
          src = inject(src, '#include <color_fragment>', 'diffuseColor.rgb *= uShade;');
          src = inject(src, '#include <emissivemap_fragment>', /* glsl */ `
            float rim = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);
            totalEmissiveRadiance += uRimCol * rim * uRim;
            if (uCharge > 0.001) {
              // a surge of light climbs the body, feet to crown, over and over — faster as the charge builds
              float hy = clamp((vObjP.y - uYRange.x) / max(1e-3, uYRange.y - uYRange.x), 0.0, 1.0);
              float wob = fbm3(vObjP * 6.0 / max(1e-3, uYRange.y - uYRange.x) * 1.9 + vec3(0.0, -uChargeT * 0.6, 0.0)) * 0.06;
              float front = fract(uChargeT * 0.12) * 1.2 - 0.1;
              float dh = hy + wob - front;
              float surge = exp(-dh * dh / 0.003);
              float trail = smoothstep(0.0, -0.08, dh) * smoothstep(-0.45, -0.08, dh) * 0.05;
              float veins = pow(1.0 - abs(fbm3(vObjP * 8.0 / max(1e-3, uYRange.y - uYRange.x) * 1.9 + vec3(0.0, -uChargeT * 0.9, 0.0))), 24.0);
              float fr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);
              vec3 ec = mix(vec3(0.55, 0.42, 1.0), vec3(1.0, 0.86, 0.6), smoothstep(0.5, 1.0, uCharge));
              totalEmissiveRadiance += ec * uCharge * (fr * 0.45 + surge * (0.35 + veins * 1.8) + trail) * 1.1;
            }
          `);
          return inject(src, '#include <lights_fragment_end>', `
            reflectedLight.directSpecular *= uSpec;
            reflectedLight.indirectSpecular *= uSpec;
          `);
        },
      });
      m.material = mat;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
    });

    model.scale.setScalar(scale);
    root.add(model);
    model.updateMatrixWorld(true);
    state.headScale = head.getWorldScale(new THREE.Vector3()).x;
    state.model = model;
    state.ready = true;
  }

  // apply the blended pose: world-axis offsets on top of rest, bone by bone down the chain
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const qq = new THREE.Quaternion();
  const pose = {};
  function applyPose() {
    for (const name of NAMES) {
      const b = state.bones[name], rest = state.rest[name];
      if (!b || !rest) continue;
      const p = pose[name];
      e.set(p[0] * DEG, p[1] * DEG, p[2] * DEG, 'YXZ');
      q.setFromEuler(e);
      qq.copy(rest.W0inv).multiply(q).multiply(rest.W0);
      b.quaternion.copy(rest.L0).multiply(qq);
    }
  }

  // turn a bone so its forward axis heads toward a world point, by at most `maxAng`
  const bp = new THREE.Vector3(), bq = new THREE.Quaternion(), pq = new THREE.Quaternion();
  const fw = new THREE.Vector3(), to = new THREE.Vector3(), dq = new THREE.Quaternion(), full = new THREE.Quaternion(), I = new THREE.Quaternion();
  function aimToward(name, target, weight, maxAng) {
    const b = state.bones[name], rest = state.rest[name];
    if (!b || !rest || !rest.fLocal || weight <= 0.001) return;
    b.updateWorldMatrix(true, false);
    b.getWorldPosition(bp);
    b.getWorldQuaternion(bq);
    fw.copy(rest.fLocal).applyQuaternion(bq);
    to.copy(target).sub(bp).normalize();
    const ang = fw.angleTo(to);
    if (ang < 1e-4) return;
    full.setFromUnitVectors(fw, to);
    const k = Math.min(weight, maxAng / ang);
    dq.slerpQuaternions(I, full, k);
    b.parent.getWorldQuaternion(pq);
    b.quaternion.copy(pq.invert().multiply(dq).multiply(bq));
  }

  const near = new THREE.Vector3(), headW = new THREE.Vector3(), localNear = new THREE.Vector3();
  const toCam = new THREE.Vector3(), headFwd = new THREE.Vector3(), hq = new THREE.Quaternion();
  let breath = 0;
  function update({ t, dt, raycaster, input, camera, awake = 0, fly = 0, stir = 1 }) {
    if (!state.ready || !Number.isFinite(camera.position.x + raycaster.ray.direction.x)) return;
    const c = state.ctrl;
    for (const k in c) if (!Number.isFinite(c[k])) c[k] = 0;
    if (!Number.isFinite(state.charge)) state.charge = 0;
    const aw = smooth(0, 1, awake);
    const fl = smooth(0, 1, fly);
    const curious = (1 - aw) * stir; // only reacts to the cursor while still asleep

    // where the cursor ray passes the head, in the figure's own space
    state.head.getWorldPosition(headW);
    const ray = raycaster.ray;
    const along = Math.max(0, headW.clone().sub(ray.origin).dot(ray.direction));
    near.copy(ray.origin).addScaledVector(ray.direction, along);
    localNear.copy(near);
    root.worldToLocal(localNear);
    const ms = state.model.scale.x;
    localNear.divideScalar(ms);
    const prox = clamp(1 - near.distanceTo(headW) / (4 * ms), 0, 1);
    const reach = prox * prox * (0.3 + input.energy * 0.9) * curious;
    c.reachL = damp(c.reachL, smooth(0.05, 0.5, localNear.x) * reach, 3, dt);
    c.reachR = damp(c.reachR, smooth(-0.05, -0.5, localNear.x) * reach, 3, dt);
    c.kick = damp(c.kick, (smooth(-0.1, -0.9, localNear.y) + input.energy * 0.35) * curious, 3, dt);
    c.open = damp(c.open, (prox * 0.6 + input.energy * 0.25) * curious, 2, dt);
    c.lookW = damp(c.lookW, (0.1 + prox * prox * 0.6) * curious, 2, dt);
    breath += dt * (1.25 + aw * 0.5);
    const chestBreath = Math.sin(breath) * (2.2 + aw * 1.2 * (1 - fl));
    const twitch = Math.sin(t * 2.6) * input.energy * 5 * curious;

    for (const name of NAMES) {
      const a = EMBRYO[name], b = POWER[name], f = FLY[name];
      pose[name] = [0, 1, 2].map((i) => lerp(lerp(a[i], b[i], aw), f[i], fl));
    }
    for (const n of ['spine', 'spine1', 'chest']) pose[n][0] *= 1 - c.open * 0.3;
    pose.chest[0] += chestBreath;
    pose.forearmL[0] += c.reachL * 50; pose.forearmL[1] += c.reachL * 45;
    pose.upper_armL[0] -= c.reachL * 26; pose.upper_armL[1] += c.reachL * 22;
    pose.forearmR[0] += c.reachR * 50; pose.forearmR[1] -= c.reachR * 45;
    pose.upper_armR[0] -= c.reachR * 26; pose.upper_armR[1] -= c.reachR * 22;
    pose.thighL[0] += c.kick * 20 + twitch; pose.thighR[0] += c.kick * 14 - twitch;
    pose.shinL[0] -= c.kick * 34; pose.shinR[0] -= c.kick * 26;
    pose.thighL[0] += Math.sin(t * 2.3) * 4 * fl;
    pose.thighR[0] += Math.sin(t * 2.3 + 2.2) * 4 * fl;
    pose.footL[0] += Math.sin(t * 1.7) * 6;
    pose.footR[0] += Math.sin(t * 1.9 + 1) * 6;
    // arms ripple like they're floating: a wave runs shoulder → hand
    const drift = 0.18 * curious + 0.35 * aw * (1 - fl) + fl;
    const ripple = (s, phase) => {
      const w = (off, amp, spd = 0.9) => Math.sin(t * spd + phase - off) * amp * drift;
      pose[`shoulder${s}`][2] += w(0, 3);
      pose[`upper_arm${s}`][0] += w(0.5, 9);
      pose[`upper_arm${s}`][2] += w(0.9, 6, 0.7) * (s === 'L' ? 1 : -1);
      pose[`forearm${s}`][0] += w(1.3, 12);
      pose[`forearm${s}`][1] += w(1.7, 6, 0.7);
      pose[`hand${s}`][0] += w(2.2, 16);
      pose[`hand${s}`][2] += w(2.6, 8, 1.1);
    };
    ripple('L', 0);
    ripple('R', 1.9);
    applyPose();
    root.updateMatrixWorld(true);
    if (curious > 0.01) {
      aimToward('neck', near, c.lookW * 0.4, 40 * DEG);
      aimToward('head', near, c.lookW * 0.85, 60 * DEG);
      aimToward('upper_armL', near, c.reachL * 0.45, 50 * DEG);
      aimToward('upper_armR', near, c.reachR * 0.45, 50 * DEG);
    }
    // once awake, it looks straight down the lens
    const meet = smooth(0.35, 0.8, awake) * (1 - fl);
    if (meet > 0.01) {
      aimToward('neck', camera.position, meet * 0.4, 30 * DEG);
      aimToward('head', camera.position, meet * 0.9, 50 * DEG);
    }
    state.charge = damp(state.charge, smooth(0.45, 1, awake), 3, dt);
    const ignite = smooth(0.3, 0.85, awake);
    state.head.getWorldPosition(headW);
    toCam.copy(camera.position).sub(headW).normalize();
    headFwd.copy(state.rest.head.fLocal).applyQuaternion(state.head.getWorldQuaternion(hq));
    const facing = smooth(-0.05, 0.35, headFwd.dot(toCam));
    const I2 = ignite * (1 + state.charge * 0.5) * facing;
    eyeMat.color.setRGB(4.6 * I2, 3.8 * I2, 0.8 * I2);
    haloMat.color.setRGB(1.4 * I2, 1 * I2, 0.12 * I2);
    const hs = state.headScale;
    for (const s of state.eyes) s.scale.setScalar((0.012 + ignite * 0.014) / hs);
    for (const s of state.halos) s.scale.setScalar((0.025 + ignite * 0.04 + state.charge * 0.015) / hs);
  }

  return {
    group, root, uniforms, ready, state, update,
    poses: { EMBRYO, POWER, FLY },
    /** World positions of the main joints, in `space`'s local frame. */
    bonePoints(space) {
      const out = [];
      if (!state.ready) return out;
      space.updateWorldMatrix(true, true);
      for (const name of NAMES) {
        if (state.bones[name]) out.push(space.worldToLocal(state.bones[name].getWorldPosition(new THREE.Vector3())));
      }
      return out;
    },
  };
}
