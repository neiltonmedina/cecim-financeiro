import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStage, MessageDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppProvider } from '../notifications/providers/whatsapp.provider';
import { EmailSmtpProvider } from '../notifications/providers/email-smtp.provider';
import { ClaudeAgentService } from './claude-agent.service';

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppProvider,
    private readonly email: EmailSmtpProvider,
    private readonly agent: ClaudeAgentService,
    private readonly config: ConfigService,
  ) {}

  /** Cria (se ainda não existir) a conversa de cobrança para uma cobrança recém-disparada por WhatsApp. */
  async ensureConversationForCharge(clientId: string, chargeId: string, intervalDays = 5) {
    const existing = await this.prisma.conversation.findFirst({
      where: { clientId, chargeId, stage: { not: 'ENCERRADA' } },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { clientId, chargeId, stage: 'INICIADA', intervalDays },
    });
  }

  /** Pausa/retoma manualmente a régua e as respostas automáticas de uma conversa (ação do painel). */
  async setPaused(conversationId: string, paused: boolean) {
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { paused } });
  }

  /**
   * Chamado quando o pagamento é confirmado (webhook do Inter) - encerra
   * automaticamente a régua daquele cliente para essa cobrança, sem
   * precisar de nenhuma ação manual no painel.
   */
  async encerrarPorPagamento(chargeId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { chargeId, stage: { not: 'ENCERRADA' } },
    });
    for (const conv of conversations) {
      await this.prisma.conversation.update({ where: { id: conv.id }, data: { stage: 'ENCERRADA' } });
    }
    if (conversations.length) {
      this.logger.log(`${conversations.length} conversa(s) encerrada(s) automaticamente por pagamento confirmado.`);
    }
  }

  /** Processa uma mensagem recebida do cliente via WhatsApp. */
  async handleInboundWhatsApp(fromPhoneRaw: string, text: string) {
    const phone = normalizePhone(fromPhoneRaw);

    const client = await this.prisma.client.findFirst({ where: { phoneE164: phone } });
    if (!client) {
      this.logger.warn(`Mensagem recebida de número não cadastrado: ${phone}`);
      return;
    }

    let conversation = await this.prisma.conversation.findFirst({
      where: { clientId: client.id, stage: { not: 'ENCERRADA' } },
      orderBy: { createdAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!conversation) {
      const openCharge = await this.prisma.charge.findFirst({
        where: { clientId: client.id, status: { in: ['PENDENTE', 'ENVIADA', 'VENCIDA'] } },
        orderBy: { dueDate: 'asc' },
      });
      conversation = await this.prisma.conversation.create({
        data: { clientId: client.id, chargeId: openCharge?.id, stage: 'INICIADA' },
        include: { messages: true },
      });
    }

    if (conversation.humanRequested || conversation.paused) {
      // Automação pausada (escalada para humano, ou pausada manualmente no painel):
      // apenas registra a mensagem, nunca responde sozinho.
      await this.logMessage(conversation.id, 'INBOUND', text);
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date() },
      });
      return;
    }

    await this.logMessage(conversation.id, 'INBOUND', text);

    const charge = conversation.chargeId
      ? await this.prisma.charge.findUnique({ where: { id: conversation.chargeId } })
      : null;

    // Resposta às opções fechadas (1 = Pix, 2 = boleto atualizado) é determinística -
    // não passa pela IA. O valor com multa/juros já vem pronto do Inter.
    const opcao = text.trim().replace(/[.\s]/g, '');
    if (charge && (opcao === '1' || /^pix$/i.test(text.trim()))) {
      const reply = charge.pixCopiaECola
        ? `Aqui está o Pix copia-e-cola para pagamento:\n\n${charge.pixCopiaECola}`
        : 'No momento não temos um Pix disponível para essa cobrança - posso te enviar o boleto atualizado (opção 2)?';
      await this.logMessage(conversation.id, 'OUTBOUND', reply);
      await this.whatsapp.send({ destination: phone, body: reply });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date(), lastOutboundAt: new Date() },
      });
      return;
    }
    if (charge && (opcao === '2' || /boleto/i.test(text.trim()))) {
      const reply = charge.paymentLink
        ? `Segue o boleto atualizado, já com os valores corretos:\n${charge.paymentLink}`
        : 'Ainda não temos o boleto disponível para essa cobrança - já vou encaminhar para um atendente confirmar.';
      await this.logMessage(conversation.id, 'OUTBOUND', reply);
      await this.whatsapp.send({ destination: phone, body: reply });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastInboundAt: new Date(),
          lastOutboundAt: new Date(),
          humanRequested: !charge.paymentLink,
        },
      });
      return;
    }

    const policy = await this.prisma.negotiationPolicy.findFirst({ where: { active: true } });

    const decision = await this.agent.decide({
      client,
      charge,
      history: conversation.messages,
      incomingMessage: text,
      policy,
      appUrl: this.config.get<string>('appUrl')!,
    });

    await this.logMessage(conversation.id, 'OUTBOUND', decision.reply, decision.intent);

    await this.whatsapp.send({ destination: phone, body: decision.reply });

    const nextStage: ConversationStage = decision.requestHumanHandoff
      ? 'AGUARDANDO_HUMANO'
      : decision.intent === 'QUER_NEGOCIAR'
        ? 'NEGOCIACAO'
        : decision.intent === 'JA_PAGOU' || decision.intent === 'VAI_PAGAR' || decision.intent === 'DATA_ESPECIFICA'
          ? 'AGUARDANDO_PAGAMENTO'
          : conversation.stage;

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        stage: nextStage,
        humanRequested: decision.requestHumanHandoff,
        lastInboundAt: new Date(),
        lastOutboundAt: new Date(),
      },
    });

    if (decision.requestHumanHandoff) {
      await this.notifyHumanEscalation(client.name, phone, text, charge?.description);
    }
  }

  private async logMessage(
    conversationId: string,
    direction: MessageDirection,
    content: string,
    intent?: string,
  ) {
    return this.prisma.conversationMessage.create({
      data: {
        conversationId,
        direction,
        channel: 'WHATSAPP',
        content,
        intent: intent as any,
      },
    });
  }

  private async notifyHumanEscalation(clientName: string, phone: string, lastMessage: string, chargeDesc?: string) {
    const escalationEmail = this.config.get<string>('escalationEmail');
    if (!escalationEmail) return;

    try {
      await this.email.send({
        destination: escalationEmail,
        subject: `Atendimento humano solicitado - ${clientName}`,
        body:
          `<p>O agente de cobrança encaminhou uma conversa para atendimento humano.</p>` +
          `<p><strong>Cliente:</strong> ${clientName}<br/>` +
          `<strong>Telefone:</strong> ${phone}<br/>` +
          `<strong>Cobrança:</strong> ${chargeDesc ?? '-'}</p>` +
          `<p><strong>Última mensagem do cliente:</strong> "${lastMessage}"</p>`,
      });
    } catch (error: any) {
      this.logger.error(`Falha ao notificar escalonamento humano: ${error.message}`);
    }
  }
}
