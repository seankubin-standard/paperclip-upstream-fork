/**
 * Email transport for auth flows (password reset, etc.).
 *
 * Provider selection via EMAIL_PROVIDER env var:
 *   "resend" (default) — Resend REST API, zero extra deps.
 *   "smtp"             — Generic SMTP via nodemailer (add nodemailer to deps when needed).
 *
 * Required env vars by provider:
 *   Resend: RESEND_API_KEY, EMAIL_FROM (e.g. "Dr. Clippy <noreply@drclippy.com>")
 *   SMTP:   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 *
 * If no provider is configured, email sending is a no-op (login shell / dev mode).
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type EmailTransport = {
  send(msg: EmailMessage): Promise<void>;
};

function buildResendTransport(apiKey: string, from: string): EmailTransport {
  return {
    async send(msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "(no body)");
        throw new Error(`Resend API error ${res.status}: ${body}`);
      }
    },
  };
}

function buildSmtpTransport(opts: {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}): EmailTransport {
  // nodemailer is an optional peer dep — only require it when SMTP is configured.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require("nodemailer") as typeof import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 465,
    auth: { user: opts.user, pass: opts.pass },
  });
  return {
    async send(msg) {
      await transporter.sendMail({
        from: opts.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
    },
  };
}

let _transport: EmailTransport | null | undefined;

function resolveTransport(): EmailTransport | null {
  if (_transport !== undefined) return _transport;

  const provider = (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase().trim();
  const from = process.env.EMAIL_FROM?.trim() ?? "Dr. Clippy <noreply@drclippy.com>";

  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      _transport = null;
      return null;
    }
    _transport = buildResendTransport(apiKey, from);
    return _transport;
  }

  if (provider === "smtp") {
    const host = process.env.SMTP_HOST?.trim();
    const port = parseInt(process.env.SMTP_PORT?.trim() ?? "587", 10);
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    if (!host || !user || !pass) {
      _transport = null;
      return null;
    }
    _transport = buildSmtpTransport({ host, port, user, pass, from });
    return _transport;
  }

  _transport = null;
  return null;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const transport = resolveTransport();
  if (!transport) {
    // Log to stderr so ops can see dropped emails during dev/misconfigured installs.
    process.stderr.write(
      `[auth/email] No email transport configured — dropping email to ${msg.to}: ${msg.subject}\n`,
    );
    return;
  }
  await transport.send(msg);
}

export function buildPasswordResetEmail(opts: {
  userName: string;
  resetUrl: string;
  appName?: string;
}): { subject: string; html: string; text: string } {
  const app = opts.appName ?? "Dr. Clippy";
  const subject = `Reset your ${app} password`;
  const text = [
    `Hi ${opts.userName},`,
    "",
    `Someone requested a password reset for your ${app} account.`,
    `Click the link below to choose a new password (valid for 1 hour):`,
    "",
    opts.resetUrl,
    "",
    `If you did not request this, you can safely ignore this email — your password won't change.`,
    "",
    `— The ${app} team`,
  ].join("\n");
  const html = `
<p>Hi ${opts.userName},</p>
<p>Someone requested a password reset for your <strong>${app}</strong> account.</p>
<p><a href="${opts.resetUrl}" style="display:inline-block;padding:10px 20px;background:#e87600;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Reset my password</a></p>
<p style="color:#666;font-size:13px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
<p>— The ${app} team</p>
`;
  return { subject, html, text };
}
