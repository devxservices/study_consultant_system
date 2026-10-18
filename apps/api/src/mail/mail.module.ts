import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MessagingService } from './messaging.service';

/** Global: notifications, receipts and reminders all send. */
@Global()
@Module({
  providers: [MailService, MessagingService],
  exports: [MailService, MessagingService],
})
export class MailModule {}
