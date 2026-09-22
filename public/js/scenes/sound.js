// Fossaniður — the waterfall's hush, synthesized. No audio asset: a looped
// brown-noise buffer through two filters with a slow swell. Only ever
// constructed inside the toggle's click handler, which satisfies the
// browsers' user-gesture autoplay policy for free. Off by default, always.
export class WaterfallSound {
  constructor() {
    this.ctx = null;
    this._onVis = () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    };
  }

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    // 4s of brown noise (integrated white, leaky so it can't wander off).
    const seconds = 4;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 420; // the falls' body
    low.Q.value = 0.7;

    const hiss = ctx.createBiquadFilter();
    hiss.type = 'peaking';
    hiss.frequency.value = 1100; // the spray
    hiss.gain.value = 3;

    const gain = ctx.createGain();
    gain.gain.value = 0.05;

    // A slow ±15% swell so the water breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 8;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.0075;
    lfo.connect(lfoGain).connect(gain.gain);

    src.connect(low).connect(hiss).connect(gain).connect(ctx.destination);
    src.start();
    lfo.start();
    document.addEventListener('visibilitychange', this._onVis);
  }

  stop() {
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
