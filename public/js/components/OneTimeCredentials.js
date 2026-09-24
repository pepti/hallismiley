// OneTimeCredentials — the "shown once" username + password panel.
//
// A login with no mailbox (a name-only customer; harvested from icelandicstore
// #382/#397, 2026-09-24) is handed its password on screen instead of by an
// invite. The password exists nowhere else — the server stores only its hash
// and never returns it again — so this panel is the one and only sight of it.
// Same shape as the 2FA recovery codes: a warning tint, the plain words "shown
// once", and a copy button beside each value. Styling is `.otc` (user-system.css,
// tokens only — invariant 15).
//
// Same API as ice's component (its graft then sees one file); the markup uses
// the engine's own classes instead of ice's cd-card/un-* kit.
//
//   credentialsPanelHtml({ name, username, password, title?, actionsHtml?, idPrefix? }) → string
//     idPrefix names the inputs <prefix>-username / <prefix>-password (stable
//     ids for e2e); omitted, a unique one is generated.
//   wireCredentialsPanel(root) — the copy buttons; call once after inserting.
import { escHtml } from '../utils/escHtml.js';
import { t }       from '../i18n/i18n.js';

let _seq = 0;

export function credentialsPanelHtml({ name, username, password, title, actionsHtml = '', idPrefix = null }) {
  const id = idPrefix || `otc-${++_seq}`;
  const row = (kind, label, value) => `
    <label class="otc__label" for="${id}-${kind}">${label}</label>
    <div class="otc__row">
      <input class="form-input otc__value" id="${id}-${kind}" readonly value="${escHtml(value)}" data-otc-value/>
      <button type="button" class="btn btn--sm ${kind === 'password' ? 'btn--primary' : 'btn--outline'}" data-otc-copy="${id}-${kind}">${t('adminUsers.copy')}</button>
    </div>`;
  return `
    <section class="otc" tabindex="-1" data-otc>
      <h2 class="otc__title">${escHtml(title || t('adminUsers.passwordTitle'))}</h2>
      ${name ? `<p class="otc__name">${escHtml(name)}</p>` : ''}
      <p class="otc__warn" role="alert">${t('adminUsers.passwordOnce')}</p>
      ${row('username', t('adminUsers.usernameLabel'), username)}
      ${row('password', t('adminUsers.passwordLabel'), password)}
      ${actionsHtml ? `<div class="otc__actions">${actionsHtml}</div>` : ''}
    </section>`;
}

export function wireCredentialsPanel(root) {
  if (!root) return;
  root.querySelectorAll('[data-otc-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const input = root.querySelector(`#${btn.dataset.otcCopy}`);
      if (!input) return;
      input.select();
      try { await navigator.clipboard.writeText(input.value); } catch { /* clipboard blocked — the text is selected */ }
      btn.textContent = t('adminUsers.copied');
      setTimeout(() => { btn.textContent = t('adminUsers.copy'); }, 1500);
    });
  });
}
