'use strict';

// public/js/utils/checkoutSettings.js — what the cart and the checkout SHOW
// about the checkout settings (harvest2-lane7a). UX only: the server enforces
// (tests/integration/checkoutSettings.test.js); this pins that the page reads
// /shop/config the way the server wrote it, and falls back to today's
// checkout when the config is missing or malformed.

const { checkoutState } = require('../../public/js/utils/checkoutSettings.js');

const cfg = (checkout = {}, shipping = {}) => ({ checkout, shipping });

describe('checkoutState', () => {
  test('no config → the defaults: open, no minimum, today\'s fields', () => {
    expect(checkoutState(null, 1000)).toEqual({
      paused: false, pausedMessage: '', minIsk: 0, belowMin: false, missingIsk: 0, freeOverIsk: 0,
      fields: { phone: 'optional', company: 'hidden', kennitala: 'hidden', note: 'optional' },
      blocked: false,
    });
  });

  test('the pause blocks, with the message of the visitor\'s language ("" → the i18n default)', () => {
    const c = cfg({ ordering_paused: true, ordering_paused_message: { is: ' Lokað ', en: '' } });
    expect(checkoutState(c, 0, 'is')).toEqual(expect.objectContaining({ paused: true, pausedMessage: 'Lokað', blocked: true }));
    expect(checkoutState(c, 0, 'en').pausedMessage).toBe('');
  });

  test('the minimum: how far below, and not blocked at it', () => {
    const c = cfg({ min_order_value_isk: 5000 });
    expect(checkoutState(c, 3200)).toEqual(expect.objectContaining({ belowMin: true, missingIsk: 1800, blocked: true }));
    expect(checkoutState(c, 5000)).toEqual(expect.objectContaining({ belowMin: false, missingIsk: 0, blocked: false }));
  });

  test('field rules pass through; an unknown value falls back to the default', () => {
    const c = cfg({ fields: { phone: 'required', company: 'optional', kennitala: 'sometimes', note: 'hidden' } });
    expect(checkoutState(c, 0).fields).toEqual({ phone: 'required', company: 'optional', kennitala: 'hidden', note: 'hidden' });
  });

  test('the free-delivery threshold comes from the shipping block', () => {
    expect(checkoutState(cfg({}, { free_over_isk: 15000 }), 0).freeOverIsk).toBe(15000);
  });
});
