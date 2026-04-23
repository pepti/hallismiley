import { t } from '../i18n/i18n.js';

// Wraps a password input with an eye-icon reveal button.  The input must
// already live in a `.form-group` or similar block-level container; the
// helper inserts a `.password-toggle` sibling wrapper around the input
// (idempotent — safe to call twice).
export function bindPasswordToggle(input) {
  if (!input || input.dataset.pwToggle === 'bound') return;

  const wrapper = document.createElement('div');
  wrapper.className = 'password-toggle';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'password-toggle__btn';
  btn.setAttribute('aria-label', t('auth.showPassword'));
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = EYE_SVG;

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  wrapper.appendChild(btn);

  btn.addEventListener('click', () => {
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    btn.setAttribute('aria-pressed', shown ? 'false' : 'true');
    btn.setAttribute('aria-label', t(shown ? 'auth.showPassword' : 'auth.hidePassword'));
    btn.innerHTML = shown ? EYE_SVG : EYE_OFF_SVG;
  });

  input.dataset.pwToggle = 'bound';
}

// Scope-limited helper — finds every `input[type=password]` inside `root`
// and binds a toggle to each.
export function bindAllPasswordToggles(root) {
  root.querySelectorAll('input[type="password"]').forEach(bindPasswordToggle);
}

const EYE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
