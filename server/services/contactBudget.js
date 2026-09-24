// A process-wide ceiling on contact-form sends, independent of who is asking.
//
// The per-IP limiter on /api/v1/contact bounds one client; it does nothing
// against rotating IPs, and since #293 every accepted submission is one Graph
// sendMail from shop@icelandicstore.is — the mailbox that also carries every
// receipt, invite and password reset. Exchange Online caps that mailbox
// (30 messages/min, 10,000 recipients/day), so an unbounded form is a way to
// take all transactional mail down. This budget is the backstop: over it, the
// customer still gets a 200 (the form must not tell a bot it found a limit),
// nothing is sent, and the summary line says so.
//
// In-memory and per process by design — a slot swap or restart resets it,
// which is fine for a backstop whose job is to bound a burst, not to meter.
const DEFAULT_HOURLY = 30;
const DEFAULT_DAILY  = 200;

function limit(name, dflt) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function createBudget({ hourly = limit('CONTACT_HOURLY_BUDGET', DEFAULT_HOURLY), daily = limit('CONTACT_DAILY_BUDGET', DEFAULT_DAILY), now = Date.now } = {}) {
  let hourStart = now(), hourCount = 0;
  let dayStart  = now(), dayCount  = 0;

  function roll() {
    const t = now();
    if (t - hourStart >= 3_600_000)  { hourStart = t; hourCount = 0; }
    if (t - dayStart  >= 86_400_000) { dayStart  = t; dayCount  = 0; }
  }

  return {
    /** Claim one send. Returns true and counts it, or false without counting. */
    take() {
      roll();
      if (hourCount >= hourly || dayCount >= daily) return false;
      hourCount += 1; dayCount += 1;
      return true;
    },
    /** For logging: what the counters read right now. */
    snapshot() { roll(); return { hourly: hourCount, daily: dayCount, hourlyLimit: hourly, dailyLimit: daily }; },
  };
}

module.exports = { createBudget, contactBudget: createBudget(), DEFAULT_HOURLY, DEFAULT_DAILY };
