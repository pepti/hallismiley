// UpdateBanner — "a new release is out, save and reload". Shown by
// services/buildGuard.js when the page is running an old release but reloading
// straight away could lose something the user typed. The page still reloads on
// its next navigation; the button just lets them do it now. Styles in
// components.css (theme tokens only).
//
// Accessibility: the live region is mounted EMPTY when the guard installs, as the
// body's first child. A role="status" element inserted already holding its text
// is not reliably announced (NVDA/JAWS announce changes to an existing region),
// and first in the DOM puts "Endurhlaða" at the start of the tab order instead of
// last (TEST report 2026-09-16, L4).
import { t } from '../i18n/i18n.js';

// The guard's listeners are live before main.js has awaited loadLocale(), so a
// refocus during boot can reach this with an empty dictionary — where t()
// returns the key itself. Fall back to the Icelandic copy (the site's default
// language) rather than painting "updateBanner.message" at someone.
const FALLBACK = {
  'updateBanner.message': 'Ný útgáfa af kerfinu er komin. Vistaðu breytingar og endurhlaðaðu.',
  'updateBanner.reload': 'Endurhlaða',
};
const label = (key) => {
  const s = t(key);
  return s === key ? FALLBACK[key] : s;
};

let _region = null;

export function mountUpdateRegion() {
  if (_region && document.body.contains(_region)) return _region;
  _region = document.createElement('div');
  _region.className = 'update-banner-region';
  _region.setAttribute('role', 'status');
  _region.setAttribute('aria-live', 'polite');
  document.body.prepend(_region);
  return _region;
}

export function showUpdateBanner() {
  const region = mountUpdateRegion();
  if (region.querySelector('.update-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'update-banner';

  const msg = document.createElement('span');
  msg.className = 'update-banner__msg';
  msg.textContent = label('updateBanner.message');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--sm btn--primary update-banner__reload';
  btn.textContent = label('updateBanner.reload');
  btn.addEventListener('click', () => window.location.reload());

  banner.append(msg, btn);
  region.appendChild(banner);
}
