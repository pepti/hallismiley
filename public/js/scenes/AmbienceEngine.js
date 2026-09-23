// AmbienceEngine — the live-Iceland layer. Singleton, loaded only via dynamic
// import() from SceneStage when a scene mounts with the ambience pref on and
// motion allowed, so pages pay nothing for it until a landscape is actually
// on screen.
//
// What it runs, all whisper-quiet and all gated:
//  • real Hafnarfjörður weather (server-proxied /api/v1/ambience, refreshed
//    every 10 min while the tab is visible) → wind-sheared rain / snow / fog
//    particles on each registered scene's canvas;
//  • the real sun over Iceland (computed locally, sun.js) →
//    body[data-amb-phase="day|golden|blue|night"] tint layer — midnight sun
//    in June, 11:00 sunrise in December, for free;
//  • a procedural WebGL aurora on hero scenes, only when the theme says
//    --scene-aurora:1 (the two dark themes), only at real night, only under
//    clear-ish skies (cloud < 70%), CSS-ribbon fallback without WebGL;
//  • optional synthesized waterfall sound (sound.js), off by default,
//    its own toggle.
//
// Pauses: document.hidden stops everything; each canvas also stops when its
// scene leaves the viewport (IntersectionObserver). The ambience toggle tears
// the whole engine down live via the 'ambiencechange' event.
import { ParticleField, presetFor } from './particles.js';
import { Aurora } from './aurora.js';
import { WaterfallSound } from './sound.js';
import { sunPhase } from './sun.js';
import { ambienceEnabled, soundEnabled, syncBodyClass } from '../services/ambiencePrefs.js';
import { motionAllowed } from '../utils/motion.js';

const LAT = 64.07, LON = -21.97;
const REFRESH_MS = 10 * 60 * 1000;
const SUN_MS = 5 * 60 * 1000;

class Engine {
  constructor() {
    this.weather = null;
    this.stages = new Map(); // root el → { canvas, preset, field, aurora, io, isHero }
    this.sound = null;
    this._timers = [];
    this._started = false;
    this._onVis = this._onVis.bind(this);
    this._onChange = this._onChange.bind(this);
  }

  async start() {
    if (this._started) return;
    this._started = true;
    syncBodyClass();
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('ambiencechange', this._onChange);
    this._applySun();
    this._timers.push(setInterval(() => this._applySun(), SUN_MS));
    await this._refreshWeather();
    this._timers.push(setInterval(() => {
      if (!document.hidden) this._refreshWeather();
    }, REFRESH_MS));
    if (soundEnabled()) this._startSound();
  }

  // SceneStage hands over its root + fx canvas; the engine owns them until
  // unregister (called from SceneStage.destroy()).
  register(rootEl, canvas, scenePreset, { isHero = false } = {}) {
    if (this.stages.has(rootEl)) return;
    const entry = { canvas, scenePreset, field: null, aurora: null, io: null, isHero, visible: false };
    entry.io = new IntersectionObserver((entries) => {
      entry.visible = entries.some((e) => e.isIntersecting);
      this._syncStage(entry);
    });
    entry.io.observe(rootEl);
    this.stages.set(rootEl, entry);
    this._syncStage(entry);
  }

  unregister(rootEl) {
    const entry = this.stages.get(rootEl);
    if (!entry) return;
    entry.io?.disconnect();
    entry.field?.stop();
    entry.aurora?.destroy();
    entry.cssAurora?.remove();
    this.stages.delete(rootEl);
  }

  destroy() {
    this._timers.forEach(clearInterval);
    this._timers = [];
    for (const el of [...this.stages.keys()]) this.unregister(el);
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('ambiencechange', this._onChange);
    this.sound?.stop();
    this.sound = null;
    delete document.body.dataset.ambPhase;
    this._started = false;
  }

  async _refreshWeather() {
    try {
      const res = await fetch('/api/v1/ambience');
      const data = res.ok ? await res.json() : null;
      this.weather = data && data.available ? data : null;
    } catch {
      this.weather = null; // static scenes; never an error surface
    }
    for (const entry of this.stages.values()) this._syncStage(entry, { rebuild: true });
  }

  _applySun() {
    document.body.dataset.ambPhase = sunPhase(new Date(), LAT, LON);
    for (const entry of this.stages.values()) this._syncStage(entry);
  }

  _active() {
    return ambienceEnabled() && motionAllowed() && !document.hidden;
  }

  _syncStage(entry, { rebuild = false } = {}) {
    const run = this._active() && entry.visible;

    // Particles — weather condition (or the scene's resting mist).
    const preset = this.weather ? presetFor(this.weather.condition, entry.scenePreset) : null;
    if (rebuild && entry.field) { entry.field.stop(); entry.field = null; }
    if (run && preset) {
      if (!entry.field) entry.field = new ParticleField(entry.canvas, preset, this.weather?.windMs || 0);
      entry.field.start();
    } else {
      entry.field?.stop();
    }

    // Aurora — hero scenes, dark themes, real night, clear-ish sky.
    const auroraEligible = entry.isHero
      && getComputedStyle(document.documentElement).getPropertyValue('--scene-aurora').trim() === '1'
      && document.body.dataset.ambPhase === 'night'
      && (this.weather ? this.weather.cloudPct < 70 : true);
    if (run && auroraEligible) {
      if (!entry.aurora) {
        // The particle canvas is busy with weather; the aurora gets a sibling.
        const canvas = document.createElement('canvas');
        canvas.className = 'ice-scene__fx ice-scene__fx--aurora';
        entry.canvas.parentElement.insertBefore(canvas, entry.canvas);
        entry.aurora = new Aurora(canvas);
        if (entry.aurora.dead) {
          // No WebGL → the CSS ribbon.
          canvas.remove();
          entry.cssAurora = document.createElement('div');
          entry.cssAurora.className = 'ice-aurora--css';
          entry.canvas.parentElement.insertBefore(entry.cssAurora, entry.canvas);
        }
      }
      entry.aurora?.start();
      entry.cssAurora?.removeAttribute('hidden');
    } else {
      entry.aurora?.stop();
      entry.cssAurora?.setAttribute('hidden', '');
    }
  }

  _startSound() {
    if (!this.sound) this.sound = new WaterfallSound();
    this.sound.start();
  }

  _onVis() {
    for (const entry of this.stages.values()) this._syncStage(entry);
  }

  _onChange(e) {
    syncBodyClass();
    const { ambience, sound } = e.detail || {};
    if (sound && this._active()) this._startSound();
    if (!sound && this.sound) { this.sound.stop(); this.sound = null; }
    if (!ambience) {
      for (const entry of this.stages.values()) this._syncStage(entry);
      delete document.body.dataset.ambPhase;
    } else {
      this._applySun();
    }
  }
}

let _engine = null;
export function getAmbienceEngine() {
  if (!_engine) _engine = new Engine();
  return _engine;
}
