import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { rng } from './util.js';

// The camera body: scatter-as-gather bokeh DOF, a dual-filter bloom, an anamorphic streak,
// lens dirt, distortion + chromatic aberration, speed smear, ACES and a film grade.

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// colour + signed circle of confusion (negative = in front of focus)
const COC_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear, uFar, uFocus, uAperture, uFarMax, uNearMax;
float linZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main(){
  vec3 c = texture2D(tColor, vUv).rgb;
  float d0 = texture2D(tDepth, vUv + uTexel * vec2(-0.5, -0.5)).r;
  float d1 = texture2D(tDepth, vUv + uTexel * vec2( 0.5, -0.5)).r;
  float d2 = texture2D(tDepth, vUv + uTexel * vec2(-0.5,  0.5)).r;
  float d3 = texture2D(tDepth, vUv + uTexel * vec2( 0.5,  0.5)).r;
  float z = linZ(min(min(d0, d1), min(d2, d3)));
  float coc = clamp(uAperture * (1.0 - uFocus / max(z, 0.001)), -uNearMax, uFarMax);
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  gl_FragColor = vec4(min(c, vec3(80.0)), coc);
}
`;

// golden-angle spiral gather; samples only count if their own blur reaches this pixel
const BOKEH_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tCoc;
uniform vec2 uTexel;
uniform float uMaxR;
void main(){
  vec4 c0 = texture2D(tCoc, vUv);
  float cs = abs(c0.a);
  vec3 acc = c0.rgb;
  float tot = 1.0;
  float radius = 1.0;
  float ang = 0.0;
  float nearCover = 0.0;
  for (int i = 0; i < 72; i++) {
    if (radius >= uMaxR) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec4 s = texture2D(tCoc, tc);
    float ss = abs(s.a);
    if (s.a > c0.a) ss = min(ss, cs * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, ss);
    acc += mix(acc / tot, s.rgb, m);
    tot += 1.0;
    if (s.a < -0.6) nearCover = max(nearCover, m);
    ang += 2.39996323;
    radius += 1.0 / radius;
  }
  float blend = max(smoothstep(0.25, 1.4, cs), nearCover);
  gl_FragColor = vec4(acc / tot, blend);
}
`;

const DOWN_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold, uKnee, uPrefilter;
vec3 pf(vec3 c){
  if (uPrefilter < 0.5) return c;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-4);
  return c * max(rq, br - uThreshold) / max(br, 1e-4);
}
vec3 S(vec2 o){ return pf(texture2D(tSrc, vUv + o * uTexel).rgb); }
void main(){
  vec3 a = S(vec2(-2.0, 2.0)), b = S(vec2(0.0, 2.0)), c = S(vec2(2.0, 2.0));
  vec3 d = S(vec2(-2.0, 0.0)), e = S(vec2(0.0, 0.0)), f = S(vec2(2.0, 0.0));
  vec3 g = S(vec2(-2.0, -2.0)), h = S(vec2(0.0, -2.0)), i = S(vec2(2.0, -2.0));
  vec3 j = S(vec2(-1.0, 1.0)), k = S(vec2(1.0, 1.0)), l = S(vec2(-1.0, -1.0)), m = S(vec2(1.0, -1.0));
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(o, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius, uWeight;
void main(){
  vec2 d = uTexel * uRadius;
  vec3 s = texture2D(tSrc, vUv + vec2(-d.x, -d.y)).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -d.y)).rgb * 2.0
         + texture2D(tSrc, vUv + vec2(d.x, -d.y)).rgb
         + texture2D(tSrc, vUv + vec2(-d.x, 0.0)).rgb * 2.0
         + texture2D(tSrc, vUv).rgb * 4.0
         + texture2D(tSrc, vUv + vec2(d.x, 0.0)).rgb * 2.0
         + texture2D(tSrc, vUv + vec2(-d.x, d.y)).rgb
         + texture2D(tSrc, vUv + vec2(0.0, d.y)).rgb * 2.0
         + texture2D(tSrc, vUv + vec2(d.x, d.y)).rgb;
  gl_FragColor = vec4(s * (uWeight / 16.0), 1.0);
}
`;

// horizontal gaussian, run repeatedly at growing steps for the anamorphic streak
const STREAK_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uStep, uThresh;
void main(){
  vec3 s = vec3(0.0);
  float w = 0.0;
  for (int i = -7; i <= 7; i++) {
    float fi = float(i);
    float wi = exp(-fi * fi / 20.0);
    vec3 c = texture2D(tSrc, vUv + vec2(fi * uStep * uTexel.x, 0.0)).rgb;
    c = max(c - uThresh, 0.0);
    s += c * wi;
    w += wi;
  }
  gl_FragColor = vec4(s / w, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSharp;
uniform sampler2D tDof;
uniform sampler2D tBloom;
uniform sampler2D tStreak;
uniform sampler2D tDirt;
uniform vec2 uRes;
uniform float uTime;
uniform float uLens, uCA, uFbm, uSpeed, uBloom, uStreak, uDirt, uExposure, uContrast, uSaturation, uVignette, uGrain, uFlashAmt, uLetterbox;
uniform vec3 uLift, uGain, uTint, uFlashColor, uStreakTint;
uniform vec2 uCursorUv;
uniform float uCursorAmt;
${NOISE_GLSL}
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(OUT * RRTAndODTFit(IN * c), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 uv = vUv;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (uv - 0.5) * asp;
  float r2 = dot(p, p);
  vec2 pd = p * (1.0 + uLens * r2 + uLens * 0.6 * r2 * r2);
  // a slow heat-haze warp of the whole frame
  vec3 nq = vec3(p * 2.1, uTime * 0.11);
  vec2 warp = vec2(snoise(nq), snoise(nq + vec3(19.1, 7.3, 3.3)));
  vec3 nq2 = vec3(p * 8.5, uTime * 0.55);
  warp += 0.4 * vec2(snoise(nq2), snoise(nq2 + vec3(5.0, 2.0, 1.0)));
  pd += warp * uFbm;
  float ca = uCA * (0.25 + r2 * 2.4);
  vec2 uvR = pd * (1.0 + ca) / asp + 0.5;
  vec2 uvG = pd / asp + 0.5;
  vec2 uvB = pd * (1.0 - ca) / asp + 0.5;
  float blend = texture2D(tDof, uvG).a;
  vec3 col;
  if (uSpeed > 0.0015) {
    // radial smear toward the centre when the camera moves fast
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float sc = 1.0 - float(i) * uSpeed;
      vec2 r = (uvR - 0.5) * sc + 0.5;
      vec2 g = (uvG - 0.5) * sc + 0.5;
      vec2 b = (uvB - 0.5) * sc + 0.5;
      acc.r += mix(texture2D(tSharp, r).r, texture2D(tDof, r).r, blend);
      acc.g += mix(texture2D(tSharp, g).g, texture2D(tDof, g).g, blend);
      acc.b += mix(texture2D(tSharp, b).b, texture2D(tDof, b).b, blend);
    }
    col = acc / 8.0;
  } else {
    col.r = mix(texture2D(tSharp, uvR).r, texture2D(tDof, uvR).r, blend);
    col.g = mix(texture2D(tSharp, uvG).g, texture2D(tDof, uvG).g, blend);
    col.b = mix(texture2D(tSharp, uvB).b, texture2D(tDof, uvB).b, blend);
  }
  vec3 bl = vec3(texture2D(tBloom, uvR).r, texture2D(tBloom, uvG).g, texture2D(tBloom, uvB).b);
  col += bl * uBloom;
  col += texture2D(tStreak, uvG).rgb * uStreakTint * uStreak;
  col += bl * texture2D(tDirt, uv).rgb * uDirt;
  col *= uExposure;
  col = mix(col, uFlashColor, uFlashAmt);
  vec3 s = toSRGB(aces(col));
  s = s * uGain + uLift * (1.0 - s);
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  s = mix(vec3(l), s, uSaturation);
  s = (s - 0.5) * uContrast + 0.5;
  s *= uTint;
  float v = smoothstep(1.35, 0.15, length(p * vec2(0.92, 1.08)));
  s *= mix(1.0, v, uVignette);
  float lb = smoothstep(uLetterbox, uLetterbox + 0.002, uv.y) * smoothstep(uLetterbox, uLetterbox + 0.002, 1.0 - uv.y);
  s *= lb;
  float gr = hash12(floor(uv * uRes) + fract(uTime * 13.7) * 311.0) - 0.5;
  s += gr * uGrain * (0.5 + 0.5 * (1.0 - l));
  s += (hash12(uv * uRes + 71.3) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}
`;

function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
}

const passMaterial = (fragmentShader, uniforms, extra = {}) =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });

/** Painted lens dirt: soft smudges, specks and a few wipe marks. */
function lensDirt() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(42);
  for (let i = 0; i < 90; i++) {
    const x = r() * 512, y = r() * 512, rad = 6 + r() * r() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.04 + r() * 0.14;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.7, `rgba(255,255,255,${a * 0.6})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`;
    ctx.beginPath();
    ctx.arc(r() * 512, r() * 512, 0.4 + r() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#fff';
  for (let i = 0; i < 14; i++) {
    ctx.lineWidth = 4 + r() * 18;
    ctx.beginPath();
    const x = r() * 512, y = r() * 512;
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + r() * 200 - 100, y + r() * 200 - 100,
      x + r() * 200 - 100, y + r() * 200 - 100,
      x + r() * 300 - 150, y + r() * 300 - 150,
    );
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class Post {
  constructor(renderer, { bloomLevels = 6, samples = 4 } = {}) {
    this.renderer = renderer;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(fullscreenTriangle(), null);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);

    const rt = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...rt, depthBuffer: true, samples });
    this.rtScene.depthTexture = new THREE.DepthTexture(4, 4);
    this.rtCoc = new THREE.WebGLRenderTarget(4, 4, rt);
    this.rtDof = new THREE.WebGLRenderTarget(4, 4, rt);
    this.bloom = Array.from({ length: bloomLevels }, () => new THREE.WebGLRenderTarget(4, 4, rt));
    this.streakA = new THREE.WebGLRenderTarget(4, 4, rt);
    this.streakB = new THREE.WebGLRenderTarget(4, 4, rt);

    const v2 = () => ({ value: new THREE.Vector2() });
    this.cocMat = passMaterial(COC_FRAG, {
      tColor: { value: this.rtScene.texture },
      tDepth: { value: this.rtScene.depthTexture },
      uTexel: v2(), uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 10 },
      uAperture: { value: 6 }, uFarMax: { value: 6 }, uNearMax: { value: 10 },
    });
    this.bokehMat = passMaterial(BOKEH_FRAG, { tCoc: { value: this.rtCoc.texture }, uTexel: v2(), uMaxR: { value: 10 } });
    this.downMat = passMaterial(DOWN_FRAG, {
      tSrc: { value: null }, uTexel: v2(), uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uPrefilter: { value: 0 },
    });
    this.upMat = passMaterial(
      UP_FRAG,
      { tSrc: { value: null }, uTexel: v2(), uRadius: { value: 1 }, uWeight: { value: 1 } },
      { blending: THREE.AdditiveBlending, transparent: true },
    );
    this.streakMat = passMaterial(STREAK_FRAG, { tSrc: { value: null }, uTexel: v2(), uStep: { value: 1 }, uThresh: { value: 0 } });
    this.compMat = passMaterial(COMPOSITE_FRAG, {
      tSharp: { value: this.rtScene.texture },
      tDof: { value: this.rtDof.texture },
      tBloom: { value: this.bloom[0].texture },
      tStreak: { value: this.streakB.texture },
      tDirt: { value: lensDirt() },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uLens: { value: 0.05 }, uCA: { value: 0.003 }, uFbm: { value: 0.001 }, uSpeed: { value: 0 },
      uBloom: { value: 0.8 }, uStreak: { value: 0.3 }, uDirt: { value: 0.5 }, uExposure: { value: 1 },
      uContrast: { value: 1 }, uSaturation: { value: 1 }, uVignette: { value: 0.5 }, uGrain: { value: 0.06 },
      uFlashAmt: { value: 0 }, uLetterbox: { value: 0 },
      uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      uFlashColor: { value: new THREE.Color(1, 1, 1) }, uStreakTint: { value: new THREE.Color(1, 0.3, 0.2) },
      uCursorUv: { value: new THREE.Vector2(0.5, 0.5) }, uCursorAmt: { value: 0 },
    });
    this.width = 4;
    this.height = 4;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.rtScene.setSize(w, h);
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    this.rtCoc.setSize(hw, hh);
    this.rtDof.setSize(hw, hh);
    let bw = hw, bh = hh;
    for (const t of this.bloom) {
      bw = Math.max(1, Math.ceil(bw / 2));
      bh = Math.max(1, Math.ceil(bh / 2));
      t.setSize(bw, bh);
    }
    const s = this.bloom[1] || this.bloom[0];
    this.streakA.setSize(s.width, s.height);
    this.streakB.setSize(s.width, s.height);
    this.compMat.uniforms.uRes.value.set(w, h);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera, p) {
    const r = this.renderer;
    r.autoClear = false;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0, 1);
    r.clear(true, true, false);
    r.render(scene, camera);

    const coc = this.cocMat.uniforms;
    coc.uTexel.value.set(1 / this.width, 1 / this.height);
    coc.uNear.value = camera.near;
    coc.uFar.value = camera.far;
    coc.uFocus.value = p.focus;
    coc.uAperture.value = p.aperture;
    coc.uFarMax.value = p.farMax;
    coc.uNearMax.value = p.nearMax;
    this.pass(this.cocMat, this.rtCoc);

    const bk = this.bokehMat.uniforms;
    bk.uTexel.value.set(1 / this.rtCoc.width, 1 / this.rtCoc.height);
    bk.uMaxR.value = p.maxRadius;
    this.pass(this.bokehMat, this.rtDof);

    const dn = this.downMat.uniforms;
    let src = this.rtDof;
    for (let i = 0; i < this.bloom.length; i++) {
      dn.tSrc.value = src.texture;
      dn.uTexel.value.set(1 / src.width, 1 / src.height);
      dn.uPrefilter.value = i === 0 ? 1 : 0;
      dn.uThreshold.value = p.threshold;
      dn.uKnee.value = p.knee;
      this.pass(this.downMat, this.bloom[i]);
      src = this.bloom[i];
    }

    const st = this.streakMat.uniforms;
    if (p.streak > 0.001) {
      const s = this.bloom[1] || this.bloom[0];
      st.uTexel.value.set(1 / s.width, 1 / s.height);
      const steps = [[s, this.streakA, 1, p.streakThreshold], [this.streakA, this.streakB, 4, 0], [this.streakB, this.streakA, 14, 0], [this.streakA, this.streakB, 40, 0]];
      for (const [from, to, step, thresh] of steps) {
        st.tSrc.value = from.texture;
        st.uStep.value = step;
        st.uThresh.value = thresh;
        this.pass(this.streakMat, to);
      }
    } else {
      r.setRenderTarget(this.streakB);
      r.clear(true, false, false);
    }

    const up = this.upMat.uniforms;
    for (let i = this.bloom.length - 2; i >= 0; i--) {
      const s = this.bloom[i + 1];
      up.tSrc.value = s.texture;
      up.uTexel.value.set(1 / s.width, 1 / s.height);
      up.uRadius.value = p.bloomRadius;
      up.uWeight.value = 1;
      this.pass(this.upMat, this.bloom[i]);
    }

    const u = this.compMat.uniforms;
    u.uTime.value = p.time;
    u.uLens.value = p.lens;
    u.uCA.value = p.ca;
    u.uFbm.value = p.fbm;
    u.uSpeed.value = p.speed;
    u.uBloom.value = p.bloom / this.bloom.length;
    u.uStreak.value = p.streak;
    u.uStreakTint.value.copy(p.streakTint);
    u.uDirt.value = p.dirt / this.bloom.length;
    u.uExposure.value = p.exposure / 0.6;
    u.uContrast.value = p.contrast;
    u.uSaturation.value = p.saturation;
    u.uVignette.value = p.vignette;
    u.uGrain.value = p.grain;
    u.uFlashAmt.value = p.flash;
    u.uFlashColor.value.copy(p.flashColor);
    u.uLetterbox.value = p.letterbox;
    u.uLift.value.copy(p.lift);
    u.uGain.value.copy(p.gain);
    u.uTint.value.copy(p.tint);
    u.uCursorUv.value.copy(p.cursorUv);
    u.uCursorAmt.value = p.cursorAmt;
    this.pass(this.compMat, null);
  }
}
