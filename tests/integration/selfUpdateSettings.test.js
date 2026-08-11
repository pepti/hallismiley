// The instance contract vs. the instance's own admin.
//
// The rule under test is commercial as much as technical: an instance
// provisioned `managed` is one Orange Smiley updates on the customer's behalf.
// If its admin could write a settings row and promote themselves out of that,
// the arrangement the customer bought would be unilaterally cancellable from
// inside the product — and the fleet would silently stop being a fleet.
const db = require('../../server/config/database');
const Setting = require('../../server/models/Setting');

const KEYS = {
  mode:    'selfupdate.mode',
  channel: 'selfupdate.channel',
  window:  'selfupdate.maintenance_window',
};

/**
 * Load selfUpdateSettings against a given instance contract. clientConfig reads
 * the environment at require time, so the module registry has to be reset —
 * which is also the honest simulation: a contract change is a redeploy.
 */
function withContract(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  let mod;
  jest.isolateModules(() => { mod = require('../../server/services/selfUpdateSettings'); });
  return Promise.resolve(fn(mod)).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

const MANAGED = { CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE: 'managed' };
const MANUAL  = { CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE: 'manual' };

beforeEach(async () => {
  await db.query('DELETE FROM app_settings WHERE key LIKE $1', ['selfupdate.%']);
});

describe('a managed instance ignores its own admin', () => {
  test('a stored mode cannot promote a managed instance', async () => {
    await Setting.set(KEYS.mode, 'auto');
    await withContract(MANAGED, async (m) => {
      const s = await m.getSelfUpdateSettings();
      expect(s.mode).toBe('managed');
      expect(s.managed).toBe(true);
    });
  });

  test('a stored channel cannot move a managed instance onto canary', async () => {
    await Setting.set(KEYS.channel, 'canary');
    await withContract(MANAGED, async (m) => {
      expect((await m.getSelfUpdateSettings()).channel).toBe('stable');
    });
  });

  test('a stored window cannot change a managed instance', async () => {
    await Setting.set(KEYS.window, { days: ['sat'], fromHour: 1, toHour: 2, tz: 'UTC' });
    await withContract(MANAGED, async (m) => {
      expect((await m.getSelfUpdateSettings()).maintenanceWindow)
        .toEqual({ days: ['tue', 'wed', 'thu'], fromHour: 3, toHour: 5, tz: 'Atlantic/Reykjavik' });
    });
  });
});

describe('a self-managed instance honours its admin', () => {
  test('with nothing stored it falls back to the contract', async () => {
    await withContract(MANUAL, async (m) => {
      const s = await m.getSelfUpdateSettings();
      expect(s).toMatchObject({ mode: 'manual', channel: 'stable', managed: false });
    });
  });

  test('the admin may switch between auto and manual', async () => {
    await Setting.set(KEYS.mode, 'auto');
    await withContract(MANUAL, async (m) => {
      expect((await m.getSelfUpdateSettings()).mode).toBe('auto');
    });
  });

  test('the admin may NOT put the instance into managed — that is the operator\'s call', async () => {
    await Setting.set(KEYS.mode, 'managed');
    await withContract(MANUAL, async (m) => {
      expect((await m.getSelfUpdateSettings()).mode).toBe('manual');
    });
  });

  test('a nonsense stored mode is ignored rather than obeyed', async () => {
    await Setting.set(KEYS.mode, 'yolo');
    await withContract(MANUAL, async (m) => {
      expect((await m.getSelfUpdateSettings()).mode).toBe('manual');
    });
  });

  test('the admin may choose a channel', async () => {
    await Setting.set(KEYS.channel, 'canary');
    await withContract(MANUAL, async (m) => {
      expect((await m.getSelfUpdateSettings()).channel).toBe('canary');
    });
  });

  test('the admin may edit the maintenance window', async () => {
    await Setting.set(KEYS.window, { days: ['sat', 'sun'], fromHour: 1, toHour: 4, tz: 'Europe/London' });
    await withContract(MANUAL, async (m) => {
      expect((await m.getSelfUpdateSettings()).maintenanceWindow)
        .toEqual({ days: ['sat', 'sun'], fromHour: 1, toHour: 4, tz: 'Europe/London' });
    });
  });

  test('a hand-edited row with junk fields keeps the contract for those fields', async () => {
    await Setting.set(KEYS.window, { days: [], fromHour: 99, toHour: 4, tz: 'Mars/Olympus' });
    await withContract(MANUAL, async (m) => {
      expect((await m.getSelfUpdateSettings()).maintenanceWindow)
        .toEqual({ days: ['tue', 'wed', 'thu'], fromHour: 3, toHour: 4, tz: 'Atlantic/Reykjavik' });
    });
  });

  test('whether a security fix may interrupt trading hours stays a contract term', async () => {
    // Not admin-editable by design: there is deliberately no settings key for it.
    await withContract(MANUAL, async (m) => {
      expect((await m.getSelfUpdateSettings()).allowCriticalOutsideWindow).toBe(true);
    });
    await withContract(
      { ...MANUAL, CLIENT_CONFIG_MODULES_SELF_UPDATE_ALLOW_CRITICAL_OUTSIDE_WINDOW: 'false' },
      async (m) => {
        expect((await m.getSelfUpdateSettings()).allowCriticalOutsideWindow).toBe(false);
      }
    );
  });
});

describe('manifestUrlFor', () => {
  test('substitutes every occurrence of the channel placeholder', async () => {
    await withContract(MANUAL, (m) => {
      expect(m.manifestUrlFor({ manifestUrl: 'https://h/{channel}/{channel}.json', channel: 'canary' }))
        .toBe('https://h/canary/canary.json');
    });
  });
});

describe('policy helpers', () => {
  test('managed instances have no apply path at all', async () => {
    await withContract(MANAGED, (m) => {
      expect(m.canApply('managed')).toBe(false);
      expect(m.canApply('manual')).toBe(true);
      expect(m.canApply('auto')).toBe(true);
      expect(m.isAuto('auto')).toBe(true);
      expect(m.isAuto('manual')).toBe(false);
    });
  });
});
