import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { BoletosModule } from '../boletos/boletos.module';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';
import { DisparosAgendadosService } from './disparos-agendados.service';

@Module({
  imports: [NotificationsModule, ConversationsModule, BoletosModule],
  controllers: [ChargesController],
  providers: [ChargesService, DisparosAgendadosService],
  exports: [ChargesService, DisparosAgendadosService],
})
export class ChargesModule {}
