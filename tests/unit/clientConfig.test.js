const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  resolveConfig,
  loadFileConfig,
  secretShapedPaths,
  envNameFor,
  deepFreeze,
  SCHEMA,
  CONFIG_FILE,
  defaults,
} = require('../../server/config/clientConfig');

const selfUpdate = cfg => cfg.modules.selfUpdate;

/** Resolve with no env at all, so process.env can never leak into a case. */
const resolve = (fileConfig = {}, env = {}) => resolveConfig({ fileConfig, env });

describe('clientConfig — defaults', () => {
  test('a missing file yields the safe defaults', () => {
    const { config, warnings } = resolve({});
    expect(selfUpdate(config)).toEqual({
      // The base ships the module OFF — instances flip it on in config/client.json.
      enabled: false,
      mode: 'managed',
      channel: 'stable',
      manifestUrl: 'https://releases.orangesmiley.is/store/{channel}.json',
      allowCriticalOutsideWindow: true,
      maintenanceWindow: {
        days: ['tue', 'wed', 'thu'],
        fromHour: 3,
        toHour: 5,
        tz: 'Atlantic/Reykjavik',
      },
    });
    expect(warnings).toEqual([]);
  });

  test('the safe default mode is managed — an unconfigured instance never self-applies', () => {
    expect(selfUpdate(resolve({}).config).mode).toBe('managed');
  });

  test('each resolution gets its own arrays — no shared mutable default state', () => {
    const a = resolve({}).config;
    const b = resolve({}).config;
    expect(a.modules.selfUpdate.maintenanceWindow.days)
      .not.toBe(b.modules.selfUpdate.maintenanceWindow.days);
    expect(defaults().modules.selfUpdate.maintenanceWindow.days)
      .not.toBe(SCHEMA.modules.selfUpdate.maintenanceWindow.days.default);
  });
});

describe('clientConfig — precedence (defaults < file < env)', () => {
  test('the file overrides defaults', () => {
    const { config } = resolve({ modules: { selfUpdate: { mode: 'manual' } } });
    expect(selfUpdate(config).mode).toBe('manual');
    expect(selfUpdate(config).channel).toBe('stable'); // untouched key keeps its default
  });

  test('env overrides the file', () => {
    const { config } = resolve(
      { modules: { selfUpdate: { mode: 'manual', channel: 'stable' } } },
      { CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE: 'auto' }
    );
    expect(selfUpdate(config).mode).toBe('auto');
    expect(selfUpdate(config).channel).toBe('stable');
  });

  test('env overrides a default with no file present', () => {
    const { config } = resolve({}, { CLIENT_CONFIG_MODULES_SELF_UPDATE_CHANNEL: 'canary' });
    expect(selfUpdate(config).channel).toBe('canary');
  });

  test('all three layers compose in one resolution', () => {
    const { config } = resolve(
      {
        modules: {
          selfUpdate: {
            mode: 'manual',
            maintenanceWindow: { fromHour: 1, toHour: 2 },
          },
        },
      },
      {
        CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE: 'auto',
        CLIENT_CONFIG_MODULES_SELF_UPDATE_MAINTENANCE_WINDOW_TZ: 'Europe/London',
      }
    );
    expect(selfUpdate(config)).toMatchObject({
      mode: 'auto',                               // env
      channel: 'stable',                          // default
      maintenanceWindow: {
        days: ['tue', 'wed', 'thu'],              // default
        fromHour: 1,                              // file
        toHour: 2,                                // file
        tz: 'Europe/London',                      // env
      },
    });
  });

  test('an empty env var means "not set", not "empty string"', () => {
    const { config, warnings } = resolve(
      { modules: { selfUpdate: { mode: 'manual' } } },
      { CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE: '' }
    );
    expect(selfUpdate(config).mode).toBe('manual');
    expect(warnings).toEqual([]);
  });
});

describe('clientConfig — env var naming', () => {
  test('camelCase paths become upper snake case with the CLIENT_CONFIG_ prefix', () => {
    expect(envNameFor(['modules', 'selfUpdate', 'mode']))
      .toBe('CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE');
    expect(envNameFor(['modules', 'selfUpdate', 'maintenanceWindow', 'fromHour']))
      .toBe('CLIENT_CONFIG_MODULES_SELF_UPDATE_MAINTENANCE_WINDOW_FROM_HOUR');
  });

  test('no two schema paths collide on one env var name', () => {
    const { warnings } = resolve({});
    expect(warnings.filter(w => w.includes('schema defect'))).toEqual([]);
  });

  test('integers and lists coerce from their string env form', () => {
    const { config, warnings } = resolve({}, {
      CLIENT_CONFIG_MODULES_SELF_UPDATE_MAINTENANCE_WINDOW_FROM_HOUR: '0',
      CLIENT_CONFIG_MODULES_SELF_UPDATE_MAINTENANCE_WINDOW_TO_HOUR: '4',
      CLIENT_CONFIG_MODULES_SELF_UPDATE_MAINTENANCE_WINDOW_DAYS: 'mon, fri',
    });
    const w = selfUpdate(config).maintenanceWindow;
    expect(w.fromHour).toBe(0);
    expect(w.toHour).toBe(4);
    expect(w.days).toEqual(['mon', 'fri']);
    expect(warnings).toEqual([]);
  });

  test('booleans coerce from the usual env spellings', () => {
    const read = v => resolve({}, { CLIENT_CONFIG_MODULES_SELF_UPDATE_ALLOW_CRITICAL_OUTSIDE_WINDOW: v })
      .config.modules.selfUpdate.allowCriticalOutsideWindow;
    expect(read('false')).toBe(false);
    expect(read('0')).toBe(false);
    expect(read('off')).toBe(false);
    expect(read('true')).toBe(true);
    expect(resolve({}, { CLIENT_CONFIG_MODULES_SELF_UPDATE_ALLOW_CRITICAL_OUTSIDE_WINDOW: 'maybe' }).warnings)
      .toEqual([expect.stringContaining('must be a boolean')]);
  });

  test('a list also accepts JSON array syntax', () => {
    const { config } = resolve({}, {
      CLIENT_CONFIG_MODULES_SELF_UPDATE_MAINTENANCE_WINDOW_DAYS: '["sat","sun"]',
    });
    expect(selfUpdate(config).maintenanceWindow.days).toEqual(['sat', 'sun']);
  });

  test('CLIENT_CONFIG_FILE is reserved, not an unknown key', () => {
    const { warnings } = resolve({}, { CLIENT_CONFIG_FILE: '/tmp/whatever.json' });
    expect(warnings).toEqual([]);
  });
});

describe('clientConfig — bad input warns and never crashes', () => {
  test('an unknown file key warns and is dropped', () => {
    const { config, warnings } = resolve({
      modules: { selfUpdate: { mode: 'auto', wharrgarbl: true } },
    });
    expect(selfUpdate(config).mode).toBe('auto');
    expect(selfUpdate(config).wharrgarbl).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining('unknown key "modules.selfUpdate.wharrgarbl"'),
    ]);
  });

  test('an unknown top-level file section warns and is dropped', () => {
    const { config, warnings } = resolve({ someFutureModule: { enabled: true } });
    expect(config.someFutureModule).toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining('unknown key "someFutureModule"')]);
  });

  test('$schema and $comment are ignored silently', () => {
    const { warnings } = resolve({
      $schema: './client.schema.json',
      $comment: 'orangesmiley.is',
      modules: { selfUpdate: { $comment: 'stays managed for now', mode: 'managed' } },
    });
    expect(warnings).toEqual([]);
  });

  test('a value outside the enum warns and keeps the previous value', () => {
    const { config, warnings } = resolve({ modules: { selfUpdate: { mode: 'yolo' } } });
    expect(selfUpdate(config).mode).toBe('managed');
    expect(warnings).toEqual([expect.stringContaining('must be one of managed, auto, manual')]);
  });

  test('a bad env value falls back to the file value, not to the default', () => {
    const { config, warnings } = resolve(
      { modules: { selfUpdate: { mode: 'manual' } } },
      { CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE: 'nope' }
    );
    expect(selfUpdate(config).mode).toBe('manual');
    expect(warnings).toEqual([expect.stringContaining('CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE')]);
  });

  test('a wrong-typed value warns and keeps the default', () => {
    const { config, warnings } = resolve({
      modules: { selfUpdate: { maintenanceWindow: { fromHour: 'three' } } },
    });
    expect(selfUpdate(config).maintenanceWindow.fromHour).toBe(3);
    expect(warnings).toEqual([expect.stringContaining('must be an integer')]);
  });

  test('an out-of-range hour warns and keeps the default', () => {
    const { config, warnings } = resolve({
      modules: { selfUpdate: { maintenanceWindow: { toHour: 24 } } },
    });
    expect(selfUpdate(config).maintenanceWindow.toHour).toBe(5);
    expect(warnings).toEqual([expect.stringContaining('must be <= 23')]);
  });

  test('a non-https manifest URL is rejected — the digest we pull comes from it', () => {
    const { config, warnings } = resolve({
      modules: { selfUpdate: { manifestUrl: 'http://releases.example.is/{channel}.json' } },
    });
    expect(selfUpdate(config).manifestUrl).toBe('https://releases.orangesmiley.is/store/{channel}.json');
    expect(warnings).toEqual([expect.stringContaining('must use https')]);
  });

  test('a garbage manifest URL is rejected', () => {
    const { warnings } = resolve({ modules: { selfUpdate: { manifestUrl: 'not a url' } } });
    expect(warnings).toEqual([expect.stringContaining('is not a valid URL')]);
  });

  test('an https manifest URL with the {channel} placeholder is accepted', () => {
    const url = 'https://releases.orangesmiley.is/erp/{channel}.json';
    const { config, warnings } = resolve({ modules: { selfUpdate: { manifestUrl: url } } });
    expect(selfUpdate(config).manifestUrl).toBe(url);
    expect(warnings).toEqual([]);
  });

  test('an unrecognised time zone warns and keeps the default', () => {
    const { config, warnings } = resolve({
      modules: { selfUpdate: { maintenanceWindow: { tz: 'Atlantic/Nowhere' } } },
    });
    expect(selfUpdate(config).maintenanceWindow.tz).toBe('Atlantic/Reykjavik');
    expect(warnings).toEqual([expect.stringContaining('not a recognised IANA time zone')]);
  });

  test('an unknown CLIENT_CONFIG_ env var warns — typos do not fail silently', () => {
    const { warnings } = resolve({}, { CLIENT_CONFIG_MODULES_SELFUPDATE_MODE: 'auto' });
    expect(warnings).toEqual([
      expect.stringContaining('CLIENT_CONFIG_MODULES_SELFUPDATE_MODE does not match any config key'),
    ]);
  });

  test('non-CLIENT_CONFIG_ env vars are left entirely alone', () => {
    const { warnings } = resolve({}, { DATABASE_URL: 'postgres://x', NODE_ENV: 'test' });
    expect(warnings).toEqual([]);
  });

  test('a non-object file body warns instead of crashing', () => {
    const { config, warnings } = resolve(['nope']);
    expect(selfUpdate(config).mode).toBe('managed');
    expect(warnings).toEqual([expect.stringContaining('top level is not an object')]);
  });

  test('a zero-length maintenance window warns', () => {
    const { warnings } = resolve({
      modules: { selfUpdate: { maintenanceWindow: { fromHour: 3, toHour: 3 } } },
    });
    expect(warnings).toEqual([expect.stringContaining('zero-length')]);
  });

  test('an empty day list warns', () => {
    const { warnings } = resolve({
      modules: { selfUpdate: { maintenanceWindow: { days: [] } } },
    });
    expect(warnings).toEqual([expect.stringContaining('days is empty')]);
  });

  test('a day outside the week warns and keeps the default', () => {
    const { config, warnings } = resolve({
      modules: { selfUpdate: { maintenanceWindow: { days: ['tue', 'funday'] } } },
    });
    expect(selfUpdate(config).maintenanceWindow.days).toEqual(['tue', 'wed', 'thu']);
    expect(warnings).toEqual([expect.stringContaining('got funday')]);
  });
});

describe('clientConfig — file loading', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clientconfig-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text, 'utf8');
    return file;
  };

  test('reads and parses a well-formed file', () => {
    const file = write('good.json', JSON.stringify({ modules: { selfUpdate: { mode: 'manual' } } }));
    const { fileConfig, source, problems } = loadFileConfig(file);
    expect(fileConfig).toEqual({ modules: { selfUpdate: { mode: 'manual' } } });
    expect(source).toBe(file);
    expect(problems).toEqual([]);
  });

  test('a missing file is not a problem — it is the normal fresh-instance case', () => {
    const { fileConfig, source, problems } = loadFileConfig(path.join(dir, 'absent.json'));
    expect(fileConfig).toEqual({});
    expect(source).toBe('defaults');
    expect(problems).toEqual([]);
  });

  test('malformed JSON reports a problem and falls back to defaults instead of crashing', () => {
    const file = write('broken.json', '{ "modules": { ');
    const { fileConfig, problems } = loadFileConfig(file);
    expect(fileConfig).toEqual({});
    expect(problems).toEqual([expect.stringContaining('is not valid JSON')]);
    expect(selfUpdate(resolve(fileConfig).config).mode).toBe('managed');
  });
});

describe('clientConfig — singleton', () => {
  test('the BASE has no committed config/client.json — the module stays dormant', () => {
    // Deliberate: client.json is per-instance (the factory writes it at
    // provisioning). The engine itself must build, boot and test green with
    // the whole module switched off.
    expect(require('fs').existsSync(CONFIG_FILE)).toBe(false);
    const { fileConfig, problems } = loadFileConfig(CONFIG_FILE);
    expect(problems).toEqual([]);
    expect(fileConfig).toEqual({});
  });

  test('the exported config is deep-frozen', () => {
    // Re-require rather than reuse the top import, so the freeze is asserted on
    // the singleton the app actually consumes.
    const { clientConfig } = require('../../server/config/clientConfig');
    expect(Object.isFrozen(clientConfig)).toBe(true);
    expect(Object.isFrozen(clientConfig.modules.selfUpdate)).toBe(true);
    expect(Object.isFrozen(clientConfig.modules.selfUpdate.maintenanceWindow)).toBe(true);
    expect(Object.isFrozen(clientConfig.modules.selfUpdate.maintenanceWindow.days)).toBe(true);
    expect(() => { clientConfig.modules.selfUpdate.mode = 'auto'; }).toThrow(TypeError);
    expect(clientConfig.modules.selfUpdate.mode).toBe('managed');
  });

  test('requiring it twice returns the same frozen object', () => {
    expect(require('../../server/config/clientConfig').clientConfig)
      .toBe(require('../../server/config/clientConfig').clientConfig);
  });

  test('deepFreeze tolerates primitives and nulls', () => {
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(7)).toBe(7);
  });
});

describe('clientConfig — boot log', () => {
  const fakeLogger = () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
  });

  test('logs the resolved config once, with its source', () => {
    const { logResolvedConfig, clientConfig } = require('../../server/config/clientConfig');
    const log = fakeLogger();
    logResolvedConfig(log);
    expect(log.info).toHaveBeenCalledTimes(1);
    const [payload, message] = log.info.mock.calls[0];
    expect(message).toContain('resolved instance configuration');
    expect(payload.config).toBe(clientConfig);
    expect(payload.config.modules.selfUpdate.mode).toBe('managed');
    // No client.json in the base — the resolved config's source is the defaults.
    expect(payload.source).toBe('defaults');
  });

  test('this instance boots clean — no warnings, no errors', () => {
    const { logResolvedConfig } = require('../../server/config/clientConfig');
    const log = fakeLogger();
    logResolvedConfig(log);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('clientConfig — no secrets in the schema', () => {
  test('the live schema holds nothing secret-shaped', () => {
    expect(secretShapedPaths()).toEqual([]);
  });

  test('the guard catches a secret-shaped key if one is ever added', () => {
    expect(secretShapedPaths({ modules: { x: { apiToken: { type: 'string', default: '' } } } }))
      .toEqual(['modules.x.apiToken']);
  });
});
