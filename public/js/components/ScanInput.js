// ScanInput — USB barcode-scanner ("keyboard wedge") input for the desktop admin
// scan surfaces (inventory check, POS, picking, order append). A USB scanner is
// an HID keyboard: it types the barcode very fast and (usually, configurably)
// sends Enter — fundamentally different from the camera BarcodeScanner. Two
// capture paths:
//   • a visible, auto-focused field that fires onScan on Enter (PRIMARY — also
//     lets staff type a code by hand), and
//   • an optional document-level "burst" detector (attachGlobal) for scanners
//     configured WITHOUT an Enter suffix: keystrokes arriving faster than a human
//     can type are buffered and flushed on idle. It only acts when NO editable
//     element is focused, so it never swallows typing in other fields.
// Plus audible (WebAudio, no asset) + visual (flash) feedback and a duplicate
// cooldown that mirrors the camera scanner's refractory window.
import { t } from '../i18n/i18n.js';

const BURST_GAP_MS  = 35;   // keystrokes closer than this look machine-fast
const IDLE_FLUSH_MS = 60;   // flush a no-Enter burst after this much idle
const MIN_BURST_LEN = 3;    // ignore stray fast keypresses (real codes are longer)
const DEFAULT_COOLDOWN_MS = 400;
// Volume 0–100 → oscillator gain. Quadratic so the low end is usable, scaled so
// the default 60 lands on the 0.06 gain every scan surface always used —
// nothing sounds different anywhere until the admin edits the setting.
const DEFAULT_VOLUME = 60;
const volumeToGain = (v) => Math.pow(Math.max(0, Math.min(100, Number(v) || 0)) / 100, 2) * (0.06 / Math.pow(0.6, 2));

export class ScanInput {
  /** @param {{ onScan:(code:string)=>void, cooldownMs?:number, sounds?:boolean, volume?:number }} opts */
  constructor({ onScan, cooldownMs = DEFAULT_COOLDOWN_MS, sounds = true, volume = DEFAULT_VOLUME } = {}) {
    this._onScan = typeof onScan === 'function' ? onScan : () => {};
    this._cooldownMs = cooldownMs;
    this._sounds = sounds !== false;
    this._volume = Number.isFinite(Number(volume)) ? Number(volume) : DEFAULT_VOLUME;
    this._lastCode = null;
    this._lastAt = 0;
    this._input = null;
    this._root = null;
    this._audioCtx = null;
    // burst-detector state
    this._buf = '';
    this._lastKeyAt = 0;
    this._idleTimer = null;
    this._globalAttached = false;
    this._onKeydown = this._onKeydown.bind(this);
  }

  // Build + return a visible scan field. The caller appends it to its DOM and
  // must call destroy() on teardown. opts: { placeholder, hint }.
  mountInput(opts = {}) {
    const root = document.createElement('div');
    root.className = 'scan-box';
    const ph = opts.placeholder || t('scan.input.placeholder');
    root.innerHTML = `
      <span class="scan-box__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14"/></svg>
      </span>
      <input type="text" class="scan-box__input" inputmode="text" autocomplete="off"
             autocapitalize="off" autocorrect="off" spellcheck="false"
             placeholder="${ph}" aria-label="${ph}" />
      <span class="scan-box__hint">${opts.hint || t('scan.input.hint')}</span>
    `;
    const input = root.querySelector('.scan-box__input');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = input.value.trim();
      input.value = '';
      if (code) this._emit(code);
    });
    this._input = input;
    this._root = root;
    return root;
  }

  focus() { if (this._input) { try { this._input.focus(); } catch { /* detached */ } } }

  // Capture scans even when the visible field isn't focused. Safe to call once;
  // ignores keystrokes whenever ANY editable element (incl. our own field) holds
  // focus, so the visible field's Enter handler owns focused input and this only
  // handles bursts that land on the body.
  attachGlobal() {
    if (this._globalAttached) return;
    document.addEventListener('keydown', this._onKeydown, true);
    this._globalAttached = true;
  }

  // Reversible counterpart to attachGlobal, for a surface that must genuinely
  // STOP listening rather than ignore what it hears — the short-pick sheet, where
  // a wedge scanner's trailing Enter would otherwise land on the confirm button.
  // destroy() also detaches, but it tears the component down; this can be undone.
  detachGlobal() {
    if (!this._globalAttached) return;
    document.removeEventListener('keydown', this._onKeydown, true);
    this._globalAttached = false;
  }

  _onKeydown(e) {
    const a = document.activeElement;
    const editableFocused = a && (
      a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' ||
      a.tagName === 'SELECT' || a.isContentEditable
    );
    if (editableFocused) return;                 // let the focused field own it
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const now = e.timeStamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (this._buf.length >= MIN_BURST_LEN) {
        const code = this._buf;
        this._buf = '';
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
        e.preventDefault();
        this._emit(code);
      }
      return;
    }
    if (e.key.length !== 1) return;              // ignore Shift/Arrow/F-keys/etc.

    const gap = now - this._lastKeyAt;
    this._lastKeyAt = now;
    this._buf = (gap > 0 && gap < BURST_GAP_MS) ? this._buf + e.key : e.key;

    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      const code = this._buf;
      this._buf = '';
      this._idleTimer = null;
      if (code.length >= MIN_BURST_LEN) this._emit(code);
    }, IDLE_FLUSH_MS);
  }

  // De-dupe identical reads within the cooldown (a scanner can fire a code twice
  // on a single trigger), then hand the code to the caller and re-focus.
  _emit(code) {
    const now = Date.now();
    if (code === this._lastCode && now - this._lastAt < this._cooldownMs) return;
    this._lastCode = code;
    this._lastAt = now;
    this._onScan(code);
    this.focus();
  }

  // ── feedback ────────────────────────────────────────────────────────────────
  // The pick screen is used heads-down with a wireless scanner, so the sounds
  // are distinct by COUNT + pitch direction, not pitch alone:
  //   ok        one high blip           unit scanned, line not complete yet
  //   err       one long low buzz       over-scan past the quantity / lookup error
  //   wrong     low DOUBLE buzz         scanned item is not on this order
  //   lineDone  rising two-tone         this line just reached its full quantity
  //   allDone   rising three-tone       every line picked — order ready to fulfil
  feedbackOk()  { this.beepOk();  this.flashOk(); }
  feedbackErr() { this.beepErr(); this.flashErr(); this._vibrate(120); }
  feedbackWrong()    { this.beepWrong(); this.flashErr(); this._vibrate([80, 60, 80]); }
  feedbackLineDone() { this.beepLineDone(); this.flashOk(); }
  feedbackAllDone()  { this.beepAllDone();  this.flashOk(); }
  // Scanned past a line's quantity (owner request 2026-09-03: "more noise"):
  // three low buzzes, louder than the plain error, plus a long vibration.
  feedbackOver()     { this.beepOver();     this.flashErr(); this._vibrate([220, 90, 220, 90, 320]); }

  // Update audio prefs after construction (callers that load config async).
  setAudio({ sounds, volume } = {}) {
    if (typeof sounds === 'boolean') this._sounds = sounds;
    if (Number.isFinite(Number(volume))) this._volume = Number(volume);
  }

  beepOk()  { this._tones([[1180, 0.09]]); }
  beepErr() { this._tones([[220, 0.22]]); }
  beepWrong()    { this._tones([[160, 0.12, 0.07], [160, 0.12]]); }
  // Completion tones play with a boost over the plain scan blip — the packer
  // must hear a line closing across a noisy floor.
  beepLineDone() { this._tones([[880, 0.09, 0.02], [1320, 0.16]], 1.4); }
  beepAllDone()  { this._tones([[990, 0.1, 0.02], [1320, 0.1, 0.02], [1760, 0.3]], 1.6); }
  beepOver()     { this._tones([[200, 0.18, 0.06], [200, 0.18, 0.06], [150, 0.45]], 1.8); }

  _vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* unsupported */ } }
  }

  // Play a short sequence of square-wave tones: [[freq, durSec, gapAfterSec?]].
  // These patterns are told apart by COUNT, so the sequence must actually be
  // spread over time: a suspended context has a frozen currentTime, and
  // scheduling against it would put every tone in the past — they would all
  // fire at once on resume and a double buzz would sound like a single blip.
  // So schedule only once the context is running, and always a hair ahead.
  _tones(steps, boost = 1) {
    try {
      if (!this._sounds) return;
      // `boost` lifts alert tones above the configured level (capped well below
      // clipping); the packer's volume setting still scales everything.
      const level = Math.min(0.5, volumeToGain(this._volume) * boost);
      if (level <= 0) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this._audioCtx) this._audioCtx = new AC();
      const ctx = this._audioCtx;
      const play = () => {
        try {
          let at = ctx.currentTime + 0.02;   // small lead so nothing lands in the past
          for (const [freq, durSec, gapSec = 0] of steps) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            osc.connect(gain); gain.connect(ctx.destination);
            gain.gain.setValueAtTime(level, at);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + durSec);
            osc.start(at);
            osc.stop(at + durSec);
            at += durSec + gapSec;
          }
        } catch { /* audio is optional — never block a scan on it */ }
      };
      if (ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});
      else play();
    } catch { /* audio is optional — never block a scan on it */ }
  }

  flashOk()  { this._flash('scan-box--ok'); }
  flashErr() { this._flash('scan-box--err'); }
  _flash(cls) {
    const el = this._root;
    if (!el) return;
    el.classList.remove('scan-box--ok', 'scan-box--err');
    void el.offsetWidth;                          // reflow so the animation re-triggers
    el.classList.add(cls);
    setTimeout(() => { if (el) el.classList.remove(cls); }, 600);
  }

  destroy() {
    if (this._globalAttached) { document.removeEventListener('keydown', this._onKeydown, true); this._globalAttached = false; }
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    if (this._audioCtx) { try { this._audioCtx.close(); } catch { /* already closed */ } this._audioCtx = null; }
    this._input = null;
    this._root = null;
  }
}
