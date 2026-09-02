import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Channel, Client, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';

export interface DispatchOptions {
  /** Canais a utilizar. Se omitido, usa todos os canais habilitados (opt-in) do cliente. */
  channels?: Channel[];
  templateType: TemplateType;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Determina para quais canais o cliente pode receber mensagens, dado seu cadastro e opt-in. */
  resolveChannelsForClient(client: Client, requested?: Channel[]): Channel[] {
    const candidates = requested?.length ? requested : ([Channel.WHATSAPP, Channel.SMS, Channel.EMAIL] as Channel[]);
    return candidates.filter((channel) => {
      if (channel === Channel.WHATSAPP) return client.whatsappOptIn && !!client.phoneE164;
      if (channel === Channel.SMS) return client.smsOptIn && !!client.phoneE164;
      if (channel === Channel.EMAIL) return client.emailOptIn && !!client.email;
      return false;
    });
  }

  /**
   * Dispara a cobrança de uma lista de charges (clientes selecionados) pelos
   * canais disponíveis: WhatsApp, SMS e E-mail.
   */
  async dispatchCharges(chargeIds: string[], options: DispatchOptions) {
    const charges = await this.prisma.charge.findMany({
      where: { id: { in: chargeIds } },
      include: { client: true },
    });

    const results: Array<{ chargeId: string; clientId: string; channelsQueued: Channel[]; skipped: string[] }> = [];

    for (const charge of charges) {
      if (!charge.client.active) {
        results.push({ chargeId: charge.id, clientId: charge.clientId, channelsQueued: [], skipped: ['cliente inativo'] });
        continue;
      }

      const channels = this.resolveChannelsForClient(charge.client, options.channels);
      const skipped: string[] = [];
      if (!channels.length) {
        skipped.push('nenhum canal disponível (verifique telefone/e-mail e opt-in do cliente)');
      }

      const queued: Channel[] = [];
      for (const channel of channels) {
        const destination = channel === Channel.EMAIL ? charge.client.email! : charge.client.phoneE164!;

        const log = await this.prisma.notificationLog.create({
          data: {
            chargeId: charge.id,
            channel,
            destination,
            templateType: options.templateType,
            status: 'QUEUED',
          },
        });

        await this.queue.add(
          'send-notification',
          { notificationLogId: log.id },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 1000,
            removeOnFail: false,
          },
        );
        queued.push(channel);
      }

      if (queued.length && charge.status === 'PENDENTE') {
        await this.prisma.charge.update({ where: { id: charge.id }, data: { status: 'ENVIADA' } });
      }

      results.push({ chargeId: charge.id, clientId: charge.clientId, channelsQueued: queued, skipped });
    }

    this.logger.log(`Disparo solicitado para ${charges.length} cobrança(s).`);
    return results;
  }
}
