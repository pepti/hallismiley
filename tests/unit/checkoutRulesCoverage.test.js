'use strict';

// Every order-create path enforces the checkout settings (harvest2-lane7a).
// The engine has ONE today — shopController.createCheckoutSession — but the
// pause is only a kill switch if a SECOND path cannot appear without it. So:
// every server file that calls Order.createWithItems must also run the pause
// guard and the minimum, and in the one function we have, the guard runs
// before the order is written. Read-the-source, like the other parity tests.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../server');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// A Windows working tree is CRLF; the committed blob (and CI) is LF.
const readLf = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

const ORDER_STARTS = [
  /Order\.createWithItems\s*\(/,
  /INSERT\s+INTO\s+orders\b/i,
  /stripeService\.createCheckoutSession\s*\(/,
];

const callers = walk(ROOT)
  .filter(f => !f.endsWith(path.join('models', 'Order.js')))
  .filter(f => !f.includes(`${path.sep}scripts${path.sep}`)) // one-off seeds write orders directly, never a customer
  .filter(f => !f.endsWith(path.join('services', 'stripeService.js'))) // defines the session call
  .map(f => ({ file: f, src: readLf(f) }))
  // A call, not a mention: whole-line // comments are dropped first
  // (config/schema.js names the method in migration 115's comment). Three
  // ways to start an order: the model, a raw INSERT, or a Stripe session.
  .filter(({ src }) => ORDER_STARTS.some(re => re.test(src.replace(/^\s*\/\/.*$/gm, ''))));

test('the order-create callers are the ones this suite knows about', () => {
  expect(callers.map(c => path.relative(ROOT, c.file).replace(/\\/g, '/'))).toEqual(['controllers/shopController.js']);
});

test.each(callers.map(c => [path.relative(ROOT, c.file), c]))('%s runs the pause guard and the minimum', (_name, { src }) => {
  expect(src).toMatch(/checkoutRules\.orderingPausedResponse\(/);
  expect(src).toMatch(/checkoutRules\.minimumOrderResponse\(/);
  expect(src).toMatch(/checkoutRules\.applyFieldRules\(/);
});

test('createCheckoutSession: pause → field rules → minimum → the order row, in that order', () => {
  const src = readLf(path.join(ROOT, 'controllers', 'shopController.js'));
  const start = src.indexOf('async createCheckoutSession(');
  const end = src.indexOf('\n  },\n', start);
  const body = src.slice(start, end);
  const at = (needle) => {
    const i = body.indexOf(needle);
    expect(i).toBeGreaterThan(-1);
    return i;
  };
  const pause = at('checkoutRules.orderingPausedResponse(');
  const fields = at('checkoutRules.applyFieldRules(');
  const min = at('checkoutRules.minimumOrderResponse(');
  const write = at('Order.createWithItems(');
  expect(pause).toBeLessThan(at('stripeIsConfigured()'));
  expect(pause).toBeLessThan(fields);
  expect(fields).toBeLessThan(min);
  expect(min).toBeLessThan(write);
});
