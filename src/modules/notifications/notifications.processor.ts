import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { SmsTwilioProvider } from './providers/sms-twilio.provider';
import { EmailSmtpProvider } from './providers/email-smtp.provider';
import { ChannelProvider } from './interfaces/channel-provider.interface';
import { buildTemplateContext, renderTemplate } from './utils/template-renderer.util';

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private readonly providers: Record<Channel, ChannelProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    whatsappProvider: WhatsAppProvider,
    smsProvider: SmsTwilioProvider,
    emailProvider: EmailSmtpProvider,
  ) {
    super();
    this.providers = {
      WHATSAPP: whatsappProvider,
      SMS: smsProvider,
      EMAIL: emailProvider,
    };
  }

  async process(job: Job<{ notificationLogId: string }>): Promise<void> {
    const { notificationLogId } = job.data;

    const log = await this.prisma.notificationLog.findUnique({
      where: { id: notificationLogId },
      include: { charge: { include: { client: true } } },
    });
    if (!log) {
      this.logger.warn(`NotificationLog ${notificationLogId} não encontrado, ignorando job.`);
      return;
    }

    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'SENDING', attempt: job.attemptsMade + 1 },
    });

    try {
      const template = await this.prisma.messageTemplate.findUnique({
        where: { channel_type: { channel: log.channel, type: log.templateType } },
      });
      if (!template || !template.active) {
        throw new Error(`Template ativo não encontrado para ${log.channel}/${log.templateType}`);
      }

      const context = buildTemplateContext(log.charge.client, log.charge, this.config.get<string>('appUrl')!);
      const body = renderTemplate(template.body, context);
      const subject = template.subject ? renderTemplate(template.subject, context) : undefined;

      const provider = this.providers[log.channel];
      const result = await provider.send({
        destination: log.destination,
        body,
        subject,
        providerTemplateName: template.providerTemplateName ?? undefined,
        templateParams: [context.cliente, context.valor, context.vencimento],
      });

      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: 'SENT',
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
          errorMessage: null,
        },
      });
      this.logger.log(`${log.channel} enviado com sucesso para ${log.destination} (cobrança ${log.chargeId}).`);
    } catch (error: any) {
      this.logger.error(`Falha ao enviar ${log.channel} para ${log.destination}: ${error.message}`);
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', errorMessage: error.message, failedAt: new Date() },
      });
      throw error; // permite que o BullMQ reprocesse conforme política de retry/backoff
    }
  }
}
