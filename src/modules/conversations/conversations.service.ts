import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStage, MessageDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppProvider } from '../notifications/providers/whatsapp.provider';
import { EmailSmtpProvider } from '../notifications/providers/email-smtp.provider';
import { ClaudeAgentService, filtrarRespostaDoAgente } from './claude-agent.service';
import { BoletosService } from '../boletos/boletos.service';
import { PushService } from '../push/push.service';
import { telefonesDoCliente } from '../clients/telefones.util';
import { buildTemplateContext, formatCurrencyBRL, formatDateBR, parametrosDoModelo } from '../notifications/utils/template-renderer.util';

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/**
 * A API do WhatsApp às vezes entrega o número do celular brasileiro sem o
 * "9" extra (ex: +559991646386 em vez de +5599991646386) - gera aqui a
 * variação alternativa (com/sem o 9) para tentar achar o cliente mesmo
 * quando o formato não bate exatamente com o cadastrado.
 */
function alternativeBrPhone(phone: string): string | null {
  const match = phone.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!match) return null;
  const [, ddd, numero] = match;
  return numero.length === 9 ? `+55${ddd}${numero.slice(1)}` : `+55${ddd}9${numero}`;
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
    private readonly boletos: BoletosService,
    private readonly push: PushService,
  ) {}

  /** Cria (se ainda não existir) a conversa de cobrança para uma cobrança recém-disparada por WhatsApp. */
  async ensureConversationForCharge(clientId: string, chargeId: string, intervalDays?: number) {
    const existing = await this.prisma.conversation.findFirst({
      where: { clientId, chargeId, stage: { not: 'ENCERRADA' } },
    });
    // Novo disparo manual sobre conversa já aberta: vale o intervalo escolhido agora.
    if (existing) {
      if (intervalDays === undefined || existing.intervalDays === intervalDays) return existing;
      return this.prisma.conversation.update({ where: { id: existing.id }, data: { intervalDays } });
    }

    return this.prisma.conversation.create({
      data: { clientId, chargeId, stage: 'INICIADA', intervalDays: intervalDays ?? 5 },
    });
  }

  /** Pausa/retoma manualmente a régua e as respostas automáticas de uma conversa (ação do painel). */
  async setPaused(conversationId: string, paused: boolean) {
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { paused } });
  }

  /**
   * Retoma as respostas automáticas de uma conversa que foi escalada para
   * atendimento humano (humanRequested = true) - usar depois que o
   * atendente já respondeu manualmente e quer devolver pro agente.
   */
  async resumeAutomation(conversationId: string) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { humanRequested: false },
    });
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

  /**
   * Registra o pagamento (uma vez só, mesmo que o aviso chegue repetido), encerra
   * a régua e agradece pelo WhatsApp quem recebeu a cobrança por lá.
   */
  async registrarPagamento(chargeId: string, valorRecebidoCents?: number): Promise<boolean> {
    const { count } = await this.prisma.charge.updateMany({
      where: { id: chargeId, status: { not: 'PAGA' } },
      data: { status: 'PAGA', paidAt: new Date() },
    });
    if (!count) return false;
    const pago = await this.prisma.charge.findUnique({ where: { id: chargeId }, include: { client: true } });
    await this.push.notificar('💰 Pagamento confirmado', `${pago?.client.name ?? 'Cliente'} pagou ${formatCurrencyBRL(valorRecebidoCents || pago?.amountCents || 0)}.`, 'charges');
    const contatado = (await this.prisma.conversation.count({ where: { chargeId } })) > 0;
    await this.encerrarPorPagamento(chargeId);
    if (contatado) await this.enviarConfirmacaoPagamento(chargeId, valorRecebidoCents);
    return true;
  }

  /** Consulta no Inter os boletos pagos e registra cada pagamento. */
  async sincronizarPagamentosInter(): Promise<number> {
    let registrados = 0;
    for (const { chargeId, valorRecebidoCents } of await this.boletos.cobrancasPagasNoInter()) {
      if (await this.registrarPagamento(chargeId, valorRecebidoCents)) registrados++;
    }
    if (registrados) this.logger.log(`${registrados} pagamento(s) confirmado(s) pelo Inter.`);
    return registrados;
  }

  private async enviarConfirmacaoPagamento(chargeId: string, valorRecebidoCents?: number) {
    const modelo = await this.prisma.messageTemplate.findFirst({
      where: { channel: 'WHATSAPP', type: 'CONFIRMACAO_PAGAMENTO', active: true },
    });
    if (!modelo?.providerTemplateName) {
      this.logger.log(`Cobrança ${chargeId} paga - agradecimento não enviado (modelo ainda não aprovado pela Meta).`);
      return;
    }
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId }, include: { client: true } });
    if (!charge || !telefonesDoCliente(charge.client).length) return;
    const contexto = {
      ...buildTemplateContext(charge.client, charge, ''),
      // Referente ao vencimento original e ao valor que de fato foi pago.
      vencimentoBoleto: formatDateBR(charge.dueDate),
      valor: formatCurrencyBRL(valorRecebidoCents || charge.amountCents),
    };
    const resumo = `[Pagamento confirmado - modelo ${modelo.providerTemplateName}] ${charge.client.name}: ${contexto.valor}`;
    try {
      for (const destination of telefonesDoCliente(charge.client)) {
        // Um telefone com problema não impede o agradecimento nos outros.
        await this.whatsapp
          .send({
            destination,
            body: resumo,
            providerTemplateName: modelo.providerTemplateName,
            templateParams: parametrosDoModelo(modelo.providerParams, contexto),
          })
          .catch((error: any) => this.logger.warn(`Falha ao enviar o agradecimento para ${destination}: ${error.message}`));
      }
      const conv = await this.prisma.conversation.findFirst({ where: { chargeId }, orderBy: { createdAt: 'desc' } });
      if (conv) {
        await this.prisma.conversationMessage.create({
          data: { conversationId: conv.id, direction: 'OUTBOUND', channel: 'WHATSAPP', content: resumo },
        });
      }
    } catch (error: any) {
      this.logger.warn(`Falha ao enviar o agradecimento de pagamento da cobrança ${chargeId}: ${error.message}`);
    }
  }

  /** Processa uma mensagem recebida do cliente via WhatsApp. */
  async handleInboundWhatsApp(fromPhoneRaw: string, text: string, messageId?: string, payload?: string) {
    // A Meta pode entregar o mesmo evento mais de uma vez: só processa cada
    // mensagem uma vez (o insert com chave primária é atômico, então funciona
    // mesmo com entregas simultâneas).
    if (messageId && !(await this.marcarComoProcessada(messageId))) {
      this.logger.log(`Mensagem ${messageId} já processada - entrega duplicada da Meta ignorada.`);
      return;
    }

    const phone = normalizePhone(fromPhoneRaw);
    const altPhone = alternativeBrPhone(phone);

    const clientes = await this.prisma.client.findMany({
      where: {
        active: true,
        OR: [
          { phoneE164: { in: altPhone ? [phone, altPhone] : [phone] } },
          { telefonesExtras: { hasSome: altPhone ? [phone, altPhone] : [phone] } },
        ],
      },
    });
    if (!clientes.length) {
      this.logger.warn(`Mensagem recebida de número não cadastrado: ${phone}`);
      return;
    }
    // Mesmo WhatsApp para mais de uma empresa (mesmo dono): a resposta vale para a
    // conversa que recebeu cobrança mais recentemente.
    const telefoneCompartilhado = clientes.length > 1;

    // Toque no botão Pix/Boleto: o payload traz a cobrança exata ("PIX:<id>").
    // Só vale se a cobrança for de um cliente deste telefone.
    const botao = /^(PIX|BOLETO):(.+)$/.exec(payload ?? '');
    const cobrancaDoBotao = botao
      ? await this.prisma.charge.findFirst({ where: { id: botao[2], clientId: { in: clientes.map((c) => c.id) } } })
      : null;
    if (cobrancaDoBotao && (cobrancaDoBotao.status === 'PAGA' || cobrancaDoBotao.status === 'CANCELADA')) {
      await this.whatsapp.send({
        destination: phone,
        body: cobrancaDoBotao.status === 'PAGA'
          ? 'Esta cobrança já consta como paga. Obrigado!'
          : 'Esta cobrança foi cancelada e não precisa ser paga.',
      });
      return;
    }
    if (cobrancaDoBotao) text = botao![1] === 'PIX' ? '1' : '2';

    let conversation = cobrancaDoBotao
      ? await this.prisma.conversation.findFirst({
          where: { chargeId: cobrancaDoBotao.id, stage: { not: 'ENCERRADA' } },
          orderBy: { createdAt: 'desc' },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
      : await this.prisma.conversation.findFirst({
          where: { clientId: { in: clientes.map((c) => c.id) }, stage: { not: 'ENCERRADA' } },
          orderBy: [{ lastOutboundAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        });
    if (!conversation && cobrancaDoBotao) {
      conversation = await this.prisma.conversation.create({
        data: { clientId: cobrancaDoBotao.clientId, chargeId: cobrancaDoBotao.id, stage: 'INICIADA' },
        include: { messages: true },
      });
    }
    const client = clientes.find((c) => c.id === (conversation?.clientId ?? cobrancaDoBotao?.clientId)) ?? clientes[0];

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

    if (conversation.paused) {
      // Automação pausada manualmente no painel: apenas registra a mensagem.
      // (humanRequested NÃO silencia: o canal é só de boletos/Pix, sem atendente -
      // é apenas um aviso interno no painel; o cliente continua recebendo Pix/boleto.)
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
    // O código (Pix / linha digitável) vai sempre numa mensagem separada, sozinho:
    // no WhatsApp, "Copiar" copia a mensagem inteira, então assim o cliente copia
    // exatamente o código, sem texto junto. (O botão "copiar código" dos templates
    // da Meta só aceita até 15 caracteres - não serve para Pix nem linha digitável.)
    if (charge && (opcao === '1' || /^pix$/i.test(text.trim()))) {
      const mensagens = charge.pixCopiaECola
        ? [
            'Segue o Pix copia e cola na próxima mensagem. Toque e segure nela, escolha *Copiar* e cole no app do seu banco, na opção Pix Copia e Cola.',
            charge.pixCopiaECola,
          ]
        : ['No momento não temos um Pix disponível para essa cobrança - posso te enviar o boleto atualizado (opção 2)?'];
      if (telefoneCompartilhado) mensagens[0] = `*${client.name}*\n${mensagens[0]}`;
      await this.enviarEmSequencia(conversation.id, phone, mensagens);
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date(), lastOutboundAt: new Date() },
      });
      return;
    }
    if (charge && (opcao === '2' || /boleto/i.test(text.trim()))) {
      let mensagens: string[];
      let pdfLink: string | undefined;
      if (!charge.paymentLink) {
        mensagens = ['O boleto desta cobrança ainda não está disponível. Assim que for emitido, ele será enviado por aqui.'];
      } else {
        // Boleto vencido: gera a segunda via com o valor atualizado (o PDF do
        // boleto vencido mostra o valor original).
        const { charge: c, valor, atualizado } = await this.boletos.gerarSegundaViaAtualizada(charge, client);
        pdfLink = c.paymentLink ?? undefined;
        const vencido = valor.diasAtraso > 0;
        let cabecalho: string;
        if (!vencido) {
          cabecalho = `Segue o seu boleto, no valor de ${formatCurrencyBRL(c.amountCents)}:\n${c.paymentLink}`;
        } else if (atualizado) {
          cabecalho =
            `Segue o boleto atualizado, com vencimento hoje, no valor de *${formatCurrencyBRL(valor.totalCents)}* ` +
            `(valor original ${formatCurrencyBRL(c.amountCents)} + multa e juros de ${valor.diasAtraso} dia(s) de atraso):\n` +
            c.paymentLink;
        } else {
          cabecalho =
            `Segue o boleto:\n${c.paymentLink}\n\nEle está vencido: ao pagar, o banco acrescenta multa e juros, ` +
            `totalizando hoje *${formatCurrencyBRL(valor.totalCents)}*. Se preferir, responda *1* para receber o Pix, ` +
            'que já vem com o valor atualizado.';
        }
        mensagens = c.linhaDigitavel
          ? [
              `${cabecalho}\n\nA linha digitável vem na próxima mensagem. Toque e segure nela, escolha *Copiar* e cole no app do seu banco.`,
              c.linhaDigitavel,
            ]
          : [cabecalho];
      }
      if (telefoneCompartilhado) mensagens[0] = `*${client.name}*\n${mensagens[0]}`;
      if (pdfLink) {
        // PDF do boleto como arquivo no WhatsApp (o link continua no texto, caso falhe).
        try {
          await this.whatsapp.sendDocument(phone, pdfLink, `Boleto CECIM - ${client.name}.pdf`.replace(/[\\/:*?"<>|]/g, ''));
          await this.logMessage(conversation.id, 'OUTBOUND', `[PDF do boleto] ${pdfLink}`);
        } catch (error: any) {
          this.logger.warn(`Não foi possível enviar o PDF do boleto para ${client.name}: ${error.message}`);
        }
      }
      await this.enviarEmSequencia(conversation.id, phone, mensagens);
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

    // Trava final: nada de desconto, parcelamento, acordo, atendente ou outro canal,
    // mesmo que a IA erre - nesse caso vai a resposta fixa e o painel recebe o aviso.
    const filtrada = filtrarRespostaDoAgente(decision.reply);
    if (filtrada.bloqueada) {
      this.logger.warn(`Resposta do agente bloqueada (termo proibido) para ${client.name}: "${decision.reply}"`);
    }
    await this.logMessage(conversation.id, 'OUTBOUND', filtrada.texto, decision.intent);

    await this.whatsapp.send({ destination: phone, body: filtrada.texto });

    // O agente não negocia: pedido de desconto/parcelamento/acordo sempre gera o aviso interno no painel.
    const encaminhar = decision.requestHumanHandoff || decision.intent === 'QUER_NEGOCIAR' || filtrada.bloqueada;
    const nextStage: ConversationStage = encaminhar
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
        humanRequested: encaminhar,
        lastInboundAt: new Date(),
        lastOutboundAt: new Date(),
      },
    });

    if (encaminhar) {
      await this.notifyHumanEscalation(client.name, phone, text, charge?.description);
    }
  }

  /** Envia as mensagens uma de cada vez, na ordem (cada envio espera o anterior), registrando no histórico. */
  private async enviarEmSequencia(conversationId: string, phone: string, mensagens: string[]) {
    for (const mensagem of mensagens) {
      await this.whatsapp.send({ destination: phone, body: mensagem });
      await this.logMessage(conversationId, 'OUTBOUND', mensagem);
    }
  }

  /** Registra a mensagem como processada; retorna false se ela já tinha sido processada antes. */
  private async marcarComoProcessada(messageId: string): Promise<boolean> {
    try {
      await this.prisma.processedWhatsAppMessage.create({ data: { id: messageId } });
      return true;
    } catch (error: any) {
      if (error?.code === 'P2002') return false; // violação de chave única: já processada
      throw error;
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
    await this.push.notificar('💬 Mensagem para verificar', `${clientName}: "${lastMessage.slice(0, 120)}"`, 'conversations');
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
