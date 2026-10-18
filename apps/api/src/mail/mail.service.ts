import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Shown as the sender's name - the consultancy's, not the platform's. */
  fromName?: string;
  attachments?: MailAttachment[];
}

/**
 * Outgoing email - receipts, document decisions, reminders.
 *
 * MAIL_DRIVER=log (the default) renders each message exactly as it would be
 * sent and writes it as an .eml file under MAIL_OUTBOX_DIR, so development
 * needs no mail server and every email can be opened and checked. smtp sends
 * through any SMTP server.
 *
 * Sending never throws: like a notification, an email that cannot go out must
 * not undo the payment or the decision it was about. Failures are logged.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: Transporter | null = null;

  private transporter(): Transporter {
    if (this.transport) return this.transport;
    const cfg = env();
    this.transport =
      cfg.MAIL_DRIVER === 'smtp'
        ? nodemailer.createTransport({
            host: cfg.SMTP_HOST,
            port: cfg.SMTP_PORT,
            secure: cfg.SMTP_SECURE,
            auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
          })
        : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    return this.transport;
  }

  async send(message: MailMessage): Promise<boolean> {
    const cfg = env();
    const from = message.fromName
      ? { name: message.fromName, address: addressOf(cfg.MAIL_FROM) }
      : cfg.MAIL_FROM;
    try {
      const info = await this.transporter().sendMail({
        from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      });
      if (cfg.MAIL_DRIVER === 'log') {
        const dir = path.resolve(process.cwd(), cfg.MAIL_OUTBOX_DIR);
        await fs.mkdir(dir, { recursive: true });
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.eml`;
        await fs.writeFile(path.join(dir, name), (info as { message: Buffer }).message);
      }
      return true;
    } catch (err) {
      this.logger.error(`email to ${message.to} not sent: ${(err as Error).message}`);
      return false;
    }
  }
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from)!.trim();
}

/** Plain text in, the same text as simple HTML out: escaped, paragraphs kept. */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div style="font-family:system-ui,Segoe UI,sans-serif;font-size:14px;line-height:1.55;color:#14213d">${escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}
