// BarcodeScanner — full-screen camera overlay that detects EAN-13 barcodes via
// the native BarcodeDetector API (Chromium/Android; secure context required).
// Point the camera at a product's barcode and the caller's onDetect receives
// the value. Feature-detect with BarcodeScanner.isSupported() before rendering
// any entry point — iOS Safari has no BarcodeDetector, so the button simply
// never shows there.
import { t } from '../i18n/i18n.js';

const POLL_MS     = 300;   // detector cadence
const COOLDOWN_MS = 2000;  // ignore repeat reads of the same code while aiming

export class BarcodeScanner {
  static isSupported() {
    return typeof window !== 'undefined'
      && 'BarcodeDetector' in window
      && !!navigator.mediaDevices?.getUserMedia;
  }

  /** @param {{ onDetect: (rawValue: string) => void }} opts */
  constructor({ onDetect }) {
    this._onDetect = onDetect;
    this._el = null;
    this._stream = null;
    this._timer = null;
    this._lastCode = null;
    this._lastAt = 0;
  }

  async open() {
    if (this._el) return;

    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: ['ean_13'] });
    } catch {
      this._toastError();
      return;
    }

    const el = document.createElement('div');
    el.className = 'bc-scan';
    el.innerHTML = `
      <video class="bc-scan__video" autoplay playsinline muted></video>
      <div class="bc-scan__frame" aria-hidden="true"></div>
      <p class="bc-scan__hint">${t('shop.scan.hint')}</p>
      <button type="button" class="bc-scan__close btn btn--primary">${t('shop.scan.close')}</button>
    `;
    el.querySelector('.bc-scan__close').addEventListener('click', () => this.close());
    document.body.appendChild(el);
    this._el = el;

    const video = el.querySelector('video');
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      video.srcObject = this._stream;
      await video.play();
    } catch {
      this.close();
      this._toastError();
      return;
    }

    this._timer = setInterval(async () => {
      if (!this._el || video.readyState < 2) return;
      let codes = [];
      try { codes = await detector.detect(video); } catch { return; }
      const raw = codes[0]?.rawValue;
      if (!raw) return;
      const now = Date.now();
      if (raw === this._lastCode && now - this._lastAt < COOLDOWN_MS) return;
      this._lastCode = raw;
      this._lastAt = now;
      if (navigator.vibrate) navigator.vibrate(80);
      this._onDetect(raw);
    }, POLL_MS);
  }

  close() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._stream) { this._stream.getTracks().forEach(tr => tr.stop()); this._stream = null; }
    if (this._el) { this._el.remove(); this._el = null; }
  }

  _toastError() {
    // Lazy import avoids a cycle if Toast ever imports i18n helpers from views.
    import('./Toast.js').then(({ showToast }) => showToast(t('shop.scan.error'), 'error')).catch(() => {});
  }
}
