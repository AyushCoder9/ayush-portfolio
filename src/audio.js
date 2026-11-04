// Sound: a generative score (pads, bass, arps, a soft pulse) through a lowpass that opens up
// chapter by chapter, plus air, a sub drone, and synthesised effects for every moment.

// lowpass cutoff per chapter: muffled at the start, wide open at the end
const CUTOFF = [480, 850, 1700, 520, 1300, 2400, 15000];

// A minor: Am9 – Fmaj7 – Cmaj7/E – G6, two bars each
const CHORDS = [
  [45, [57, 60, 64, 67, 71]],
  [41, [53, 57, 60, 64, 69]],
  [40, [55, 59, 60, 64, 67]],
  [43, [55, 59, 62, 64, 67]],
];
const BPM = 84;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function impulse(ctx, seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** decay;
  }
  return buf;
}

const pref = {
  get() { try { return localStorage.getItem('ak-sound'); } catch { return null; } },
  set(v) { try { localStorage.setItem('ak-sound', v); } catch { /* storage blocked */ } },
};

export function createAudio({ button } = {}) {
  let ctx = null;
  let n = null;
  let want = pref.get() !== 'off';
  let playing = false;
  let shatterArmed = true;
  const armed = { seam: true, lift: true, eyes: true, door: true };
  const lastPlayed = {};
  // a local-only soundtrack: if public/media/local/music.mp3 exists it replaces the generative
  // score (that folder is git- and vercel-ignored, so deployed builds fall back to the score)
  const TRACK_URL = '/media/local/music.mp3';
  let hasTrack = false;
  let trackEl = null;
  fetch(TRACK_URL, { method: 'HEAD' })
    .then((r) => { hasTrack = r.ok && (r.headers.get('content-type') || '').includes('audio'); })
    .catch(() => {});

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 20000;
    tone.Q.value = 0.3;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.05;
    comp.release.value = 0.4;
    master.connect(tone).connect(comp).connect(ctx.destination);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 4.2, 2.6);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    verb.connect(verbOut).connect(master);
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    dry.connect(master);
    const bus = ctx.createGain(); // effects go dry + wet
    bus.connect(dry);
    bus.connect(verb);

    // the score's chain: song → lowpass (chapter) → peak (scroll whoosh) → gain
    const song = ctx.createGain();
    const songF = ctx.createBiquadFilter();
    songF.type = 'lowpass';
    songF.frequency.value = CUTOFF[0];
    songF.Q.value = 0.9;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 900;
    peak.Q.value = 1.6;
    peak.gain.value = 0;
    const songG = ctx.createGain();
    songG.gain.value = 0.8;
    const send = ctx.createGain();
    send.gain.value = 0.12;
    song.connect(songF).connect(peak).connect(songG);
    songG.connect(master);
    songG.connect(send).connect(verb);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / BPM) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.5;
    delay.connect(fb).connect(delay);
    delay.connect(delayOut).connect(song);

    // brown-ish noise, looped
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.032;
      b2 = 0.95 * b2 + w * 0.048;
      nd[i] = (b0 + b1 + b2 + w * 0.02) * 0.9;
    }
    const noiseSrc = () => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.start(0, Math.random() * 2.5);
      return s;
    };
    const airF = ctx.createBiquadFilter();
    airF.type = 'lowpass';
    airF.frequency.value = 300;
    airF.Q.value = 0.9;
    const airG = ctx.createGain();
    airG.gain.value = 0;
    noiseSrc().connect(airF).connect(airG).connect(bus);
    const seamF = ctx.createBiquadFilter();
    seamF.type = 'bandpass';
    seamF.frequency.value = 400;
    seamF.Q.value = 0.8;
    const seamG = ctx.createGain();
    seamG.gain.value = 0;
    noiseSrc().connect(seamF).connect(seamG).connect(bus);
    // glass: a shimmering partial stack while the egg cracks
    const glassG = ctx.createGain();
    glassG.gain.value = 0;
    const glassF = ctx.createBiquadFilter();
    glassF.type = 'lowpass';
    glassF.frequency.value = 1800;
    glassF.connect(glassG).connect(bus);
    for (const [f, a] of [[880, 0.5], [1318.5, 0.3], [1760, 0.18], [2217, 0.1]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.3 + Math.random() * 0.5;
      const depth = ctx.createGain();
      depth.gain.value = a * 0.5;
      const g = ctx.createGain();
      g.gain.value = a;
      lfo.connect(depth).connect(g.gain);
      o.connect(g).connect(glassF);
      o.start();
      lfo.start();
    }
    const subG = ctx.createGain();
    subG.gain.value = 0;
    const sub = ctx.createOscillator();
    sub.frequency.value = 41.2;
    sub.connect(subG).connect(bus);
    sub.start();
    n = { master, song, songF, songG, peak, send, delay, airF, airG, seamF, seamG, glassG, subG, bus, noiseSrc };
    if (hasTrack) {
      trackEl = new Audio(TRACK_URL);
      trackEl.loop = true;
      trackEl.preload = 'auto';
      const trackG = ctx.createGain();
      trackG.gain.value = 0.55; // a mastered song is far hotter than the synth score
      ctx.createMediaElementSource(trackEl).connect(trackG).connect(song);
    } else {
      startScore();
    }
  }

  // ---- the score -------------------------------------------------------------------------
  let nextStep = 0;
  let step = 0;
  let timer = 0;
  const STEP = 60 / BPM / 4; // sixteenth notes

  function voice(type, freq, t, { a = 0.01, d = 0.3, s = 0, r = 0.2, hold = 0, peakG = 0.1, detune = 0, to = null, dest } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peakG, t + a);
    if (s > 0) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakG * s), t + a + d);
      g.gain.setValueAtTime(Math.max(0.0001, peakG * s), t + a + d + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    o.connect(g).connect(dest || n.song);
    o.start(t);
    o.stop(t + a + d + hold + r + 0.05);
    return g;
  }

  const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  function schedule(i, t) {
    const bar = Math.floor(i / 16);
    const sixteenth = i % 16;
    const [root, notes] = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const beat = 60 / BPM;
    // pads: a new voicing every two bars, long and soft, two detuned saws per note
    if (sixteenth === 0 && bar % 2 === 0) {
      const len = beat * 8;
      for (const m of notes) {
        for (const det of [-7, 7]) {
          voice('sawtooth', mtof(m), t, { a: 1.6, d: 0.8, s: 0.7, hold: len - 2.2, r: 2.4, peakG: 0.012, detune: det });
        }
      }
    }
    // bass on the beat with a soft push on the "and"
    if (sixteenth % 4 === 0) voice('triangle', mtof(root - 12), t, { a: 0.01, d: 0.5, peakG: 0.09 });
    if (sixteenth % 8 === 6) voice('sine', mtof(root - 12), t, { a: 0.01, d: 0.25, peakG: 0.05 });
    // heartbeat kick
    if (sixteenth === 0 || sixteenth === 8) voice('sine', 110, t, { a: 0.004, d: 0.32, peakG: 0.22, to: 42 });
    // arp: a sparse sixteenth pattern from the chord, an octave up, into the delay
    if (rand() < (sixteenth % 2 === 0 ? 0.55 : 0.22)) {
      const m = notes[Math.floor(rand() * notes.length)] + 12;
      const g = voice('triangle', mtof(m), t, { a: 0.005, d: 0.22, peakG: 0.035 });
      g.connect(n.delay);
    }
    // ticks on the off-beats
    if (sixteenth % 4 === 2) {
      const s = n.noiseSrc();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      s.connect(hp).connect(g).connect(n.song);
      s.stop(t + 0.08);
    }
  }

  function startScore() {
    nextStep = ctx.currentTime + 0.1;
    clearInterval(timer);
    timer = setInterval(() => {
      if (!playing || ctx.state !== 'running') return;
      while (nextStep < ctx.currentTime + 0.25) {
        schedule(step++, nextStep);
        nextStep += STEP;
      }
      if (nextStep < ctx.currentTime) nextStep = ctx.currentTime + 0.05;
    }, 60);
  }

  // ---- effects ---------------------------------------------------------------------------
  const env = (g, t, a, peakG, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peakG, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  function tone(freq, { type = 'sine', a = 0.005, d = 0.25, peak = 0.08, to = null, at = 0 } = {}) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
    const g = ctx.createGain();
    env(g, t, a, peak, d);
    o.connect(g).connect(n.bus);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }
  function whoosh({ from = 300, to = 2400, back = 400, a = 0.35, d = 0.9, peak = 0.2, q = 1.4 } = {}) {
    const t = ctx.currentTime;
    const s = n.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + a);
    f.frequency.exponentialRampToValueAtTime(back, t + a + d);
    const g = ctx.createGain();
    env(g, t, a, peak, d);
    s.connect(f).connect(g).connect(n.bus);
    s.stop(t + a + d + 0.1);
  }
  function shatterSound() {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(92, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(g).connect(n.bus);
    o.start(t);
    o.stop(t + 3.3);
    const s = n.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.6;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.6);
    f.frequency.exponentialRampToValueAtTime(160, t + 3);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.22, t + 0.5);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 3.1);
    s.connect(f).connect(g2).connect(n.bus);
    s.stop(t + 3.2);
  }
  const SFX = {
    tag: (i = 0) => {
      const f = [880, 988, 1175, 1319, 1568][i % 5];
      tone(f, { d: 0.35, peak: 0.05 });
      tone(f * 2, { d: 0.12, peak: 0.015 });
    },
    card: () => tone(1320, { type: 'triangle', d: 0.09, peak: 0.03 }),
    open: () => {
      tone(420, { d: 0.35, peak: 0.07, to: 840 });
      whoosh({ from: 500, to: 3000, back: 900, a: 0.12, d: 0.35, peak: 0.07 });
    },
    close: () => {
      tone(760, { d: 0.3, peak: 0.05, to: 380 });
      whoosh({ from: 2600, to: 700, back: 300, a: 0.08, d: 0.3, peak: 0.05 });
    },
    seam: () => whoosh({ from: 220, to: 2600, back: 260, a: 0.45, d: 1.1, peak: 0.16, q: 0.9 }),
    eyes: () => {
      tone(110, { type: 'sawtooth', a: 0.6, d: 0.9, peak: 0.035, to: 440 });
      [659.3, 830.6, 987.8].forEach((f, i) => tone(f, { a: 0.02, d: 1.6, peak: 0.04, at: 0.55 + i * 0.06 }));
    },
    release: () => {
      tone(48, { a: 0.01, d: 2, peak: 0.34, to: 28 });
      tone(96, { type: 'triangle', a: 0.01, d: 0.7, peak: 0.07, to: 48 });
      whoosh({ from: 2400, to: 600, back: 140, a: 0.04, d: 1.8, peak: 0.2, q: 0.7 });
      [1318.5, 1661.2, 1975.5].forEach((f, i) => tone(f, { a: 0.01, d: 1.4, peak: 0.016, at: 0.05 + i * 0.04 }));
    },
    hover: () => tone(2100, { d: 0.05, peak: 0.012 }),
    click: () => tone(900, { d: 0.08, peak: 0.03, to: 600 }),
    title: () => {
      tone(523.3, { a: 0.02, d: 1.1, peak: 0.025 });
      tone(784, { a: 0.02, d: 1.3, peak: 0.018, at: 0.09 });
    },
    door: () => {
      tone(55, { a: 0.02, d: 1.6, peak: 0.3, to: 30 });
      whoosh({ from: 3000, to: 400, back: 120, a: 0.2, d: 1.5, peak: 0.16, q: 0.8 });
    },
    lift: () => {
      tone(70, { a: 0.01, d: 0.6, peak: 0.25, to: 36 });
      whoosh({ from: 150, to: 1800, back: 500, a: 0.7, d: 1.4, peak: 0.18 });
    },
  };
  function sfx(name, arg) {
    if (!ctx || !playing || !SFX[name]) return;
    const now = performance.now();
    if (now - (lastPlayed[name] || 0) < 60) return;
    lastPlayed[name] = now;
    SFX[name](arg);
  }
  addEventListener('sfx', (e) => sfx(e.detail?.name || e.detail, e.detail?.arg));
  let lastHover = null;
  addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('a, button, .wl, .wm-thumb');
    if (el && el !== lastHover) sfx('hover');
    lastHover = el;
  });
  addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('a, button')) sfx('click');
  }, true);

  function start() {
    if (!want) return;
    if (!ctx) build();
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    trackEl?.play().catch(() => {});
    n.master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.6);
    reflect();
  }
  function stop() {
    if (!ctx) return;
    n.master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    playing = false;
    setTimeout(() => { if (!playing) trackEl?.pause(); }, 900);
    reflect();
  }
  function toggle() {
    want = !want || !playing;
    pref.set(want ? 'on' : 'off');
    if (want) start();
    else stop();
  }
  function reflect() {
    if (!button) return;
    const on = playing && want;
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('on', on);
    const label = button.querySelector('span');
    if (label) label.textContent = on ? 'on' : 'off';
  }
  // browsers need a gesture before sound; start on the first one if wanted
  const firstGesture = (e) => {
    if (button && button.contains(e.target)) return;
    if (!playing && want) start();
    if (playing) {
      removeEventListener('pointerdown', firstGesture);
      removeEventListener('keydown', firstGesture);
    }
  };
  addEventListener('pointerdown', firstGesture);
  addEventListener('keydown', firstGesture);
  button?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      ctx.suspend();
      trackEl?.pause();
    } else if (playing) {
      ctx.resume();
      trackEl?.play().catch(() => {});
    }
  });
  reflect();

  /** Called every frame with what the camera is doing. */
  function update({ scrollV = 0, sceneF = 0, fly = 0, speed = 0, seam = 0, crack = 0, shatter = 0, awake = 0, footer = 0, modal = false, flash = 0 }) {
    if (!ctx || !playing) return;
    const t = ctx.currentTime;
    const last = CUTOFF.length - 1;
    const i = Math.floor(Math.max(0, Math.min(last, sceneF)));
    const j = Math.min(last, i + 1);
    const k = Math.max(0, Math.min(1, sceneF - i));
    let cut = Math.exp(Math.log(CUTOFF[i]) * (1 - k) + Math.log(CUTOFF[j]) * k);
    const cracking = Math.max(0, Math.min(1, crack)) * (1 - Math.min(1, shatter * 1.4));
    cut *= 1 - cracking * 0.8;
    cut *= 1 + Math.min(1, shatter) * (1 - awake) * 1.5;
    cut *= 1 + fly * 0.25;
    cut *= 1 - Math.min(1, Math.max(0, (speed - 25) / 90)) * 0.55 * (1 - fly);
    const rush = Math.min(1, scrollV * 1.6);
    cut *= 1 - rush * 0.6;
    n.send.gain.setTargetAtTime(0.12 + rush * 0.9, t, 0.15);
    n.peak.gain.setTargetAtTime(rush * 9, t, 0.12);
    n.peak.frequency.setTargetAtTime(500 + rush * 2200, t, 0.15);
    cut *= 1 - Math.min(1, seam) * 0.88;
    const duck = modal ? 0.3 : 1;
    if (modal) cut = Math.min(cut, 420);
    cut = Math.min(cut, 20000 - footer * 19300);
    n.songF.frequency.setTargetAtTime(Math.max(120, Math.min(19000, cut)), t, 0.18);
    n.songF.Q.value = 0.9 + seam * 3;
    n.songG.gain.setTargetAtTime(0.8 * duck * (1 - footer * 0.3), t, 0.4);
    const sp = Math.min(1, speed / 60);
    n.airG.gain.setTargetAtTime((fly * 0.13 + sp * 0.09) * duck, t, 0.35);
    n.airF.frequency.setTargetAtTime(260 + fly * 240 + sp * 900, t, 0.3);
    n.seamG.gain.setTargetAtTime(seam * 0.3 * duck, t, 0.12);
    n.seamF.frequency.setTargetAtTime(280 + seam * 1300, t, 0.12);
    n.glassG.gain.setTargetAtTime(cracking * 0.035 * duck, t, 0.4);
    n.subG.gain.setTargetAtTime(awake * (1 - fly) * 0.12 * duck, t, 0.6);
    if (shatter > 0.02 && shatterArmed) {
      shatterArmed = false;
      shatterSound();
    }
    if (shatter <= 0.001) shatterArmed = true;
    if (seam > 0.7 && armed.seam) { armed.seam = false; sfx('seam'); } else if (seam < 0.3) armed.seam = true;
    if (flash > 0.4 && armed.door) { armed.door = false; sfx('door'); } else if (flash < 0.1) armed.door = true;
    if (awake > 0.55 && armed.eyes) { armed.eyes = false; sfx('eyes'); } else if (awake < 0.3) armed.eyes = true;
    if (fly > 0.05 && fly < 0.9 && armed.lift) { armed.lift = false; sfx('lift'); } else if (fly <= 0.001) armed.lift = true;
  }

  return {
    update,
    toggle,
    sfx,
    enter(on) {
      want = on;
      pref.set(on ? 'on' : 'off');
      if (on) start();
      else reflect();
    },
    get on() { return playing && want; },
  };
}
