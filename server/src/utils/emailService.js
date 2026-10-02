const nodemailer = require('nodemailer');
const path = require('path');

// Ensure environment configuration is loaded before accessing process.env
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env.secrets'), override: true });

/**
 * Validates whether required SMTP credentials are present
 */
function isSmtpConfigured() {
  const user = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '').trim();
  return Boolean(user && pass);
}

/**
 * Build Nodemailer transporter using environment variables
 * Configured for Gmail SMTP over port 587 using STARTTLS
 */
function getTransporter() {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || (port === 465 && process.env.SMTP_SECURE !== 'false');
  const user = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const rawPass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '').trim();

  // For Gmail App Passwords (16 characters formatted in groups of 4), strip spaces for SMTP authentication
  const pass = host.includes('gmail.com') ? rawPass.replace(/\s+/g, '') : rawPass;

  if (user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure, // false on port 587 (uses STARTTLS)
      auth: {
        user,
        pass
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      }
    });
  }
  return null;
}

/**
 * Resolve sender address from environment variables
 */
function getSenderAddress() {
  const from = (process.env.SMTP_FROM || '').trim();
  const user = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  if (from) {
    if (from.includes('<')) return from;
    return `"SyncNote Security" <${from}>`;
  }
  if (user) {
    return `"SyncNote Security" <${user}>`;
  }
  return '"SyncNote Security" <no-reply@syncnote.app>';
}

/**
 * Dispatch 6-digit OTP verification email for password recovery
 * Strictly adheres to security requirements:
 * - Never logs OTP values or recipient OTP information
 * - Never logs SMTP passwords or sensitive authentication data
 */
async function sendPasswordResetOtpEmail({ toEmail, otp }) {
  const cleanEmail = (toEmail || '').trim().toLowerCase();

  if (!isSmtpConfigured()) {
    console.warn('[Email Service] SMTP credentials not configured. Please set SMTP_USER and SMTP_PASS in environment variables.');
    return { success: false, error: 'SMTP credentials not configured' };
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Email Service] Unable to initialize SMTP transporter.');
    return { success: false, error: 'SMTP transporter initialization failed' };
  }

  const from = getSenderAddress();
  const subject = 'Your SyncNote Password Reset Verification Code';
  const text = `Hello,\n\nYou recently requested to reset your password for your SyncNote account.\n\nYour 6-digit verification code is: ${otp}\n\nThis code will expire in 10 minutes. If you did not request a password reset, you can safely ignore this email.\n\nBest regards,\nSyncNote Security Team`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; color: #111827;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 44px; height: 44px; background: #0070f3; color: #ffffff; border-radius: 10px; font-size: 22px; font-weight: 800; line-height: 44px; text-align: center;">S</div>
        <h2 style="font-size: 20px; font-weight: 800; margin: 12px 0 4px 0; color: #111827;">SyncNote Password Reset</h2>
        <p style="font-size: 13px; color: #6b7280; margin: 0;">Account Verification Code</p>
      </div>
      <p style="font-size: 14px; line-height: 1.6; color: #374151; margin-bottom: 20px;">
        Hello,<br/><br/>
        We received a request to reset the password for your SyncNote account. Enter the following 6-digit verification code to proceed:
      </p>
      <div style="text-align: center; margin: 28px 0; padding: 20px 24px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0;">
        <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0070f3; font-family: monospace;">${otp}</span>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #6b7280; margin-bottom: 20px;">
        ⏰ This verification code will expire in <strong>10 minutes</strong> and can only be used once.<br/>
        🔒 If you did not request a password reset, you can safely ignore this email; your password will remain unchanged. Never share this code with anyone.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
        SyncNote • Offline-First Intelligent Knowledge Management Platform
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to: cleanEmail,
      subject,
      text,
      html
    });
    console.log('[Email Service] Password reset OTP email sent successfully.');
    return { success: true, delivered: true };
  } catch (err) {
    console.error('[Email Service] Failed to send OTP email');
    return { success: false, error: 'Failed to send OTP email' };
  }
}

module.exports = {
  sendPasswordResetOtpEmail,
  isSmtpConfigured,
  getTransporter,
  getSenderAddress
};
