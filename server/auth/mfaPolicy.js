'use strict';
/*
 * Two-factor ENROLMENT — optional or mandatory, per instance.
 *
 * The switch is `security.mfa.enrolment` in config/client.json
 * (server/config/clientConfig.js; env CLIENT_CONFIG_SECURITY_MFA_ENROLMENT):
 *
 *   optional (the DEFAULT since 2026-09-23, Halli: "change mfa to optional")
 *     mustEnrol() is always false. Nothing below withholds anything, and
 *     `mfa_enrolment_required` is always false. An account that HAS enrolled
 *     is still challenged for a code at every sign-in (mfaService — this file
 *     never touches the challenge), and the Prófíll panel still offers
 *     enrolment to every protected account (its "password only" hint is the
 *     recommendation; mfaService.shouldEnrol is the predicate behind it).
 *   required
 *     the rule harvested from rekstrarkerfid, described below.
 *
 * Why the mandatory mode exists: mfaService.isProtected() only ever challenged
 * accounts that had chosen to enrol, so an admin who never opened the 2FA
 * panel signed in with a password alone (Öryggisvörður's review in
 * rekstrarkerfid, 2026-09-18; harvested into the engine 2026-09-23).
 *
 * The rule under `required`, enforced here and nowhere else:
 *
 *   an account the login path would challenge (mfaService.protectedRole: an
 *   admin by primary role or role SET, an `accounts` holder, a published
 *   seller) that has not enabled TOTP is NOT that yet.
 *
 * It can sign in (it needs a session to reach POST /auth/totp/setup +
 * /confirm), but every place a session becomes a `req.user` runs the policy,
 * which WITHHOLDS what made the account protected from what the rest of the
 * server sees:
 *   • `admin` is stripped from role + roles (effectiveRoles). requireRole,
 *     requireView and every inline `req.user.role === 'admin'` in a controller
 *     then refuse on their own — a downgrade at the source, not a check in the
 *     guards that someone adding a guard next year can forget (invariant 8).
 *   • the `accounts` view (and a wildcard grant) is stripped from the resolved
 *     view list (withholdViews) — requireView is the one place views are
 *     resolved for a guard, and it asks this file.
 *   • a published seller's routes demand totp_enabled themselves
 *     (routes/sellerRoutes.js, rule 4, which asks enrolmentRequired() — so
 *     only under `required` since mfa-reminder-2026-09-23; it applied in both
 *     modes before); the session payload also reports
 *     mfa_enrolment_required so the SPA walks the seller to the panel.
 *
 * Under `optional` the same accounts get a dismissible REMINDER instead
 * (reminderCandidate below; the session's `mfa_reminder`).
 * Other roles the account holds keep working: they never required a second
 * factor.
 *
 * The session payloads are downgraded the same way (authController.roleFields)
 * and carry `mfa_enrolment_required`, so the SPA paints no admin chrome and
 * sends the person to Prófíll → Tveggja þátta staðfesting. That part is UX;
 * this part is the gate.
 *
 * ESCAPE HATCH — non-production only, and only meaningful under `required`.
 * ADMIN_TOTP_EXEMPT is a comma-separated
 * list of usernames (or `*`) that are not forced to enrol. It exists for the
 * Jest and Playwright suites, where dozens of admin sign-ins per minute cannot
 * pass TOTP's replay guard (one code per 30-second step), and for a developer's
 * local database. It is IGNORED when NODE_ENV=production, which includes the
 * Azure TEST stack; server.js warns at boot if it is set there. Break-glass for
 * a locked-out production admin is a script run with database access, not a
 * switch — docs/ADMIN-2FA.md.
 */

const { protectedRole, shouldEnrol } = require('../services/mfaService');
const Role = require('../models/Role');
const { ALL } = require('./adminViews');
const { clientConfig, envNameFor, SCHEMA } = require('../config/clientConfig');

const ADMIN = 'admin';
// The view whose holders the gate protects (ENHANCEMENTS #17): withheld, with
// the wildcard that implies it, while enrolment is owed.
const PROTECTED_VIEW = 'accounts';

// security.mfa.enrolment — see the header.
const ENROLMENT_ENV = envNameFor(['security', 'mfa', 'enrolment']);   // CLIENT_CONFIG_SECURITY_MFA_ENROLMENT
const ENROLMENT_MODES = SCHEMA.security.mfa.enrolment.enum;

/**
 * 'optional' | 'required'. The env var is re-read per call, like
 * ADMIN_TOTP_EXEMPT, so a suite can flip the mode for itself; a value the
 * schema would reject is ignored here exactly as clientConfig ignored it at
 * boot, so both readings agree. Otherwise the resolved config decides.
 */
function enrolmentMode() {
  const raw = process.env[ENROLMENT_ENV];
  if (ENROLMENT_MODES.includes(raw)) return raw;
  return clientConfig.security.mfa.enrolment;
}

function enrolmentRequired() {
  return enrolmentMode() === 'required';
}

function exemptList() {
  return String(process.env.ADMIN_TOTP_EXEMPT || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Read per call, like the rate limiters' `skip`, so a test can flip it. */
function isExempt(user) {
  if (process.env.NODE_ENV === 'production') return false;
  const list = exemptList();
  if (!list.length) return false;
  return list.includes('*') || list.includes(String(user?.username || '').toLowerCase());
}

function roleSet(user, roles) {
  return Array.isArray(roles) && roles.length ? roles : [user.role];
}

function holdsAdmin(user, roles) {
  return !!user && (user.role === ADMIN || roleSet(user, roles).includes(ADMIN));
}

/** Does a resolved view list grant the protected view? */
function viewsHoldProtected(views) {
  return Array.isArray(views) && (views.includes(ALL) || views.includes(PROTECTED_VIEW));
}

/**
 * Must this account enrol before it may act as what it is?
 * `user` carries whatever flags the caller could resolve — accounts_holder,
 * seller_holder (utils/adminRole.js, auth/publishedSeller.js); admin-anywhere
 * is read off the role set here, so a caller with the set never has to.
 * Always false while this instance's enrolment is `optional`.
 */
function mustEnrol(user, roles) {
  if (!user || user.totp_enabled === true || !enrolmentRequired() || isExempt(user)) return false;
  return protectedRole({ ...user, admin_anywhere: user.admin_anywhere === true || holdsAdmin(user, roles) });
}

/**
 * Is this account a candidate for the two-step REMINDER
 * (mfa-reminder-2026-09-23)? Only while enrolment is `optional` — under
 * `required` the forced flow above applies instead — and only for an account
 * mfaService.shouldEnrol recommends it to (protected role, no TOTP). Same
 * `user` flags as mustEnrol. Whether the account has dismissed it is the
 * caller's to add (authController.roleFields reads users.mfa_reminder_dismissed_at);
 * this is the predicate, the column is the preference.
 */
function reminderCandidate(user, roles) {
  if (!user || enrolmentRequired()) return false;
  return shouldEnrol({ ...user, admin_anywhere: user.admin_anywhere === true || holdsAdmin(user, roles) });
}

/** The role view of an account, with `admin` withheld while enrolment is owed. */
function effectiveRoles(user, roles) {
  const set = roleSet(user, roles);
  if (!mustEnrol(user, set)) return { role: user.role, roles: set, enrolmentRequired: false };
  if (!holdsAdmin(user, set)) {
    // Protected through a view or the seller snapshot, not a role: the roles
    // stand, the view is withheld (withholdViews) or the routes ask themselves.
    return { role: user.role, roles: set, enrolmentRequired: true };
  }
  const rest = set.filter(r => r !== ADMIN);
  const kept = rest.length ? rest : ['user'];
  return { role: user.role === ADMIN ? kept[0] : user.role, roles: kept, enrolmentRequired: true };
}

/** The resolved view list, with the protected view (and `*`) withheld while
 *  enrolment is owed. Pure: requireView and roleFields both call it. */
function withholdViews(views, enrolmentRequired) {
  if (!enrolmentRequired || !Array.isArray(views)) return views;
  return views.filter(v => v !== ALL && v !== PROTECTED_VIEW);
}

/**
 * Apply the policy to a freshly validated session user, in place.
 * `roles` is the resolved role set when the caller has one (attachRoles); a
 * reader that only knows the primary role passes none. Always leaves
 * `user.roles` set, so downstream guards never fall back to a primary role this
 * function did not get to vet.
 */
function applyMfaPolicy(user, roles) {
  if (!user) return user;
  const eff = effectiveRoles(user, roles);
  user.role  = eff.role;
  user.roles = eff.roles;
  if (eff.enrolmentRequired) user.mfaEnrolmentRequired = true;
  return user;
}

/**
 * Per-request form, for attachRoles once the role set is known. The
 * `accounts` flag needs the resolved views, so they are looked up (from the
 * Role cache) only when the answer depends on them: an unenrolled, non-exempt
 * account that holds no admin role, on an instance that requires enrolment.
 * Enrolled and exempt accounts, admins, and every account under `optional`
 * cost nothing extra. A failed lookup leaves the flag unset — the account is
 * then treated as unprotected for this request, which is what it was before
 * this rule existed, and requireView still resolves views for itself.
 */
async function applyMfaPolicyToRequest(req) {
  const user = req.user;
  if (!user) return user;
  const roles = roleSet(user, user.roles);
  if (enrolmentRequired() && user.totp_enabled !== true && !isExempt(user) && !holdsAdmin(user, roles)
      && user.accounts_holder === undefined) {
    try {
      user.accounts_holder = viewsHoldProtected(await Role.getViewsForRoles(roles));
    } catch { /* undecided: see above */ }
  }
  return applyMfaPolicy(user, roles);
}

module.exports = {
  mustEnrol, reminderCandidate, effectiveRoles, withholdViews, viewsHoldProtected,
  applyMfaPolicy, applyMfaPolicyToRequest, isExempt, holdsAdmin, PROTECTED_VIEW,
  enrolmentMode, enrolmentRequired, ENROLMENT_ENV,
};
