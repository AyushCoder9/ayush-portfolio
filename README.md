# Ayush Kumar Singh — portfolio

A scroll-driven WebGL film in six chapters, built with three.js (r186) and Vite.
One red thread runs through every scene; the camera rides it.

```
npm install
npm run dev        # http://localhost:5199
npm run build      # → dist/
npm run preview
```

Deploy `dist/` anywhere static (Vercel: `vercel --prod` from this folder).

## Where things live

| What | File |
| --- | --- |
| All of Ayush's content (chapters, projects, links) | `src/data.js` |
| Page shell, intro, footer copy | `index.html` |
| Project screenshots (panels + modal) | `public/media/work/*.jpg` |
| Camera shot list | `src/story/shots.js` |
| Per-chapter colour grades | `src/core/looks.js` |
| Scenes | `src/chapters/*.js` |
| Figure, egg, flight | `src/hero/*.js` |
| Generative score + sound effects | `src/audio.js` |

Adding a project to the ring: append to `PROJECTS` in `src/data.js` and drop two
16:9 screenshots in `public/media/work/`. The ring, camera shots, captions and modal
adapt automatically.

URL flags: `?q=low|high` (quality), `?s=23` (jump to a story position), `?clean` (hide UI).

## Credits

- Figure: the "X Bot" character (Mixamo) from the three.js examples, retargeted to
  procedural poses.
- Music and sound effects are synthesised live with the Web Audio API.
