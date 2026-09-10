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
   * 1ª mensagem -> lembrete -> 3ª tentativa (oferece opções fechadas) -> encerra (sem spam).
   * O intervalo entre cada contato é o definido no painel ao confirmar a campanha
   * (Conversation.intervalDays). Nunca mexe em conversas escaladas para humano ou pausadas.
   */
  private async advanceStaleConversations() {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        humanRequested: false,
        paused: false,
        stage: { in: ['INICIADA', 'LEMBRETE_ENVIADO', 'TERCEIRA_TENTATIVA'] },
      },
      include: { client: true, charge: true },
    });

    for (const conv of conversations) {
      // Se o cliente respondeu depois do último envio, não é "sem resposta" - ignora.
      if (conv.lastInboundAt && conv.lastInboundAt > (conv.lastOutboundAt ?? new Date(0))) continue;
      if (!conv.client.phoneE164) continue;
      if (!conv.lastOutboundAt) continue;

      const staleThreshold = new Date(conv.lastOutboundAt.getTime() + conv.intervalDays * 24 * 60 * 60 * 1000);
      if (new Date() < staleThreshold) continue; // ainda dentro do intervalo configurado, aguarda

      if (conv.stage === 'TERCEIRA_TENTATIVA') {
        await this.prisma.conversation.update({ where: { id: conv.id }, data: { stage: 'ENCERRADA' } });
        this.logger.log(`Conversa ${conv.id} encerrada por falta de resposta (evitando excesso de mensagens).`);
        continue;
      }

      const diasAtraso = conv.charge
        ? Math.max(0, Math.floor((Date.now() - conv.charge.dueDate.getTime()) / (24 * 60 * 60 * 1000)))
        : null;
      const opcoes = 'Responda *1* para receber o Pix ou *2* para o boleto atualizado (já com os valores corretos).';
      const situacaoAtraso = diasAtraso !== null ? ` Está ${diasAtraso} dia(s) em atraso.` : '';

      const nextStage = conv.stage === 'INICIADA' ? 'LEMBRETE_ENVIADO' : 'TERCEIRA_TENTATIVA';
      const message =
        nextStage === 'LEMBRETE_ENVIADO'
          ? `Olá ${conv.client.name}, passando para lembrar sobre ${
              conv.charge?.description ?? 'sua cobrança em aberto'
            }.${situacaoAtraso} ${opcoes}`
          : `Olá ${conv.client.name}, sua cobrança sobre ${
              conv.charge?.description ?? ''
            } segue em aberto.${situacaoAtraso} ${opcoes} Se preferir negociar, me avise por aqui.`;

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
