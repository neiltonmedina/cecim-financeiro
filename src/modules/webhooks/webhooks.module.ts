import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { BoletosModule } from '../boletos/boletos.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [ConversationsModule, BoletosModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
