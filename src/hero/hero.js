import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl.js';
import { clamp, damp, lerp, smooth } from '../core/util.js';
import { createFigure } from './figure.js';
import { createEgg } from './egg.js';

// energy rings: broken, flickering arcs running round a hoop
const RING_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vW;
  void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const RING_FRAG = /* glsl */ `
  uniform vec3 uCol; uniform float uAmt, uT, uSeed;
  varying vec2 vUv; varying vec3 vW;
  ${NOISE_GLSL}
  void main(){
    float a = vUv.x * 6.2831853;
    float n = snoise(vec3(cos(a) * 2.2, sin(a) * 2.2, uT * 1.7 + uSeed)) * 0.5 + 0.5;
    float arcs = smoothstep(0.45, 0.82, n);
    float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
    // never a bright bar across the lens when the camera is right up against it
    float near = smoothstep(0.3, 1.1, distance(vW, cameraPosition));
    gl_FragColor = vec4(uCol * uAmt * (0.06 + arcs * 1.5) * core * near, 1.0);
  }`;
const ringMaterial = (seed) => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color('#d9c8ff').multiplyScalar(3) }, uAmt: { value: 0 }, uT: { value: 0 }, uSeed: { value: seed } },
  vertexShader: RING_VERT,
  fragmentShader: RING_FRAG,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});

/** Rings of light that climb the figure as it charges, and a shockwave when it releases. */
function createCharge() {
  const group = new THREE.Group();
  group.name = 'charge';
  const torus = new THREE.TorusGeometry(1, 0.012, 6, 160);
  torus.rotateX(Math.PI / 2);
  const rings = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(torus, ringMaterial(i * 7.3));
    m.renderOrder = 40;
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  const shockGeo = new THREE.RingGeometry(0.96, 1, 160, 1);
  shockGeo.rotateX(-Math.PI / 2);
  const shock = new THREE.Mesh(shockGeo, ringMaterial(31));
  shock.material.uniforms.uCol.value.set('#fff0c8').multiplyScalar(4);
  shock.renderOrder = 41;
  shock.frustumCulled = false;
  group.add(shock);
  const col = new THREE.Color();
  const cool = new THREE.Color('#b9a0ff');
  const hot = new THREE.Color('#fff0c4');
  const shockRadius = (s) => 0.3 + 12 * (1 - (1 - s) ** 2.2);
  return {
    group,
    shockRadius,
    set({ charge = 0, lead = 0, shock: s = 0, foot = 0, head = 2, x = 0, z = 0, r = 0.5, t = 0 }) {
      group.visible = charge > 0.002 || (s > 0 && s < 1);
      if (!group.visible) return;
      const h = head - foot;
      col.copy(cool).lerp(hot, Math.min(1, charge));
      rings.forEach((m, i) => {
        const u = m.material.uniforms;
        u.uT.value = t;
        let y, amt;
        if (i === 0) {
          y = Math.min(1, lead);
          amt = 0.35 * (1 - y) + 0.65 * Math.sin(Math.PI * y);
        } else {
          y = (t * 0.5 + i / 2) % 1;
          amt = Math.sin(Math.PI * y);
        }
        m.position.set(x, foot + y * h, z);
        m.scale.setScalar(r * (1.15 - 0.35 * (Math.abs(y - 0.45) * 2) ** 2));
        u.uAmt.value = amt * charge * (i === 0 ? 1.2 : 0.7);
        u.uCol.value.copy(col).multiplyScalar(2);
      });
      shock.visible = s > 0 && s < 1;
      if (shock.visible) {
        shock.position.set(x, foot + h * 0.42, z);
        shock.scale.setScalar(shockRadius(s));
        shock.material.uniforms.uAmt.value = (1 - s) ** 1.5 * 1.8;
        shock.material.uniforms.uT.value = t;
      }
    },
  };
}

const FLY_SCALE = 0.62;

/**
 * The hero: the figure asleep in the egg at the centre of the work ring, waking, then leaving
 * the egg to ride the thread with the camera behind it.
 */
export function createHero({ work, flight }) {
  const figure = createFigure({ scale: 2 });
  const egg = createEgg();
  const charge = createCharge();
  const group = new THREE.Group();
  group.name = 'hero';
  const body = new THREE.Group();
  body.add(figure.group);
  group.add(body, egg.group, charge.group);

  const center = work.center;
  const workQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, work.group.rotation.y, 0));
  const lean = { x: -0.18, z: 0.28 };
  const eggFit = { center: new THREE.Vector3(), r: 1.3, fitted: false };
  const qLocal = new THREE.Quaternion(), qInv = new THREE.Quaternion(), qBank = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const basis = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  const xAxis = new THREE.Vector3(), yAxis = new THREE.Vector3(), zAxis = new THREE.Vector3();
  const fr = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), S: new THREE.Vector3() };
  const fwdNow = new THREE.Vector3(), fwdAhead = new THREE.Vector3();
  const home = new THREE.Vector3(), ridePos = new THREE.Vector3();
  const rideQ = new THREE.Quaternion(), homeQ = new THREE.Quaternion();
  const ctrl = { lat: 0, vert: 0, latPrev: 0, vertPrev: 0, latV: 0, vertV: 0, bank: 0, pitch: 0.16, sx: 0, sy: 0, started: false };
  const rider = new THREE.Vector3(), arc = new THREE.Vector3(), camTarget = new THREE.Vector3(), offset = new THREE.Vector3(), steer = new THREE.Vector3();
  let beatPhase = 0;
  let chargeT = 0;
  let release = -1;
  const footQ = new THREE.Quaternion();
  const mid = new THREE.Vector3();
  const footW = new THREE.Vector3();
  const st = { L: 0, fly: 0, awake: 0, scale: 1, rider, bank: 0 };

  function fitEgg() {
    const pts = figure.bonePoints(group);
    if (pts.length < 8) return;
    new THREE.Box3().setFromPoints(pts).getCenter(eggFit.center);
    let r = 0;
    for (const p of pts) r = Math.max(r, p.distanceTo(eggFit.center));
    eggFit.r = r + 0.34;
    eggFit.fitted = true;
  }

  // the rider's pose on the thread: weaving with the cursor, banking into turns
  function ride(L, hover, dt, t, input) {
    flight.frameAt(L, fr);
    flight.smoothForward(L, 3.5, fwdNow);
    flight.smoothForward(L + 6, 3.5, fwdAhead);
    ctrl.sx = damp(ctrl.sx, input.target.x, 2.2, dt);
    ctrl.sy = damp(ctrl.sy, input.target.y, 2.2, dt);
    const weave = Math.sin(t * 0.72) * 0.26 + Math.sin(t * 1.63 + 1) * 0.07;
    const k = st.scale / FLY_SCALE;
    const lat = (weave + ctrl.sx * 0.5) * k;
    const vert = (Math.sin(t * 1.1) * 0.08 + ctrl.sy * 0.26) * k;
    if (!ctrl.started) {
      ctrl.latPrev = lat;
      ctrl.vertPrev = vert;
      ctrl.started = true;
    }
    ctrl.latV = damp(ctrl.latV, (lat - ctrl.latPrev) / Math.max(dt, 0.001), 6, dt);
    ctrl.vertV = damp(ctrl.vertV, (vert - ctrl.vertPrev) / Math.max(dt, 0.001), 6, dt);
    ctrl.latPrev = lat;
    ctrl.vertPrev = vert;
    ctrl.lat = lat;
    ctrl.vert = vert;
    const turn = tmp.subVectors(fwdAhead, fwdNow).dot(fr.S);
    ctrl.bank = damp(ctrl.bank, clamp(-ctrl.latV * 0.5 - ctrl.sx * 0.3 - turn * 2.2, -0.9, 0.9), 2.2, dt);
    ctrl.pitch = damp(ctrl.pitch, 0.16 + clamp(ctrl.vertV * 0.08, -0.3, 0.3), 3, dt);
    ridePos.copy(fr.pos).addScaledVector(fr.U, hover + vert).addScaledVector(fr.S, lat);
    // body: head forward along the thread, belly down
    yAxis.copy(fwdNow).multiplyScalar(Math.cos(ctrl.pitch)).addScaledVector(fr.U, Math.sin(ctrl.pitch)).normalize();
    zAxis.copy(fr.U).addScaledVector(yAxis, -yAxis.dot(fr.U)).normalize().negate();
    xAxis.crossVectors(yAxis, zAxis).normalize();
    basis.makeBasis(xAxis, yAxis, zAxis);
    rideQ.setFromRotationMatrix(basis);
    rideQ.premultiply(qBank.setFromAxisAngle(yAxis, ctrl.bank));
    st.bank = ctrl.bank;
  }

  function update({ t, dt, st: story, phase, raycaster, input, camera }) {
    const { crack, shatter, awake, fly } = phase;
    const aw = smooth(0, 1, awake);
    const fl = smooth(0, 1, fly);
    st.awake = awake;
    st.fly = fly;
    st.L = story.L;
    const float = Math.sin(t * 0.5) * 0.12 * (1 - aw);
    home.copy(work.w(center.x, center.y + float + aw * 0.45, center.z));
    const yaw = -0.16 + Math.PI / 2 + Math.sin(t * 0.07) * 0.22 * (1 - smooth(0.2, 0.9, shatter));
    const turn = smooth(0.3, 0.85, awake);
    eul.set(lerp(lean.x, 0, aw), lerp(yaw, -0.16, turn * turn * (3 - 2 * turn)), lerp(lean.z + Math.sin(t * 0.11) * 0.06, 0, aw));
    qLocal.setFromEuler(eul);
    homeQ.copy(workQ).multiply(qLocal);
    const ease = fl * fl * fl * (fl * (fl * 6 - 15) + 10);
    st.scale = lerp(1, FLY_SCALE, ease);
    if (fly > 0) {
      ride(story.L, story.hover * (st.scale / FLY_SCALE), dt, t, input);
      // leave the egg on an arc up and over onto the thread
      arc.copy(home).lerp(ridePos, 0.35);
      arc.y = Math.max(home.y, ridePos.y) + 1.4;
      const a = ease, b = 1 - ease;
      group.position.set(0, 0, 0).addScaledVector(home, b * b).addScaledVector(arc, 2 * b * a).addScaledVector(ridePos, a * a);
      group.quaternion.slerpQuaternions(homeQ, rideQ, smooth(0.1, 0.9, fl));
    } else {
      ctrl.started = false;
      group.position.copy(home);
      group.quaternion.copy(homeQ);
    }
    group.scale.setScalar(st.scale);
    body.quaternion.identity();
    rider.copy(group.position);

    if (egg.group.visible || shatter < 1) {
      qInv.copy(group.quaternion).invert().multiply(workQ);
      egg.group.quaternion.copy(qInv);
      egg.group.position.copy(eggFit.center);
      egg.group.scale.setScalar(eggFit.r);
      beatPhase += dt * 2.3 * (1 + crack * 1.6);
      const beat = Math.max(0, Math.sin(beatPhase)) ** 10 + 0.55 * Math.max(0, Math.sin(beatPhase - 0.55)) ** 10;
      egg.set({ crack, shatter, beat, glow: 1 + crack * 0.8, scanY: Math.sin(t * 0.55) * 1.15, t });
    }
    figure.uniforms.uRim.value = smooth(0.1, 0.9, awake) * 0.18;
    figure.uniforms.uShade.value = lerp(0.16, 1, smooth(0.1, 0.6, shatter));
    figure.update({ t, dt, raycaster, input, camera, awake, fly, stir: 1 - smooth(0, 0.6, crack) });

    const pre = smooth(0.3, 1, shatter) * 0.7;
    const wake = smooth(0.05, 0.6, awake);
    const settled = smooth(0.8, 1, awake);
    const amount = Math.max(pre, wake) * (1 - settled * 0.7) * (1 - smooth(0, 0.35, fly));
    chargeT += dt * (1 + amount * 2.5);
    figure.uniforms.uCharge.value = amount;
    figure.uniforms.uChargeT.value = chargeT;
    if (awake > 0.85 && fly === 0 && release < 0) {
      release = 0;
      dispatchEvent(new CustomEvent('sfx', { detail: { name: 'release' } }));
    }
    if (awake < 0.6) release = -1;
    if (release >= 0) release += dt;
    const shockT = release >= 0 ? Math.min(1, release / 2.4) : 0;
    const gu = work.grass && work.grass.uniforms;
    if (figure.state.ready && (amount > 0.002 || (shockT > 0 && shockT < 1))) {
      charge.group.position.set(0, 0, 0);
      charge.group.quaternion.copy(footQ.copy(group.quaternion).invert().multiply(workQ));
      const pts = figure.bonePoints(charge.group);
      let lo = Infinity, hi = -Infinity;
      mid.set(0, 0, 0);
      for (const p of pts) {
        lo = Math.min(lo, p.y);
        hi = Math.max(hi, p.y);
        mid.add(p);
      }
      mid.divideScalar(Math.max(1, pts.length));
      let rad = 0;
      for (const p of pts) rad = Math.max(rad, Math.hypot(p.x - mid.x, p.z - mid.z));
      const h = Math.max(0.5, hi - lo);
      charge.set({ charge: amount, lead: phase.lead ?? 0, shock: shockT, foot: lo - h * 0.05, head: hi + h * 0.12, x: mid.x, z: mid.z, r: Math.min(0.85, rad * 0.7 + 0.15), t: chargeT });
      if (gu) {
        charge.group.localToWorld(footW.set(mid.x, lo, mid.z));
        gu.uShock.value.set(footW.x, footW.y, footW.z, charge.shockRadius(shockT));
        gu.uShockA.value = shockT > 0 && shockT < 1 ? (1 - shockT) ** 1.2 : 0;
      }
    } else {
      charge.set({ charge: 0 });
      if (gu) gu.uShockA.value = 0;
    }
    if (figure.state.ready && !eggFit.fitted && awake === 0 && fly === 0) {
      group.updateMatrixWorld(true);
      fitEgg();
    }
  }

  const look = new THREE.Vector3();
  /** Chase camera behind the rider, nudged so the rider leads the frame as it weaves. */
  function chase(L, o, out) {
    const k = st.scale / FLY_SCALE;
    const opts = {
      back: o.back * k, lift: o.lift * k, side: o.side * k, ahead: o.ahead * k, hover: o.hover * k,
      lookLift: 0.35 * k, lw: o.lw, flat: o.flat, keep: o.keep,
    };
    flight.chase(L, opts, out, rider);
    flight.frameAt(L, fr);
    offset.subVectors(out.pos, out.rider);
    steer.copy(out.rider).addScaledVector(fr.S, ctrl.lat * 0.45).addScaledVector(fr.U, ctrl.vert * 0.45);
    camTarget.copy(rider).lerp(steer, smooth(0.55, 1, st.fly));
    out.look.sub(rider).add(camTarget);
    out.pos.copy(camTarget).add(offset);
    out.focus = out.focus || look;
    out.focus.copy(rider);
    return out;
  }

  return { group, figure, egg, charge, state: st, update, chase, lean, eggFit };
}
