import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Channel, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { SmsTwilioProvider } from './providers/sms-twilio.provider';
import { EmailSmtpProvider } from './providers/email-smtp.provider';
import { ChannelProvider } from './interfaces/channel-provider.interface';
import { buildTemplateContext, renderTemplate, TemplateContext } from './utils/template-renderer.util';

// Fila vazia: espera até 60s por job a cada consulta (padrão 5s) e checa jobs
// travados a cada 5 min - o servidor fica acordado 24h e o polling padrão
// esgotava a cota de comandos do Redis gerenciado (Upstash).
@Processor(NOTIFICATIONS_QUEUE, { drainDelay: 60, stalledInterval: 5 * 60 * 1000 })
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
    await this.enviarNotificacao(job.data.notificationLogId, job.attemptsMade + 1);
  }

  /**
   * Envia uma notificação registrada em NotificationLog. Usado pelo worker da
   * fila e, diretamente, quando a fila (Redis) está indisponível no disparo.
   * Lança erro em caso de falha (o log já fica como FAILED).
   */
  async enviarNotificacao(notificationLogId: string, attempt = 1): Promise<void> {
    const log = await this.prisma.notificationLog.findUnique({
      where: { id: notificationLogId },
      include: { charge: { include: { client: true } } },
    });
    if (!log) {
      this.logger.warn(`NotificationLog ${notificationLogId} não encontrado, ignorando job.`);
      return;
    }

    // "Reserva" o envio de forma atômica: se outro processo (fila ou a rotina
    // que reenvia o que ficou parado) já pegou ou já enviou, não envia de novo.
    const reservado = await this.prisma.notificationLog.updateMany({
      where: { id: log.id, status: { in: ['QUEUED', 'FAILED'] } },
      data: { status: 'SENDING', attempt },
    });
    if (!reservado.count) {
      this.logger.warn(`Notificação ${log.id} já está em envio/enviada (${log.status}) - ignorando duplicata.`);
      return;
    }

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

      const templateParams = this.buildWhatsAppTemplateParams(log.templateType, context);
      if (log.channel === 'WHATSAPP' && template.providerTemplateName && templateParams.some((p) => !String(p ?? '').trim())) {
        // A Meta recusaria com "(#131008) Required parameter is missing" - explica o motivo real.
        throw new Error(
          'Cobrança sem boleto (linha digitável/Pix vazios) - o boleto não foi gerado no Inter. Gere o boleto no painel e dispare de novo.',
        );
      }

      const provider = this.providers[log.channel];
      const result = await provider.send({
        destination: log.destination,
        body,
        subject,
        providerTemplateName: template.providerTemplateName ?? undefined,
        templateParams,
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

      if (log.channel === 'WHATSAPP') {
        // A mensagem já foi entregue ao WhatsApp: uma falha aqui não pode virar
        // retry do job (o cliente receberia a cobrança duplicada).
        await this.registrarPrimeiroContatoNaConversa(log.charge.clientId, log.chargeId, body).catch((err) =>
          this.logger.error(`Falha ao registrar contato na conversa (cobrança ${log.chargeId}): ${err.message}`),
        );
      }
    } catch (error: any) {
      this.logger.error(`Falha ao enviar ${log.channel} para ${log.destination}: ${error.message}`);
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', errorMessage: error.message, failedAt: new Date() },
      });
      throw error; // permite que o BullMQ reprocesse conforme política de retry/backoff
    }
  }

  /**
   * Monta a lista de variáveis (na ordem certa) para cada modelo de mensagem
   * aprovado na Meta - o número e a ordem dos parâmetros precisa bater
   * exatamente com as variáveis {{1}}, {{2}}... definidas em cada modelo,
   * senão o WhatsApp recusa o envio.
   *
   * cobranca_cecim (COBRANCA_PENDENTE): {{1}} nome, {{2}} linha digitável.
   * cecim_hoje_ (LEMBRETE_VENCIMENTO): {{1}} nome, {{2}} valor.
   * cobranca_vencida_cecim (COBRANCA_VENCIDA): {{1}} nome, {{2}} valor,
   * {{3}} vencimento, {{4}} pix.
   */
  private buildWhatsAppTemplateParams(templateType: TemplateType, context: TemplateContext): string[] {
    switch (templateType) {
      case 'COBRANCA_PENDENTE':
        return [context.cliente, context.linhaDigitavel || context.pix];
      case 'LEMBRETE_VENCIMENTO':
        return [context.cliente, context.valor];
      case 'COBRANCA_VENCIDA':
        return [context.cliente, context.valor, context.vencimento, context.pix];
      default:
        return [context.cliente, context.valor, context.vencimento];
    }
  }

  /**
   * Marca o contato na conversa (lastOutboundAt) e registra a mensagem no
   * histórico - sem isso, a rotina diária que avança a régua
   * (SchedulerService.advanceStaleConversations) nunca tinha uma data de
   * referência pra contar o intervalo, e o lembrete seguinte nunca disparava
   * pra quem não respondia de primeira. Um novo disparo manual também
   * reinicia a contagem a partir de agora.
   */
  private async registrarPrimeiroContatoNaConversa(clientId: string, chargeId: string, body: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { clientId, chargeId, stage: { not: 'ENCERRADA' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!conversation) return;

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastOutboundAt: new Date() },
    });
    await this.prisma.conversationMessage.create({
      data: { conversationId: conversation.id, direction: 'OUTBOUND', channel: 'WHATSAPP', content: body },
    });
  }
}
