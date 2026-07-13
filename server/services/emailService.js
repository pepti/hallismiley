// Email service using Resend API.
// Falls back to a no-op with a console notice when RESEND_API_KEY is not set (dev/test mode).
const { Resend } = require('resend');
const { t }      = require('../i18n');

const APP_URL   = process.env.APP_URL || 'https://www.hallismiley.is';
// Send from the real owner mailbox (a verified Google Workspace address) rather
// than a noreply@ alias, so mail actually delivers. Override with EMAIL_FROM.
const FROM_ADDR = process.env.EMAIL_FROM || 'halli@hallismiley.is';
const FROM      = `Halli Smiley <${FROM_ADDR}>`;

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

// Basic transport-layer health check. DB-dependent checks (e.g. which admin
// emails are verified) belong in the caller — this stays DB-free so the
// emailService module stays reusable outside request context.
function emailHealthCheck() {
  return {
    resendConfigured: !!process.env.RESEND_API_KEY,
    fromAddressSet:   !!process.env.EMAIL_FROM,
    fromAddress:      FROM_ADDR,
  };
}

function getClient() {
  return new Resend(process.env.RESEND_API_KEY);
}

// ── Shared HTML shell ─────────────────────────────────────────────────────────

function emailShell(title, bodyHtml, locale = 'en') {
  const footer = t(locale, 'email.footer', { appUrl: APP_URL });
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;border:1px solid #222;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a1a 0%,#0d0d0d 100%);padding:32px 40px;border-bottom:2px solid #c9a84c;">
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#c9a84c;letter-spacing:1px;">Halli Smiley</h1>
              <p style="margin:4px 0 0;font-size:13px;color:#666;letter-spacing:2px;text-transform:uppercase;">hallismiley.is</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #222;background-color:#0d0d0d;">
              <p style="margin:0;font-size:12px;color:#444;text-align:center;">
                ${footer}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Verification email ────────────────────────────────────────────────────────

async function sendVerificationEmail(to, token, locale = 'en') {
  // Include the locale in the link so the verify page renders in the same
  // language as the email — recipients often aren't logged in yet, so no
  // session preference exists for the locale middleware to fall back to.
  const link = `${APP_URL}/#/verify-email?token=${token}&locale=${encodeURIComponent(locale)}`;

  if (!isConfigured()) {
    // Do NOT log the token or the full link — they are credential-equivalent.
    // In development, retrieve the token directly from the database:
    //   SELECT email_verify_token FROM users WHERE email = '...';
    console.log('[EmailService] Resend not configured — verification email skipped (retrieve token from DB)');
    return;
  }

  const subject = t(locale, 'email.verify.subject');
  const html = emailShell(subject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">${t(locale, 'email.verify.heading')}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${t(locale, 'email.verify.body')}
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${link}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.verify.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.verify.fallback')}<br/>
      <a href="${link}" style="color:#c9a84c;word-break:break-all;">${link}</a>
    </p>
  `, locale);

  // Log the Resend message ID (not the recipient address — that's PII)
  const { data, error } = await getClient().emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Verification email sent: id=${data.id}`);
}

// ── Password reset email ──────────────────────────────────────────────────────

async function sendPasswordResetEmail(to, token, locale = 'en') {
  const link = `${APP_URL}/#/reset-password?token=${token}&locale=${encodeURIComponent(locale)}`;

  if (!isConfigured()) {
    // Do NOT log the token or the full link — they are credential-equivalent.
    // In development, retrieve the token directly from the database:
    //   SELECT password_reset_token FROM users WHERE email = '...';
    console.log('[EmailService] Resend not configured — password reset email skipped (retrieve token from DB)');
    return;
  }

  const subject = t(locale, 'email.reset.subject');
  const html = emailShell(subject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">${t(locale, 'email.reset.heading')}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${t(locale, 'email.reset.body')}
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${link}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.reset.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.reset.fallback')}<br/>
      <a href="${link}" style="color:#c9a84c;word-break:break-all;">${link}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#444;">
      ${t(locale, 'email.reset.noAction')}
    </p>
  `, locale);

  // Log the Resend message ID (not the recipient address — that's PII)
  const { data, error } = await getClient().emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Password reset email sent: id=${data.id}`);
}

// ── Order receipt email ───────────────────────────────────────────────────────

function formatMoney(amount, currency, locale = 'en') {
  const tag = locale === 'is' ? 'is-IS' : 'en-GB';
  if (currency === 'ISK') {
    return new Intl.NumberFormat(tag, {
      style: 'currency', currency: 'ISK', maximumFractionDigits: 0,
    }).format(Number(amount));
  }
  if (currency === 'EUR') {
    return new Intl.NumberFormat(tag, {
      style: 'currency', currency: 'EUR',
    }).format(Number(amount) / 100);
  }
  return `${amount} ${currency}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendOrderReceipt(order, items, locale = 'en', { hasBookableItems = false } = {}) {
  const to = order.guest_email || order.user_email;
  if (!to) {
    console.warn(`[EmailService] No recipient for order ${order.order_number} receipt`);
    return;
  }

  const orderUrl = `${APP_URL}/#/checkout/success?session_id=${encodeURIComponent(order.stripe_session_id || '')}`;

  // Shop redesign step 5 — surface the scheduling promise inline in the
  // receipt when any item is bookable (tech / carpentry service). The
  // shipping line still renders normally so customers see what they're
  // owed for any physical items in the same order.
  const bookingBlockHtml = hasBookableItems ? `
    <table width="100%" cellpadding="0" cellspacing="0"
           style="margin:0 0 28px;background-color:#0d0d0d;border-radius:8px;border:1px solid #2a2a2a;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#c9a84c;letter-spacing:1.5px;text-transform:uppercase;">
            ${t(locale, 'email.order.bookingHeading')}
          </p>
          <p style="margin:0;font-size:14px;color:#e0e0e0;line-height:1.6;">
            ${t(locale, 'email.order.bookingBody')}
          </p>
        </td>
      </tr>
    </table>` : '';

  const itemsHtml = items.map(it => `
    <tr>
      <td style="padding:8px 0;color:#aaa;font-size:14px;">
        ${escapeHtml(it.product_name_snapshot)} × ${Number(it.quantity)}
      </td>
      <td style="padding:8px 0;color:#e0e0e0;font-size:14px;text-align:right;">
        ${formatMoney(it.product_price_snapshot * it.quantity, order.currency, locale)}
      </td>
    </tr>
  `).join('');

  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — order receipt for ${order.order_number} skipped`);
    return;
  }

  const methodLabel = order.shipping_method === 'local_pickup'
    ? t(locale, 'email.order.localPickup')
    : t(locale, 'email.order.shippingMethod');

  const subject = t(locale, 'email.order.subject', { orderNumber: order.order_number });
  const html = emailShell(subject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">${t(locale, 'email.order.heading')}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${t(locale, 'email.order.body', { orderNumber: escapeHtml(order.order_number) })}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #222;">
      ${itemsHtml}
      <tr>
        <td style="padding:12px 0 8px;color:#666;font-size:13px;border-top:1px solid #222;">${t(locale, 'email.order.subtotal')}</td>
        <td style="padding:12px 0 8px;color:#aaa;font-size:13px;text-align:right;border-top:1px solid #222;">
          ${formatMoney(order.subtotal, order.currency, locale)}
        </td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#666;font-size:13px;">${t(locale, 'email.order.shipping', { method: methodLabel })}</td>
        <td style="padding:4px 0;color:#aaa;font-size:13px;text-align:right;">
          ${formatMoney(order.shipping, order.currency, locale)}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0 0;color:#e0e0e0;font-size:16px;font-weight:600;border-top:1px solid #222;">${t(locale, 'email.order.total')}</td>
        <td style="padding:12px 0 0;color:#c9a84c;font-size:16px;font-weight:600;text-align:right;border-top:1px solid #222;">
          ${formatMoney(order.total, order.currency, locale)}
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:12px;color:#555;">
      ${t(locale, 'email.order.vatNote')}
    </p>
    ${bookingBlockHtml}
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${orderUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.order.viewButton')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.order.questions')}
    </p>
  `, locale);

  const { data, error } = await getClient().emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Order receipt sent: order=${order.order_number} id=${data.id}`);
}

// ── Booking notification to admins (shop redesign step 5) ───────────────────
// Fires when a paid order contains at least one is_bookable item. Halli (and
// any other admin recipients) get an itemised list of the service line items
// plus the order/contact details needed to follow up. Always English — the
// admin audience is small and locale-mixed; the customer-facing receipt
// localises separately.

async function sendBookingNotification({ order, bookableItems, adminEmails }) {
  if (!adminEmails || adminEmails.length === 0) return;
  if (!bookableItems || bookableItems.length === 0) return;
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — booking notification skipped (order=${order.order_number}, items=${bookableItems.length})`);
    return;
  }

  const locale = 'en';
  const subject = t(locale, 'email.bookingNotification.subject', { orderNumber: order.order_number });

  const customerLine = order.guest_email
    ? `${escapeHtml(order.guest_name || order.guest_email)} &lt;${escapeHtml(order.guest_email)}&gt;`
    : escapeHtml(order.user_email || t(locale, 'email.bookingNotification.unknownCustomer'));

  const itemRowsHtml = bookableItems.map(it => `
    <tr>
      <td style="padding:8px 0;color:#e0e0e0;font-size:14px;">
        ${escapeHtml(it.product_name_snapshot)} × ${Number(it.quantity)}
      </td>
      <td style="padding:8px 0;color:#aaa;font-size:14px;text-align:right;">
        ${formatMoney(it.product_price_snapshot * it.quantity, order.currency, locale)}
      </td>
    </tr>
  `).join('');

  const adminUrl = `${APP_URL}/#/admin/shop/orders`;
  const heading  = t(locale, 'email.bookingNotification.heading');
  const bodyText = t(locale, 'email.bookingNotification.body', {
    orderNumber: escapeHtml(order.order_number),
    customer:    customerLine,
  });

  const html = emailShell(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:#e0e0e0;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${bodyText}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #222;border-bottom:1px solid #222;">
      ${itemRowsHtml}
    </table>
    <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.6;">
      ${t(locale, 'email.bookingNotification.totalLabel')}:
      <strong style="color:#c9a84c;">${formatMoney(order.total, order.currency, locale)}</strong>
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${adminUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.bookingNotification.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.bookingNotification.footer')}
    </p>
  `, locale);

  const { data, error } = await getClient().emails.send({
    from: FROM, to: adminEmails, subject, html,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Booking notification sent: order=${order.order_number} items=${bookableItems.length} recipients=${adminEmails.length} id=${data.id}`);
}

// ── RSVP notification to admins ───────────────────────────────────────────────
// Party admin notifications are sent in Icelandic — the owner (and the party's
// admin audience) is Icelandic-first.

async function sendRsvpNotification({ user, answers, rsvpForm, isUpdate, adminEmails }) {
  if (!adminEmails || adminEmails.length === 0) return;
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — RSVP notification skipped (user=${user.id}, isUpdate=${isUpdate})`);
    return;
  }

  const locale = 'is';
  const name   = user.display_name || user.username || user.email;
  const subject = isUpdate
    ? t(locale, 'email.rsvpNotification.subject.update', { name })
    : t(locale, 'email.rsvpNotification.subject.new',    { name });

  const fields     = Array.isArray(rsvpForm) ? rsvpForm : [];
  const dataFields = fields.filter(f => !['heading', 'paragraph'].includes(f.type));

  const answerRows = dataFields.map(f => {
    const a = answers?.[f.id];
    if (a == null || (Array.isArray(a) && a.length === 0) || a === '') return null;
    const val = Array.isArray(a) ? a.map(escapeHtml).join(', ') : escapeHtml(String(a));
    return `
      <tr>
        <td style="padding:8px 0;color:#666;font-size:13px;vertical-align:top;width:180px;">${escapeHtml(f.label || f.id)}</td>
        <td style="padding:8px 0;color:#e0e0e0;font-size:14px;">${val}</td>
      </tr>`;
  }).filter(Boolean).join('');

  // Fall back to dumping raw keys if the form schema is missing
  const rawRows = answerRows ? '' : Object.entries(answers || {}).map(([k, v]) => {
    const val = Array.isArray(v) ? v.map(escapeHtml).join(', ') : escapeHtml(String(v));
    return `
      <tr>
        <td style="padding:8px 0;color:#666;font-size:13px;vertical-align:top;width:180px;">${escapeHtml(k)}</td>
        <td style="padding:8px 0;color:#e0e0e0;font-size:14px;">${val}</td>
      </tr>`;
  }).join('');

  const partyUrl = `${APP_URL}/#/party/admin`;
  const heading  = t(locale, isUpdate ? 'email.rsvpNotification.heading.update' : 'email.rsvpNotification.heading.new');
  const bodyText = t(locale, isUpdate ? 'email.rsvpNotification.body.update' : 'email.rsvpNotification.body.new',
    { name: escapeHtml(name), email: escapeHtml(user.email || '') });

  const html = emailShell(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:#e0e0e0;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${bodyText}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #222;">
      ${answerRows || rawRows || `<tr><td style="padding:8px 0;color:#666;font-size:13px;">${t(locale, 'email.rsvpNotification.noAnswers')}</td></tr>`}
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${partyUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.rsvpNotification.button')}
          </a>
        </td>
      </tr>
    </table>
  `, locale);

  const { data, error } = await getClient().emails.send({
    from: FROM, to: adminEmails, subject, html,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] RSVP notification sent: user=${user.id} isUpdate=${isUpdate} recipients=${adminEmails.length} id=${data.id}`);
}

// ── RSVP confirmation to the guest ────────────────────────────────────────────

async function sendRsvpConfirmation({ user, answers, rsvpForm, isUpdate, partyInfo }) {
  if (!user?.email) return;
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — RSVP confirmation skipped (user=${user.id}, isUpdate=${isUpdate})`);
    return;
  }

  // Party guests default to Icelandic; an explicit switch to English (stored
  // on the account) is respected.
  const locale = user.preferred_locale || 'is';
  const name   = user.display_name || user.username || 'there';

  const subject = t(locale, isUpdate ? 'email.rsvpConfirmation.subject.update' : 'email.rsvpConfirmation.subject.new');

  const fields     = Array.isArray(rsvpForm) ? rsvpForm : [];
  const dataFields = fields.filter(f => !['heading', 'paragraph'].includes(f.type));

  const answerRows = dataFields.map(f => {
    const a = answers?.[f.id];
    if (a == null || (Array.isArray(a) && a.length === 0) || a === '') return null;
    const val = Array.isArray(a) ? a.map(escapeHtml).join(', ') : escapeHtml(String(a));
    return `
      <tr>
        <td style="padding:8px 0;color:#666;font-size:13px;vertical-align:top;width:180px;">${escapeHtml(f.label || f.id)}</td>
        <td style="padding:8px 0;color:#e0e0e0;font-size:14px;">${val}</td>
      </tr>`;
  }).filter(Boolean).join('');

  const info = partyInfo || {};
  const venueName    = escapeHtml(info.venue_name    || '');
  const venueAddress = escapeHtml(info.venue_address || '');
  const partyDate    = escapeHtml(info.date          || 'July 25, 2026');
  const mapsLink     = info.venue_maps_link
    || (info.venue_address
          ? `https://www.google.com/maps/search/${encodeURIComponent(info.venue_address)}`
          : '');

  const partyUrl = `${APP_URL}/#/party`;
  const heading  = t(locale, isUpdate ? 'email.rsvpConfirmation.heading.update' : 'email.rsvpConfirmation.heading.new');
  const bodyText = t(locale, isUpdate ? 'email.rsvpConfirmation.body.update' : 'email.rsvpConfirmation.body.new',
    { name: escapeHtml(name) });

  const html = emailShell(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:#e0e0e0;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${bodyText}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-top:1px solid #222;">
      ${answerRows || `<tr><td style="padding:8px 0;color:#666;font-size:13px;">${t(locale, 'email.rsvpConfirmation.noAnswers')}</td></tr>`}
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background-color:#0d0d0d;border-radius:8px;border:1px solid #222;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${t(locale, 'email.rsvpConfirmation.whenWhere')}</p>
          <p style="margin:0 0 4px;font-size:17px;color:#c9a84c;font-weight:600;">${partyDate}</p>
          ${venueName    ? `<p style="margin:0;font-size:15px;color:#e0e0e0;">${venueName}</p>` : ''}
          ${venueAddress ? `<p style="margin:4px 0 0;font-size:13px;color:#888;">${venueAddress}</p>` : ''}
          ${mapsLink     ? `<p style="margin:12px 0 0;font-size:13px;"><a href="${escapeHtml(mapsLink)}" style="color:#c9a84c;text-decoration:none;">${t(locale, 'email.rsvpConfirmation.openMaps')}</a></p>` : ''}
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:15px;color:#aaa;line-height:1.6;">
      ${t(locale, 'email.rsvpConfirmation.updateNote')}
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${partyUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.rsvpConfirmation.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.rsvpConfirmation.closing')}
    </p>
  `, locale);

  const { data, error } = await getClient().emails.send({ from: FROM, to: user.email, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] RSVP confirmation sent: user=${user.id} isUpdate=${isUpdate} id=${data.id}`);
}

// ── Party announcement to going/maybe guests ──────────────────────────────────
// Sends one email per recipient (not a single message with array `to`) — that
// way each guest only sees their own address in the To: header. Resend's
// default rate limit is 100 req/sec, well above any plausible guest list.
// Body is the host's free-form message (optional); falls back to the i18n
// default copy. Recipients are { email, locale } — the host's free-form
// subject/body go out as-typed to everyone, but the surrounding chrome
// (heading, when-and-where labels, button, default intro/signoff) localizes
// per guest (Icelandic by default). Returns { sent, failed } so the caller can
// report partial failures (e.g. a single bounce shouldn't blank the whole
// result).

async function sendPartyAnnouncement({ recipients, subject, body, partyInfo }) {
  if (!Array.isArray(recipients) || recipients.length === 0) return { sent: 0, failed: 0 };
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — party announcement skipped (recipients=${recipients.length})`);
    return { sent: 0, failed: 0 };
  }

  const info         = partyInfo || {};
  const venueName    = escapeHtml(info.venue_name    || '');
  const venueAddress = escapeHtml(info.venue_address || '');
  const partyDate    = escapeHtml(info.date          || '');
  const mapsLink     = info.venue_maps_link
    || (info.venue_address
          ? `https://www.google.com/maps/search/${encodeURIComponent(info.venue_address)}`
          : '');

  const partyUrl = `${APP_URL}/#/party`;

  // The body is identical per recipient within a locale, so render once per
  // distinct locale (two entries at most: en/is).
  const rendered = new Map(); // locale -> { subject, html }
  function renderFor(locale) {
    if (rendered.has(locale)) return rendered.get(locale);
    const finalSubject = (subject && subject.trim()) || t(locale, 'email.partyAnnouncement.subject');
    const introText    = (body && body.trim())    || t(locale, 'email.partyAnnouncement.intro');
    const signoffText  = t(locale, 'email.partyAnnouncement.signoff');
    // Render the host's body as plain text with line breaks preserved. Escape
    // first, then turn newlines into <br/> so a literal "<br/>" in the body
    // stays escaped.
    const bodyHtml = escapeHtml(introText).replace(/\n/g, '<br/>');
    const heading  = t(locale, 'email.partyAnnouncement.heading');
    const html = emailShell(finalSubject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#cccccc;line-height:1.6;">
      ${bodyHtml}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background-color:#0d0d0d;border-radius:8px;border:1px solid #222;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${t(locale, 'email.rsvpConfirmation.whenWhere')}</p>
          ${partyDate    ? `<p style="margin:0 0 4px;font-size:17px;color:#c9a84c;font-weight:600;">${partyDate}</p>` : ''}
          ${venueName    ? `<p style="margin:0;font-size:15px;color:#e0e0e0;">${venueName}</p>` : ''}
          ${venueAddress ? `<p style="margin:4px 0 0;font-size:13px;color:#888;">${venueAddress}</p>` : ''}
          ${mapsLink     ? `<p style="margin:12px 0 0;font-size:13px;"><a href="${escapeHtml(mapsLink)}" style="color:#c9a84c;text-decoration:none;">${t(locale, 'email.rsvpConfirmation.openMaps')}</a></p>` : ''}
        </td>
      </tr>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${partyUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.partyAnnouncement.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      ${escapeHtml(signoffText)}
    </p>
  `, locale);
    const entry = { subject: finalSubject, html };
    rendered.set(locale, entry);
    return entry;
  }

  // Fan out one-by-one so no recipient sees another's address. Use
  // allSettled so one bounce doesn't abort the rest of the send. Accepts
  // legacy plain-string recipients (treated as Icelandic default).
  const client = getClient();
  const results = await Promise.allSettled(
    recipients.map(r => {
      const to = typeof r === 'string' ? r : r.email;
      const { subject: finalSubject, html } = renderFor((typeof r === 'object' && r.locale) || 'is');
      return client.emails.send({ from: FROM, to, subject: finalSubject, html });
    })
  );

  let sent = 0, failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && !r.value.error) sent++;
    else {
      failed++;
      const msg = r.status === 'rejected' ? r.reason?.message : r.value?.error?.message;
      // Log the index, not the address — index is enough to correlate with
      // the recipient list at the call site without leaking PII into logs.
      console.error(`[EmailService] Party announcement send failed (idx=${i}): ${msg}`);
    }
  });
  console.log(`[EmailService] Party announcement: sent=${sent} failed=${failed} total=${recipients.length}`);
  return { sent, failed };
}

// ── Party sign-up notification to admins ──────────────────────────────────────
// Fires when someone submits the sign-up form on the party page. Sent in
// Icelandic (the owner is the audience). The default path auto-grants access,
// so the primary button now means "send the party-info email" (one-click
// confirm page at approveUrl); `granted: false` marks the manual-review
// variant (a previously declined/revoked guest re-requesting), where the same
// button still gates access. A secondary link points at the full party admin.

async function sendPartyRequestNotification({ request, adminEmails, approveUrl, granted = true }) {
  if (!adminEmails || adminEmails.length === 0) return;
  if (!isConfigured()) {
    console.log('[EmailService] Resend not configured — party request notification skipped');
    return;
  }

  const locale   = 'is';
  const name     = request.name || request.email;
  const subject  = t(locale, 'email.partyRequest.subject', { name });
  const adminUrl = `${APP_URL}/is/party/admin`;
  const bodyKey  = granted ? 'email.partyRequest.body' : 'email.partyRequest.bodyManual';

  const html = emailShell(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:#e0e0e0;">${escapeHtml(t(locale, 'email.partyRequest.heading'))}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${t(locale, bodyKey)}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-top:1px solid #222;border-bottom:1px solid #222;">
      <tr>
        <td style="padding:10px 0;color:#666;font-size:13px;width:120px;">${t(locale, 'email.partyRequest.nameLabel')}</td>
        <td style="padding:10px 0;color:#e0e0e0;font-size:14px;">${escapeHtml(request.name || '—')}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#666;font-size:13px;border-top:1px solid #1a1a1a;">${t(locale, 'email.partyRequest.emailLabel')}</td>
        <td style="padding:10px 0;color:#e0e0e0;font-size:14px;border-top:1px solid #1a1a1a;">${escapeHtml(request.email)}</td>
      </tr>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${approveUrl}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.partyRequest.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.partyRequest.manage')}<br/>
      <a href="${adminUrl}" style="color:#c9a84c;">${adminUrl}</a>
    </p>
  `, locale);

  const { data, error } = await getClient().emails.send({ from: FROM, to: adminEmails, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Party request notification sent: recipients=${adminEmails.length} id=${data.id}`);
}

// ── Party invite (magic link) to the guest ────────────────────────────────────
// Sent on approval (request flow, admin approval, or owner-initiated invite).
// The link carries a NON-EXPIRING magic-login token — never log it. Localised to
// the guest's preferred locale; mentions the optional password route.

async function sendPartyInviteEmail({ to, name, token, locale = 'is' }) {
  const link = `${APP_URL}/${encodeURIComponent(locale)}/party/login?token=${token}&locale=${encodeURIComponent(locale)}`;

  if (!isConfigured()) {
    // Do NOT log the token or full link — it is credential-equivalent.
    console.log('[EmailService] Resend not configured — party invite email skipped (retrieve magic token from DB)');
    return;
  }

  const displayName = (name && name.trim()) || t(locale, 'email.partyInvite.fallbackName');
  const subject = t(locale, 'email.partyInvite.subject');
  const html = emailShell(subject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">${escapeHtml(t(locale, 'email.partyInvite.heading'))}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${t(locale, 'email.partyInvite.body', { name: escapeHtml(displayName) })}
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${link}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.partyInvite.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 24px;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.partyInvite.fallback')}<br/>
      <a href="${link}" style="color:#c9a84c;word-break:break-all;">${link}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      ${t(locale, 'email.partyInvite.passwordNote')}
    </p>
  `, locale);

  const { data, error } = await getClient().emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Party invite email sent: id=${data.id}`);
}

// ── Party welcome / info email to the guest ───────────────────────────────────
// Sent when the owner "approves" a guest (one-click email link or the admin
// queue) — the party-info package: schedule, venue, activities, good-to-know.
// Renders from the LIVE party info (services/partyInfo.readPartyInfo) at send
// time, so the owner edits content on the party page and simply re-sends.
// Structured sections (schedule/venue_details/activities) arrive as JSON
// strings; each section is skipped when its data is missing or unparseable so
// a half-filled party page still yields a clean email.

function _parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

// Escape first, then preserve intentional line breaks — party-page content
// (schedule entries, activity descriptions) uses \n inside a single entry.
function _escapeMultiline(value) {
  return escapeHtml(String(value)).replace(/\n/g, '<br/>');
}

async function sendPartyWelcomeEmail({ user, partyInfo, locale = 'is' }) {
  if (!user?.email) return;
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — party welcome email skipped (user=${user.id})`);
    return;
  }

  const info = partyInfo || {};
  const name = (user.display_name && user.display_name.trim())
    || user.username
    || t(locale, 'email.partyInvite.fallbackName');

  const subject  = t(locale, 'email.partyWelcome.subject');
  const partyUrl = `${APP_URL}/${encodeURIComponent(locale)}/party`;

  // ── When & where card (same visual language as the RSVP confirmation) ──
  const venueName    = escapeHtml(info.venue_name    || '');
  const venueAddress = escapeHtml(info.venue_address || '');
  const partyDate    = escapeHtml(info.date          || '');
  const mapsLink     = info.venue_maps_link
    || (info.venue_address
          ? `https://www.google.com/maps/search/${encodeURIComponent(info.venue_address)}`
          : '');
  const whenWhereHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background-color:#0d0d0d;border-radius:8px;border:1px solid #222;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${t(locale, 'email.rsvpConfirmation.whenWhere')}</p>
          ${partyDate    ? `<p style="margin:0 0 4px;font-size:17px;color:#c9a84c;font-weight:600;">${partyDate}</p>` : ''}
          ${venueName    ? `<p style="margin:0;font-size:15px;color:#e0e0e0;">${venueName}</p>` : ''}
          ${venueAddress ? `<p style="margin:4px 0 0;font-size:13px;color:#888;">${venueAddress}</p>` : ''}
          ${mapsLink     ? `<p style="margin:12px 0 0;font-size:13px;"><a href="${escapeHtml(mapsLink)}" style="color:#c9a84c;text-decoration:none;">${t(locale, 'email.rsvpConfirmation.openMaps')}</a></p>` : ''}
        </td>
      </tr>
    </table>`;

  // ── Schedule timeline ──
  const schedule = _parseJson(info.schedule);
  let scheduleHtml = '';
  if (Array.isArray(schedule) && schedule.length > 0) {
    const rows = schedule
      .filter(s => s && (s.time || s.event))
      .map(s => `
      <tr>
        <td style="padding:8px 16px 8px 0;color:#c9a84c;font-size:14px;font-weight:600;white-space:nowrap;vertical-align:top;width:60px;">${escapeHtml(String(s.time || ''))}</td>
        <td style="padding:8px 0;color:#e0e0e0;font-size:14px;line-height:1.5;">${_escapeMultiline(s.event || '')}</td>
      </tr>`).join('');
    if (rows) {
      scheduleHtml = `
    <h3 style="margin:0 0 12px;font-size:17px;color:#c9a84c;">${escapeHtml(t(locale, 'email.partyWelcome.scheduleHeading'))}</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-top:1px solid #222;border-bottom:1px solid #222;">
      ${rows}
    </table>`;
    }
  }

  // ── Venue details (hall / spa bullet lists) ──
  const details = _parseJson(info.venue_details);
  let venueDetailsHtml = '';
  if (details && (Array.isArray(details.hall) || Array.isArray(details.spa))) {
    const list = (items) => (Array.isArray(items) ? items : [])
      .filter(Boolean)
      .map(item => `<li style="margin:0 0 6px;color:#aaa;font-size:14px;line-height:1.5;">${escapeHtml(String(item))}</li>`)
      .join('');
    const hallItems = list(details.hall);
    const spaItems  = list(details.spa);
    if (hallItems || spaItems) {
      venueDetailsHtml = `
    <h3 style="margin:0 0 12px;font-size:17px;color:#c9a84c;">${escapeHtml(t(locale, 'email.partyWelcome.venueHeading'))}</h3>
    ${hallItems ? `
    <p style="margin:0 0 6px;font-size:13px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(t(locale, 'email.partyWelcome.hallHeading'))}</p>
    <ul style="margin:0 0 16px;padding:0 0 0 20px;">${hallItems}</ul>` : ''}
    ${spaItems ? `
    <p style="margin:0 0 6px;font-size:13px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(t(locale, 'email.partyWelcome.spaHeading'))}</p>
    <ul style="margin:0 0 16px;padding:0 0 0 20px;">${spaItems}</ul>` : ''}
    <div style="margin:0 0 12px;"></div>`;
    }
  }

  // ── Activities (daytime / evening) ──
  const activities = _parseJson(info.activities);
  let activitiesHtml = '';
  if (activities && (Array.isArray(activities.daytime) || Array.isArray(activities.evening))) {
    const group = (items) => (Array.isArray(items) ? items : [])
      .filter(a => a && (a.name || a.description))
      // Hide the seed placeholders — a TBD row helps nobody in an email.
      .filter(a => String(a.name || '').trim().toUpperCase() !== 'TBD')
      .map(a => `
      <tr>
        <td style="padding:8px 0;">
          <p style="margin:0;font-size:14px;color:#e0e0e0;font-weight:600;">${escapeHtml(String(a.name || ''))}</p>
          ${a.description ? `<p style="margin:2px 0 0;font-size:13px;color:#888;line-height:1.5;">${_escapeMultiline(a.description)}</p>` : ''}
          ${a.rules ? `<p style="margin:2px 0 0;font-size:12px;color:#666;line-height:1.5;">${escapeHtml(String(a.rulesLabel || ''))} ${_escapeMultiline(a.rules)}</p>` : ''}
        </td>
      </tr>`).join('');
    const daytimeRows = group(activities.daytime);
    const eveningRows = group(activities.evening);
    if (daytimeRows || eveningRows) {
      activitiesHtml = `
    <h3 style="margin:0 0 12px;font-size:17px;color:#c9a84c;">${escapeHtml(t(locale, 'email.partyWelcome.activitiesHeading'))}</h3>
    ${daytimeRows ? `
    <p style="margin:0 0 4px;font-size:13px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(t(locale, 'email.partyWelcome.daytimeHeading'))}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${daytimeRows}</table>` : ''}
    ${eveningRows ? `
    <p style="margin:0 0 4px;font-size:13px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(t(locale, 'email.partyWelcome.eveningHeading'))}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${eveningRows}</table>` : ''}
    <div style="margin:0 0 12px;"></div>`;
    }
  }

  // ── Good to know (fixed i18n copy) ──
  const goodToKnowItems = ['goodToKnow1', 'goodToKnow2', 'goodToKnow3', 'goodToKnow4']
    .map(k => `<li style="margin:0 0 8px;color:#aaa;font-size:14px;line-height:1.5;">${t(locale, `email.partyWelcome.${k}`)}</li>`)
    .join('');
  const goodToKnowHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background-color:#0d0d0d;border-radius:8px;border:1px solid #222;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 10px;font-size:12px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(t(locale, 'email.partyWelcome.goodToKnowHeading'))}</p>
          <ul style="margin:0;padding:0 0 0 20px;">${goodToKnowItems}</ul>
        </td>
      </tr>
    </table>`;

  const html = emailShell(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:#e0e0e0;">${escapeHtml(t(locale, 'email.partyWelcome.heading'))}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      ${t(locale, 'email.partyWelcome.intro', { name: escapeHtml(name) })}
    </p>
    ${whenWhereHtml}
    ${scheduleHtml}
    ${venueDetailsHtml}
    ${activitiesHtml}
    ${goodToKnowHtml}
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${partyUrl}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            ${t(locale, 'email.partyWelcome.button')}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:14px;color:#888;line-height:1.6;">
      ${t(locale, 'email.partyWelcome.closing')}
    </p>
  `, locale);

  const { data, error } = await getClient().emails.send({ from: FROM, to: user.email, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Party welcome email sent: user=${user.id} id=${data.id}`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendOrderReceipt, sendBookingNotification, sendRsvpNotification, sendRsvpConfirmation, sendPartyAnnouncement, sendPartyRequestNotification, sendPartyInviteEmail, sendPartyWelcomeEmail, emailHealthCheck, isConfigured };
