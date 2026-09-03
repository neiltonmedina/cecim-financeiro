import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { SmsTwilioProvider } from './providers/sms-twilio.provider';
import { EmailSmtpProvider } from './providers/email-smtp.provider';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: NOTIFICATIONS_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          tls: config.get<boolean>('redis.tls') ? {} : undefined,
        },
      }),
    }),
  ],
  providers: [NotificationsService, NotificationsProcessor, WhatsAppProvider, SmsTwilioProvider, EmailSmtpProvider],
  exports: [NotificationsService, WhatsAppProvider, EmailSmtpProvider],
})
export class NotificationsModule {}
