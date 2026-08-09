// Unit tests for the discount engine (server/services/discountEngine.js).
// The engine is pure logic on top of two Discount model lookups, so we mock
// the model and exercise every gate + benefit branch directly. This is a unit
// test (model mocked) — not an integration test — so it does not violate the
// "don't mock pg" rule, which governs integration tests hitting real Postgres.
jest.mock('../../server/models/Discount', () => ({
  findByCodeCI:      jest.fn(),
  findLiveAutomatic: jest.fn(),
}));

const Discount = require('../../server/models/Discount');
const { computeForCheckout, computeForCode } = require('../../server/services/discountEngine');

// A valid, enabled, code-based 10%-off order discount in ISK. Override per test.
function disc(overrides = {}) {
  return {
    id: 'd1', code: 'SAVE10', enabled: true,
    method: 'code', type: 'order', value_type: 'percentage', value: 10,
    currency: 'ISK', min_subtotal: null,
    usage_limit: null, used_count: 0,
    starts_at: null, ends_at: null,
    ...overrides,
  };
}

const PAST   = '2000-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

afterEach(() => jest.clearAllMocks());

describe('computeForCheckout — code path', () => {
  test('unknown code → 404 invalidCode (existence not leaked)', async () => {
    Discount.findByCodeCI.mockResolvedValue(null);
    const r = await computeForCheckout({ code: 'NOPE', subtotal: 10000, currency: 'ISK' });
    expect(r.error).toMatchObject({ status: 404, reason: 'invalidCode' });
    expect(Discount.findByCodeCI).toHaveBeenCalledWith('NOPE');
  });

  test('disabled code → 404 invalidCode', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ enabled: false }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 404, reason: 'invalidCode' });
  });

  test('whitespace is trimmed before lookup', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc());
    await computeForCheckout({ code: '  SAVE10  ', subtotal: 10000 });
    expect(Discount.findByCodeCI).toHaveBeenCalledWith('SAVE10');
  });

  test('scheduled (starts_at in future) → 422 scheduled', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ starts_at: FUTURE }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 422, reason: 'scheduled' });
  });

  test('expired (ends_at in past) → 422 expired', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ ends_at: PAST }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 422, reason: 'expired' });
  });

  test('usage limit reached → 409 usageLimitReached', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ usage_limit: 5, used_count: 5 }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 409, reason: 'usageLimitReached' });
  });

  test('currency mismatch → 422 currencyMismatch', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ currency: 'EUR' }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000, currency: 'ISK' });
    expect(r.error).toMatchObject({ status: 422, reason: 'currencyMismatch' });
  });

  test('below minimum subtotal → 422 minSubtotal with the required amount', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ min_subtotal: 20000 }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 422, reason: 'minSubtotal', params: { amount: 20000 } });
  });

  test('percentage discount → rounded amount', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ value_type: 'percentage', value: 10 }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 9999 });
    expect(r.error).toBeUndefined();
    expect(r.discount.code).toBe('SAVE10');
    expect(r.discountAmount).toBe(1000); // round(9999 * 10 / 100) = round(999.9)
    expect(r.shippingDiscount).toBe(0);
  });

  test('fixed discount → min(value, subtotal)', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ value_type: 'fixed', value: 500 }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.discountAmount).toBe(500);
  });

  test('fixed discount larger than subtotal is clamped to subtotal', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ value_type: 'fixed', value: 99999 }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.discountAmount).toBe(10000);
  });

  test('zero-value benefit → 422 notApplicable', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ value_type: 'percentage', value: 0 }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 422, reason: 'notApplicable' });
  });

  test('free shipping code → discounts the shipping amount only', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ type: 'free_shipping', value_type: null, value: null }));
    const r = await computeForCheckout({ code: 'SHIPFREE', subtotal: 10000, shippingAmount: 1500 });
    expect(r.discountAmount).toBe(0);
    expect(r.shippingDiscount).toBe(1500);
  });

  test('free shipping code is valid even with zero shipping (e.g. pickup)', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ type: 'free_shipping' }));
    const r = await computeForCheckout({ code: 'SHIPFREE', subtotal: 10000, shippingAmount: 0 });
    expect(r.error).toBeUndefined();
    expect(r.discount.type).toBe('free_shipping');
    expect(r.shippingDiscount).toBe(0);
  });

  test('negative subtotal is floored to 0', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ value_type: 'fixed', value: 500 }));
    const r = await computeForCheckout({ code: 'SAVE10', subtotal: -100 });
    // sub clamps to 0 → fixed min(500, 0) = 0 → no benefit → notApplicable
    expect(r.error).toMatchObject({ reason: 'notApplicable' });
  });
});

describe('computeForCheckout — automatic discovery', () => {
  test('no code → picks the live automatic discount with the greatest benefit', async () => {
    Discount.findLiveAutomatic.mockResolvedValue([
      disc({ id: 'a', method: 'automatic', value_type: 'percentage', value: 10 }),       // 1000 off
      disc({ id: 'b', method: 'automatic', type: 'free_shipping' }),                      // 2000 off shipping
    ]);
    const r = await computeForCheckout({ subtotal: 10000, shippingAmount: 2000 });
    expect(Discount.findLiveAutomatic).toHaveBeenCalledWith({ currency: 'ISK' });
    expect(r.discount.id).toBe('b');
    expect(r.shippingDiscount).toBe(2000);
  });

  test('candidates failing gates are silently skipped', async () => {
    Discount.findLiveAutomatic.mockResolvedValue([
      disc({ id: 'a', method: 'automatic', currency: 'EUR' }),                   // currency gate fails
      disc({ id: 'b', method: 'automatic', value_type: 'fixed', value: 300 }),   // valid → 300 off
    ]);
    const r = await computeForCheckout({ subtotal: 10000, currency: 'ISK' });
    expect(r.discount.id).toBe('b');
    expect(r.discountAmount).toBe(300);
  });

  test('no applicable automatic discount → null discount, zero amounts', async () => {
    Discount.findLiveAutomatic.mockResolvedValue([
      disc({ id: 'a', method: 'automatic', value_type: 'percentage', value: 0 }), // no benefit
    ]);
    const r = await computeForCheckout({ subtotal: 10000 });
    expect(r.discount).toBeNull();
    expect(r.discountAmount).toBe(0);
    expect(r.shippingDiscount).toBe(0);
  });

  test('empty candidate list → null discount', async () => {
    Discount.findLiveAutomatic.mockResolvedValue([]);
    const r = await computeForCheckout({ subtotal: 10000 });
    expect(r.discount).toBeNull();
  });
});

describe('computeForCode — public preview shape', () => {
  test('valid order discount → { amount, freeShipping:false }', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ value_type: 'percentage', value: 10 }));
    const r = await computeForCode({ code: 'SAVE10', subtotal: 10000 });
    expect(r.amount).toBe(1000);
    expect(r.freeShipping).toBe(false);
    expect(r.discount.code).toBe('SAVE10');
  });

  test('free shipping code → freeShipping:true', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ type: 'free_shipping' }));
    const r = await computeForCode({ code: 'SHIPFREE', subtotal: 10000 });
    expect(r.freeShipping).toBe(true);
  });

  test('gate error is passed through unchanged', async () => {
    Discount.findByCodeCI.mockResolvedValue(disc({ ends_at: PAST }));
    const r = await computeForCode({ code: 'SAVE10', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 422, reason: 'expired' });
  });

  test('empty code (no discount resolved) → 404 invalidCode', async () => {
    Discount.findLiveAutomatic.mockResolvedValue([]);
    const r = await computeForCode({ code: '', subtotal: 10000 });
    expect(r.error).toMatchObject({ status: 404, reason: 'invalidCode' });
  });
});
