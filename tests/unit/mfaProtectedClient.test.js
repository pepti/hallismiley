/**
 * The 2FA enrolment UI's role predicate must agree with the server's.
 *
 * ENHANCEMENTS #17 (2026-09-07) widened the SERVER gate — server/services/
 * mfaService.js protectedRole() — to `accounts_holder`, so a seller who owns
 * customer accounts is challenged like an admin. The Profile screen's Two-step
 * section was left gated on `profile.role === 'admin'`, so such a seller was
 * pushed to enrol and had no panel to enrol from: challenged, unable to comply.
 *
 * Client-side the same question is asked of the session payload's role SET and
 * view list, so the two predicates are written in different vocabularies. This
 * pins them to the same answers.
 *
 * The server's review pass (PR #3) found the same defect from the other side:
 * the enrolment ENDPOINTS also tested role === 'admin', so the users the gate
 * newly protected were the only ones who could not enrol. Both halves were
 * needed — a UI that renders the panel and an API that accepts the request —
 * and authController.isEnrolmentEligible() now asks protectedRole() too.
 * That pass exported protectedRole, so this compares against it directly.
 *
 * babel-jest compiles the ESM module to CJS for require() (see money.client.test.js).
 */
const { protectedRole } = require('../../server/services/mfaService');

// auth.js dispatches a CustomEvent on `window` after a restored session.
// testEnvironment is 'node', so give it just enough to not throw.
global.window = { dispatchEvent: () => {} };

const auth = require('../../public/js/services/auth.js');

/** Put a session payload into the module's cached user via the real code path. */
async function signInAs(user) {
  global.fetch = async () => ({ json: async () => ({ authenticated: true, user }) });
  await auth.tryRestoreSession();
}

describe('client isMfaProtected() agrees with the server', () => {
  // [label, client session payload, equivalent server-side user]
  const CASES = [
    [
      'primary admin',
      { role: 'admin', roles: ['admin'], views: ['*'] },
      { role: 'admin' },
    ],
    [
      'admin-anywhere: primary role user, admin in the role SET',
      { role: 'user', roles: ['user', 'admin'], views: ['*'] },
      { role: 'user', admin_anywhere: true },
    ],
    [
      'accounts-holding seller (solumadur)',
      { role: 'solumadur', roles: ['solumadur'], views: ['handbok', 'leads', 'accounts', 'commission'] },
      { role: 'solumadur', accounts_holder: true },
    ],
    [
      'verktaki: accounts + allaccounts',
      { role: 'verktaki', roles: ['verktaki'], views: ['handbok', 'accounts', 'allaccounts'] },
      { role: 'verktaki', accounts_holder: true },
    ],
    [
      'handbook-only seller (solufolk) — not protected',
      { role: 'solufolk', roles: ['solufolk'], views: ['handbok', 'leads'] },
      { role: 'solufolk', accounts_holder: false },
    ],
    [
      'plain user — not protected',
      { role: 'user', roles: ['user'], views: [] },
      { role: 'user' },
    ],
  ];

  test.each(CASES)('%s', async (_label, clientUser, serverUser) => {
    await signInAs(clientUser);
    expect(auth.isMfaProtected()).toBe(protectedRole(serverUser));
  });

  test('the accounts holder that #17 widened the server to is offered the panel', async () => {
    await signInAs({ role: 'solumadur', roles: ['solumadur'], views: ['accounts'] });
    expect(auth.isMfaProtected()).toBe(true);
  });

  test('a wildcard view grant counts as holding accounts', async () => {
    await signInAs({ role: 'moderator', roles: ['moderator'], views: ['*'] });
    expect(auth.isMfaProtected()).toBe(true);
  });

  test('signed out is never protected', async () => {
    auth.clearSession();
    expect(auth.isMfaProtected()).toBe(false);
  });
});
