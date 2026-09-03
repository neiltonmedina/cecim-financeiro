import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [ConversationsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
