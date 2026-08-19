'use strict';

// The one place that answers "how does self-update behave on this instance?".
//
// Two layers, and the order matters:
//   1. config/client.json + CLIENT_CONFIG_* — the INSTANCE CONTRACT. Set at
//      provisioning time by whoever operates the deployment.
//   2. app_settings rows — what the instance's own admin has chosen since.
//
// The contract wins where it must. An instance provisioned `managed` is one
// Orange Smiley updates on the customer's behalf; its admin cannot promote
// itself out of that, or the arrangement the customer bought would be
// unilaterally cancellable from inside the product. So:
//
//   • file mode `managed` ⇒ admin overrides are ignored entirely
//   • file mode `auto`/`manual` ⇒ the admin may switch between those two,
//     choose a channel, and edit the maintenance window
//
// Everything is async from the first line so the DB layer could be added in
// phase 4 without changing a single call site.

const { clientConfig } = require('../config/clientConfig');
const Setting = require('../models/Setting');

const MODES        = ['managed', 'auto', 'manual'];
// The modes an admin may put their own instance into. `managed` is not here:
// entering it is the operator's decision, and leaving it certainly is.
const ADMIN_MODES  = ['auto', 'manual'];
const CHANNELS     = ['stable', 'canary'];

const KEYS = {
  mode:    'selfupdate.mode',
  channel: 'selfupdate.channel',
  window:  'selfupdate.maintenance_window',
};

/** The provisioned contract — the floor everything else is measured against. */
function contract() {
  return clientConfig.modules.selfUpdate;
}

/** Is the self-update module switched on for this instance at all? */
function isEnabled() { return contract().enabled === true; }

/** Can this instance's admin change its update behaviour at all? */
function isManaged() { return contract().mode === 'managed'; }

/**
 * Effective settings: the contract with the admin's choices applied where the
 * contract allows them.
 * @returns {Promise<{mode,channel,manifestUrl,maintenanceWindow,managed}>}
 */
async function getSelfUpdateSettings() {
  const base = contract();
  const managed = base.mode === 'managed';
  const effective = {
    // Contract-only: whether the module exists here is not a setting an
    // instance admin can flip.
    enabled:           base.enabled,
    mode:              base.mode,
    channel:           base.channel,
    manifestUrl:       base.manifestUrl,
    // Not admin-editable: whether a security fix may interrupt trading hours is
    // a contract term, agreed at provisioning, not a checkbox in a settings card.
    allowCriticalOutsideWindow: base.allowCriticalOutsideWindow,
    maintenanceWindow: { ...base.maintenanceWindow, days: [...base.maintenanceWindow.days] },
    // Surfaced so callers never have to re-derive "is this instance ours?".
    managed,
  };
  if (managed) return effective;

  const stored = await Setting.getMany(Object.values(KEYS)).catch(() => ({}));

  const mode = stored[KEYS.mode];
  if (ADMIN_MODES.includes(mode)) effective.mode = mode;

  const channel = stored[KEYS.channel];
  if (CHANNELS.includes(channel)) effective.channel = channel;

  const win = stored[KEYS.window];
  if (win && typeof win === 'object' && !Array.isArray(win)) {
    // Shape was validated on write (adminUpdatesRoutes); re-check the pieces we
    // are about to do arithmetic with, because a hand-edited row is possible.
    const days = Array.isArray(win.days) ? win.days.filter(d => typeof d === 'string') : null;
    if (days && days.length) effective.maintenanceWindow.days = days;
    if (Number.isInteger(win.fromHour) && win.fromHour >= 0 && win.fromHour <= 23) {
      effective.maintenanceWindow.fromHour = win.fromHour;
    }
    if (Number.isInteger(win.toHour) && win.toHour >= 0 && win.toHour <= 23) {
      effective.maintenanceWindow.toHour = win.toHour;
    }
    if (typeof win.tz === 'string' && win.tz) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: win.tz });
        effective.maintenanceWindow.tz = win.tz;
      } catch { /* keep the contract's zone */ }
    }
  }
  return effective;
}

/** The manifest URL for a channel — `{channel}` is the only placeholder. */
function manifestUrlFor(settings) {
  return settings.manifestUrl.replace(/\{channel\}/g, settings.channel);
}

/** May this instance apply an update at all? `managed` means no controls. */
function canApply(mode) { return mode === 'manual' || mode === 'auto'; }

/** Does this instance schedule its own updates? */
function isAuto(mode) { return mode === 'auto'; }

module.exports = {
  MODES, ADMIN_MODES, CHANNELS, KEYS,
  getSelfUpdateSettings, manifestUrlFor, canApply, isAuto, isManaged, isEnabled, contract,
};
