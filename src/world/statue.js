import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { perlin, smooth, lerp } from '../core/util.js';
import { tubeAlong, onlyAttrs } from './fx.js';

// A fallen colossal head — crowned, bearded, carved — sculpted from primitives with sums of
// gaussians. Plus a fluted column drum and a relief slab for the ruins around it.

const bump2 = (x, y, sx, sy) => Math.exp(-(x * x) / (sx * sx) - (y * y) / (sy * sy));

function headGeometry(noise) {
  let g = new THREE.SphereGeometry(1, 200, 150);
  onlyAttrs(g, ['position']);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const { x, y, z } = v;
    const front = smooth(0.05, 0.5, z);
    let X = x * 0.64, Y = y * 0.9, Z = z * 0.72;
    if (z < 0) Z *= 0.9;
    if (y < -0.2) X *= 1 - 0.2 * smooth(-0.2, -0.95, y);
    if (y > 0.5) X *= 1 - 0.06 * smooth(0.5, 1, y);
    let d = 0;
    for (const s of [-1, 1]) {
      const ex = x - s * 0.34;
      d -= 0.16 * bump2(ex, y - 0.13, 0.17, 0.1); // eye socket
      d += 0.1 * bump2(ex, y - 0.125, 0.125, 0.05); // eyeball
      d -= 0.035 * bump2(ex - s * 0.015, y - 0.128, 0.032, 0.032); // pupil
      d += 0.05 * bump2(ex, y - 0.195, 0.15, 0.024); // upper lid
      d += 0.028 * bump2(ex, y - 0.065, 0.13, 0.02); // lower lid
      d += 0.07 * bump2(x - s * 0.42, y + 0.05, 0.16, 0.15); // cheek
      d += 0.09 * bump2(x - s * 0.095, y + 0.12, 0.055, 0.04); // nostril wing
      d -= 0.04 * bump2(x - s * 0.075, y + 0.145, 0.026, 0.02); // nostril
    }
    d += 0.1 * Math.exp(-((y - 0.29) ** 2) / 0.0056) * (1 - smooth(0.36, 0.64, Math.abs(x))); // brow
    d -= 0.02 * bump2(x, y - 0.3, 0.05, 0.05);
    const ridge = 0.31 * smooth(0.32, -0.08, y) * (1 - smooth(-0.1, -0.17, y));
    const nw = 0.05 + 0.085 * smooth(0.32, -0.12, y);
    d += ridge * Math.exp(-(x * x) / (nw * nw)); // nose
    d += 0.035 * bump2(x, y + 0.27, 0.17, 0.03); // upper lip
    d += 0.04 * bump2(x, y + 0.345, 0.14, 0.035); // lower lip
    d -= 0.02 * bump2(x, y + 0.305, 0.16, 0.012); // mouth line
    Z += d * front;
    const n = noise(x * 3.1, y * 3.1, z * 3.1) * 0.01;
    pos.setXYZ(i, X + x * n, Y + y * n, Z + z * n);
  }
  g.computeVertexNormals();
  return g;
}

function crownGeometry(noise) {
  const H = 0.9, base = 0.46;
  let g = new THREE.CylinderGeometry(0.75, 0.67, H, 140, 40, false);
  onlyAttrs(g, ['position']);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const band = (y, c, w) => Math.exp(-((y - c) ** 2) / (w * w));
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const y = v.y;
    const rad = Math.hypot(v.x, v.z);
    const ang = Math.atan2(v.z, v.x);
    let R = rad;
    if (rad > 0.3) {
      R += 0.03 * band(y, -0.38, 0.04) + 0.035 * band(y, H / 2 - 0.14, 0.05) + 0.012 * band(y, H / 2 - 0.26, 0.02);
      R += noise(v.x * 4, y * 4, v.z * 4) * 0.01;
    }
    let Y = y;
    // broken away on one side
    const da = Math.atan2(Math.sin(ang - 0.9), Math.cos(ang - 0.9));
    const brk = smooth(0.55, 0, Math.abs(da)) * smooth(H / 2 - 0.45, H / 2, y);
    Y -= brk * (0.28 + noise(ang * 5, y * 6, 1) * 0.12);
    const k = rad > 1e-4 ? R / rad : 1;
    pos.setXYZ(i, v.x * k, Y + base + H / 2, v.z * k - 0.08);
  }
  g.computeVertexNormals();
  const parts = [g];
  // horns wrapping the crown, three tiers
  for (let tier = 0; tier < 3; tier++) {
    const y0 = 0.62 + tier * 0.22;
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const a = Math.PI / 2 + s * lerp(2.35, 0.06, t);
        const rr = 0.69 + (y0 - base) * 0.09 + 0.035;
        pts.push(new THREE.Vector3(Math.cos(a) * rr, y0 + 0.1 * smooth(0.7, 1, t) - 0.03 * t, Math.sin(a) * rr - 0.08));
      }
      parts.push(tubeAlong(new THREE.CatmullRomCurve3(pts), {
        segments: 48, radial: 8, radius: (t) => lerp(0.02, 0.048, t) * (1 - smooth(0.96, 1, t) * 0.6),
      }));
    }
  }
  // crenellated rim
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const da = Math.atan2(Math.sin(a - 0.9), Math.cos(a - 0.9));
    if (Math.abs(da) < 0.5) continue;
    const b = new THREE.BoxGeometry(0.07, 0.17, 0.035, 1, 3, 1);
    onlyAttrs(b);
    const m = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2);
    m.setPosition(Math.cos(a) * 0.76, 1.31, Math.sin(a) * 0.76 - 0.08);
    b.applyMatrix4(m);
    parts.push(b);
  }
  return parts;
}

function beardGeometry(noise) {
  let g = new THREE.BoxGeometry(1, 1, 1, 56, 72, 10);
  onlyAttrs(g, ['position']);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const x = v.x, t = v.y + 0.5, z = v.z;
    const X = x * lerp(1, 1.3, t ** 0.7);
    const top = -0.3 + 0.34 * smooth(0.28, 0.62, Math.abs(X));
    const Y = lerp(-1.6 + noise(X * 3, 0.5, 2) * 0.09 + Math.abs(X) * 0.12, top, t);
    const depth = lerp(0.44, 0.66, t);
    let Z = lerp(0.26, 0.1, t) + z * depth;
    if (z > 0.2) {
      const f = smooth(0.2, 0.5, z);
      Z += 0.1 * (1 - Math.min(1, (2 * x) ** 2)) * f;
      // braided rows of ringlets
      const row = ((Y + 0.4) / 0.35) % 1;
      Z += 0.013 * Math.sin(X * 62 + Math.sin(Y * 9) * 0.6) * smooth(0.1, 0.35, Math.abs(((row + 1) % 1) - 0.5)) * f;
    }
    pos.setXYZ(i, X, Y, Z);
  }
  g.computeVertexNormals();
  return g;
}

function hairGeometry(noise) {
  let g = new THREE.BoxGeometry(1, 1, 1, 40, 50, 8);
  onlyAttrs(g, ['position']);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const x = v.x, t = v.y + 0.5, z = v.z;
    const X = x * lerp(1.42, 1.2, t);
    const Y = lerp(-1.3 + noise(x * 4, 3, 1) * 0.08, 0.35, t);
    const Z = lerp(-0.62, -0.3, z + 0.5) - 0.12 * (1 - (2 * x) ** 2) * (z < 0 ? 1 : 0) - 0.08 * t;
    const w = 0.012 * Math.sin(X * 55) * (z < 0 ? 1 : 0.3);
    pos.setXYZ(i, X, Y, Z + w);
  }
  g.computeVertexNormals();
  return g;
}

function moustacheGeometry() {
  const parts = [];
  for (const s of [-1, 1]) {
    const pts = [
      new THREE.Vector3(s * 0.01, -0.2, 0.76), new THREE.Vector3(s * 0.16, -0.22, 0.74), new THREE.Vector3(s * 0.3, -0.29, 0.66),
      new THREE.Vector3(s * 0.4, -0.39, 0.55), new THREE.Vector3(s * 0.43, -0.47, 0.5),
    ];
    parts.push(tubeAlong(new THREE.CatmullRomCurve3(pts), { segments: 40, radial: 10, radius: (t) => lerp(0.05, 0.028, t) }));
  }
  return parts;
}

/** A small spiral curl, instanced over the beard. */
function curlGeometry({ r0 = 0.065, turns = 1.7, tube = 0.02, segments = 56, radial = 6 } = {}) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * turns * Math.PI * 2;
    const rr = r0 * (1 - t * 0.92);
    pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, t * r0 * 0.55));
  }
  return tubeAlong(new THREE.CatmullRomCurve3(pts), { segments, radial, radius: (t) => tube * (1 - t * 0.55) });
}

export function statueGeometry(seed = 3) {
  const noise = perlin(seed);
  const parts = [headGeometry(noise), ...crownGeometry(noise), beardGeometry(noise), hairGeometry(noise), ...moustacheGeometry()];
  const knob = new THREE.SphereGeometry(0.09, 16, 12);
  onlyAttrs(knob);
  knob.translate(0, 1.42, -0.08);
  parts.push(knob);
  const geometry = mergeGeometries(parts.map((g) => onlyAttrs(g, ['position', 'normal'])), false);
  geometry.computeBoundingSphere();

  // where the curls go: rows over the beard, a row under it, and down each side
  const curls = [];
  [-0.56, -0.9, -1.24, -1.52].forEach((y, row) => {
    const t = (y + 1.6) / 1.3;
    const width = lerp(1, 1.3, Math.max(0, t) ** 0.7) - 0.14;
    const n = Math.round(width / 0.15);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5 + (row % 2 ? 0.5 / n : 0) * 0.6;
      const x = u * width;
      const depth = lerp(0.44, 0.66, t);
      const z = lerp(0.26, 0.1, t) + depth * 0.5 + 0.1 * (1 - Math.min(1, ((2 * u) / (width / 1.2)) ** 2)) + 0.02;
      curls.push({ p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(x * 0.5, -0.1, 1).normalize(), s: 1 + (row === 0 ? -0.1 : 0), spin: i * 1.7 + row });
    }
  });
  for (let i = 0; i < 10; i++) {
    const u = (i + 0.5) / 10 - 0.5;
    curls.push({ p: new THREE.Vector3(u * 1.25, -1.24, -0.72 + Math.abs(u) * 0.2), n: new THREE.Vector3(u * 0.4, -0.2, -1).normalize(), s: 1.05, spin: i * 2.1 });
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      curls.push({ p: new THREE.Vector3(s * 0.66, 0.05 - i * 0.2, 0.05 - i * 0.02), n: new THREE.Vector3(s, 0, 0.35).normalize(), s: 0.9, spin: i });
    }
    curls.push({ p: new THREE.Vector3(s * 0.45, -0.5, 0.5), n: new THREE.Vector3(s * 0.5, -0.2, 1).normalize(), s: 0.75, spin: 0.3 });
  }
  return { geometry, curls, curlGeometry: curlGeometry({ r0: 0.078, tube: 0.027 }) };
}

/** A fluted column drum with broken ends. */
export function columnGeometry(seed = 1, { r = 0.34, h = 1.3 } = {}) {
  const noise = perlin(seed);
  let g = new THREE.CylinderGeometry(r, r, h, 96, 24, false);
  onlyAttrs(g, ['position']);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const rad = Math.hypot(v.x, v.z);
    const a = Math.atan2(v.z, v.x);
    let R = rad;
    if (rad > r * 0.5) R = rad - 0.028 * Math.max(0, Math.cos(a * 20)) ** 0.6;
    let y = v.y;
    if (Math.abs(y) > h / 2 - 0.02) y += noise(v.x * 5, v.z * 5, y) * 0.16 * Math.sign(y) - (y > 0 ? 0.08 : 0);
    const k = rad > 1e-4 ? R / rad : 1;
    pos.setXYZ(i, v.x * k + noise(v.x * 3, y * 3, v.z * 3) * 0.01, y, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A relief slab carved with rows of cuneiform-like wedges, one corner broken off. */
export function reliefGeometry(seed = 2) {
  const noise = perlin(seed);
  let g = new THREE.BoxGeometry(1.9, 1, 0.22, 90, 50, 2);
  onlyAttrs(g, ['position']);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.z > 0.05) {
      const row = Math.floor((v.y + 0.5) / 0.25);
      const fr = ((v.y + 0.5) / 0.25) % 1;
      const u = v.x * 7 + row * 0.5;
      const k = Math.abs(Math.sin(u * Math.PI)) ** 0.35 * smooth(0, 0.6, fr);
      v.z += k * 0.05 - 0.02;
    }
    v.x += noise(v.x, v.y, 3) * 0.05;
    const n = noise(v.x * 2.5, v.y * 2.5, 7);
    if (v.x > 0.6) v.x -= Math.max(0, n) * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
