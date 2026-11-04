import * as THREE from 'three';

// The shot list. `add(space, pos, look, opts)` places a camera key in a chapter's local space.
// opts: fov, roll (deg), par (cursor parallax), dwell:false (passing shot), f (look/scene blend
// index), flash, focus, and for chase shots L (thread position), fly, back/lift/side/ahead/...

const WORLD = {
  w: (x, y, z) => (Array.isArray(x) ? new THREE.Vector3(...x) : new THREE.Vector3(x, y, z)),
  dir: (x, y, z) => new THREE.Vector3(x, y, z),
};
const between = (a, b, t, lift = 0) => a.origin.clone().lerp(b.origin, t).add(new THREE.Vector3(0, lift, 0)).toArray();

export function authorShots(flight) {
  return (add, chapters) => {
    const [origin, memory, refraction, work, threshold, network] = chapters;

    // 01 origin: push in on the ring, tip over the edge and fall
    add(origin, [0, 0.4, 38], [0, 0, 0], { fov: 28, par: 0.9 });
    add(origin, [5, 1.2, 26], [0, 0.2, 0], { fov: 32, par: 0.8 });
    add(origin, [-5.5, 2.4, 18], [0, 0, 0], { fov: 36, roll: -2 });
    add(origin, [-2, 7.5, 11], [0, -1.5, 0], { fov: 40, roll: 1 });
    add(origin, [1.5, 2, 5.5], [0, -9, -2], { fov: 46, roll: 4, dwell: false, f: 0.2 });
    add(origin, [1.2, -16, -1], [0, -40, -18], { fov: 54, dwell: false, f: 0.4, roll: -3 });
    add(WORLD, between(origin, memory, 0.62, 18), memory.w(0, 2, 0).toArray(), { fov: 50, dwell: false, f: 0.7, roll: 2 });

    // 02 memory: circle the fallen head and the scanner
    add(memory, [9, 7, 17], [0, 1.4, 0], { fov: 38, f: 0.95 });
    add(memory, [4.5, 2.4, 10], [-0.6, 1.7, -0.4], { fov: 34 });
    add(memory, [-1.2, 1.7, 7.8], [-1.6, 1.9, -1.2], { fov: 32, roll: -1 });
    add(memory, [-6.8, 2.5, 6.4], [-4.2, 2.4, 0.9], { fov: 34, roll: 1 });
    add(memory, [-4, 6, -2], [8, 4, -24], { fov: 42, dwell: false, f: 1.25 });
    add(WORLD, between(memory, refraction, 0.55, 14), refraction.w(0, 3, 0).toArray(), { fov: 46, dwell: false, f: 1.55, roll: -3 });

    // 03 refraction: approach the frame and pass through it
    add(refraction, [15, 4.5, 30], [0, 3.5, 0], { fov: 34, f: 1.85 });
    add(refraction, [7, 2.1, 15], [0, 3.4, 0], { fov: 34 });
    add(refraction, [2.2, 1.4, 10], [0, 3.3, 0], { fov: 32, roll: -1 });
    add(refraction, [-4.8, 2.5, 8.8], [0, 3.9, 0], { fov: 34, roll: 1 });
    add(refraction, refraction.throughPoint(6).toArray(), refraction.throughPoint(-4).toArray(), { fov: 38 });
    add(refraction, refraction.throughPoint(1.4).toArray(), refraction.throughPoint(-6).toArray(), { fov: 44, dwell: false, f: 2.2, par: 0.25 });
    add(refraction, refraction.throughPoint(-2.5).toArray(), refraction.throughPoint(-12).toArray(), { fov: 52, dwell: false, f: 2.55, par: 0.25 });
    add(refraction, refraction.throughPoint(-14).toArray(), refraction.throughPoint(-30).toArray(), { fov: 46, dwell: false, f: 2.8 });

    // 04 work: arrive, then alternate panel close-ups with orbits of the egg
    add(work, [15, 10, 27], [0, 3.6, 0], { fov: 40, f: 3, flash: 0.08 });
    add(work, [7.8, 5.4, 12.6], [0, 3.5, 0], { fov: 34, par: 0.8 });
    const n = work.panels.length;
    const orbitDist = [7.6, 4.7, 7.8, 5.6, 7.2];
    const orbitLift = [0.25, 0.5, 0.1, 0.35, 0.2];
    const shots = [];
    for (let i = 0; i < n; i++) {
      shots.push(work.panelShot(i));
      if (i < n - 1) {
        const mid = (work.panels[i].ang + work.panels[i + 1].ang) / 2 + 0.34;
        shots.push(work.orbitShot(mid, orbitDist[i % orbitDist.length], orbitLift[i % orbitLift.length]));
      }
    }
    shots.forEach((s, i) => {
      const k = add(work, s.pos, s.look, {
        focus: s.focus,
        fov: i % 2 ? (i === 3 ? 30 : 32) : 33,
        par: i % 2 ? 0.55 : 0.7,
        roll: i % 2 ? 0 : i % 4 ? 1 : -1,
      });
      if (s.k !== undefined) work.shotS[s.k] = k;
    });

    // thread arc length at a chapter's i-th thread point
    const starts = [];
    let acc = 0;
    for (let i = 0; i < 6; i++) {
      starts.push(acc);
      acc += Math.max(1, chapters[i].thread.length);
    }
    const atThread = (ch, i) => flight.atPoint(starts[ch.index] + i);
    const lerp = (a, b, t) => a + (b - a) * t;
    const afterLoop = (x) => {
      const i = acc - 1 + Math.floor(x);
      return lerp(flight.atPoint(i), flight.atPoint(i + 1), x % 1);
    };

    // the egg: close in, crack, shatter, wake
    const eggA = -0.19;
    const sCrack = add(work, [Math.sin(eggA) * 7.4, 4.3, Math.cos(eggA) * 7.4], [0, 3.5, 0], { fov: 34, par: 0.5 });
    const sShatter = add(work, [-0.85, 3.9, 5.3], [0, 3.55, 0], { fov: 38, par: 0.2, flash: 0.06, flashColor: '#e6d8ff' });
    const sAwake = add(work, [-0.4, 2.2, 1.7], [0, 3.3, 0], { fov: 84, par: 0.15, roll: -2, focus: [0, 2.6, 0.2] });
    add(work, [-0.3, 3.55, 1.45], [0, 4.2, 0], { fov: 72, par: 0.12, roll: 1, focus: [0, 3.8, 0.2] });
    add(work, [-0.15, 4.85, 1.3], [0, 4.85, 0], { fov: 58, par: 0.1, focus: [0, 4.85, 0.25], L: atThread(work, work.threadTouch) - 1.5 });
    work.eggS = {
      crack: [sCrack - 0.5, sShatter - 0.2],
      shatter: [sShatter - 0.3, sShatter + 0.6],
      awake: [sShatter + 0.1, sAwake + 0.5],
      lead: [sAwake - 0.2, sAwake + 0.95],
    };

    // chase shots: the figure rides the thread, the camera follows
    const ride = (space, L, o = {}) => {
      const c = flight.chase(L, { back: o.back, lift: o.lift, side: o.side, ahead: o.ahead, hover: o.hover, flat: o.flat }, flight.makeChase());
      return add({ index: space.index, w: WORLD.w, dir: WORLD.dir }, c.pos.toArray(), c.look.toArray(), {
        fov: 52, par: 0.3, ...o, L, fly: 1, focus: c.rider.toArray(), up: c.up.toArray(),
      });
    };
    const behind = (side) => ({ back: 1.05, lift: 0.78, side: side * 1.55, ahead: 10 });
    const touch = atThread(work, work.threadTouch);
    ride(work, touch + 2, { f: 3.2, fov: 54, back: 2.4, lift: 1.1, side: 0.8, ahead: 4, dwell: false });
    const toDunes = atThread(threshold, 3);
    const leg = (t) => lerp(touch + 2, toDunes, t);
    ride(work, leg(0.05), { ...behind(0.42), f: 3.28, fov: 52, dwell: false });
    ride(work, leg(0.15), { ...behind(0.42), f: 3.36, fov: 54, dwell: false });
    ride(threshold, leg(0.33), { ...behind(0.42), f: 3.46, fov: 57, dwell: false });
    ride(threshold, leg(0.61), { ...behind(0.42), f: 3.62, fov: 58, dwell: false });
    const tn = threshold.thread.length;
    ride(threshold, toDunes, { ...behind(0.42), f: 4, fov: 50 });
    ride(threshold, atThread(threshold, 5), { ...behind(0.42), f: 4.1, fov: 50, hover: 0.9 });
    ride(threshold, atThread(threshold, Math.min(8, tn - 7)), { ...behind(0.42), f: 4.2, fov: 50, hover: 0.8 });
    ride(threshold, atThread(threshold, tn - 6), { ...behind(0.42), f: 4.3, fov: 46, hover: 0.8 });
    ride(threshold, atThread(threshold, tn - 3), { ...behind(0.42), f: 4.4, fov: 52, hover: 0.5, dwell: false, flash: 0.25, flashColor: '#ff2a18' });
    ride(threshold, atThread(threshold, tn - 1), { ...behind(0.42), f: 4.6, fov: 56, dwell: false, flash: 0.5, flashColor: '#b01008' });
    ride(network, atThread(network, 0), { ...behind(0.42), f: 4.85, fov: 54, dwell: false, flash: 0.2, flashColor: '#b01008' });
    ride(network, atThread(network, 1), { ...behind(0.42), f: 5, fov: 50 });
    ride(network, atThread(network, 3), { ...behind(0.42), f: 5.1, fov: 48 });
    ride(network, atThread(network, 5), { ...behind(0.42), f: 5.25, fov: 50 });
    ride(network, atThread(network, 7), { ...behind(0.42), f: 5.45, fov: 54, dwell: false });
    const finale = { index: 6 };
    ride(finale, atThread(network, 9), { ...behind(0.42), f: 5.75, fov: 56, dwell: false });
    // pull far back: the whole thread, every chapter on it
    ride(finale, afterLoop(1), { f: 6, fov: 50, back: 13, lift: 7, side: 9, ahead: 3, lw: 0.25, keep: 0.3 });
    ride(finale, afterLoop(1.45), { f: 6, fov: 44, back: 19, lift: 13, side: 15, ahead: 3, lw: 0.55, keep: 0.26 });
    ride(finale, afterLoop(1.9), { f: 6, fov: 40, back: -2.8, lift: -0.2, side: 2.6, ahead: -1.2, lw: 0, keep: 0.3 });
  };
}
