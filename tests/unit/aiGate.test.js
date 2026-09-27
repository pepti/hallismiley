'use strict';

// server/services/aiGate.js — the process-wide cap on concurrent paid AI calls
// (harvest2, ported from icelandicstore #218 visionGate): slot accounting, the
// AI_MAX_CONCURRENT override, the refuse-now path (withSlot → AiBusyError, a
// 429) and the queued path the translator's parallel batches use.
const aiGate = require('../../server/services/aiGate');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setImmediate(r));

describe('aiGate', () => {
  const OLD = process.env.AI_MAX_CONCURRENT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.AI_MAX_CONCURRENT; else process.env.AI_MAX_CONCURRENT = OLD;
    aiGate._reset();
  });

  test('up to the default cap, then no slot; release frees one', () => {
    delete process.env.AI_MAX_CONCURRENT;
    for (let i = 0; i < aiGate.DEFAULT_MAX_CONCURRENT; i++) expect(aiGate.tryAcquire()).toBe(true);
    expect(aiGate.tryAcquire()).toBe(false);
    expect(aiGate.inFlight()).toBe(aiGate.DEFAULT_MAX_CONCURRENT);
    aiGate.release();
    expect(aiGate.tryAcquire()).toBe(true);
  });

  test('release never drives the counter negative', () => {
    aiGate.release();
    expect(aiGate.inFlight()).toBe(0);
  });

  test('AI_MAX_CONCURRENT overrides the cap; junk falls back to the default', () => {
    process.env.AI_MAX_CONCURRENT = '1';
    expect(aiGate.maxConcurrent()).toBe(1);
    process.env.AI_MAX_CONCURRENT = 'lots';
    expect(aiGate.maxConcurrent()).toBe(aiGate.DEFAULT_MAX_CONCURRENT);
    process.env.AI_MAX_CONCURRENT = '0';
    expect(aiGate.maxConcurrent()).toBe(aiGate.DEFAULT_MAX_CONCURRENT);
  });

  test('withSlot over the cap throws a typed 429 with Retry-After, and runs nothing', async () => {
    process.env.AI_MAX_CONCURRENT = '1';
    const first = deferred();
    const running = aiGate.withSlot(() => first.promise);
    const fn = jest.fn();
    const err = await aiGate.withSlot(fn).catch((e) => e);
    expect(err).toBeInstanceOf(aiGate.AiBusyError);
    expect(err).toMatchObject({ status: 429, reason: 'AI_BUSY', messageKey: 'errors.ai.busy' });
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(fn).not.toHaveBeenCalled();
    first.resolve('done');
    await expect(running).resolves.toBe('done');
    expect(aiGate.inFlight()).toBe(0);
  });

  test('a failing call still releases its slot', async () => {
    process.env.AI_MAX_CONCURRENT = '1';
    await expect(aiGate.withSlot(async () => { throw new Error('model down'); })).rejects.toThrow('model down');
    expect(aiGate.inFlight()).toBe(0);
    await expect(aiGate.withSlot(async () => 'ok')).resolves.toBe('ok');
  });

  test('withQueuedSlot waits for a slot and hands it over FIFO; never more than the cap run at once', async () => {
    process.env.AI_MAX_CONCURRENT = '2';
    let running = 0, peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    const order = [];
    const calls = gates.map((g, i) => aiGate.withQueuedSlot(async () => {
      running += 1; peak = Math.max(peak, running); order.push(i);
      try { return await g.promise; } finally { running -= 1; }
    }, { waitMs: 5000 }));
    await tick();
    expect(order).toEqual([0, 1]);
    expect(aiGate.queued()).toBe(3);
    for (const g of gates) { g.resolve('x'); await tick(); await tick(); }
    await Promise.all(calls);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(aiGate.inFlight()).toBe(0);
    expect(aiGate.queued()).toBe(0);
  });

  test('withQueuedSlot gives up with AiBusyError after waitMs, and leaves the queue clean', async () => {
    process.env.AI_MAX_CONCURRENT = '1';
    const hold = deferred();
    const holder = aiGate.withSlot(() => hold.promise);
    const fn = jest.fn();
    await expect(aiGate.withQueuedSlot(fn, { waitMs: 20 })).rejects.toBeInstanceOf(aiGate.AiBusyError);
    expect(fn).not.toHaveBeenCalled();
    expect(aiGate.queued()).toBe(0);
    hold.resolve();
    await holder;
    expect(aiGate.inFlight()).toBe(0);
  });
});
