/** Callout tags (dot, leader line, pill) pinned to points on the glass frame in chapter 03. */
export class FrameTags {
  constructor(items) {
    this.root = document.getElementById('frame-tags');
    this.items = items.map(({ label, at, side }, i) => {
      const el = document.createElement('div');
      el.className = `ft-tag ${side < 0 ? 'l' : 'r'}`;
      el.style.setProperty('--i', i);
      el.innerHTML = `<i class="ft-dot"></i><i class="ft-lead"></i><span class="mono">${label}</span>`;
      this.root.appendChild(el);
      return { el, at, on: false };
    });
  }

  /** `project(at, out)` writes screen px into out and says whether it is on screen. */
  update(project, progress, out) {
    const n = this.items.length;
    document.body.classList.toggle('frame-tags-on', progress > 0.5 / (n + 0.5));
    this.items.forEach((item, i) => {
      const on = project(item.at, out) && progress > (i + 0.5) / (n + 0.5);
      if (on) item.el.style.transform = `translate3d(${out.x.toFixed(1)}px, ${out.y.toFixed(1)}px, 0)`;
      if (on !== item.on) {
        item.on = on;
        item.el.classList.toggle('on', on);
        if (on) dispatchEvent(new CustomEvent('sfx', { detail: { name: 'tag', arg: i } }));
      }
    });
  }

  hide() {
    document.body.classList.remove('frame-tags-on');
    this.items.forEach((item) => {
      item.on = false;
      item.el.classList.remove('on');
    });
  }
}
