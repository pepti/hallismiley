// The process-wide contact-send budget: bounds a burst regardless of source IP.
const { createBudget, DEFAULT_HOURLY, DEFAULT_DAILY } = require('../../server/services/contactBudget');

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

describe('contactBudget', () => {
  test('defaults are 30/hour and 200/day, env-tunable', () => {
    expect(DEFAULT_HOURLY).toBe(30);
    expect(DEFAULT_DAILY).toBe(200);
    process.env.CONTACT_HOURLY_BUDGET = '2';
    const b = createBudget();
    expect(b.snapshot().hourlyLimit).toBe(2);
    delete process.env.CONTACT_HOURLY_BUDGET;
    expect(createBudget().snapshot().hourlyLimit).toBe(30);
  });

  test('refuses the (hourly+1)th send within the hour, without counting it', () => {
    const c = clock();
    const b = createBudget({ hourly: 3, daily: 100, now: c.now });
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, true]);
    expect(b.take()).toBe(false);
    expect(b.snapshot()).toMatchObject({ hourly: 3, daily: 3 });
  });

  test('the hourly window rolls, the daily one keeps counting', () => {
    const c = clock();
    const b = createBudget({ hourly: 2, daily: 3, now: c.now });
    b.take(); b.take();
    expect(b.take()).toBe(false);
    c.advance(3_600_000);
    expect(b.take()).toBe(true);                       // hour rolled → allowed again
    expect(b.take()).toBe(false);                      // daily cap (3) reached
    c.advance(86_400_000);
    expect(b.take()).toBe(true);                       // day rolled
  });
});
