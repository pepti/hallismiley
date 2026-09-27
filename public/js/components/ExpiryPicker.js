// "Gildir til" — the validity of a time-limited login (migration 114,
// login-expiry-2026-09-26). Shared by the Users list (change an existing
// login's expiry) and the Customers "add" form (a demo login for a prospect).
//
// A quick choice of 7 / 14 / 30 days from now, a date (valid through the END
// of that day, browser-local), or none. The server re-validates everything
// (auth/accountExpiry.js parseExpiresAt): the value must lie in the future.
import { t, plural } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';
import { formatDateTime } from '../utils/format.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const QUICK_DAYS = [7, 14, 30];

function pad(n) { return String(n).padStart(2, '0'); }

/** YYYY-MM-DD of a Date in the browser's local time (what <input type=date> speaks). */
function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The badge for a list row: nothing for a login without expiry, "útrunninn"
 * once it has passed, else "rennur út eftir N daga" (Icelandic plural rule
 * via plural()). Days round UP: 30 minutes left is "1 dag", never "0 daga".
 */
export function expiryBadgeHtml(expiresAt, now = Date.now()) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms) || ms <= now) {
    return `<span class="users-expiry-badge users-expiry-badge--expired" data-expiry-state="expired">${escHtml(t('adminUsers.expired'))}</span>`;
  }
  const days = Math.max(1, Math.ceil((ms - now) / DAY_MS));
  // The exact moment, in the app locale through the kit formatter (not the
  // browser's own toLocaleString; ice #324 sweep, harvest 2 lane 4a).
  const title = formatDateTime(ms);
  return `<span class="users-expiry-badge" data-expiry-state="active" title="${escHtml(title)}">${escHtml(plural(days, 'adminUsers.expiresIn.one', 'adminUsers.expiresIn.many'))}</span>`;
}

/**
 * The radio group. `current` (ISO string or null) preselects: none, or the
 * date option carrying that date. `idPrefix` keeps two pickers on one page
 * apart.
 */
export function expiryFieldHtml({ idPrefix, current = null }) {
  const name = `${idPrefix}-choice`;
  const hasCurrent = !!current && Number.isFinite(new Date(current).getTime());
  const today = localDate(new Date());
  const radio = (value, label, checked) => `
    <label class="users-expiry-modal__choice">
      <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}/>
      <span>${escHtml(label)}</span>
    </label>`;
  return `
    <fieldset class="users-expiry-modal__choices" data-expiry-picker="${escHtml(idPrefix)}">
      <legend>${escHtml(t('adminUsers.validUntil'))}</legend>
      ${radio('none', t('adminUsers.expiryNone'), !hasCurrent)}
      ${QUICK_DAYS.map(n => radio(String(n), plural(n, 'adminUsers.expiryDays.one', 'adminUsers.expiryDays.many'), false)).join('')}
      <label class="users-expiry-modal__choice">
        <input type="radio" name="${name}" value="date" ${hasCurrent ? 'checked' : ''}/>
        <span>${escHtml(t('adminUsers.expiryDate'))}</span>
        <input type="date" class="form-input form-input--sm" id="${escHtml(idPrefix)}-date"
               min="${today}" value="${hasCurrent ? localDate(new Date(current)) : ''}"
               aria-label="${escHtml(t('adminUsers.expiryDate'))}"/>
      </label>
    </fieldset>`;
}

/** Picking a date selects the date option — one less click. */
export function wireExpiryField(root, idPrefix) {
  const dateInput = root.querySelector(`#${idPrefix}-date`);
  const dateRadio = root.querySelector(`input[name="${idPrefix}-choice"][value="date"]`);
  if (!dateInput || !dateRadio) return;
  const pick = () => { dateRadio.checked = true; };
  dateInput.addEventListener('focus', pick);
  dateInput.addEventListener('input', pick);
}

/**
 * Read the choice: { ok: true, value: ISO string | null } or
 * { ok: false, message } when the date option has no date. A date means the
 * end of that day in the browser's time zone.
 */
export function readExpiryField(root, idPrefix, now = Date.now()) {
  const picked = root.querySelector(`input[name="${idPrefix}-choice"]:checked`);
  const choice = picked ? picked.value : 'none';
  if (choice === 'none') return { ok: true, value: null };
  if (choice === 'date') {
    const raw = root.querySelector(`#${idPrefix}-date`)?.value || '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return { ok: false, message: t('adminUsers.expiryPickDate') };
    const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
    return { ok: true, value: end.toISOString() };
  }
  const days = Number(choice);
  return { ok: true, value: new Date(now + days * DAY_MS).toISOString() };
}
