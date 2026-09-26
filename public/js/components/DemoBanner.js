// The demo instance's banner (R2b, D-020): a slim line at the top of every
// page saying this is sample data, reset every night, and that nothing is
// sent. Shown only when ssrMeta marked the page <html data-demo-instance>
// (server/config/demoInstance.js) — no request needed. Not the TEST chrome's
// per-browser "demo mode" (services/themePrefs.js), which is cosmetic.
import { t } from '../i18n/i18n.js';

let banner = null;

export function mountDemoBanner() {
  const html = document.documentElement;
  if (html.dataset.demoInstance !== 'true') return null;
  const hour = String(Number.parseInt(html.dataset.demoResetHour || '2', 10) || 0).padStart(2, '0');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.setAttribute('role', 'note');
    banner.dataset.testid = 'demo-banner';
    document.body.insertBefore(banner, document.body.firstChild);
  }
  banner.textContent = t('demo.banner', { time: `${hour}:00` });
  return banner;
}
