import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { G, FOG } from './core/glsl.js';
import { clamp, damp, lerp, smooth } from './core/util.js';
import { Post } from './core/post.js';
import { Input } from './core/input.js';
import { LightRig } from './core/lights.js';
import { LOOKS, makeLook, mixLooks } from './core/looks.js';
import { createSky } from './core/sky.js';
import { createParticles } from './world/particles.js';
import { createDebris } from './world/debris.js';
import { createThread } from './world/thread.js';
import { buildChapters } from './chapters/index.js';
import { createFlight } from './story/flight.js';
import { createStory } from './story/story.js';
import { authorShots } from './story/shots.js';
import { createHero } from './hero/hero.js';
import { createAudio } from './audio.js';
import { Hud } from './ui/hud.js';

if (!document.createElement('canvas').getContext('webgl2')) {
  document.querySelector('.loader-k').innerHTML = 'This film needs WebGL 2. Say hi instead: <a href="mailto:ayushkumar1699@gmail.com" style="color:inherit">ayushkumar1699@gmail.com</a>';
  document.querySelector('.loader-bar').remove();
  document.getElementById('loader-p').remove();
  throw new Error('WebGL 2 unavailable');
}

const params = new URLSearchParams(location.search);
if (params.has('clean')) document.documentElement.classList.add('clean');

function pickQuality() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const q = params.get('q');
  if (q === 'low' || (touch && small)) return { name: 'low', maxDpr: 1, msaa: 0, dust: 3500, debris: 3600, grass: 0.45, shadow: 1024, dofR: 7 };
  if (q === 'high') return { name: 'high', maxDpr: 2, msaa: 4, dust: 12000, debris: 18000, grass: 1.3, shadow: 2048, dofR: 11 };
  return { name: 'med', maxDpr: 1.5, msaa: 4, dust: 9000, debris: 12000, grass: 1, shadow: 2048, dofR: 10 };
}
const quality = pickQuality();

// ---- renderer, scene, camera --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NoToneMapping;
renderer.transmissionResolutionScale = 0.6;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0, 0.01); // only switches fog on; our own height fog does the work
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 6000);
scene.add(camera);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const post = new Post(renderer, { samples: quality.msaa });
const scrollEl = document.getElementById('scroll');
const storyMax = () => Math.max(1, scrollEl.offsetHeight - innerHeight);
const input = new Input({ storyMax });
const rig = new LightRig(scene, { shadowSize: quality.shadow });
const look = makeLook();
const sky = createSky();
scene.add(sky.group);
const dust = createParticles({ mode: 'wrap', count: quality.dust, box: 56, size: 0.024, amount: 0.8, repel: 1.8, twinkle: 0.45, seed: 99 });
scene.add(dust.points);
const debris = createDebris({ count: quality.debris, box: 24 });
scene.add(debris.group);

// ---- the world ----------------------------------------------------------------------------
const world = { scene, renderer, camera, quality, params };
const chapters = buildChapters(world);
chapters.forEach((c) => scene.add(c.group));

// one thread through all six chapters, closed by a long loop up through the sky
const threadPts = [];
for (let i = 0; i < 6; i++) {
  const c = chapters[i];
  if (c.thread.length) threadPts.push(...c.thread);
  else threadPts.push(c.origin.clone().add(new THREE.Vector3(0, 4, 0)));
}
const last = threadPts[threadPts.length - 1], first = threadPts[0];
threadPts.push(new THREE.Vector3(last.x, last.y + 160, last.z));
threadPts.push(new THREE.Vector3(last.x * 0.6 + first.x * 0.4, 260, last.z * 0.6 + first.z * 0.4));
threadPts.push(new THREE.Vector3(first.x * 0.8 + last.x * 0.2, first.y + 220, first.z * 0.8 + last.z * 0.2));
const thread = createThread(threadPts);
scene.add(thread.mesh);

const work = chapters[3];
const flight = createFlight(thread.curve);
const hero = createHero({ work, flight });
scene.add(hero.group);
const story = createStory(chapters, authorShots(flight));

const transmissive = [];
scene.traverse((o) => {
  if (o.isMesh && o.material && o.material.transmission > 0) transmissive.push({ o, p: new THREE.Vector3() });
});

let dpr = Math.min(devicePixelRatio, quality.maxDpr);
const drawSize = new THREE.Vector2();
function resize() {
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.getDrawingBufferSize(drawSize);
  post.setSize(drawSize.x, drawSize.y);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  G.uPixelRatio.value = dpr;
  G.uViewH.value = drawSize.y;
  scrollEl.style.height = `${story.count * 46}vh`;
  input.readScroll();
}
addEventListener('resize', resize);
resize();

const chapterStarts = chapters.slice(0, 6).map((c, i) => (story.ranges[i] ? story.ranges[i][0] : 0));
const hud = new Hud({
  onJump(i) {
    const s = i === 0 ? 0 : chapterStarts[i - 1] + 0.35;
    scrollTo({ top: (s / (story.count - 1)) * storyMax(), behavior: 'smooth' });
  },
});
hud.layoutRail(chapterStarts.map((s) => s / (story.count - 1)));
window.__story = story;
window.__jump = (s) => {
  scrollTo(0, (s / (story.count - 1)) * storyMax());
  input.readScroll();
  input.scroll = input.scrollTarget;
};
if (params.has('s')) requestAnimationFrame(() => window.__jump(parseFloat(params.get('s'))));

// where the scene index crosses an integer: chapter seams, for the warp + whoosh
const st = story.createState();
const seams = [];
{
  const tmpState = story.createState();
  let prev = null;
  for (let s = 0; s <= story.count - 1; s += 0.01) {
    story.sample(s, tmpState);
    const f = Math.round(tmpState.sceneF);
    if (prev !== null && f !== prev && f <= 6) seams.push(s);
    prev = f;
  }
}
const seamAt = (s) => seams.reduce((m, x) => Math.max(m, Math.exp(-(((s - x) / 0.3) ** 2))), 0);

// ---- per-frame state ----------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const UP = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lastCam = new THREE.Vector3();
const flashCol = new THREE.Color(), cursorUv = new THREE.Vector2();
let speed = 0, time = 0, frames = 0, frameTime = 0;
const timer = new THREE.Timer();
const P = {
  focus: 10, aperture: 5, farMax: 4, nearMax: 12, maxRadius: quality.dofR, threshold: 1, knee: 0.6, bloom: 1, bloomRadius: 1,
  streak: 0.3, streakThreshold: 1.2, streakTint: new THREE.Color(), dirt: 0.5, lens: 0.05, ca: 0.003, fbm: 0.001, speed: 0,
  exposure: 1, contrast: 1, saturation: 1, vignette: 0.5, grain: 0.06, flash: 0, flashColor: new THREE.Color(), letterbox: 0,
  lift: new THREE.Vector3(), gain: new THREE.Vector3(1, 1, 1), tint: new THREE.Vector3(1, 1, 1), cursorUv: new THREE.Vector2(0.5, 0.5), cursorAmt: 0, time: 0,
};
let focus = 20;
const phase = { crack: 0, shatter: 0, awake: 0, lead: 0, fly: 0 };
const span = (s, r) => clamp((s - r[0]) / (r[1] - r[0]), 0, 1);
const chaseRig = flight.makeChase();
chaseRig.lookTo = new THREE.Vector3(0, -210, -160); // the finale looks back at the whole world
const tintTmp = new THREE.Color();
const white = new THREE.Color(1, 1, 1);
const audio = createAudio({ button: document.getElementById('sound-btn') });
let tailRun = 0;
// a spring for the cursor's camera sway
const SWAY = { yaw: 0.04, pitch: 0.024, stiffness: 16, damping: 1 };
const sway = {
  x: 0, y: 0, vx: 0, vy: 0,
  update(dt, target) {
    const k = SWAY.stiffness, c = 2 * Math.sqrt(k) * SWAY.damping;
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vx += ((target.x - this.x) * k - this.vx * c) * h;
      this.vy += ((target.y - this.y) * k - this.vy * c) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
    }
  },
};

function frame(dt) {
  time += dt;
  G.uTime.value = time;
  input.update(dt);
  const s = input.scroll * (story.count - 1);
  story.sample(s, st);
  // past the last key the rider keeps going round the loop on its own
  const tail = smooth(story.count - 1.5, story.count - 1, s);
  tailRun = tail > 0 ? tailRun + dt * 2.4 * tail : damp(tailRun, 0, 2.5, dt);
  st.L += tailRun;

  const egg = work.eggS;
  phase.crack = span(s, egg.crack);
  phase.shatter = span(s, egg.shatter);
  phase.awake = span(s, egg.awake);
  phase.lead = span(s, egg.lead);
  phase.fly = st.fly;
  hero.group.visible = st.sceneF > 2.3;
  hero.update({ t: time, dt, st, phase, raycaster, input, camera });
  if (st.fly > 0) {
    hero.chase(st.L, st, chaseRig);
    for (const c of chapters) {
      if (c.floorAt && c.group.visible) chaseRig.pos.y = Math.max(chaseRig.pos.y, c.floorAt(chaseRig.pos));
    }
    const k = smooth(0, 1, st.fly);
    st.pos.lerp(chaseRig.pos, k);
    st.look.lerp(chaseRig.look, k);
    st.up.lerp(chaseRig.up, k).normalize();
    st.focus.lerp(chaseRig.focus, k);
  }

  // camera: the key, plus a little spring sway toward the cursor
  sway.update(dt, input.target);
  fwd.copy(st.look).sub(st.pos).normalize();
  right.crossVectors(fwd, st.up);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  upv.crossVectors(right, fwd).normalize();
  camPos.copy(st.pos).addScaledVector(right, sway.x * st.par).addScaledVector(upv, sway.y * st.par * 0.55);
  camLook.copy(st.look);
  // on tall screens, back off from the egg so it still fits
  const pull = clamp((1.1 - camera.aspect) / 0.6, 0, 1) * 0.45 * clamp((s - egg.crack[0]) / 0.6, 0, 1) * (1 - st.fly);
  if (pull > 0) camPos.sub(camLook).multiplyScalar(1 + pull).add(camLook);
  camera.position.copy(camPos);
  camera.up.copy(st.up);
  camera.lookAt(camLook);
  camera.rotateY(-sway.x * SWAY.yaw);
  camera.rotateX(sway.y * SWAY.pitch);
  camera.rotateZ(st.roll);
  camera.rotateX(-smooth(0, 1, input.footerS) * 0.05);
  // keep the horizontal framing on portrait screens by widening the vertical fov
  const widen = Math.sqrt(Math.max(1, 1.5 / camera.aspect));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(st.fov) / 2) * widen));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  G.uProjScale.value = drawSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const v = camPos.distanceTo(lastCam) / Math.max(dt, 1e-4);
  lastCam.copy(camPos);
  speed = damp(speed, Math.min(v, 200), 4, dt);

  // grade: blend the two chapter looks either side of the camera
  const f = clamp(st.sceneF, 0, LOOKS.length - 1);
  const fa = Math.floor(f), fb = Math.min(fa + 1, LOOKS.length - 1);
  const ft = smooth(0, 1, f - fa);
  mixLooks(LOOKS[fa], LOOKS[fb], ft, look);
  // in the work chapter the whole world leans toward the colour of the project in view
  const tw = work.tintW * clamp(1 - Math.abs(f - 3) * 1.4, 0, 1);
  if (tw > 0.001) {
    const c = work.tint;
    look.nebA.lerp(tintTmp.copy(c).multiplyScalar(0.06), tw);
    look.nebB.lerp(tintTmp.copy(c).multiplyScalar(0.025), tw * 0.8);
    look.skyHorizon.lerp(tintTmp.copy(c).multiplyScalar(0.02), tw);
    look.fogColor.lerp(tintTmp.copy(c).multiplyScalar(0.01), tw);
    look.hemiSky.lerp(tintTmp.copy(c).lerp(white, 0.3), tw * 0.5);
    look.dust.lerp(tintTmp.copy(c).lerp(white, 0.3), tw * 0.3);
    look.streakTint.lerp(c, tw);
  }
  FOG.uFogColor.value.copy(look.fogColor);
  FOG.uFogDensity.value = look.fogDensity;
  FOG.uFogFalloff.value = look.fogFalloff;
  FOG.uFogNoise.value = look.fogNoise;
  const fogBase = (i) => (i === 6 ? 0 : chapters[i].origin.y) + LOOKS[i].fogBase;
  FOG.uFogBase.value = lerp(fogBase(fa), fogBase(fb), ft);
  scene.environmentIntensity = look.env;
  rig.update(f, chapters, look);
  renderer.shadowMap.needsUpdate = rig.key.intensity > 0.001;
  sky.update(camera, look);
  dust.uniforms.uCamPos.value.copy(camera.position);
  dust.uniforms.uColor.value.copy(look.dust);
  dust.uniforms.uColor2.value.copy(look.dust);
  dust.uniforms.uAmt.value = look.dustAmt;
  dust.points.visible = look.dustAmt > 0.005;
  debris.update(camera, look);

  raycaster.setFromCamera(input.fast, camera);
  G.uRayO.value.copy(raycaster.ray.origin);
  G.uRayD.value.copy(raycaster.ray.direction);
  G.uCursor.value.copy(input.ndc);
  G.uCursorVel.value = input.energy;
  const fd = Math.max(0.5, UP.copy(st.focus).sub(camPos).dot(fwd));
  focus = damp(focus, fd, 5, dt);
  G.uFocus.value = focus;
  const flyOpen = 1 - smooth(0, 0.6, st.fly);
  G.uBokeh.value = (look.aperture / 5) * flyOpen;

  // only the chapters near the camera are visible and updated
  const finale = f > 5.35;
  for (const c of chapters) {
    if (c.index >= 6) continue;
    const vis = Math.abs(f - c.index) < 0.8 || finale;
    if (c.group.visible && !vis && c.onHide) c.onHide();
    c.group.visible = vis;
    if (vis) {
      c.update({
        t: time, dt, local: story.local(c.index, s), weight: 1 - Math.min(1, Math.abs(f - c.index)), raycaster, input, camera, look, st, finale, awake: phase.awake,
      });
    }
  }
  for (const it of transmissive) it.o.visible = camPos.distanceTo(it.o.getWorldPosition(it.p)) < 170;

  // the thread's bright head marks where you are on it
  const nearL = thread.nearestL(camPos) + 10;
  thread.uniforms.uHead.value = st.fly > 0.5 ? hero.state.L + 3 : nearL;
  thread.uniforms.uGain.value = 1 + smooth(5.6, 6, f) * (1 - smooth(6.2, 6.6, f)) * 1.4;

  P.focus = focus;
  P.aperture = look.aperture * flyOpen;
  P.farMax = look.farMax;
  P.nearMax = look.nearMax;
  P.threshold = look.threshold;
  P.knee = look.knee;
  P.bloom = look.bloom;
  P.bloomRadius = look.bloomRadius;
  P.streak = look.streak;
  P.streakThreshold = look.streakThreshold;
  P.streakTint.copy(look.streakTint);
  P.dirt = look.dirt;
  const rush = smooth(8, 70, speed);
  const seam = seamAt(s);
  audio.update({
    scrollV: Math.abs(input.scrollTarget - input.scroll) * story.count, flash: st.flash, sceneF: f, fly: st.fly, speed, seam,
    crack: phase.crack, shatter: phase.shatter, awake: phase.awake, footer: input.footerS, modal: document.documentElement.classList.contains('modal-open'),
  });
  P.lens = -seam * 0.45;
  P.ca = 6e-4 + st.flash * 0.004 + seam * 0.018;
  P.fbm = look.fbm + seam * 0.075;
  P.speed = rush * 0.012;
  P.exposure = look.exposure;
  P.contrast = look.contrast;
  P.saturation = look.saturation;
  P.vignette = look.vignette;
  P.grain = look.grain;
  P.flash = st.flash + smooth(0, 1, input.footerS) * 0.08;
  P.flashColor.copy(flashCol.copy(st.flashColor).multiplyScalar(2.2));
  P.letterbox = st.letterbox;
  P.lift.copy(look.lift);
  P.gain.copy(look.gain);
  P.tint.copy(look.tint);
  cursorUv.set(input.fast.x * 0.5 + 0.5, input.fast.y * 0.5 + 0.5);
  P.cursorUv.copy(cursorUv);
  P.cursorAmt = 0.35 + input.energy * 1.2;
  P.time = time;
  post.render(scene, camera, P);

  const introAmt = 1 - smooth(0.05, 0.7, s);
  const finaleAmt = smooth(story.count - 3.1, story.count - 2.5, s) * (1 - smooth(story.count - 1.6, story.count - 1.15, s));
  hud.update({
    sceneF: f, progress: input.scroll, chapterLocal: story.local(Math.round(f), s), introAmt, finaleAmt, footerAmt: input.footer, dt,
  });

  // adaptive resolution: drop pixel ratio when frames run long, recover when there's headroom
  frameTime += dt;
  frames++;
  if (frameTime > 2) {
    const avg = frameTime / frames;
    const top = Math.min(devicePixelRatio, quality.maxDpr);
    const floor = Math.min(1, top);
    if (avg > 1 / 36 && dpr > floor) {
      dpr = Math.max(floor, dpr - 0.1);
      resize();
    } else if (avg < 1 / 55 && dpr < top) {
      dpr = Math.min(top, dpr + 0.2);
      resize();
    }
    frameTime = 0;
    frames = 0;
  }
}

function loop() {
  timer.update();
  frame(Math.min(timer.getDelta(), 1 / 20));
  requestAnimationFrame(loop);
}

async function boot() {
  const fill = document.getElementById('loader-fill');
  const pct = document.getElementById('loader-p');
  const progress = (k) => {
    fill.style.transform = `scaleX(${k})`;
    pct.textContent = String(Math.round(k * 100)).padStart(3, '0');
  };
  progress(0.15);
  await document.fonts.ready.catch(() => {});
  progress(0.35);
  await hero.figure.ready;
  progress(0.55);
  chapters.forEach((c) => { c.group.visible = true; });
  story.sample(0, st);
  camera.position.copy(st.pos);
  camera.lookAt(st.look);
  try {
    await renderer.compileAsync(scene, camera);
  } catch (e) {
    console.warn(e);
  }
  progress(0.8);
  renderer.shadowMap.needsUpdate = true;
  post.render(scene, camera, P);
  progress(1);
  requestAnimationFrame(loop);
  const loader = document.getElementById('loader');
  setTimeout(() => {
    loader.classList.add('ready');
    loader.querySelector('.loader-k').textContent = 'Best with headphones';
  }, 300);
  loader.querySelectorAll('[data-enter]').forEach((b) => b.addEventListener('click', () => {
    audio.enter(b.dataset.enter === 'sound');
    loader.classList.add('done');
    document.documentElement.classList.remove('gate');
  }));
}
boot();
