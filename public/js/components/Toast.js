// Singleton toast manager.
//
// Toasts stack newest-at-the-bottom, and only the latest
// MAX_VISIBLE stay on screen. Nothing is lost when one is evicted or fades:
// every toast is recorded in the session log (services/toastLog.js), which a
// click on any toast opens.

import { logToast } from '../services/toastLog.js';
import { openToastLog } from './ToastLog.js';
import { t } from '../i18n/i18n.js';

// ice ships 20s here; this repo keeps its 3s default — the linger was an
// ice UX decision, and 20s toasts also slow every e2e flow that waits
// behind one. The log/cap/click-to-dismiss improvements are kept.
const DEFAULT_DURATION = 3000;
const MAX_VISIBLE = 6;
const FADE_MS = 200;

let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

// Pending timers per toast, so evicting one over the cap doesn't leave its
// fade-out timer to fire against a node that is already gone.
const timers = new WeakMap();

function removeNow(toast) {
  if (!toast) return;
  const ids = timers.get(toast);
  if (ids) { ids.forEach(clearTimeout); timers.delete(toast); }
  toast.remove();
}

export function showToast(message, type = 'success', duration = DEFAULT_DURATION) {
  logToast(message, type);

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  // Clicking any toast opens the full session log.
  toast.setAttribute('role', 'button');
  toast.setAttribute('tabindex', '0');
  // A toast can fire before loadLocale() resolves, and t() falls back to the key
  // itself — show no tooltip rather than the raw key.
  const hint = t('toast.viewLog');
  if (hint !== 'toast.viewLog') toast.title = hint;
  toast.addEventListener('click', () => openToastLog());
  toast.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openToastLog(); }
  });

  const c = getContainer();
  c.appendChild(toast);

  // Keep only the latest MAX_VISIBLE on screen; the rest live on in the log.
  while (c.children.length > MAX_VISIBLE) removeNow(c.firstElementChild);

  const hide = setTimeout(() => {
    toast.style.transition = `opacity ${FADE_MS}ms`;
    toast.style.opacity = '0';
    timers.set(toast, [setTimeout(() => removeNow(toast), FADE_MS)]);
  }, duration);
  timers.set(toast, [hide]);
}
