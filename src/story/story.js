import * as THREE from 'three';

// The film: an ordered list of camera keys. Scroll position s (0..count-1) samples a
// centripetal spline through them; scalar channels use Catmull-Rom, the thread position a
// monotone (PCHIP) curve so the rider never runs backwards.

const CHASE_KEYS = ['back', 'lift', 'side', 'ahead', 'hover', 'lw', 'flat', 'keep'];
const CHASE_DEFAULTS = { back: 6, lift: 2, side: 0, ahead: 4, hover: 0.6, lw: 0, flat: 0, keep: 0.3 };

export class Story {
  constructor(keys, ranges) {
    this.keys = keys;
    this.count = keys.length;
    this.ranges = ranges;
    this.posCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal', 0.5);
    this.lookCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.look), false, 'centripetal', 0.5);
    this.focusCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.focus || k.look), false, 'centripetal', 0.5);
    this.upCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.up), false, 'catmullrom', 0.5);
    const L = keys.map((k) => k.L);
    const d = L.slice(1).map((v, i) => v - L[i]);
    this.mL = L.map((_, i) => {
      if (i === 0) return d[0] ?? 0;
      if (i === L.length - 1) return d[i - 1];
      const a = d[i - 1], b = d[i];
      return a * b <= 0 ? 0 : 2 / (1 / a + 1 / b);
    });
  }

  pchipL(i, t) {
    const k = this.keys;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * k[i].L + (t3 - 2 * t2 + t) * this.mL[i] + (-2 * t3 + 3 * t2) * k[i + 1].L + (t3 - t2) * this.mL[i + 1];
  }

  createState() {
    return {
      pos: new THREE.Vector3(), look: new THREE.Vector3(), focus: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
      fov: 35, roll: 0, sceneF: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1), par: 0.5, letterbox: 0, s: 0, fly: 0, L: 0,
      ...CHASE_DEFAULTS,
    };
  }

  cr(key, i, t) {
    const k = this.keys;
    const p0 = k[Math.max(0, i - 1)][key], p1 = k[i][key];
    const p2 = k[Math.min(k.length - 1, i + 1)][key], p3 = k[Math.min(k.length - 1, i + 2)][key];
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  sample(s, out) {
    const n = this.count;
    s = Math.min(Math.max(s, 0), n - 1);
    const u = s / (n - 1);
    this.posCurve.getPoint(u, out.pos);
    this.lookCurve.getPoint(u, out.look);
    this.focusCurve.getPoint(u, out.focus);
    this.upCurve.getPoint(u, out.up).normalize();
    const i = Math.min(Math.floor(s), n - 2);
    const t = s - i;
    const a = this.keys[i], b = this.keys[i + 1];
    out.fov = this.cr('fov', i, t);
    out.roll = this.cr('roll', i, t);
    out.par = a.par + (b.par - a.par) * t;
    out.sceneF = a.f + (b.f - a.f) * t;
    out.flash = a.flash + (b.flash - a.flash) * t;
    out.letterbox = a.letterbox + (b.letterbox - a.letterbox) * t;
    out.flashColor.copy(a.flash >= b.flash ? a.flashColor : b.flashColor);
    out.fly = a.fly + (b.fly - a.fly) * t;
    out.L = this.pchipL(i, t);
    for (const k of CHASE_KEYS) out[k] = this.cr(k, i, t);
    out.s = s;
    return out;
  }

  /** 0..1 progress through chapter `index`'s dwelling shots. */
  local(index, s) {
    const r = this.ranges[index];
    return r ? Math.min(1, Math.max(0, (s - r[0]) / Math.max(0.001, r[1] - r[0]))) : 0;
  }
}

/** Collect keys from an authoring function into a Story. */
export function createStory(chapters, author) {
  const keys = [];
  const ranges = [];
  const add = (space, pos, look, o = {}) => {
    const i = keys.length;
    if (typeof space.index === 'number' && o.dwell !== false) {
      const r = ranges[space.index] || [i, i];
      r[0] = Math.min(r[0], i);
      r[1] = Math.max(r[1], i);
      ranges[space.index] = r;
    }
    keys.push({
      pos: space.w(pos),
      look: space.w(look),
      focus: o.focus ? space.w(o.focus) : null,
      up: o.up ? space.dir(...o.up).normalize() : new THREE.Vector3(0, 1, 0),
      fov: o.fov ?? 35,
      roll: ((o.roll ?? 0) * Math.PI) / 180,
      f: o.f ?? space.index,
      flash: o.flash ?? 0,
      flashColor: new THREE.Color(o.flashColor ?? '#ffffff'),
      par: o.par ?? 0.5,
      letterbox: o.lb ?? 0,
      fly: o.fly ?? 0,
      L: o.L ?? null,
      ...Object.fromEntries(CHASE_KEYS.map((k) => [k, o[k] ?? CHASE_DEFAULTS[k]])),
    });
    return i;
  };
  author(add, chapters);
  // carry thread positions across keys that don't set one
  let last = keys.find((k) => k.L !== null)?.L ?? 0;
  for (const k of keys) {
    if (k.L === null) k.L = last;
    else last = k.L;
  }
  return new Story(keys, ranges);
}
