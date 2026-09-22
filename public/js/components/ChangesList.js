// ChangesList — one row of the "Latest updates" list: the changes the running
// build carries (server/scripts/generate-changes.js → GET /api/v1/system/changes).
// Shared by Admin → Monitoring and the /admin overview card so both render the
// same row. Styles: the .mon-update* rules in admin-monitoring.css (global).

import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';
import { formatDate } from '../utils/format.js';

// Where a "#203" suffix links.
export const REPO_URL = 'https://github.com/orange-smiley/orangesmiley';

export function updateRowHtml(ch) {
  // Conventional-commit prefix ("fix(pos): …" → "fix") becomes a small pill;
  // the rest of the subject is shown as written, minus the "(#203)" suffix
  // that the PR link already carries.
  const m = /^([a-z]+)(\([^)]*\))?!?:\s*(.*)$/i.exec(ch.subject || '');
  const kind  = m ? m[1].toLowerCase() : '';
  const title = (m ? m[3] : ch.subject || '').replace(/\s*\(#\d+\)\s*$/, '');
  const pr = Number.isInteger(ch.pr)
    ? `<a class="mon-update__pr" href="${REPO_URL}/pull/${ch.pr}" target="_blank" rel="noopener">${escHtml(t('adminMonitoring.updatesPr', { pr: ch.pr }))}</a>`
    : '<span class="mon-update__pr"></span>';
  return `<li class="mon-update">
    <span class="mon-update__date">${escHtml(formatDate(ch.date))}</span>
    <span class="mon-update__kind mon-update__kind--${escHtml(kind)}">${escHtml(kind)}</span>
    <span class="mon-update__title">${escHtml(title)}</span>
    ${pr}
  </li>`;
}
