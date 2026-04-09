// Email service using nodemailer with Google Workspace SMTP.
// Falls back to console logging when SMTP is not configured (dev/test mode).
const nodemailer = require('nodemailer');

const APP_URL     = process.env.APP_URL || 'https://www.hallismiley.is';
const FROM_NAME   = 'Halli Smiley';
const FROM_ADDR   = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@hallismiley.is';
const FROM        = `${FROM_NAME} <${FROM_ADDR}>`;

function isSmtpConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host:              'smtp.gmail.com',
    port:              587,
    secure:            false,
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     15000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
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

  if (!isSmtpConfigured()) {
    console.log(`[EmailService] SMTP not configured — verification link for ${to}:`);
    console.log(`  ${link}`);
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

  console.log(`[EmailService] Sending verification email to ${to} from ${FROM}`);
  const info = await createTransport().sendMail({ from: FROM, to, subject, html });
  console.log(`[EmailService] Verification email sent: messageId=${info.messageId}, response=${info.response}`);
}

// ── Password reset email ──────────────────────────────────────────────────────

async function sendPasswordResetEmail(to, token) {
  const link = `${APP_URL}/#/reset-password?token=${token}`;

  if (!isSmtpConfigured()) {
    console.log(`[EmailService] SMTP not configured — password reset link for ${to}:`);
    console.log(`  ${link}`);
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

  console.log(`[EmailService] Sending password reset email to ${to} from ${FROM}`);
  const info = await createTransport().sendMail({ from: FROM, to, subject, html });
  console.log(`[EmailService] Password reset email sent: messageId=${info.messageId}, response=${info.response}`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
