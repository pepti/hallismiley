'use strict';

// The pdf.js worker preload in productImport/parsePdf (ice's salesReport/parsePdf, moved) (see the note there): the
// worker module is loaded by us, once, with a synchronous require, and handed to
// pdf.js through globalThis.pdfjsWorker so pdf.js never runs its own memoised
// `await import('./pdf.worker.mjs')` — which failed under a flagless Jest and,
// because pdf.js caches a rejected load, took every later PDF parse down with it.
const fs = require('fs');
const path = require('path');
const { pdfLines } = require('../fixtures/pdfFixture');

const PARSE_PDF = '../../server/services/productImport/parsePdf';
const REAL_WORKER_PATH = jest.requireActual(PARSE_PDF).WORKER_PATH;

// Load parsePdf in a fresh module registry with the worker module mocked, run
// `fn` against it, and always unmock — an assertion failure inside must not leave
// a throwing worker mock behind for the rest of the file.
async function withMockedWorker(factory, fn) {
  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock(REAL_WORKER_PATH, factory, { virtual: false });
      await fn(require(PARSE_PDF));
    });
  } finally {
    jest.dontMock(REAL_WORKER_PATH);
  }
}

describe('parsePdf — pdf.js worker preload', () => {
  const saved = globalThis.pdfjsWorker;
  afterEach(() => {
    if (saved === undefined) delete globalThis.pdfjsWorker;
    else globalThis.pdfjsWorker = saved;
  });

  test('WORKER_PATH is the worker file shipped beside pdf-parse\'s entry', () => {
    expect(path.basename(REAL_WORKER_PATH)).toBe('pdf.worker.mjs');
    expect(path.dirname(REAL_WORKER_PATH)).toBe(path.dirname(require.resolve('pdf-parse')));
    expect(fs.existsSync(REAL_WORKER_PATH)).toBe(true);
  });

  test('ensurePdfWorker installs WorkerMessageHandler on globalThis, idempotently', () => {
    delete globalThis.pdfjsWorker;
    const { ensurePdfWorker } = require(PARSE_PDF);
    ensurePdfWorker();
    expect(typeof globalThis.pdfjsWorker.WorkerMessageHandler.setup).toBe('function');
    const installed = globalThis.pdfjsWorker;
    ensurePdfWorker();
    expect(globalThis.pdfjsWorker).toBe(installed);
  });

  test('a removed or partial handler is reinstalled by the next call', () => {
    const { ensurePdfWorker } = require(PARSE_PDF);
    ensurePdfWorker();
    delete globalThis.pdfjsWorker;
    ensurePdfWorker();
    expect(typeof globalThis.pdfjsWorker.WorkerMessageHandler.setup).toBe('function');
    // Something without a callable setup would make pdf.js throw inside its own
    // memoised setup — it must not be mistaken for an installed worker.
    globalThis.pdfjsWorker = { WorkerMessageHandler: {} };
    ensurePdfWorker();
    expect(typeof globalThis.pdfjsWorker.WorkerMessageHandler.setup).toBe('function');
  });

  test('a parse installs the handler before pdf.js is constructed, and reads the text', async () => {
    delete globalThis.pdfjsWorker;
    const { parsePdfBuffer } = require(PARSE_PDF);
    const out = await parsePdfBuffer(await pdfLines(['SKU', 'MAG-1']));
    expect(typeof globalThis.pdfjsWorker.WorkerMessageHandler.setup).toBe('function');
    expect([out.headers, ...out.rows].flat()).toEqual(expect.arrayContaining(['SKU', 'MAG-1']));
  });

  // pdf.js consulting globalThis.pdfjsWorker is an internal seam, not a documented
  // option. Prove it is still honoured: a handler whose setup throws must break the
  // parse — if pdf.js had gone back to importing its own worker, this would pass.
  test('pdf.js really uses the preloaded handler (a poisoned one breaks the parse)', async () => {
    await withMockedWorker(
      () => ({ WorkerMessageHandler: { setup() { throw new Error('poisoned handler'); } } }),
      async ({ parsePdfBuffer }) => {
        delete globalThis.pdfjsWorker;
        await expect(parsePdfBuffer(await pdfLines(['SKU', 'MAG-1']))).rejects.toThrow(/poisoned handler/);
      },
    );
  });

  // A Jest started without --experimental-vm-modules (a bare `npx jest`, or a
  // git hook written before the npm script existed) cannot evaluate the ES-module
  // worker through its sandboxed require — it throws a SyntaxError (verified:
  // "Cannot use 'import.meta' outside a module"); some builds throw
  // ERR_REQUIRE_ESM instead. Both must fall through to the createRequire loader.
  //
  // Asserted as "the fallback loader is tried and its module installed", not as
  // "the real worker parses through it": since Jest 30.5 the sandbox's
  // `process.getBuiltinModule('module')` is routed through Jest's own registry
  // (jest-runtime installGetBuiltinModule), so `createRequire(…)(WORKER_PATH)`
  // sees the same `jest.doMock` as `require` does. The first call throws the
  // sandbox error, the second — the fallback — returns the stand-in handler.
  // Before 30.5 createRequire escaped the mock and loaded the real file.
  test.each([
    ['SyntaxError', () => { throw new SyntaxError("Cannot use 'import.meta' outside a module"); }],
    ['ERR_REQUIRE_ESM', () => { throw Object.assign(new Error('Must use import to load ES Module'), { code: 'ERR_REQUIRE_ESM' }); }],
  ])('when the sandboxed require fails with %s, the createRequire fallback is used', async (_name, fail) => {
    const fake = { WorkerMessageHandler: { setup() {} } };
    const factory = jest.fn().mockImplementationOnce(fail).mockImplementation(() => fake);
    await withMockedWorker(factory, async ({ ensurePdfWorker }) => {
      delete globalThis.pdfjsWorker;
      expect(() => ensurePdfWorker()).not.toThrow();
      // Engine note (harvest-ice-d-2026-09-24): the engine pins Jest 30.4, where
      // createRequire still escapes the mock and installs the REAL worker's
      // handler; under 30.5+ it is the stand-in. Either way the fallback ran and
      // installed a handler pdf.js accepts.
      const installed = globalThis.pdfjsWorker.WorkerMessageHandler;
      expect(typeof installed.setup).toBe('function');
      if (installed === fake.WorkerMessageHandler) expect(factory).toHaveBeenCalledTimes(2);
      else expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  test('any other load failure surfaces its own error and is retried, not memoised', async () => {
    const fake = { WorkerMessageHandler: { setup() {} } };
    const factory = jest.fn()
      .mockImplementationOnce(() => { throw new Error('worker load boom'); })
      .mockImplementation(() => fake);
    await withMockedWorker(factory, async ({ ensurePdfWorker }) => {
      delete globalThis.pdfjsWorker;
      expect(() => ensurePdfWorker()).toThrow('worker load boom');
      expect(globalThis.pdfjsWorker).toBeUndefined();

      ensurePdfWorker();
      expect(globalThis.pdfjsWorker.WorkerMessageHandler).toBe(fake.WorkerMessageHandler);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  // A preload that fails is logged, not fatal: parsePdfBuffer still constructs
  // pdf.js, which falls back to importing its own worker (pdf.js's dynamic import
  // does not go through the CJS mock, so it gets the real file) and the document
  // still reads. (pdf.js's own worker registers itself on globalThis as it loads.)
  // pdf.js's import needs Jest's ESM loader, i.e. --experimental-vm-modules on
  // THIS process; in a flagless in-band run there is no fallback to prove.
  const vmModulesAvailable = typeof require('vm').SourceTextModule === 'function';
  (vmModulesAvailable ? test : test.skip)('a failing preload is not fatal — pdf.js gets to load its own worker', async () => {
    await withMockedWorker(() => { throw new Error('worker gone'); }, async ({ parsePdfBuffer }) => {
      delete globalThis.pdfjsWorker;
      const out = await parsePdfBuffer(await pdfLines(['SKU', 'MAG-1']));
      expect([out.headers, ...out.rows].flat()).toEqual(expect.arrayContaining(['SKU', 'MAG-1']));
    });
  });
});
