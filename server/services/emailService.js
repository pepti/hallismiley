// Email service using Resend API.
// Falls back to a no-op with a console notice when RESEND_API_KEY is not set (dev/test mode).
const { Resend } = require('resend');

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

function emailShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
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
                You received this email from <a href="${APP_URL}" style="color:#c9a84c;text-decoration:none;">hallismiley.is</a>.
                If you did not request this, you can safely ignore it.
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

async function sendVerificationEmail(to, token) {
  const link = `${APP_URL}/#/verify-email?token=${token}`;

  if (!isConfigured()) {
    // Do NOT log the token or the full link — they are credential-equivalent.
    // In development, retrieve the token directly from the database:
    //   SELECT email_verify_token FROM users WHERE email = '...';
    console.log('[EmailService] Resend not configured — verification email skipped (retrieve token from DB)');
    return;
  }

  const subject = 'Verify your Halli Smiley account';
  const html = emailShell(subject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">Verify your email</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      Thanks for signing up! Click the button below to verify your email address
      and activate your account. This link expires in <strong style="color:#c9a84c;">24 hours</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${link}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            Verify Email Address
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      Or paste this link into your browser:<br/>
      <a href="${link}" style="color:#c9a84c;word-break:break-all;">${link}</a>
    </p>
  `);

  // Log the Resend message ID (not the recipient address — that's PII)
  const { data, error } = await getClient().emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Verification email sent: id=${data.id}`);
}

// ── Password reset email ──────────────────────────────────────────────────────

async function sendPasswordResetEmail(to, token) {
  const link = `${APP_URL}/#/reset-password?token=${token}`;

  if (!isConfigured()) {
    // Do NOT log the token or the full link — they are credential-equivalent.
    // In development, retrieve the token directly from the database:
    //   SELECT password_reset_token FROM users WHERE email = '...';
    console.log('[EmailService] Resend not configured — password reset email skipped (retrieve token from DB)');
    return;
  }

  const subject = 'Reset your Halli Smiley password';
  const html = emailShell(subject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">Reset your password</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      We received a request to reset the password for your account. Click the button
      below to choose a new password. This link expires in <strong style="color:#c9a84c;">1 hour</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${link}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:13px;color:#555;line-height:1.6;">
      Or paste this link into your browser:<br/>
      <a href="${link}" style="color:#c9a84c;word-break:break-all;">${link}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#444;">
      If you did not request a password reset, no action is needed — your password remains unchanged.
    </p>
  `);

  // Log the Resend message ID (not the recipient address — that's PII)
  const { data, error } = await getClient().emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Password reset email sent: id=${data.id}`);
}

// ── Order receipt email ───────────────────────────────────────────────────────

function formatMoney(amount, currency) {
  if (currency === 'ISK') {
    return `${Number(amount).toLocaleString('is-IS')} kr.`;
  }
  if (currency === 'EUR') {
    return `€${(Number(amount) / 100).toFixed(2)}`;
  }
  return `${amount} ${currency}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendOrderReceipt(order, items) {
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
        ${formatMoney(it.product_price_snapshot * it.quantity, order.currency)}
      </td>
    </tr>
  `).join('');

  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — order receipt for ${order.order_number} skipped`);
    return;
  }

  const subject = `Your Halli Smiley order ${order.order_number}`;
  const html = emailShell(subject, `
    <h2 style="margin:0 0 16px;font-size:22px;color:#e0e0e0;">Thank you for your order</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      Your order <strong style="color:#c9a84c;">${escapeHtml(order.order_number)}</strong>
      has been received. A confirmation of the full details is below.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #222;">
      ${itemsHtml}
      <tr>
        <td style="padding:12px 0 8px;color:#666;font-size:13px;border-top:1px solid #222;">Subtotal</td>
        <td style="padding:12px 0 8px;color:#aaa;font-size:13px;text-align:right;border-top:1px solid #222;">
          ${formatMoney(order.subtotal, order.currency)}
        </td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#666;font-size:13px;">Shipping (${escapeHtml(order.shipping_method === 'local_pickup' ? 'Local pickup' : 'Shipping')})</td>
        <td style="padding:4px 0;color:#aaa;font-size:13px;text-align:right;">
          ${formatMoney(order.shipping, order.currency)}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0 0;color:#e0e0e0;font-size:16px;font-weight:600;border-top:1px solid #222;">Total</td>
        <td style="padding:12px 0 0;color:#c9a84c;font-size:16px;font-weight:600;text-align:right;border-top:1px solid #222;">
          ${formatMoney(order.total, order.currency)}
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:12px;color:#555;">
      Price includes 24% VAT (VSK).
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${orderUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            View Order
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      Questions? Reply to this email and we'll get back to you.
    </p>
  `);

  const { data, error } = await getClient().emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] Order receipt sent: order=${order.order_number} id=${data.id}`);
}

// ── RSVP notification to admins ───────────────────────────────────────────────

async function sendRsvpNotification({ user, answers, rsvpForm, isUpdate, adminEmails }) {
  if (!adminEmails || adminEmails.length === 0) return;
  if (!isConfigured()) {
    console.log(`[EmailService] Resend not configured — RSVP notification skipped (user=${user.id}, isUpdate=${isUpdate})`);
    return;
  }

  const name = user.display_name || user.username || user.email;
  const subject = isUpdate
    ? `RSVP updated: ${name}`
    : `New RSVP from ${name}`;

  const fields = Array.isArray(rsvpForm) ? rsvpForm : [];
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
  const heading  = isUpdate ? 'An RSVP was updated' : 'A new RSVP came in';

  const html = emailShell(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:#e0e0e0;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      <strong style="color:#c9a84c;">${escapeHtml(name)}</strong>
      (${escapeHtml(user.email || '')}) ${isUpdate ? 'updated their RSVP' : 'sent an RSVP'}.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #222;">
      ${answerRows || rawRows || `<tr><td style="padding:8px 0;color:#666;font-size:13px;">(no answers)</td></tr>`}
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${partyUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            Open Party Admin
          </a>
        </td>
      </tr>
    </table>
  `);

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

  const name = user.display_name || user.username || 'there';
  const subject = isUpdate
    ? "Your RSVP to Halli's 40th — updated"
    : "Your RSVP to Halli's 40th — we've got it!";

  const fields = Array.isArray(rsvpForm) ? rsvpForm : [];
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
  const headline = isUpdate
    ? 'Your RSVP has been updated'
    : "You're on the list! 🎉";

  const html = emailShell(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:#e0e0e0;">${escapeHtml(headline)}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
      Hi ${escapeHtml(name)} — ${isUpdate
        ? "your updated answers are saved. Here's what we have:"
        : "thanks for letting Halli know you'll be there. Here's a copy of your answers:"}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-top:1px solid #222;">
      ${answerRows || `<tr><td style="padding:8px 0;color:#666;font-size:13px;">(no answers on file)</td></tr>`}
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background-color:#0d0d0d;border-radius:8px;border:1px solid #222;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#666;letter-spacing:1.5px;text-transform:uppercase;">When &amp; where</p>
          <p style="margin:0 0 4px;font-size:17px;color:#c9a84c;font-weight:600;">${partyDate}</p>
          ${venueName    ? `<p style="margin:0;font-size:15px;color:#e0e0e0;">${venueName}</p>` : ''}
          ${venueAddress ? `<p style="margin:4px 0 0;font-size:13px;color:#888;">${venueAddress}</p>` : ''}
          ${mapsLink     ? `<p style="margin:12px 0 0;font-size:13px;"><a href="${escapeHtml(mapsLink)}" style="color:#c9a84c;text-decoration:none;">📍 Open in Google Maps</a></p>` : ''}
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:15px;color:#aaa;line-height:1.6;">
      Need to change anything? You can update your RSVP any time:
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#c9a84c;border-radius:8px;">
          <a href="${partyUrl}"
             style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                    color:#0a0a0a;text-decoration:none;letter-spacing:0.5px;">
            Update RSVP
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
      Can't wait to celebrate with you!
    </p>
  `);

  const { data, error } = await getClient().emails.send({ from: FROM, to: user.email, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[EmailService] RSVP confirmation sent: user=${user.id} isUpdate=${isUpdate} id=${data.id}`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendOrderReceipt, sendRsvpNotification, sendRsvpConfirmation, emailHealthCheck, isConfigured };
