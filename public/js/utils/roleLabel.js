// The name a person reads for an admin role (harvest 2 G1/G3, the pattern of
// icelandicstore #421's companyRoleLabel): one helper for the Roles grid, the
// Members board, the Users-page dropdown and the Profile badge, so a custom
// role shows its typed name everywhere and never its slug by accident.
//
//   • the three built-in roles (admin, moderator, user) are named by i18n
//     (adminRoles.builtin.<name>) in both languages — their stored label is a
//     generic backfill (migration 116);
//   • any other role shows its `label` (migration 116_role_label);
//   • a role nobody named (label '') falls back to its slug.
import { t } from '../i18n/i18n.js';

export const BUILT_IN_ROLES = ['admin', 'moderator', 'user'];

/**
 * @param {{name: string, label?: string}|string} role  a role row, or a bare slug
 * @param {Array<{name: string, label?: string}>} [roles]  rows to look a bare slug up in
 * @returns {string}
 */
export function roleLabel(role, roles = []) {
  if (!role) return '';
  const row = typeof role === 'string' ? (roles.find(r => r && r.name === role) || { name: role }) : role;
  const name = String(row.name || '');
  if (BUILT_IN_ROLES.includes(name)) {
    const key = `adminRoles.builtin.${name}`;
    const text = t(key);
    if (text && text !== key) return text;
  }
  return (row.label && String(row.label)) || name;
}
