import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ChargesModule } from '../charges/charges.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [NotificationsModule, ConversationsModule, ChargesModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
