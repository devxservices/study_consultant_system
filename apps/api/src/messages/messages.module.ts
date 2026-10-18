import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [CasesModule],
  controllers: [MessagesController],
  providers: [MessagesService, ChatGateway],
  exports: [MessagesService],
})
export class MessagesModule {}
