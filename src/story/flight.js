import * as THREE from 'three';
import { smooth } from '../core/util.js';

/**
 * Arc-length parameterised frames along the thread (position, tangent, a smoothed "up" that
 * prefers world-up), plus a chase rig: a camera that rides behind something on the thread.
 */
export function createFlight(curve, { samples = 5000 } = {}) {
  curve.arcLengthDivisions = 10000;
  curve.updateArcLengths();
  const length = curve.getLength();
  const lengths = curve.getLengths();
  const P = [], T = [], U = [];
  const worldUp = new THREE.Vector3(0, 1, 0);
  const flat = new THREE.Vector3();
  let prev = null;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    const up = prev ? prev.clone() : new THREE.Vector3(1, 0, 0);
    up.addScaledVector(t, -t.dot(up));
    if (up.lengthSq() < 1e-8) up.set(0, 0, 1).addScaledVector(t, -t.z);
    up.normalize();
    // ease the frame toward world-up wherever the thread isn't vertical
    flat.copy(worldUp).addScaledVector(t, -t.y);
    const fl = flat.length();
    if (fl > 0.001) {
      flat.divideScalar(fl);
      up.lerp(flat, (prev ? 0.045 : 1) * smooth(0.12, 0.55, fl)).normalize();
    }
    P.push(p);
    T.push(t);
    U.push(up);
    prev = up;
  }
  const wrap = (L) => ((L % length) + length) % length;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  function frameAt(L, out = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), S: new THREE.Vector3() }) {
    const f = (wrap(L) / length) * samples;
    const i = Math.min(samples - 1, Math.floor(f));
    const k = f - i;
    out.pos.lerpVectors(P[i], P[i + 1], k);
    out.T.lerpVectors(T[i], T[i + 1], k).normalize();
    out.U.lerpVectors(U[i], U[i + 1], k);
    out.U.addScaledVector(out.T, -out.T.dot(out.U)).normalize();
    out.S.crossVectors(out.T, out.U).normalize();
    return out;
  }
  const pointAt = (L, out = new THREE.Vector3()) => {
    const f = (wrap(L) / length) * samples;
    const i = Math.min(samples - 1, Math.floor(f));
    return out.lerpVectors(P[i], P[i + 1], f - i);
  };
  /** Direction of travel, averaged over a window so kinks don't jerk the camera. */
  const smoothForward = (L, w, out = new THREE.Vector3()) => out.subVectors(pointAt(L + w, a), pointAt(L - w * 0.6, b)).normalize();
  function nearest(p, from = 0, span = length) {
    let best = Infinity, bl = from;
    const step = length / samples;
    for (let L = from; L <= from + span; L += step) {
      const d = pointAt(L, c).distanceToSquared(p);
      if (d < best) { best = d; bl = L; }
    }
    return bl;
  }
  /** Arc length at control point i of the curve. */
  const atPoint = (i) => lengths[Math.round((i / curve.points.length) * (lengths.length - 1))];

  const fr = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), S: new THREE.Vector3() };
  const fwd = new THREE.Vector3(), F = new THREE.Vector3(), Up = new THREE.Vector3();
  const hz = new THREE.Vector3(), toLook = new THREE.Vector3(), axis = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  /** Place a chase camera for a rider at arc length L. */
  function chase(L, o, out, riderOverride = null) {
    frameAt(L, fr);
    smoothForward(L, 3.5, fwd);
    const rider = tmp.copy(fr.pos).addScaledVector(fr.U, o.hover ?? 0.6);
    const anchor = riderOverride || rider;
    out.rider.copy(rider);
    F.copy(fwd);
    Up.copy(fr.U);
    const flatten = o.flat ?? 0;
    if (flatten > 0) {
      hz.set(fwd.x, 0, fwd.z);
      const hl = hz.length();
      const k = flatten * smooth(0.05, 0.3, hl);
      if (k > 0) {
        F.lerp(hz.divideScalar(hl), k).normalize();
        Up.lerp(worldUp, k).normalize();
      }
    }
    out.pos.copy(rider).addScaledVector(F, -(o.back ?? 6)).addScaledVector(Up, o.lift ?? 2).addScaledVector(fr.S, o.side ?? 0);
    out.look.copy(anchor).addScaledVector(F, o.ahead ?? 4).addScaledVector(Up, o.lookLift ?? 0.4);
    if (o.lw && out.lookTo) {
      // pull the gaze toward a fixed point, but never let the rider leave the frame
      out.look.lerp(out.lookTo, o.lw);
      const keep = o.keep ?? 0.3;
      hz.subVectors(anchor, out.pos).normalize();
      toLook.subVectors(out.look, out.pos);
      const dl = toLook.length();
      toLook.divideScalar(dl);
      if (hz.angleTo(toLook) > keep) {
        axis.crossVectors(hz, toLook).normalize();
        out.look.copy(out.pos).addScaledVector(toLook.copy(hz).applyAxisAngle(axis, keep), dl);
      }
    }
    out.up.copy(Up);
    return out;
  }

  return {
    curve, length, frameAt, pointAt, smoothForward, nearest, atPoint, chase, wrap,
    makeChase: () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), rider: new THREE.Vector3(), lookTo: null }),
  };
}
