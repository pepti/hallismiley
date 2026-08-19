const { renderChangelog } = require('../../server/services/changelogRender');

describe('renderChangelog — the useful subset', () => {
  test('headings collapse to h3/h4 so they never outrank the page', () => {
    expect(renderChangelog('# 1.4.2')).toBe('<h3>1.4.2</h3>');
    expect(renderChangelog('## 1.4.2')).toBe('<h3>1.4.2</h3>');
    expect(renderChangelog('#### Details')).toBe('<h4>Details</h4>');
  });

  test('bullet lists', () => {
    expect(renderChangelog('- one\n- two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(renderChangelog('* one')).toBe('<ul>\n<li>one</li>\n</ul>');
  });

  test('numbered lists', () => {
    expect(renderChangelog('1. one\n2. two')).toBe('<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
  });

  test('paragraphs, with wrapped lines joined', () => {
    expect(renderChangelog('hello\nworld')).toBe('<p>hello world</p>');
    expect(renderChangelog('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });

  test('inline emphasis, bold and code', () => {
    expect(renderChangelog('**bold** and *soft* and `code`'))
      .toBe('<p><strong>bold</strong> and <em>soft</em> and <code>code</code></p>');
  });

  test('code spans are not re-read for emphasis', () => {
    expect(renderChangelog('`a * b * c`')).toBe('<p><code>a * b * c</code></p>');
  });

  test('links get target and rel', () => {
    const html = renderChangelog('[docs](https://example.com/x)');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('>docs</a>');
  });

  test('a realistic changelog survives intact', () => {
    const html = renderChangelog('## 1.4.2\n\nSecurity release.\n\n- Fixed **XSS** in search\n- Bumped deps\n');
    expect(html).toContain('<h3>1.4.2</h3>');
    expect(html).toContain('<p>Security release.</p>');
    expect(html).toContain('<li>Fixed <strong>XSS</strong> in search</li>');
  });

  test('empty input renders nothing at all', () => {
    expect(renderChangelog('')).toBe('');
    expect(renderChangelog('   \n  ')).toBe('');
    expect(renderChangelog(null)).toBe('');
    expect(renderChangelog(undefined)).toBe('');
    expect(renderChangelog(42)).toBe('');
  });
});

describe('renderChangelog — the changelog comes from a manifest we did not write', () => {
  // The property that matters is that nothing hostile becomes LIVE markup. The
  // words "onerror" or "javascript:" surviving as escaped text is the mechanism
  // working, not failing — so assert on tags and attributes, not on substrings.
  const noLiveMarkup = (html) => {
    // Only what is inside a real tag can execute. Escaped text that happens to
    // spell "onerror" is inert, and asserting otherwise would test the wrong
    // thing — so pull the actual tags out and inspect those.
    const tags = html.match(/<[^>]+>/g) || [];
    for (const tag of tags) {
      expect(tag).not.toMatch(/^<\/?(script|img|iframe|object|embed|style|svg)\b/i);
      expect(tag).not.toMatch(/\son[a-z]+\s*=/i);            // no event-handler attribute
      expect(tag).not.toMatch(/=\s*["']?\s*javascript:/i);   // no javascript: in any attribute
    }
  };

  test('raw HTML is escaped, not rendered', () => {
    const html = renderChangelog('<script>alert(1)</script>');
    noLiveMarkup(html);
    expect(html).toContain('&lt;script&gt;');
  });

  test('an img with an onerror handler becomes text', () => {
    const html = renderChangelog('<img src=x onerror=alert(1)>');
    noLiveMarkup(html);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('a javascript: link is not a link at all', () => {
    const html = renderChangelog('[click](javascript:alert(1))');
    noLiveMarkup(html);
    expect(html).not.toContain('href');
    expect(html).toContain('[click](javascript:alert(1))');   // inert text
  });

  test('images are not supported at all — a changelog is not a tracking pixel', () => {
    const html = renderChangelog('![tracker](https://evil.example.com/pixel.png)');
    expect(html).not.toContain('<img');
  });

  test('a markdown link cannot smuggle an event handler', () => {
    noLiveMarkup(renderChangelog('[x](https://e.com" onmouseover="alert(1))'));
  });

  test('html entities in prose stay prose', () => {
    expect(renderChangelog('5 < 6 & 7 > 6')).toBe('<p>5 &lt; 6 &amp; 7 &gt; 6</p>');
  });

  test('every tag in the output is on the allowlist', () => {
    const html = renderChangelog(
      '# h\n\n<table><tr><td>x</td></tr></table>\n\n<iframe src="https://evil.example.com"></iframe>\n\n- item'
    );
    const tags = [...html.matchAll(/<(\/?)([a-z0-9]+)/gi)].map(m => m[2].toLowerCase());
    for (const tag of tags) {
      expect(['h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre', 'a', 'br']).toContain(tag);
    }
  });
});
