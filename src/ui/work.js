import { pad2 } from '../core/util.js';

const $ = (id) => document.getElementById(id);

/** The bottom-left caption that names whichever panel the camera is facing. */
export class WorkLabels {
  constructor(projects, onOpen) {
    this.root = $('work-labels');
    this.active = -1;
    this.items = projects.map((p, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'wl';
      el.style.setProperty('--pc', p.color);
      el.setAttribute('aria-label', `${p.name}, ${p.tag}. View work`);
      el.innerHTML = `
        <span class="wl-row mono"><span class="wl-num">${pad2(i + 1)}</span><span class="wl-rule" aria-hidden="true"></span><span class="wl-tag">${p.tag}</span></span>
        <span class="wl-name">${p.name}</span>
        <span class="wl-cta mono">View work <i aria-hidden="true">↗</i></span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onOpen(i);
      });
      this.root.appendChild(el);
      return { el };
    });
  }

  show(i, hot = false) {
    if (i !== this.active) {
      if (this.active >= 0) this.items[this.active].el.classList.remove('on', 'hot');
      this.active = i;
      if (i >= 0) {
        this.items[i].el.classList.add('on');
        this.seen = true;
        dispatchEvent(new CustomEvent('sfx', { detail: 'card' }));
      }
      document.body.classList.toggle('work-card', i >= 0 || !!this.seen);
    }
    if (i >= 0) this.items[i].el.classList.toggle('hot', hot);
  }

  reset() {
    this.show(-1);
    this.seen = false;
    document.body.classList.remove('work-card');
  }
}

/** The glass case study modal: title, write-up, stack, links, and a media carousel. */
export class WorkModal {
  constructor(projects) {
    this.projects = projects;
    this.el = $('work-modal');
    this.stage = $('wm-stage');
    this.thumbs = $('wm-thumbs');
    this.i = 0;
    this.j = 0;
    this.isOpen = false;
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.close();
    });
    $('wm-prev').addEventListener('click', () => this.step(-1));
    $('wm-next').addEventListener('click', () => this.step(1));
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowRight') this.step(1);
      if (e.key === 'ArrowLeft') this.step(-1);
    });
  }

  open(i) {
    dispatchEvent(new CustomEvent('sfx', { detail: 'open' }));
    const p = this.projects[i];
    if (!p) return;
    this.lastFocus = document.activeElement;
    this.i = i;
    this.el.style.setProperty('--pc', p.color);
    $('wm-title').textContent = p.name;
    $('wm-desc').textContent = p.desc;
    $('wm-stack').innerHTML = p.stack.map((s) => `<li>${s}</li>`).join('');
    const links = [];
    if (p.live) links.push(`<a href="${p.live}" target="_blank" rel="noopener">Live ↗</a>`);
    if (p.code) links.push(`<a href="${p.code}" target="_blank" rel="noopener">Code ↗</a>`);
    $('wm-links').innerHTML = links.join('');
    this.thumbs.innerHTML = '';
    p.media.forEach((src, k) => {
      const b = document.createElement('button');
      b.className = 'wm-thumb';
      b.setAttribute('aria-label', `${p.name} — ${k + 1}`);
      b.style.backgroundImage = `url("${src}")`;
      b.addEventListener('click', () => this.show(k));
      this.thumbs.appendChild(b);
    });
    this.isOpen = true;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('modal-open');
    this.show(0);
    this.el.querySelector('.wm-close').focus({ preventScroll: true, focusVisible: false });
  }

  show(k) {
    const p = this.projects[this.i];
    const src = p.media[k];
    if (!src) return;
    this.j = k;
    this.stage.innerHTML = '';
    const img = document.createElement('img');
    img.src = src;
    img.alt = `${p.name} — screen ${k + 1}`;
    img.decoding = 'async';
    this.stage.appendChild(img);
    [...this.thumbs.children].forEach((t, n) => t.classList.toggle('on', n === k));
  }

  step(d) {
    const n = this.projects[this.i].media.length;
    this.show((this.j + d + n) % n);
  }

  close() {
    if (!this.isOpen) return;
    dispatchEvent(new CustomEvent('sfx', { detail: 'close' }));
    this.isOpen = false;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('modal-open');
    this.lastFocus?.focus?.({ preventScroll: true });
    setTimeout(() => {
      if (!this.isOpen) this.stage.innerHTML = '';
    }, 500);
  }
}
