import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { BoletosModule } from '../boletos/boletos.module';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';
import { DisparosAgendadosService } from './disparos-agendados.service';
import { LotesService } from './lotes.service';
import { LotesController } from './lotes.controller';

@Module({
  imports: [NotificationsModule, ConversationsModule, BoletosModule],
  controllers: [ChargesController, LotesController],
  providers: [ChargesService, DisparosAgendadosService, LotesService],
  exports: [ChargesService, DisparosAgendadosService, LotesService],
})
export class ChargesModule {}
