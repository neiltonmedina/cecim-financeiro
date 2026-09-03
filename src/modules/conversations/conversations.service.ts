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
  async ensureConversationForCharge(clientId: string, chargeId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { clientId, chargeId, stage: { not: 'ENCERRADA' } },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { clientId, chargeId, stage: 'INICIADA' },
    });
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

    if (conversation.humanRequested) {
      // Automação pausada: apenas registra a mensagem, não responde automaticamente.
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
