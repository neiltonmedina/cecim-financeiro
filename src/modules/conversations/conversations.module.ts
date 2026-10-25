import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BoletosModule } from '../boletos/boletos.module';
import { ConversationsController } from './conversations.controller';
import { CaixaEntradaController } from './caixa-entrada.controller';
import { ConversationsService } from './conversations.service';
import { ClaudeAgentService } from './claude-agent.service';

@Module({
  imports: [NotificationsModule, BoletosModule],
  controllers: [ConversationsController, CaixaEntradaController],
  providers: [ConversationsService, ClaudeAgentService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
