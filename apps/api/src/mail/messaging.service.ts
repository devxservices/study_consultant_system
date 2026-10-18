import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

export type MessageChannel = 'whatsapp' | 'sms';

export interface OutgoingMessage {
  channel: MessageChannel;
  /** E.164, e.g. +923001234567. */
  to: string;
  body: string;
}

/**
 * WhatsApp and SMS.
 *
 * MESSAGING_DRIVER=log (the default) appends each message to
 * MAIL_OUTBOX_DIR/messages.log and sends nothing. 'twilio' sends through
 * Twilio's REST API for both channels; WhatsApp business-initiated messages
 * must use a template Meta has approved, which is the consultancy's to set up
 * with Twilio. Like email, a failure is logged and never undoes the action.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  async send(message: OutgoingMessage): Promise<boolean> {
    const cfg = env();
    const to = normalisePhone(message.to);
    if (!to) {
      this.logger.warn(`${message.channel} not sent: "${message.to}" is not a phone number`);
      return false;
    }
    try {
      if (cfg.MESSAGING_DRIVER === 'twilio') {
        const from = message.channel === 'whatsapp' ? cfg.TWILIO_WHATSAPP_FROM : cfg.TWILIO_SMS_FROM;
        if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN || !from) {
          throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender number are required');
        }
        const prefix = message.channel === 'whatsapp' ? 'whatsapp:' : '';
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              authorization: `Basic ${Buffer.from(`${cfg.TWILIO_ACCOUNT_SID}:${cfg.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ From: `${prefix}${from}`, To: `${prefix}${to}`, Body: message.body }),
          },
        );
        if (!res.ok) throw new Error(`Twilio answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } else {
        const dir = path.resolve(process.cwd(), cfg.MAIL_OUTBOX_DIR);
        await fs.mkdir(dir, { recursive: true });
        await fs.appendFile(
          path.join(dir, 'messages.log'),
          `${JSON.stringify({ at: new Date().toISOString(), ...message, to })}\n`,
        );
      }
      return true;
    } catch (err) {
      this.logger.error(`${message.channel} to ${to} not sent: ${(err as Error).message}`);
      return false;
    }
  }
}

/** Digits and a leading +; a Pakistani 03xx number becomes +923xx. Null if hopeless. */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.replace(/[\s()-]/g, '');
  if (/^\+\d{7,15}$/.test(trimmed)) return trimmed;
  if (/^00\d{7,15}$/.test(trimmed)) return `+${trimmed.slice(2)}`;
  if (/^03\d{9}$/.test(trimmed)) return `+92${trimmed.slice(1)}`;
  return null;
}
