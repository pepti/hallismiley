// The apply/verify state machine (real Postgres).
//
// available ──apply──► applying ──verify: version matches──► applied
//      │                   │
//      │                   └──grace expired, version unchanged──► failed ──► rollback
//      ▼
// scheduled ──window opens──► applying
//
// The deployment trigger is stubbed throughout: what is under test is that this
// app records the right things in the right ORDER, not that Azure pulls images.
const db = require('../../server/config/database');
const SystemUpdate = require('../../server/models/SystemUpdate');
const {
  applyUpdate, rollbackUpdate, verifyPendingUpdate, runDueScheduled,
  runningImageDigest, fireTrigger,
  UpdateNotPermittedError, UpdateStateError, TriggerNotConfiguredError,
} = require('../../server/services/updateApplier');

const DIGEST_NEW = 'sha256:' + '1'.repeat(64);
const DIGEST_OLD = 'sha256:' + '0'.repeat(64);
const RUNNING = { version: '1.4.0', gitSha: 'abc', builtAt: null, channel: 'stable' };
const NEXT    = { version: '1.4.2', gitSha: 'def', builtAt: null, channel: 'stable' };

const settings = (over = {}) => ({
  mode: 'manual', channel: 'stable',
  manifestUrl: 'https://releases.orangesmiley.is/store/{channel}.json',
  allowCriticalOutsideWindow: true,
  maintenanceWindow: { days: ['tue'], fromHour: 3, toHour: 5, tz: 'Atlantic/Reykjavik' },
  managed: false, ...over,
});

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** A trigger that always accepts, and remembers what it was told. */
function okTrigger() {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 202 };
  };
  impl.calls = calls;
  return impl;
}
const failTrigger = async () => ({ ok: false, status: 500 });

async function seedAvailable(over = {}) {
  return SystemUpdate.recordAvailable({
    version: '1.4.2', imageDigest: DIGEST_NEW, channel: 'stable',
    changelogMd: '- things', detail: { publishedAt: '2026-08-09T00:00:00.000Z', critical: false, compatible: true },
    ...over,
  });
}

let savedTriggerUrl;
beforeEach(async () => {
  await db.query('TRUNCATE TABLE system_updates RESTART IDENTITY');
  savedTriggerUrl = process.env.SELF_UPDATE_TRIGGER_URL;
  process.env.SELF_UPDATE_TRIGGER_URL = 'https://deploy.example.com/hook?token=x';
  delete process.env.RUNNING_IMAGE_DIGEST;
  delete process.env.DOCKER_CUSTOM_IMAGE_NAME;
});
afterEach(() => {
  if (savedTriggerUrl === undefined) delete process.env.SELF_UPDATE_TRIGGER_URL;
  else process.env.SELF_UPDATE_TRIGGER_URL = savedTriggerUrl;
});

describe('applyUpdate — the happy path', () => {
  test('moves the row to applying and tells the platform which digest to pull', async () => {
    const update = await seedAvailable();
    const trigger = okTrigger();

    const row = await applyUpdate(update.id, { settings: settings(), fetchImpl: trigger, log: silent });

    expect(row.status).toBe('applying');
    expect(trigger.calls).toHaveLength(1);
    expect(trigger.calls[0].body).toMatchObject({
      updateId: update.id, version: '1.4.2', imageDigest: DIGEST_NEW, channel: 'stable', reason: 'manual',
    });
  });

  test('records who triggered it and from which version', async () => {
    const update = await seedAvailable();
    const row = await applyUpdate(update.id, {
      settings: settings(), fetchImpl: okTrigger(), log: silent,
      actor: { id: 7, username: 'halli' },
    });
    expect(row.detail.triggeredBy).toEqual({ id: 7, username: 'halli' });
    expect(row.detail.triggeredFromVersion).toBe('dev');   // the test process is an unstamped build
    expect(row.detail.triggeredAt).toEqual(expect.any(String));
  });

  test('captures the previous digest BEFORE the swap — it is unrecoverable after', async () => {
    process.env.RUNNING_IMAGE_DIGEST = DIGEST_OLD;
    const update = await seedAvailable();
    const row = await applyUpdate(update.id, { settings: settings(), fetchImpl: okTrigger(), log: silent });
    expect(row.previous_digest).toBe(DIGEST_OLD);
  });

  test('a scheduled update can be applied immediately too ("update now instead")', async () => {
    const update = await seedAvailable();
    await SystemUpdate.markScheduled(update.id, '2026-08-11T03:00:00.000Z');
    const row = await applyUpdate(update.id, { settings: settings({ mode: 'auto' }), fetchImpl: okTrigger(), log: silent });
    expect(row.status).toBe('applying');
  });
});

describe('applyUpdate — refusals', () => {
  test('a managed instance is refused, with a 403 the route can forward', async () => {
    const update = await seedAvailable();
    await expect(applyUpdate(update.id, { settings: settings({ mode: 'managed' }), fetchImpl: okTrigger(), log: silent }))
      .rejects.toMatchObject({ name: 'UpdateNotPermittedError', status: 403 });
    expect((await SystemUpdate.findById(update.id)).status).toBe('available');
  });

  test('an unknown id is a 409, not a crash', async () => {
    await expect(applyUpdate(99999, { settings: settings(), fetchImpl: okTrigger(), log: silent }))
      .rejects.toBeInstanceOf(UpdateStateError);
  });

  test('an already-applied update cannot be applied again', async () => {
    const update = await seedAvailable();
    await SystemUpdate.markApplying(update.id, DIGEST_OLD);
    await SystemUpdate.markApplied(update.id);
    await expect(applyUpdate(update.id, { settings: settings(), fetchImpl: okTrigger(), log: silent }))
      .rejects.toThrow(/applied and cannot be applied again/);
  });

  test('an update that needs an intermediate release is refused', async () => {
    const update = await seedAvailable({ detail: { compatible: false, minCompatibleVersion: '1.5.0' } });
    await expect(applyUpdate(update.id, { settings: settings(), fetchImpl: okTrigger(), log: silent }))
      .rejects.toThrow(/requires at least 1\.5\.0/);
  });

  test('a second concurrent apply does not fire a second deployment', async () => {
    const update = await seedAvailable();
    const trigger = okTrigger();
    const results = await Promise.allSettled([
      applyUpdate(update.id, { settings: settings(), fetchImpl: trigger, log: silent }),
      applyUpdate(update.id, { settings: settings(), fetchImpl: trigger, log: silent }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(trigger.calls).toHaveLength(1);
  });
});

describe('applyUpdate — the trigger itself failing', () => {
  test('a rejected trigger fails the row immediately rather than leaving it in flight', async () => {
    const update = await seedAvailable();
    await expect(applyUpdate(update.id, { settings: settings(), fetchImpl: failTrigger, log: silent }))
      .rejects.toThrow(/HTTP 500/);
    const row = await SystemUpdate.findById(update.id);
    expect(row.status).toBe('failed');
    expect(row.detail.stage).toBe('trigger');
    expect(row.detail.failureReason).toContain('HTTP 500');
  });

  test('an unconfigured trigger URL is a 503, and the row is not left applying', async () => {
    delete process.env.SELF_UPDATE_TRIGGER_URL;
    const update = await seedAvailable();
    await expect(applyUpdate(update.id, { settings: settings(), fetchImpl: okTrigger(), log: silent }))
      .rejects.toBeInstanceOf(TriggerNotConfiguredError);
    expect((await SystemUpdate.findById(update.id)).status).toBe('failed');
  });

  test('a plaintext trigger URL is refused — the hook carries a credential', async () => {
    process.env.SELF_UPDATE_TRIGGER_URL = 'http://deploy.example.com/hook?token=x';
    await expect(fireTrigger({}, { fetchImpl: okTrigger(), log: silent })).rejects.toThrow(/must use https/);
  });

  test('an https hook with credentials in the URL IS allowed — App Service works that way', async () => {
    process.env.SELF_UPDATE_TRIGGER_URL = 'https://user:pass@site.scm.azurewebsites.net/docker/hook';
    const trigger = okTrigger();
    await expect(fireTrigger({ ok: 1 }, { fetchImpl: trigger, log: silent })).resolves.toMatchObject({ status: 202 });
    expect(trigger.calls[0].url).toContain('site.scm.azurewebsites.net');
  });
});

describe('runningImageDigest', () => {
  test('prefers an explicitly injected digest', async () => {
    process.env.RUNNING_IMAGE_DIGEST = DIGEST_OLD;
    expect(await runningImageDigest()).toBe(DIGEST_OLD);
  });

  test('parses one out of the App Service image reference', async () => {
    process.env.DOCKER_CUSTOM_IMAGE_NAME = `acr.azurecr.io/orangesmiley@${DIGEST_OLD}`;
    expect(await runningImageDigest()).toBe(DIGEST_OLD);
  });

  test('ignores a tag-only image reference — a tag is not a digest', async () => {
    process.env.DOCKER_CUSTOM_IMAGE_NAME = 'acr.azurecr.io/orangesmiley:latest';
    expect(await runningImageDigest()).toBeNull();
  });

  test('falls back to the last applied release', async () => {
    const prior = await SystemUpdate.recordAvailable({ version: '1.3.0', imageDigest: DIGEST_OLD, channel: 'stable' });
    await SystemUpdate.markApplying(prior.id, null);
    await SystemUpdate.markApplied(prior.id);
    expect(await runningImageDigest()).toBe(DIGEST_OLD);
  });

  test('null when nothing knows — a rollback then has to be expressed by version', async () => {
    expect(await runningImageDigest()).toBeNull();
  });
});

describe('post-boot verification', () => {
  const applying = async () => {
    const update = await seedAvailable();
    await SystemUpdate.markApplying(update.id, DIGEST_OLD);
    return update;
  };

  test('nothing pending is not an event', async () => {
    expect(await verifyPendingUpdate({ log: silent })).toEqual({ outcome: 'nothing-pending' });
  });

  test('the running version matching the target means it landed', async () => {
    const update = await applying();
    const res = await verifyPendingUpdate({ build: NEXT, log: silent });
    expect(res.outcome).toBe('applied');
    const row = await SystemUpdate.findById(update.id);
    expect(row.status).toBe('applied');
    expect(row.applied_at).not.toBeNull();
  });

  test('inside the grace period, an unchanged version is patience, not failure', async () => {
    await applying();
    const res = await verifyPendingUpdate({ build: RUNNING, now: new Date(Date.now() + 60_000), log: silent });
    expect(res.outcome).toBe('still-waiting');
    expect(res.update.status).toBe('applying');
  });

  test('past the grace period, an unchanged version is a failure with the reason recorded', async () => {
    const update = await applying();
    const res = await verifyPendingUpdate({
      build: RUNNING, now: new Date(Date.now() + 30 * 60_000), log: silent,
    });
    expect(res.outcome).toBe('failed');
    const row = await SystemUpdate.findById(update.id);
    expect(row.status).toBe('failed');
    expect(row.detail.failureReason).toMatch(/still running 1\.4\.0/);
    expect(row.detail.observedVersion).toBe('1.4.0');
    expect(row.previous_digest).toBe(DIGEST_OLD);   // still there for the rollback
  });

  test('verification is idempotent — a second boot does not re-decide', async () => {
    const update = await applying();
    await verifyPendingUpdate({ build: NEXT, log: silent });
    const again = await verifyPendingUpdate({ build: NEXT, log: silent });
    expect(again.outcome).toBe('nothing-pending');
    expect((await SystemUpdate.findById(update.id)).status).toBe('applied');
  });
});

describe('rollback — assisted, and honest about it', () => {
  const failed = async (previousDigest = DIGEST_OLD) => {
    const update = await seedAvailable();
    await SystemUpdate.markApplying(update.id, previousDigest);
    await SystemUpdate.markFailed(update.id, 'did not land');
    return update;
  };

  test('re-triggers the deployment pinned to the previous digest', async () => {
    const update = await failed();
    const trigger = okTrigger();
    const res = await rollbackUpdate(update.id, { settings: settings(), fetchImpl: trigger, log: silent });

    expect(res.triggered).toBe(true);
    expect(trigger.calls[0].body).toMatchObject({ imageDigest: DIGEST_OLD, rollback: true, reason: 'rollback' });
    expect(res.update.detail.rollbackTriggered).toBe(true);
  });

  test('with no previous digest it hands over the operator command instead of pretending', async () => {
    const update = await failed(null);
    const trigger = okTrigger();
    const res = await rollbackUpdate(update.id, { settings: settings(), fetchImpl: trigger, log: silent });

    expect(res.triggered).toBe(false);
    expect(trigger.calls).toHaveLength(0);
    expect(res.command).toContain('Redeploy the release that preceded 1.4.2');
  });

  test('a failing rollback trigger reports the failure and still shows the command', async () => {
    const update = await failed();
    const res = await rollbackUpdate(update.id, { settings: settings(), fetchImpl: failTrigger, log: silent });
    expect(res.triggered).toBe(false);
    expect(res.error).toContain('HTTP 500');
    expect(res.command).toContain(DIGEST_OLD);
    expect(res.update.detail.rollbackError).toContain('HTTP 500');
  });

  test('an applied update can also be rolled back — "it booted and it is wrong"', async () => {
    const update = await seedAvailable();
    await SystemUpdate.markApplying(update.id, DIGEST_OLD);
    await SystemUpdate.markApplied(update.id);
    const res = await rollbackUpdate(update.id, { settings: settings(), fetchImpl: okTrigger(), log: silent });
    expect(res.triggered).toBe(true);
  });

  test('an update that never ran cannot be rolled back', async () => {
    const update = await seedAvailable();
    await expect(rollbackUpdate(update.id, { settings: settings(), fetchImpl: okTrigger(), log: silent }))
      .rejects.toThrow(/Only an applied or failed update/);
  });

  test('a managed instance has no rollback either', async () => {
    const update = await failed();
    await expect(rollbackUpdate(update.id, { settings: settings({ mode: 'managed' }), fetchImpl: okTrigger(), log: silent }))
      .rejects.toBeInstanceOf(UpdateNotPermittedError);
  });
});

describe('runDueScheduled — auto mode firing its own window', () => {
  const scheduledAt = async (iso) => {
    const update = await seedAvailable();
    await SystemUpdate.markScheduled(update.id, iso);
    return update;
  };

  test('fires when the slot has arrived', async () => {
    const update = await scheduledAt('2026-08-11T03:00:00.000Z');
    const trigger = okTrigger();
    const res = await runDueScheduled({
      settings: settings({ mode: 'auto' }), now: new Date('2026-08-11T03:00:01Z'), fetchImpl: trigger, log: silent,
    });
    expect(res.fired).toHaveLength(1);
    expect((await SystemUpdate.findById(update.id)).status).toBe('applying');
    expect(trigger.calls).toHaveLength(1);
  });

  test('does nothing before the slot', async () => {
    await scheduledAt('2026-08-11T03:00:00.000Z');
    const trigger = okTrigger();
    const res = await runDueScheduled({
      settings: settings({ mode: 'auto' }), now: new Date('2026-08-11T02:59:00Z'), fetchImpl: trigger, log: silent,
    });
    expect(res.fired).toEqual([]);
    expect(trigger.calls).toHaveLength(0);
  });

  test('manual mode never fires on its own, even for a scheduled row', async () => {
    await scheduledAt('2026-08-11T03:00:00.000Z');
    const trigger = okTrigger();
    const res = await runDueScheduled({
      settings: settings({ mode: 'manual' }), now: new Date('2026-08-12T00:00:00Z'), fetchImpl: trigger, log: silent,
    });
    expect(res.fired).toEqual([]);
    expect(trigger.calls).toHaveLength(0);
  });

  test('a failing trigger is reported, not thrown at the scheduler loop', async () => {
    await scheduledAt('2026-08-11T03:00:00.000Z');
    const res = await runDueScheduled({
      settings: settings({ mode: 'auto' }), now: new Date('2026-08-12T00:00:00Z'), fetchImpl: failTrigger, log: silent,
    });
    expect(res.fired).toEqual([]);
    expect(res.error).toContain('HTTP 500');
  });
});
