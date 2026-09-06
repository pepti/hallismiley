/**
 * "Juice" for the /aron13ara page: synthesized 8-bit sound, pixel particles,
 * screen shake, flashes, haptics, a typewriter and a countdown.
 *
 * Sound is WebAudio only (oscillators + a noise buffer) so nothing is fetched
 * and the CSP is untouched. Every effect is a no-op when unavailable, and all
 * motion respects prefers-reduced-motion (sound still plays).
 */
import { pixelText } from './aron13-font.js';

const MUTE_KEY = 'aron13:mute';
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Sound ─────────────────────────────────────────────────────────────────────

let _ctx = null;
let _noiseBuf = null;

function readMute() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

function ctx() {
  if (_ctx) {
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    return _ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { _ctx = new AC(); } catch { return null; }
  return _ctx;
}

function noiseBuffer(c) {
  if (_noiseBuf) return _noiseBuf;
  const len = c.sampleRate * 1.5;
  _noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = _noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _noiseBuf;
}

function tone({ type = 'square', f = 440, f2 = null, t = 0.08, vol = 0.12, delay = 0 }) {
  if (sfx.muted) return;
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + t);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + t);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + t + 0.02);
}

function noise({ t = 0.15, vol = 0.18, delay = 0, f = 1000, q = 0.8, f2 = null }) {
  if (sfx.muted) return;
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(f, t0);
  if (f2) bp.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t0 + t);
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + t);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + t + 0.02);
}

export const sfx = {
  muted: readMute(),
  /** Call from a user gesture so the context is allowed to start. */
  unlock() { ctx(); },
  setMuted(v) {
    sfx.muted = !!v;
    try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* private mode */ }
  },
  blip()    { tone({ f: 880, t: 0.05, vol: 0.08 }); },
  hit()     { noise({ t: 0.05, vol: 0.12, f: 900 }); tone({ f: 220, f2: 150, t: 0.05, vol: 0.06 }); },
  break()   { noise({ t: 0.18, vol: 0.2, f: 600, f2: 200 }); tone({ f: 300, f2: 80, t: 0.15, vol: 0.1 }); },
  diamond() { [660, 880, 1320].forEach((f, i) => tone({ f, t: 0.14, vol: 0.1, delay: i * 0.07 })); },
  gold()    { [523, 784].forEach((f, i) => tone({ type: 'triangle', f, t: 0.12, vol: 0.12, delay: i * 0.08 })); },
  boom()    { noise({ t: 0.45, vol: 0.35, f: 200, f2: 60, q: 0.5 }); tone({ type: 'triangle', f: 120, f2: 40, t: 0.4, vol: 0.3 }); },
  pop()     { noise({ t: 0.12, vol: 0.14, f: 500, f2: 120 }); },
  coin()    { tone({ f: 988, t: 0.06, vol: 0.1 }); tone({ f: 1319, t: 0.14, vol: 0.1, delay: 0.06 }); },
  combo(n)  { const base = 523 * Math.pow(2, Math.min(n, 10) / 12); [1, 1.25, 1.5].forEach((m, i) => tone({ f: base * m, t: 0.1, vol: 0.09, delay: i * 0.05 })); },
  hurt()    { tone({ type: 'sawtooth', f: 400, f2: 120, t: 0.25, vol: 0.1 }); },
  snap()    { tone({ f: 300, f2: 520, t: 0.05, vol: 0.08 }); noise({ t: 0.03, vol: 0.06, f: 2000 }); },
  craft()   { tone({ type: 'triangle', f: 1400, f2: 900, t: 0.14, vol: 0.16 }); noise({ t: 0.08, vol: 0.12, f: 3000 }); tone({ type: 'triangle', f: 1400, f2: 900, t: 0.14, vol: 0.12, delay: 0.16 }); },
  win()     { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ f, t: 0.16, vol: 0.1, delay: i * 0.09 })); },
  go()      { tone({ f: 784, t: 0.1, vol: 0.1 }); tone({ f: 1047, t: 0.25, vol: 0.12, delay: 0.1 }); },
  type()    { tone({ f: 1500, t: 0.02, vol: 0.04 }); },
  hiss()    { noise({ t: 1.1, vol: 0.2, f: 3000, f2: 6000, q: 0.4 }); },
};

// ── Motion ────────────────────────────────────────────────────────────────────

export const reduced = REDUCED;

let _layer = null;
function layer() {
  if (_layer && _layer.isConnected) return _layer;
  _layer = document.createElement('div');
  _layer.className = 'a13-fxlayer';
  _layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_layer);
  return _layer;
}

const rnd = (a, b) => a + Math.random() * (b - a);

function centre(el) {
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}

/**
 * Burst pixel particles at viewport coords.
 * @param {number} x
 * @param {number} y
 * @param {object} o  colours: CSS colour list; n; spread (px); up (px); fall (px); size [min,max]; life [min,max] s; ring: true for an even circle
 */
export function burst(x, y, { colours, n = 16, spread = 70, up = 60, fall = 90, size = [4, 9], life = [0.5, 0.9], ring = false } = {}) {
  if (REDUCED) return;
  const host = layer();
  let html = '';
  for (let i = 0; i < n; i++) {
    let dx, dy;
    if (ring) {
      const a = (i / n) * Math.PI * 2;
      dx = Math.cos(a) * spread;
      dy = Math.sin(a) * spread;
    } else {
      dx = rnd(-spread, spread);
      dy = -rnd(up * 0.3, up);
    }
    const s = rnd(size[0], size[1]).toFixed(0);
    const d = rnd(life[0], life[1]).toFixed(2);
    const c = colours[i % colours.length];
    html += `<span class="a13-particle" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--fall:${ring ? 0 : fall}px;--s:${s}px;--d:${d}s;--c:${c}"></span>`;
  }
  const frag = document.createElement('div');
  frag.innerHTML = html;
  const bits = [...frag.children];
  bits.forEach(b => {
    b.addEventListener('animationend', () => b.remove(), { once: true });
    host.appendChild(b);
  });
  setTimeout(() => bits.forEach(b => b.remove()), 1500);
}

const C = {
  grass: '#5d9c3a', grassD: '#3e6b26', dirt: '#7a5230', dirtD: '#5a3a1e', stone: '#a8a8a8', stoneD: '#5c5c5c',
  diamond: '#4fd7e0', diamondD: '#1f8f97', white: '#f4f1ea', gold: '#f2c94c', goldD: '#c9971e',
  red: '#e2231a', redD: '#9c150f', ink: '#101010', green: '#2ecc40', blue: '#3b7dd8', pink: '#f27aa8',
};

export const particles = {
  debris(el, kind = 'stone') {
    const { x, y } = centre(el);
    const pal = { grass: [C.grass, C.grassD, C.dirt], dirt: [C.dirt, C.dirtD], stone: [C.stone, C.stoneD] }[kind] || [C.stone];
    burst(x, y, { colours: pal, n: 14, spread: 50, up: 50, fall: 80 });
  },
  sparkle(el) {
    const { x, y } = centre(el);
    burst(x, y, { colours: [C.diamond, C.white, C.diamondD], n: 18, spread: 60, up: 70, fall: 40, size: [3, 6], life: [0.6, 1] });
  },
  gold(el) {
    const { x, y } = centre(el);
    burst(x, y, { colours: [C.gold, C.goldD, C.white], n: 12, spread: 45, up: 55, fall: 60, size: [3, 6] });
  },
  boom(el) {
    const { x, y } = centre(el);
    burst(x, y, { colours: [C.red, C.gold, C.ink, C.redD], n: 30, spread: 120, up: 120, fall: 140, size: [5, 12], life: [0.6, 1.1] });
  },
  coinPop(el) {
    const { x, y } = centre(el);
    burst(x, y, { colours: [C.gold, C.white, C.goldD], n: 10, spread: 40, up: 50, fall: 40, size: [3, 6], life: [0.4, 0.7] });
  },
  firework(x, y) {
    const sets = [[C.red, C.gold], [C.diamond, C.white], [C.green, C.gold], [C.pink, C.white], [C.blue, C.diamond]];
    const colours = sets[Math.floor(Math.random() * sets.length)];
    burst(x, y, { colours, n: 26, spread: rnd(60, 110), ring: true, size: [4, 7], life: [0.8, 1.2] });
    burst(x, y, { colours: [C.white], n: 8, spread: 30, ring: true, size: [3, 4], life: [0.5, 0.8] });
  },
};

export function shake(el, hard = false) {
  if (REDUCED || !el) return;
  const cls = hard ? 'a13-shake--hard' : 'a13-shake';
  el.classList.remove('a13-shake', 'a13-shake--hard');
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

export function screenShake() {
  shake(document.querySelector('.aron13'), true);
}

export function flash(colour = 'rgba(226,35,26,.45)') {
  if (REDUCED) return;
  const el = document.createElement('div');
  el.className = 'a13-flash';
  el.style.background = colour;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

export function haptic(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}

/**
 * Type `text` into `el` one character at a time. Resolves when done.
 * Pass the caller's `timers` array so a view teardown can cancel it.
 */
export function typewriter(el, text, timers = []) {
  return new Promise((resolve) => {
    if (REDUCED) { el.textContent = text; resolve(); return; }
    el.textContent = '';
    let i = 0;
    const id = setInterval(() => {
      if (!el.isConnected) { clearInterval(id); resolve(); return; }
      el.textContent += text[i];
      if (i % 2 === 0) sfx.type();
      i += 1;
      if (i >= text.length) { clearInterval(id); resolve(); }
    }, 42);
    timers.push(id);
  });
}

/**
 * „3 · 2 · 1 · GO!" overlay inside `host`. Resolves on GO (the game may start
 * while GO is still on screen). Instant under reduced motion.
 */
export function countdown(host, timers = []) {
  return new Promise((resolve) => {
    if (REDUCED) { resolve(); return; }
    const ov = document.createElement('div');
    ov.className = 'a13-overlay a13-overlay--count';
    ov.setAttribute('aria-hidden', 'true');
    host.appendChild(ov);
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;
    let pending = null;
    const go = () => {
      ov.innerHTML = `<div class="a13-count a13-pop">${pixelText('GO!', { scale: 9, colour: 'e', title: '' })}</div>`;
      sfx.go();
      resolve();
      timers.push(setTimeout(() => ov.remove(), 450));
    };
    const tick = () => {
      if (!ov.isConnected) { resolve(); return; }
      const s = steps[i];
      if (s === 'GO!') { go(); return; }
      ov.innerHTML = `<div class="a13-count a13-pop">${pixelText(s, { scale: 12, colour: 'y', title: '' })}</div>`;
      sfx.blip();
      i += 1;
      pending = setTimeout(tick, 520);
      timers.push(pending);
    };
    // Second playthrough: a tap skips straight to GO.
    ov.addEventListener('pointerdown', () => {
      if (i >= steps.length) return;
      clearTimeout(pending);
      i = steps.length;
      go();
    }, { once: true });
    tick();
  });
}

let _toast = null;
export function toast(title, body, spriteHtml = '') {
  if (_toast) _toast.remove();
  const el = document.createElement('div');
  el.className = 'a13-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="a13-toast__art">${spriteHtml}</div>
    <div class="a13-toast__text">
      <div class="a13-toast__title">${pixelText(title, { scale: 2, colour: 'y', title })}</div>
      <div class="a13-toast__body">${body}</div>
    </div>`;
  document.body.appendChild(el);
  _toast = el;
  setTimeout(() => { el.classList.add('is-out'); }, 3200);
  setTimeout(() => { el.remove(); if (_toast === el) _toast = null; }, 3700);
}

export function cleanupFx() {
  if (_layer) { _layer.remove(); _layer = null; }
  if (_toast) { _toast.remove(); _toast = null; }
  document.querySelectorAll('.a13-flash').forEach(e => e.remove());
}

export const fx = { sfx, particles, burst, shake, screenShake, flash, haptic, typewriter, countdown, toast, reduced: REDUCED, cleanupFx };
