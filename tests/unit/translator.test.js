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
