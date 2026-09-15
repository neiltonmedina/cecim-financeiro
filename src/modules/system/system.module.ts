import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BoletosModule } from '../boletos/boletos.module';
import { SystemController } from './system.controller';

@Module({
  imports: [NotificationsModule, BoletosModule],
  controllers: [SystemController],
})
export class SystemModule {}
