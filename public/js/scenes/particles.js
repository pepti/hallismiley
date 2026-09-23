// Weather particles — one 2D-canvas engine, three presets, driven by the real
// wind. Deliberately modest: fixed counts, DPR capped at 1.5, a single rAF
// per canvas that the AmbienceEngine starts/stops with visibility. The layer
// whispers; it never performs.
const DPR_CAP = 1.5;

const PRESETS = {
  rain: (windMs) => ({
    count: 90,
    make: (w, h) => ({
      x: Math.random() * w, y: Math.random() * h,
      len: 14 + Math.random() * 8,
      vy: 540 + Math.random() * 140,
      vx: Math.min(220, windMs * 14),
      a: 0.22 + Math.random() * 0.14,
    }),
    step(p, dt, w, h) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > h + 30) { p.y = -30; p.x = Math.random() * w; }
      if (p.x > w + 30) p.x = -30;
    },
    draw(ctx, p) {
      ctx.strokeStyle = `rgba(210, 225, 240, ${p.a})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.02, p.y - p.len);
      ctx.stroke();
    },
  }),
  snow: (windMs) => ({
    count: 120,
    make: (w, h) => ({
      x: Math.random() * w, y: Math.random() * h,
      r: 1 + Math.random() * 1.5,
      vy: 60 + Math.random() * 50,
      vx: windMs * 8,
      sway: Math.random() * Math.PI * 2,
      a: 0.35 + Math.random() * 0.3,
    }),
    step(p, dt, w, h, t) {
      p.x += (p.vx + Math.sin(t * 0.8 + p.sway) * 14) * dt;
      p.y += p.vy * dt;
      if (p.y > h + 6) { p.y = -6; p.x = Math.random() * w; }
      if (p.x > w + 6) p.x = -6;
      if (p.x < -6) p.x = w + 6;
    },
    draw(ctx, p) {
      ctx.fillStyle = `rgba(245, 248, 252, ${p.a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    },
  }),
  // Fog drift doubles as the waterfall scenes' resting mist.
  fog: (windMs) => ({
    count: 12,
    make: (w, h) => ({
      x: Math.random() * w, y: h * (0.35 + Math.random() * 0.6),
      r: 120 + Math.random() * 220,
      vx: 4 + windMs * 3 + Math.random() * 6,
      a: 0.04 + Math.random() * 0.05,
    }),
    step(p, dt, w) {
      p.x += p.vx * dt;
      if (p.x - p.r > w) p.x = -p.r;
    },
    draw(ctx, p) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(235, 240, 245, ${p.a})`);
      g.addColorStop(1, 'rgba(235, 240, 245, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    },
  }),
};

// condition (+ the scene's own resting preset) → preset name or null.
export function presetFor(condition, scenePreset) {
  if (condition === 'rain') return 'rain';
  if (condition === 'snow') return 'snow';
  if (condition === 'fog') return 'fog';
  return scenePreset; // 'mist' scenes keep a whisper of fog in clear weather
}

export class ParticleField {
  constructor(canvas, preset, windMs) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const def = PRESETS[preset === 'mist' ? 'fog' : preset];
    this.def = def(windMs || 0);
    this.parts = [];
    this._raf = null;
    this._last = 0;
    this._resize = this._resize.bind(this);
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this._raf) return;
    this._resize();
    window.addEventListener('resize', this._resize, { passive: true });
    this.canvas.hidden = false;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    window.removeEventListener('resize', this._resize);
    this.canvas.hidden = true;
  }

  _resize() {
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.max(1, w * dpr);
    this.canvas.height = Math.max(1, h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.parts = Array.from({ length: this.def.count }, () => this.def.make(w, h));
  }

  _tick(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const t = now / 1000;
    this.ctx.clearRect(0, 0, w, h);
    for (const p of this.parts) {
      this.def.step(p, dt, w, h, t);
      this.def.draw(this.ctx, p);
    }
    this._raf = requestAnimationFrame(this._tick);
  }
}
