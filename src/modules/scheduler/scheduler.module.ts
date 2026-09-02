import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [NotificationsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
