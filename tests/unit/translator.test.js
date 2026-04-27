'use strict';

// Unit tests for server/services/translator.js.
// Mocks the @anthropic-ai/sdk so no real HTTP calls ever fire.

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

describe('server/services/translator', () => {
  let translator;

  beforeEach(() => {
    jest.resetModules();
    mockCreate.mockReset();
    delete process.env.TRANSLATE_ENABLED;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.TRANSLATE_MODEL;
    delete process.env.TRANSLATE_TIMEOUT_MS;
    translator = require('../../server/services/translator');
  });

  describe('isEnabled()', () => {
    test('returns false when flag is off', () => {
      process.env.TRANSLATE_ENABLED = 'false';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      expect(translator.isEnabled()).toBe(false);
    });

    test('returns false when flag is on but API key is blank', () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = '';
      expect(translator.isEnabled()).toBe(false);
    });

    test('returns true only when both are set', () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      expect(translator.isEnabled()).toBe(true);
    });
  });

  describe('translate()', () => {
    test('returns null without calling SDK when flag is off', async () => {
      process.env.TRANSLATE_ENABLED = 'false';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      const out = await translator.translate({ text: 'hello world' });
      expect(out).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('returns null for empty / non-string input even when enabled', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      expect(await translator.translate({ text: '' })).toBeNull();
      expect(await translator.translate({ text: '   ' })).toBeNull();
      expect(await translator.translate({})).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('returns translated string on success', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Halló heimur' }],
      });
      const out = await translator.translate({ text: 'Hello world' });
      expect(out).toBe('Halló heimur');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    test('returns null when SDK throws', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      mockCreate.mockRejectedValue(new Error('boom'));
      const out = await translator.translate({ text: 'Hello' });
      expect(out).toBeNull();
    });

    test('passes a system prompt that mentions preservation rules', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      await translator.translate({ text: 'Visit {0} at https://example.com', format: 'markdown' });
      const callArgs = mockCreate.mock.calls[0][0];
      expect(typeof callArgs.system).toBe('string');
      expect(callArgs.system).toMatch(/URL/i);
      expect(callArgs.system).toMatch(/placeholder/i);
      expect(callArgs.system).toMatch(/Markdown/i);
      expect(callArgs.temperature).toBe(0);
    });
  });

  describe('translateTree()', () => {
    test('returns null when disabled', async () => {
      process.env.TRANSLATE_ENABLED = 'false';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      const out = await translator.translateTree({ title: 'Hello' });
      expect(out).toBeNull();
    });

    test('translates string leaves and preserves structure', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      mockCreate.mockImplementation(async ({ messages }) => {
        const input  = JSON.parse(messages[0].content);
        const output = input.map(s => `IS:${s}`);
        return { content: [{ type: 'text', text: JSON.stringify(output) }] };
      });
      const tree = {
        eyebrow: 'HELLO',
        items: [
          { label: 'First',  value: 'one'     },
          { label: 'Second', value: 'two'     },
        ],
      };
      const out = await translator.translateTree(tree);
      expect(out.eyebrow).toBe('IS:HELLO');
      expect(out.items[0].label).toBe('IS:First');
      expect(out.items[0].value).toBe('IS:one');
      expect(out.items[1].value).toBe('IS:two');
      expect(out).not.toBe(tree); // deep-cloned
    });

    test('skips BLOCK_KEYS like href / url / type / brand_name', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      mockCreate.mockImplementation(async ({ messages }) => {
        const input  = JSON.parse(messages[0].content);
        return { content: [{ type: 'text', text: JSON.stringify(input.map(s => `IS:${s}`)) }] };
      });
      const tree = {
        label:      'Email',
        href:       'mailto:halli@example.is',
        type:       'email',
        brand_name: 'HALLI SMILEY',
        url:        'https://example.is',
        meta:       'Typical reply within 2–3 days',
      };
      const out = await translator.translateTree(tree);
      expect(out.label).toBe('IS:Email');
      expect(out.meta).toMatch(/^IS:/);
      expect(out.href).toBe('mailto:halli@example.is');       // untouched
      expect(out.type).toBe('email');                          // untouched
      expect(out.brand_name).toBe('HALLI SMILEY');             // untouched
      expect(out.url).toBe('https://example.is');              // untouched
    });

    test('falls back to per-leaf calls when batched response length mismatches', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      let call = 0;
      mockCreate.mockImplementation(async ({ messages }) => {
        call++;
        if (call === 1) {
          // Batched call returns a bad array — triggers fallback
          return { content: [{ type: 'text', text: '["only-one"]' }] };
        }
        // Per-leaf fallback calls
        return { content: [{ type: 'text', text: `IS:${messages[0].content}` }] };
      });
      const out = await translator.translateTree({ a: 'one', b: 'two' });
      expect(out.a).toBe('IS:one');
      expect(out.b).toBe('IS:two');
      expect(call).toBeGreaterThanOrEqual(3); // 1 batch + 2 leaf calls
    });

    test('returns tree unchanged (deep-cloned) when tree has no translatable leaves', async () => {
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';
      const tree = { href: 'https://x.is', type: 'email' };
      const out = await translator.translateTree(tree);
      expect(out).toEqual(tree);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('chunks large trees into multiple parallel batched calls', async () => {
      // The CHUNK_SIZE is 25; build a tree of 60 leaves so it must split
      // into 3 chunks (25, 25, 10).
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';

      const tree = {};
      for (let i = 0; i < 60; i++) tree[`k${i}`] = `EN-${i}`;

      const callPayloads = [];
      mockCreate.mockImplementation(async ({ messages }) => {
        const input = JSON.parse(messages[0].content);
        callPayloads.push(input.length);
        return {
          content: [{ type: 'text', text: JSON.stringify(input.map(s => `IS:${s}`)) }],
        };
      });

      const out = await translator.translateTree(tree);

      // Three batched calls: two full chunks (25 each) + one short (10).
      expect(callPayloads).toHaveLength(3);
      expect(callPayloads.sort((a, b) => a - b)).toEqual([10, 25, 25]);

      // All 60 leaves translated.
      for (let i = 0; i < 60; i++) {
        expect(out[`k${i}`]).toBe(`IS:EN-${i}`);
      }
    });

    test('chunked trees fall back to per-leaf only for the failed chunk', async () => {
      // 60 leaves → 3 chunks; make the FIRST chunk return bad JSON so it
      // alone falls through to per-leaf, while chunks 2 + 3 succeed.
      process.env.TRANSLATE_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-x';

      const tree = {};
      for (let i = 0; i < 60; i++) tree[`k${i}`] = `EN-${i}`;

      let firstChunkSeen = false;
      mockCreate.mockImplementation(async ({ messages }) => {
        const raw = messages[0].content;
        // Per-leaf calls send a plain string, not JSON; batched calls
        // send a JSON array as the user message.
        let input;
        try { input = JSON.parse(raw); } catch { input = null; }

        if (Array.isArray(input)) {
          // Batched call. First batched call (the first chunk that hits
          // here, with 25 entries starting "EN-0") returns wrong-length
          // JSON to trigger per-leaf fallback for that chunk only.
          const isFirstChunk = input.length === 25 && input[0] === 'EN-0' && !firstChunkSeen;
          if (isFirstChunk) {
            firstChunkSeen = true;
            return { content: [{ type: 'text', text: '["only-one"]' }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify(input.map(s => `IS:${s}`)) }] };
        }
        // Per-leaf fallback (raw is a single string)
        return { content: [{ type: 'text', text: `IS-LEAF:${raw}` }] };
      });

      const out = await translator.translateTree(tree);

      // Failed chunk's leaves came back via per-leaf fallback
      for (let i = 0; i < 25; i++) {
        expect(out[`k${i}`]).toBe(`IS-LEAF:EN-${i}`);
      }
      // Successful chunks kept their batched translations
      for (let i = 25; i < 60; i++) {
        expect(out[`k${i}`]).toBe(`IS:EN-${i}`);
      }
    });
  });

  describe('_internal.collectLeaves', () => {
    test('caps recursion at MAX_TREE_DEPTH', () => {
      const { collectLeaves, MAX_TREE_DEPTH } = translator._internal;
      // Build a tree deeper than the cap
      let tree = { leaf: 'deep-leaf' };
      for (let i = 0; i < MAX_TREE_DEPTH + 5; i++) tree = { nested: tree };
      const leaves = [];
      collectLeaves(tree, [], 0, leaves);
      // Depth cap should have prevented collecting the inner leaf
      const anyDeep = leaves.some(l => l.value === 'deep-leaf');
      expect(anyDeep).toBe(false);
    });
  });
});
