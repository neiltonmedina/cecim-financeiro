import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsAppProvider } from '../notifications/providers/whatsapp.provider';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly whatsapp: WhatsAppProvider,
  ) {}

  /** Todos os dias às 08:00 (America/Sao_Paulo), envia lembretes e cobranças automáticas. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'America/Sao_Paulo' })
  async runDailyReminders() {
    this.logger.log('Executando rotina diária de lembretes/cobranças automáticas...');
    await this.markOverdueCharges();

    const rules = await this.prisma.reminderRule.findMany({ where: { active: true } });
    for (const rule of rules) {
      await this.dispatchForRule(rule.offsetDays, rule.templateType);
    }

    await this.advanceStaleConversations();
  }

  /**
   * Avança o fluxo de conversas do agente de cobrança que ficaram sem resposta:
   * 1ª mensagem -> lembrete -> 3ª tentativa (oferece negociação) -> encerra (sem spam).
   * Nunca mexe em conversas já escaladas para humano.
   */
  private async advanceStaleConversations() {
    const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h sem resposta

    const conversations = await this.prisma.conversation.findMany({
      where: {
        humanRequested: false,
        stage: { in: ['INICIADA', 'LEMBRETE_ENVIADO', 'TERCEIRA_TENTATIVA'] },
        lastOutboundAt: { lt: staleThreshold },
      },
      include: { client: true, charge: true },
    });

    for (const conv of conversations) {
      // Se o cliente respondeu depois do último envio, não é "sem resposta" - ignora.
      if (conv.lastInboundAt && conv.lastInboundAt > (conv.lastOutboundAt ?? new Date(0))) continue;
      if (!conv.client.phoneE164) continue;

      if (conv.stage === 'TERCEIRA_TENTATIVA') {
        await this.prisma.conversation.update({ where: { id: conv.id }, data: { stage: 'ENCERRADA' } });
        this.logger.log(`Conversa ${conv.id} encerrada por falta de resposta (evitando excesso de mensagens).`);
        continue;
      }

      const nextStage = conv.stage === 'INICIADA' ? 'LEMBRETE_ENVIADO' : 'TERCEIRA_TENTATIVA';
      const message =
        nextStage === 'LEMBRETE_ENVIADO'
          ? `Olá ${conv.client.name}, passando para saber se você viu nossa mensagem sobre ${
              conv.charge?.description ?? 'sua cobrança em aberto'
            }. Qualquer dúvida, estou à disposição.`
          : `Olá ${conv.client.name}, ainda estamos à disposição para resolver ${
              conv.charge?.description ?? 'sua cobrança em aberto'
            }. Se preferir, podemos conversar sobre condições para regularizar - é só me responder aqui.`;

      try {
        await this.whatsapp.send({ destination: conv.client.phoneE164, body: message });
        await this.prisma.conversationMessage.create({
          data: { conversationId: conv.id, direction: 'OUTBOUND', channel: 'WHATSAPP', content: message },
        });
        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: { stage: nextStage, lastOutboundAt: new Date(), attemptCount: { increment: 1 } },
        });
      } catch (error: any) {
        this.logger.error(`Falha ao avançar conversa ${conv.id}: ${error.message}`);
      }
    }
  }

  /** Marca como VENCIDA toda cobrança PENDENTE cujo vencimento já passou. */
  private async markOverdueCharges() {
    const today = startOfDay(new Date());
    const result = await this.prisma.charge.updateMany({
      where: { status: 'PENDENTE', dueDate: { lt: today } },
      data: { status: 'VENCIDA' },
    });
    if (result.count) {
      this.logger.log(`${result.count} cobrança(s) marcada(s) como VENCIDA.`);
    }
  }

  private async dispatchForRule(offsetDays: number, templateType: TemplateType) {
    const target = startOfDay(addDays(new Date(), offsetDays));
    const nextDay = addDays(target, 1);

    const charges = await this.prisma.charge.findMany({
      where: {
        status: { in: ['PENDENTE', 'VENCIDA'] },
        dueDate: { gte: target, lt: nextDay },
        client: { active: true },
      },
    });

    if (!charges.length) return;

    const chargeIds = charges.map((c) => c.id);
    this.logger.log(`Disparando ${templateType} (offset ${offsetDays}d) para ${chargeIds.length} cobrança(s).`);
    await this.notificationsService.dispatchCharges(chargeIds, { templateType });
  }
}
