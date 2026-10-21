import { Injectable, Logger } from '@nestjs/common';
import { boletoNoPrazo } from '../notifications/notifications.service';
import { hojeSaoPaulo } from '../boletos/boletos.service';
import { buildTemplateContext, parametrosDoModelo, payloadsDosBotoes } from '../notifications/utils/template-renderer.util';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsAppProvider } from '../notifications/providers/whatsapp.provider';
import { ConversationsService } from '../conversations/conversations.service';
import { telefonesDoCliente } from '../clients/telefones.util';
import { LotesService } from '../charges/lotes.service';

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
    private readonly conversations: ConversationsService,
    private readonly lotes: LotesService,
  ) {}

  /**
   * Todos os dias às 08:00 (America/Sao_Paulo): mantém o status das
   * cobranças em dia e avança as conversas já em andamento conforme o
   * intervalo definido manualmente ao confirmar cada campanha.
   *
   * O disparo inicial de cobrança NUNCA é automático - é sempre feito
   * manualmente pelo painel (dias definidos por quem confirma o disparo).
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'America/Sao_Paulo' })
  async runDailyReminders() {
    this.logger.log('Executando rotina diária de manutenção...');
    // Antes da régua: quem já pagou não recebe lembrete de atraso.
    await this.conversations.sincronizarPagamentosInter().catch((e) => this.logger.error(`Falha ao consultar pagamentos no Inter: ${e.message}`));
    await this.markOverdueCharges();
    await this.lotes.enviarAvisosAutomaticos().catch((e) => this.logger.error(`Falha no aviso dos boletos do mês: ${e.message}`));
    await this.notificationsService.lembretesDoDiaDoVencimento().catch((e) => this.logger.error(`Falha no lembrete do dia do vencimento: ${e.message}`));
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
        client: { active: true },
      },
      include: { client: true, charge: { omit: { boletoPdfBase64: true } } },
    });

    for (const conv of conversations) {
      // Cobrança já paga/cancelada (ex: baixa manual pelo painel) - não cobra mais.
      if (!conv.charge || conv.charge.status === 'PAGA' || conv.charge.status === 'CANCELADA') {
        await this.prisma.conversation.update({ where: { id: conv.id }, data: { stage: 'ENCERRADA' } });
        continue;
      }
      // Conversas abertas antes da correção não tinham a data do primeiro contato:
      // recupera a partir do envio real registrado no histórico de notificações.
      if (!conv.lastOutboundAt && conv.chargeId) {
        const ultimoEnvio = await this.prisma.notificationLog.findFirst({
          where: { chargeId: conv.chargeId, channel: 'WHATSAPP', sentAt: { not: null } },
          orderBy: { sentAt: 'desc' },
        });
        if (ultimoEnvio?.sentAt) {
          conv.lastOutboundAt = ultimoEnvio.sentAt;
          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { lastOutboundAt: ultimoEnvio.sentAt },
          });
        }
      }
      // Se o cliente respondeu depois do último envio, não é "sem resposta" - ignora.
      if (conv.lastInboundAt && conv.lastInboundAt > (conv.lastOutboundAt ?? new Date(0))) continue;
      const telefones = telefonesDoCliente(conv.client);
      if (!telefones.length) continue;
      if (!conv.lastOutboundAt) continue;

      const staleThreshold = new Date(conv.lastOutboundAt.getTime() + conv.intervalDays * 24 * 60 * 60 * 1000);
      if (new Date() < staleThreshold) continue; // ainda dentro do intervalo configurado, aguarda
      // Já recebeu mensagem desta cobrança hoje (ex: lembrete do dia do vencimento): fica para o próximo dia.
      const enviadaHoje = await this.prisma.notificationLog.findFirst({
        where: { chargeId: conv.chargeId!, channel: 'WHATSAPP', queuedAt: { gte: new Date(Date.now() - 20 * 60 * 60 * 1000) } },
      });
      if (enviadaHoje) continue;

      if (conv.stage === 'TERCEIRA_TENTATIVA') {
        await this.prisma.conversation.update({ where: { id: conv.id }, data: { stage: 'ENCERRADA' } });
        this.logger.log(`Conversa ${conv.id} encerrada por falta de resposta (evitando excesso de mensagens).`);
        continue;
      }

      const codigo = conv.charge.linhaDigitavel || conv.charge.pixCopiaECola;
      if (!codigo) {
        this.logger.warn(`Conversa ${conv.id}: cobrança sem linha digitável/Pix - lembrete não enviado.`);
        continue;
      }

      const nextStage = conv.stage === 'INICIADA' ? 'LEMBRETE_ENVIADO' : 'TERCEIRA_TENTATIVA';

      // Mesmo modelo do disparo: boleto ainda no prazo usa o "boleto a vencer" (se
      // aprovado/ativo); vencido usa o de cobrança. Sem modelo configurado, cobranca_cecim.
      const noPrazo = boletoNoPrazo(conv.charge, hojeSaoPaulo());
      const modelo =
        (noPrazo && (await this.prisma.messageTemplate.findFirst({ where: { channel: 'WHATSAPP', type: 'BOLETO_DISPONIVEL', active: true } }))) ||
        (await this.prisma.messageTemplate.findFirst({ where: { channel: 'WHATSAPP', type: 'COBRANCA_PENDENTE', active: true } }));
      const nomeModelo = modelo?.providerTemplateName ?? 'cobranca_cecim';
      const params = modelo?.providerParams?.length
        ? parametrosDoModelo(modelo.providerParams, buildTemplateContext(conv.client, conv.charge as any, ''))
        : [conv.client.name, codigo];
      const resumo = `[Lembrete automático - modelo ${nomeModelo}] ${conv.client.name}: ${codigo}`;

      try {
        // Lembrete sempre via template aprovado: fora da janela de 24h desde a última
        // mensagem do cliente, o WhatsApp rejeita texto livre (erro 131047) - e um
        // lembrete de régua, por definição, vai pra quem não respondeu.
        // Todos os telefones da empresa; basta um receber para a régua avançar.
        let enviados = 0;
        let ultimoErro: any;
        for (const destination of telefones) {
          try {
            await this.whatsapp.send({
              destination,
              body: resumo,
              providerTemplateName: nomeModelo,
              templateParams: params,
              templateButtonPayloads: modelo?.providerBotoes?.length ? payloadsDosBotoes(modelo.providerBotoes, conv.chargeId!) : undefined,
            });
            enviados++;
          } catch (error) {
            ultimoErro = error;
          }
        }
        if (!enviados) throw ultimoErro;
        await this.prisma.conversationMessage.create({
          data: { conversationId: conv.id, direction: 'OUTBOUND', channel: 'WHATSAPP', content: resumo },
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

  /** Marca como VENCIDA toda cobrança em aberto (pendente ou já enviada) cujo vencimento já passou. */
  private async markOverdueCharges() {
    const today = startOfDay(new Date());
    const result = await this.prisma.charge.updateMany({
      where: { status: { in: ['PENDENTE', 'ENVIADA'] }, dueDate: { lt: today } },
      data: { status: 'VENCIDA' },
    });
    if (result.count) {
      this.logger.log(`${result.count} cobrança(s) marcada(s) como VENCIDA.`);
    }
  }

}
