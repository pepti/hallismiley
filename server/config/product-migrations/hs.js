// Product migrations for hallismiley.is (product id "hs", role personal).
//
// Concatenated AFTER the engine list (server/config/schema.js) by
// server/config/migrationSet.js, so the runner sees one ordered array. The
// engine array is authored in the upstream repo (orangesmiley) only and
// arrives here by merge; THIS file is product-owned and never overwritten by
// an engine sync. Names are the runner's identity: never rename an applied
// entry.
//
// hallismiley was the base the engine was scaffolded from, so it has no
// product-only migrations: every entry it applied under its own numbering
// before the 2026-09-22 graft is an engine migration under another name.
// The `aliases` map below tells the runner which engine names its databases
// already satisfy (recorded as applied with resolved_from = the old name,
// nothing executed); `superseded` names the one engine entry it must never
// run. Both were verified against `git show f7d93b9:server/config/schema.js`
// (the last hallismiley commit the engine harvested from).
//
// Sections:
//   legacy      entries applied under pre-split, unprefixed names. Empty:
//               hallismiley never had a product-only entry. Frozen.
//   migrations  new entries, named hs_NNN_snake, numbered from 001.
//   aliases     { engineName: [hallismileyNamesAlreadyApplied] }
//   superseded  { engineName: 'reason' }

module.exports = {
  product: 'hs',
  legacy: [],
  migrations: [
    // { name: 'hs_001_…', statements: [ … ] },
  ],
  aliases: {
    // Same DDL, different number: the base and the engine numbered the
    // 2026-08-19 base-upgrade program independently (HISTORY: base-sync).
    '082_admin_totp':             ['080_admin_totp'],
    '081_system_updates':         ['082_system_updates'],
    '087_event_logs':             ['083_event_logs'],
    '088_mcp_tokens':             ['084_mcp_tokens'],
    '083_user_theme':             ['081_user_theme'],
    '103_books_vehicle_accounts': ['085_books_vehicle_accounts'],
  },
  superseded: {
    // 084 re-declared users_theme_check as the engine's five-id set. Running
    // it here would reject every account on glacier/moss/lava/aurora/
    // black-sand; the engine's 106 drops the constraint altogether, after
    // which the theme list in server/config/themes.js is the only gate.
    '084_user_theme_widen': 'hallismiley keeps the six-palette theme set of its 081_user_theme; the CHECK is dropped by 106',
  },
};
