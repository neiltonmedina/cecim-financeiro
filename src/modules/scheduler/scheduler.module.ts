import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [NotificationsModule, ConversationsModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
