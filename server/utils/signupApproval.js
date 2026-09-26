// "Awaiting approval" — ONE predicate for a sign-up an admin has not yet
// approved or declined (users.approval_status, migration 060), shared by the
// "Í dag" attention card (services/adminHome.js) and the user list's
// ?status=pending filter (controllers/adminController.listUsers), so the number
// on the card is exactly the rows its link opens (harvest 2 lane 5,
// icelandicstore #417). Column-only, no alias: usable against `users` in any
// query that selects from it unaliased.
const PENDING_APPROVAL_SQL = `approval_status = 'pending'`;

module.exports = { PENDING_APPROVAL_SQL };
