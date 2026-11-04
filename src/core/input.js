import * as THREE from 'three';
import { clamp, damp } from './util.js';

/** Pointer + scroll, smoothed. `scroll` is 0..1 through the story, `footer` 0..1 past it. */
export class Input {
  constructor({ storyMax } = {}) {
    this.storyMax = storyMax || (() => document.documentElement.scrollHeight - innerHeight);
    this.footer = 0;
    this.footerS = 0;
    this.target = new THREE.Vector2();
    this.ndc = new THREE.Vector2();
    this.fast = new THREE.Vector2();
    this.px = new THREE.Vector2(innerWidth / 2, innerHeight / 2);
    this.energy = 0;
    this.lastMove = 0;
    this.moved = false;
    this.down = false;
    this.clickPulse = 0;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.scrollTarget = 0;
    this.scroll = 0;
    this.scrollVel = 0;

    const move = (x, y) => {
      const nx = (x / innerWidth) * 2 - 1;
      const ny = -((y / innerHeight) * 2 - 1);
      const d = Math.hypot(nx - this.target.x, ny - this.target.y);
      this.energy = Math.min(1, this.energy + d * 2.2);
      this.target.set(nx, ny);
      this.px.set(x, y);
      this.lastMove = performance.now();
      this.moved = true;
    };
    addEventListener('pointermove', (e) => move(e.clientX, e.clientY), { passive: true });
    addEventListener('pointerdown', (e) => { this.down = true; this.clickPulse = 1; move(e.clientX, e.clientY); }, { passive: true });
    addEventListener('pointerup', () => { this.down = false; }, { passive: true });
    addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
    addEventListener('scroll', () => this.readScroll(), { passive: true });
    addEventListener('resize', () => this.readScroll());
    this.readScroll();
    this.scroll = this.scrollTarget;
  }

  readScroll() {
    const max = Math.max(1, this.storyMax());
    this.scrollTarget = clamp(scrollY / max, 0, 1);
    this.footerEl ||= document.getElementById('footer');
    const fh = this.footerEl?.offsetHeight || innerHeight;
    this.footer = clamp((scrollY - max) / Math.max(1, fh), 0, 1);
  }

  update(dt) {
    // on touch, the "cursor" drifts home once the finger has been still a while
    if (this.coarse && (performance.now() - this.lastMove) / 1000 > 2.5) {
      this.target.multiplyScalar(Math.max(0, 1 - dt * 1.5));
    }
    this.ndc.x = damp(this.ndc.x, this.target.x, 3.2, dt);
    this.ndc.y = damp(this.ndc.y, this.target.y, 3.2, dt);
    this.fast.x = damp(this.fast.x, this.target.x, 14, dt);
    this.fast.y = damp(this.fast.y, this.target.y, 14, dt);
    this.energy = damp(this.energy, 0, 1.6, dt);
    this.clickPulse = damp(this.clickPulse, 0, 3.5, dt);
    const prev = this.scroll;
    this.scroll = damp(this.scroll, this.scrollTarget, 2.6, dt);
    if (Math.abs(this.scroll - this.scrollTarget) < 1e-6) this.scroll = this.scrollTarget;
    this.scrollVel = (this.scroll - prev) / Math.max(dt, 1e-4);
    this.footerS = damp(this.footerS, this.footer, 2.6, dt);
  }
}
