import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Channel, Client, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';
import { NotificationsProcessor } from './notifications.processor';

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
    private readonly processor: NotificationsProcessor,
  ) {}

  /**
   * A cada 10 min, envia direto as notificações que ficaram paradas na fila
   * (QUEUED há mais de 10 min) - acontece quando o Redis aceita o job mas o
   * worker não consegue processar (ex: cota do Upstash esgotada).
   */
  @Cron('*/10 * * * *')
  async reenviarParadasNaFila() {
    const paradas = await this.prisma.notificationLog.findMany({
      where: { status: 'QUEUED', queuedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
      select: { id: true },
      take: 50,
    });
    if (!paradas.length) return;
    this.logger.warn(`${paradas.length} notificação(ões) parada(s) na fila - enviando direto.`);
    for (const { id } of paradas) {
      await this.processor.enviarNotificacao(id).catch(() => undefined); // falha fica registrada no log
    }
  }

  /**
   * Enfileira o envio; se a fila (Redis) estiver fora do ar ou sem cota, envia
   * na hora, direto - o disparo não pode falhar por causa da fila.
   */
  private async enfileirarOuEnviar(notificationLogId: string) {
    try {
      await Promise.race([
        this.queue.add(
          'send-notification',
          { notificationLogId },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: false },
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('tempo esgotado ao falar com o Redis')), 10000)),
      ]);
    } catch (error: any) {
      this.logger.error(`Fila de envio indisponível (${error.message}) - enviando direto, sem fila.`);
      await this.processor.enviarNotificacao(notificationLogId).catch(() => undefined); // falha já fica registrada no log
    }
  }

  /**
   * Determina para quais canais o cliente pode receber mensagens, dado seu
   * cadastro e opt-in. Por padrão (sem canais explicitamente pedidos) só usa
   * WhatsApp e e-mail - SMS fica de fora do padrão porque não está
   * configurado (falta TWILIO_ACCOUNT_SID/TWILIO_FROM_NUMBER) e sempre falha;
   * ainda pode ser usado se pedido explicitamente em `requested`.
   */
  resolveChannelsForClient(client: Client, requested?: Channel[]): Channel[] {
    const candidates = requested?.length ? requested : ([Channel.WHATSAPP, Channel.EMAIL] as Channel[]);
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

      let channels = this.resolveChannelsForClient(charge.client, options.channels);
      const skipped: string[] = [];
      // O modelo do WhatsApp precisa da linha digitável (ou do Pix): sem boleto, a Meta recusa.
      if (channels.includes(Channel.WHATSAPP) && !charge.linhaDigitavel && !charge.pixCopiaECola) {
        channels = channels.filter((c) => c !== Channel.WHATSAPP);
        skipped.push(`${charge.client.name}: cobrança sem boleto gerado no Inter`);
      }
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

        await this.enfileirarOuEnviar(log.id);
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
