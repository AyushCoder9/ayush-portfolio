import { CHAPTERS } from '../data.js';
import { pad2 } from '../core/util.js';

const $ = (id) => document.getElementById(id);

/** Everything drawn over the canvas: chapter titles, counter, rail, index, intro/finale, cursor. */
export class Hud {
  constructor({ onJump }) {
    this.onJump = onJump;
    this.chapterEl = $('chapter');
    this.titleEl = $('ch-title');
    this.lineEl = $('ch-line');
    this.statsEl = $('ch-stats');
    this.numEl = $('ch-num');
    this.countEl = $('count-now');
    this.intro = $('intro');
    this.finale = $('finale');
    this.cue = $('cue');
    this.rail = $('rail');
    this.cursor = $('cursor');
    this.dot = this.cursor.querySelector('.c-dot');
    this.ring = this.cursor.querySelector('.c-ring');
    document.addEventListener('pointerleave', () => this.cursor.classList.add('away'));
    document.addEventListener('pointerenter', () => this.cursor.classList.remove('away'));
    this.current = -2;

    const fill = document.createElement('i');
    fill.className = 'rail-fill';
    this.rail.appendChild(fill);
    this.railFill = fill;
    this.railLinks = CHAPTERS.map((c, i) => {
      const a = document.createElement('a');
      a.href = '#';
      a.dataset.jump = String(i + 1);
      a.innerHTML = `<span>${pad2(i + 1)} ${c.title}</span>`;
      a.setAttribute('aria-label', `Chapter ${i + 1}: ${c.title}`);
      this.rail.appendChild(a);
      return a;
    });
    const list = $('index-list');
    this.indexLinks = CHAPTERS.map((c, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<a href="#" data-jump="${i + 1}"><small>${pad2(i + 1)}</small>${c.title}</a>`;
      list.appendChild(li);
      return li.firstChild;
    });
    document.addEventListener('click', (e) => {
      const j = e.target.closest('[data-jump]');
      if (!j) return;
      e.preventDefault();
      this.onJump(Number(j.dataset.jump));
    });
    document.addEventListener('pointerover', (e) => document.body.classList.toggle('hovering', !!e.target.closest('a,button,.wm-thumb')));
    this.cx = this.tx = innerWidth / 2;
    this.cy = this.ty = innerHeight / 2;
    addEventListener('pointermove', (e) => {
      this.tx = e.clientX;
      this.ty = e.clientY;
      this.cursor.classList.remove('away');
    }, { passive: true });
  }

  layoutRail(stops) {
    stops.forEach((s, i) => {
      if (this.railLinks[i]) this.railLinks[i].style.top = `${s * 100}%`;
    });
  }

  setChapter(i) {
    if (i === this.current) return;
    this.current = i;
    const show = i >= 0 && i < CHAPTERS.length;
    clearTimeout(this.swap);
    this.chapterEl.classList.remove('on');
    if (show) {
      const c = CHAPTERS[i];
      // wait for the old title to fade, swap the text, then let the letters rise in
      this.swap = setTimeout(() => {
        let n = 0;
        this.titleEl.innerHTML = c.title.split(' ').map((w) => `<span class="ch-word">${[...w].map((ch) => `<span class="ch-char" style="--i:${n++}">${ch}</span>`).join('')}</span>`).join(' ');
        this.titleEl.setAttribute('aria-label', c.title);
        this.lineEl.textContent = c.line;
        this.lineEl.hidden = !c.line;
        const stats = (c.stats || []).filter(([v]) => v);
        this.statsEl.innerHTML = stats.map(([v, d], k) => `<div style="--j:${k}"><dt>${v}</dt><dd class="mono">${d}</dd></div>`).join('');
        this.statsEl.hidden = !stats.length;
        this.numEl.textContent = pad2(i + 1);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (this.current === i) {
            this.chapterEl.classList.add('on');
            dispatchEvent(new CustomEvent('sfx', { detail: 'title' }));
          }
        }));
      }, 380);
    }
    this.railLinks.forEach((a, k) => a.classList.toggle('on', k === i));
    this.indexLinks.forEach((a, k) => a.classList.toggle('on', k === i));
  }

  update({ sceneF, progress, chapterLocal, introAmt, finaleAmt, footerAmt = 0, dt }) {
    const nearest = Math.round(sceneF);
    const count = introAmt > 0.5 ? 0 : Math.min(CHAPTERS.length, Math.max(1, nearest + 1));
    if (count !== this.count) {
      this.count = count;
      this.countEl.textContent = pad2(count);
    }
    const settled = Math.abs(sceneF - nearest) < 0.34 && nearest < CHAPTERS.length && introAmt < 0.5 && finaleAmt < 0.3;
    this.setChapter(settled ? nearest : -1);
    this.chapterEl.style.setProperty('--p', chapterLocal.toFixed(3));
    this.intro.style.opacity = String(introAmt);
    this.intro.style.filter = `blur(${((1 - introAmt) * 10).toFixed(1)}px)`;
    this.intro.style.visibility = introAmt < 0.01 ? 'hidden' : '';
    this.cue.style.opacity = String(Math.max(0, introAmt * 1.4 - 0.4));
    this.finale.classList.toggle('on', finaleAmt > 0.5);
    const foot = footerAmt > 0.12;
    if (foot !== this.foot) {
      this.foot = foot;
      document.body.classList.toggle('footer-on', foot);
    }
    this.railFill.style.transform = `scaleY(${progress.toFixed(4)})`;
    this.cx += (this.tx - this.cx) * Math.min(1, dt * 16);
    this.cy += (this.ty - this.cy) * Math.min(1, dt * 16);
    this.dot.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0)`;
    this.ring.style.transform = `translate3d(${this.cx}px, ${this.cy}px, 0)`;
  }
}
