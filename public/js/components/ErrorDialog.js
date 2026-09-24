// Centered error dialog with an OK button.
//
// Owner request (2026-09-03): a red toast in the bottom-right corner is easy
// to miss on a busy screen — an error must land in the middle and stay until
// it is acknowledged. Every showToast(..., 'error') routes here (Toast.js);
// success/info toasts keep the corner. Errors are still recorded in the
// session log (services/toastLog.js) exactly as before, so Admin → Monitoring
// and the toast-log modal see them too.
//
// One dialog at a time: further errors queue (identical consecutive messages
// collapse, and the queue is capped so a failing loop can't stack dozens).

import { t } from '../i18n/i18n.js';

const MAX_QUEUED = 5;
const FADE_MS = 150;

let overlay = null;
let isOpen = false;
let shown = null;   // the message on screen
const queue = [];

function mount() {
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay error-dialog-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'error-dialog-title');
  overlay.setAttribute('aria-describedby', 'error-dialog-msg');
  overlay.innerHTML = `
    <div class="modal error-dialog" data-testid="error-dialog">
      <h2 class="modal__title error-dialog__title" id="error-dialog-title"></h2>
      <p class="error-dialog__msg" id="error-dialog-msg"></p>
      <div class="error-dialog__actions">
        <button type="button" class="btn btn--primary error-dialog__ok" data-testid="error-dialog-ok"></button>
      </div>
    </div>`;
  overlay.querySelector('.error-dialog__ok').addEventListener('click', () => closeErrorDialog());
  // Keyboard: Enter / Escape / Space all acknowledge. Listening on the overlay
  // (which holds focus via the OK button) keeps this off the document.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeErrorDialog(); }
  });
  document.body.appendChild(overlay);
}

function present(message) {
  if (!overlay) mount();
  const title = t('toast.errorTitle');
  overlay.querySelector('#error-dialog-title').textContent = title === 'toast.errorTitle' ? 'Error' : title;
  const ok = t('toast.ok');
  overlay.querySelector('.error-dialog__ok').textContent = ok === 'toast.ok' ? 'OK' : ok;
  overlay.querySelector('#error-dialog-msg').textContent = message;
  shown = message;
  // Commit the opacity:0 start state before adding .open so the fade-in runs
  // (see ToastLog.js for why this is a forced flush, not requestAnimationFrame).
  void overlay.offsetWidth;
  overlay.classList.add('open');
  isOpen = true;
  overlay.querySelector('.error-dialog__ok').focus();
}

export function showErrorDialog(message) {
  const msg = String(message == null ? '' : message);
  if (isOpen) {
    // Engine fix (harvest-ice-b-2026-09-24): compare with the message ON
    // SCREEN when nothing is queued yet — ice compared only with the queue's
    // tail, so the first repeat of the shown error was queued, not collapsed.
    const last = queue.length ? queue[queue.length - 1] : shown;
    if (last !== msg && queue.length < MAX_QUEUED) queue.push(msg);
    return;
  }
  present(msg);
}

export function closeErrorDialog() {
  if (!isOpen) return;
  overlay.classList.remove('open');
  isOpen = false;
  const next = queue.shift();
  if (next !== undefined) setTimeout(() => present(next), FADE_MS);
}
