import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BoletosModule } from '../boletos/boletos.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SystemController } from './system.controller';
import { CronController } from './cron.controller';

@Module({
  imports: [NotificationsModule, BoletosModule, SchedulerModule],
  controllers: [SystemController, CronController],
})
export class SystemModule {}
