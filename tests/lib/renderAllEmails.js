'use strict';

/**
 * Drive every sender in server/services/emailService.js once, with fixture
 * data, and return what the transport was handed (harvest 2 lane 2).
 *
 * The caller owns the transport stub — `jest.mock('resend', …)` pushing each
 * message into `sent` — and loads the service with RESEND_API_KEY set, so
 * nothing leaves the process. Used by the email shell/palette suites to
 * measure the REAL rendered mails, not a hand-written list of colours.
 *
 * @param {object} svc   a loaded emailService
 * @param {Array}  sent  the stub's capture array (cleared here)
 * @returns {Promise<Array<{ name: string, msg: object }>>}
 */
async function renderAllEmails(svc, sent) {
  sent.length = 0;
  const out = [];
  const to = 'recipient@example.test';
  const admins = ['admin@example.test'];
  const order = {
    order_number: 'HP-2026-TEST', guest_email: to, guest_name: 'Anna', currency: 'ISK',
    subtotal: 1000, shipping: 500, vat_total: 0, total: 1500, shipping_method: 'local_pickup', stripe_session_id: 'cs_test',
  };
  const items = [{ product_name_snapshot: 'Vara', quantity: 2, product_price_snapshot: 500 }];
  const user = { id: 1, email: to, display_name: 'Anna', preferred_locale: 'is' };
  const rsvpForm = [{ id: 'q1', label: 'Mætir þú?', type: 'text' }];
  const partyInfo = {
    venue_name: 'Salur', venue_address: 'Gata 1, Reykjavík', date: '1. janúar 2027',
    schedule: JSON.stringify([{ time: '18:00', event: 'Matur' }]),
    venue_details: JSON.stringify({ hall: ['Salur'], spa: ['Laug'] }),
    activities: JSON.stringify({ daytime: [{ name: 'Ganga', description: 'Út', rules: 'Skór', rulesLabel: 'Reglur:' }], evening: [{ name: 'Dans' }] }),
  };

  const cases = [
    ['verification',      () => svc.sendVerificationEmail(to, 'tok', 'is')],
    ['passwordReset',     () => svc.sendPasswordResetEmail(to, 'tok', 'en')],
    ['welcomeInvite',     () => svc.sendWelcomeInviteEmail(to, 'tok', 'is')],
    ['orderReceipt',      () => svc.sendOrderReceipt(order, items, 'is', { hasBookableItems: true })],
    ['booking',           () => svc.sendBookingNotification({ order, bookableItems: items, adminEmails: admins })],
    ['rsvpNotification',  () => svc.sendRsvpNotification({ user, answers: { q1: 'Já' }, rsvpForm, isUpdate: false, adminEmails: admins })],
    ['rsvpConfirmation',  () => svc.sendRsvpConfirmation({ user, answers: { q1: 'Já' }, rsvpForm, isUpdate: true, partyInfo })],
    ['partyAnnouncement', () => svc.sendPartyAnnouncement({ recipients: [{ email: to, locale: 'is' }], subject: '', body: '', partyInfo })],
    ['partyRequest',      () => svc.sendPartyRequestNotification({ request: { name: 'Anna', email: to }, adminEmails: admins, approveUrl: 'https://example.test/approve' })],
    ['partyInvite',       () => svc.sendPartyInviteEmail({ to, name: 'Anna', token: 'tok' })],
    ['partyWelcome',      () => svc.sendPartyWelcomeEmail({ user, partyInfo })],
    ['lead',              () => svc.sendLeadNotification({ submissionId: 'sub-1', name: 'Anna', email: to, message: 'Halló', company: 'Fyrirtæki', phone: '555', platform: 'Shopify' })],
  ];
  for (const [name, run] of cases) {
    const before = sent.length;
    await run();
    if (sent.length !== before + 1) throw new Error(`${name}: expected one message, got ${sent.length - before}`);
    out.push({ name, msg: sent[sent.length - 1] });
  }
  return out;
}

module.exports = { renderAllEmails };
