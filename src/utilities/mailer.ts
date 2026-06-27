// src/utilities/mailer.ts
// ─────────────────────────────────────────────
// Nodemailer — Gmail SMTP Transporter
// Sends all transactional emails from jadvixwork@gmail.com
// ─────────────────────────────────────────────

import nodemailer, { Transporter } from "nodemailer";
import { env } from "./env";

// ── Transporter Singleton ──────────────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // false for port 587 (STARTTLS)
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false, // allow self-signed certs in dev
      },
    });
  }
  return transporter;
}

// ── Verify Connection (called on server start) ─

export async function verifyMailerConnection(): Promise<void> {
  try {
    await getTransporter().verify();
    console.log("✅ [Mailer] SMTP connection verified");
  } catch (error) {
    console.warn("⚠️  [Mailer] SMTP connection failed — emails will not send");
    console.warn("   Check SMTP_USER and SMTP_PASS in your .env file");
  }
}

// ── Send Raw Email ──────────────────────────────

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const mailOptions = {
    from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM_ADDRESS}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text ?? options.subject,
  };

  await getTransporter().sendMail(mailOptions);
}

// ── Email Templates ────────────────────────────

function baseTemplate(content: string): string {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>RotaPay</title>
    <style>
      body { margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .wrapper { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px 40px; text-align: center; }
      .header h1 { margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
      .header p { margin: 4px 0 0; color: rgba(255,255,255,0.8); font-size: 14px; }
      .body { padding: 40px; }
      .body p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
      .btn-wrap { text-align: center; margin: 32px 0; }
      .btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 36px; border-radius: 12px; letter-spacing: 0.2px; }
      .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
      .small { color: #9ca3af; font-size: 13px; }
      .footer { background: #f9fafb; padding: 20px 40px; text-align: center; }
      .footer p { margin: 0; color: #9ca3af; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="header">
        <h1>RotaPay</h1>
        <p>Professional Workforce Management</p>
      </div>
      <div class="body">
        ${content}
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} RotaPay. All rights reserved.</p>
        <p style="margin-top:4px;">If you didn't create a RotaPay account, you can safely ignore this email.</p>
      </div>
    </div>
  </body>
  </html>
  `;
}

// ── Template: Email Verification ──────────────

export async function sendVerificationEmail(
  to: string,
  displayName: string | null,
  token: string
): Promise<void> {
  const verifyUrl = `${env.CLIENT_URL}/auth/verify-email?token=${token}`;
  const name = displayName ?? "there";

  const html = baseTemplate(`
    <p>Hi ${name},</p>
    <p>Welcome to <strong>RotaPay</strong>! We're excited to have you on board. Please verify your email address to activate your account.</p>
    <div class="btn-wrap">
      <a href="${verifyUrl}" class="btn">Verify Email Address</a>
    </div>
    <hr class="divider" />
    <p class="small">This link expires in <strong>24 hours</strong>. If the button doesn't work, copy and paste the URL below into your browser:</p>
    <p class="small" style="word-break:break-all;">${verifyUrl}</p>
  `);

  await sendEmail({
    to,
    subject: "Verify your RotaPay email address",
    html,
    text: `Hi ${name},\n\nVerify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
}

// ── Template: Password Reset ───────────────────

export async function sendPasswordResetEmail(
  to: string,
  displayName: string | null,
  token: string
): Promise<void> {
  const resetUrl = `${env.CLIENT_URL}/auth/reset-password?token=${token}`;
  const name = displayName ?? "there";

  const html = baseTemplate(`
    <p>Hi ${name},</p>
    <p>We received a request to reset your RotaPay password. Click the button below to choose a new password.</p>
    <div class="btn-wrap">
      <a href="${resetUrl}" class="btn">Reset My Password</a>
    </div>
    <hr class="divider" />
    <p class="small">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, please ignore this email — your password will not change.</p>
    <p class="small" style="word-break:break-all;">${resetUrl}</p>
  `);

  await sendEmail({
    to,
    subject: "Reset your RotaPay password",
    html,
    text: `Hi ${name},\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });
}

// ── Template: Welcome (post-verify) ───────────

export async function sendWelcomeEmail(
  to: string,
  displayName: string | null
): Promise<void> {
  const name = displayName ?? "there";

  const html = baseTemplate(`
    <p>Hi ${name},</p>
    <p>Your email has been verified and your <strong>RotaPay</strong> account is now fully active. 🎉</p>
    <p>You can now:</p>
    <ul style="color:#374151;font-size:15px;line-height:1.8;padding-left:20px;">
      <li>Add your employers and pay rates</li>
      <li>Schedule and track your shifts</li>
      <li>Clock in and out in real time</li>
      <li>View earnings reports</li>
    </ul>
    <div class="btn-wrap">
      <a href="${env.CLIENT_URL}/dashboard" class="btn">Go to Dashboard</a>
    </div>
  `);

  await sendEmail({
    to,
    subject: "Welcome to RotaPay — Your account is ready!",
    html,
    text: `Hi ${name},\n\nYour RotaPay account is now active. Head to your dashboard: ${env.CLIENT_URL}/dashboard`,
  });
}
