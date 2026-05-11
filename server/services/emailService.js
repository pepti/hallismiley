// Email service using Resend API.
// Falls back to a no-op with a console notice when RESEND_API_KEY is not set (dev/test mode).
const { Resend } = require('resend');
const { t }      = require('../i18n');

const APP_URL   = process.env.APP_URL || 'https://www.hallismiley.is';
const FROM_ADDR = process.env.EMAIL_FROM || 'noreply@hallismiley.is';
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

async function sendOrderReceipt(order, items, locale = 'en') {
  const to = order.guest_email || order.user_email;
  if (!to) {
    console.warn(`[EmailService] No recipient for order ${order.order_number} receipt`);
    return;
  }

  const orderUrl = `${APP_URL}/#/checkout/success?session_id=${encodeURIComponent(order.stripe_session_id || '')}`;

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

// ── RSVP notification to admins ───────────────────────────────────────────────
// Admin notification emails are always sent in English (admins may not all speak Icelandic).

async function sendRsvpNotification({ user, answers, rsvpForm, isUpdate, adminEmails }) {
  if (!adminEmails || adminEmails.length === 0) return;
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — RSVP notification skipped (user=${user.id}, isUpdate=${isUpdate})`);
    return;
  }

  const locale = 'en';
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

  const locale = user.preferred_locale || 'en';
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
// default copy. Always sent in English: the host writes the message himself
// in one language. Returns { sent, failed } so the caller can report partial
// failures (e.g. a single bounce shouldn't blank the whole result).

async function sendPartyAnnouncement({ recipients, subject, body, partyInfo }) {
  if (!Array.isArray(recipients) || recipients.length === 0) return { sent: 0, failed: 0 };
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — party announcement skipped (recipients=${recipients.length})`);
    return { sent: 0, failed: 0 };
  }

  const locale       = 'en';
  const finalSubject = (subject && subject.trim()) || t(locale, 'email.partyAnnouncement.subject');
  const introText    = (body && body.trim())    || t(locale, 'email.partyAnnouncement.intro');
  const signoffText  = t(locale, 'email.partyAnnouncement.signoff');

  // Render the host's body as plain text with line breaks preserved. Escape
  // first, then turn newlines into <br/> so a literal "<br/>" in the body
  // stays escaped.
  const bodyHtml = escapeHtml(introText).replace(/\n/g, '<br/>');

  const info         = partyInfo || {};
  const venueName    = escapeHtml(info.venue_name    || '');
  const venueAddress = escapeHtml(info.venue_address || '');
  const partyDate    = escapeHtml(info.date          || '');
  const mapsLink     = info.venue_maps_link
    || (info.venue_address
          ? `https://www.google.com/maps/search/${encodeURIComponent(info.venue_address)}`
          : '');

  const partyUrl  = `${APP_URL}/#/party`;
  const heading   = t(locale, 'email.partyAnnouncement.heading');

  // Body is identical per recipient (no personalization yet), so render once.
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

  // Fan out one-by-one so no recipient sees another's address. Use
  // allSettled so one bounce doesn't abort the rest of the send.
  const client = getClient();
  const results = await Promise.allSettled(
    recipients.map(to => client.emails.send({ from: FROM, to, subject: finalSubject, html }))
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

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendOrderReceipt, sendRsvpNotification, sendRsvpConfirmation, sendPartyAnnouncement, emailHealthCheck, isConfigured };
