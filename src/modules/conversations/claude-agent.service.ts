import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Charge, Client, ConversationMessage, MessageIntent, NegotiationPolicy } from '@prisma/client';
import { formatCurrencyBRL, formatDateBR } from '../notifications/utils/template-renderer.util';

export interface AgentDecision {
  intent: MessageIntent;
  reply: string;
  requestHumanHandoff: boolean;
  requestPaymentProof: boolean;
}

const RESPONDER_TOOL: Anthropic.Tool = {
  name: 'responder_cliente',
  description:
    'Classifica a intenção da mensagem do cliente e produz a resposta a ser enviada, seguindo estritamente as regras da empresa.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: [
          'JA_PAGOU',
          'VAI_PAGAR',
          'DATA_ESPECIFICA',
          'QUER_NEGOCIAR',
          'NAO_RECONHECE',
          'NAO_PODE_PAGAR',
          'PEDIU_BOLETO_PIX',
          'QUER_HUMANO',
          'OUTRO',
        ],
        description: 'Intenção principal identificada na última mensagem do cliente.',
      },
      reply: {
        type: 'string',
        description:
          'Resposta a ser enviada ao cliente pelo WhatsApp: educada, profissional, objetiva, sem ameaças, sem parecer um robô, sem inventar valores/condições fora do permitido.',
      },
      requestHumanHandoff: {
        type: 'boolean',
        description:
          'true se a conversa deve ser pausada e encaminhada para um atendente humano (cliente pediu humano, não reconhece a cobrança, ou situação sensível/fora do escopo autorizado).',
      },
      requestPaymentProof: {
        type: 'boolean',
        description: 'true se a resposta deve pedir o comprovante de pagamento ao cliente.',
      },
    },
    required: ['intent', 'reply', 'requestHumanHandoff', 'requestPaymentProof'],
    additionalProperties: false,
  },
  strict: true,
};

@Injectable()
export class ClaudeAgentService {
  private readonly logger = new Logger(ClaudeAgentService.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = this.config.get<string>('anthropic.apiKey');
      if (!apiKey) {
        throw new Error('Agente de cobrança não configurado: defina ANTHROPIC_API_KEY');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  private buildSystemPrompt(policy: NegotiationPolicy | null, appUrl: string): string {
    // Decisão da empresa: este WhatsApp é SÓ para envio de boletos e Pix. Não há
    // atendimento humano por ele e o agente não negocia (a política cadastrada é ignorada).
    void policy;
    const contato = this.config.get<string>('contatoAtendimento');
    const ondeFalar = contato
      ? `para outros assuntos, o cliente deve falar com a CECIM ${contato}`
      : 'para outros assuntos, o cliente deve procurar a CECIM pelos canais de atendimento habituais do escritório';

    return [
      `Você é o assistente automático de cobrança da CECIM Assessoria Contábil no WhatsApp.`,
      `Este canal serve SOMENTE para enviar boletos e códigos Pix das cobranças. Não existe atendimento humano por aqui.`,
      ``,
      `TOM DE VOZ (obrigatório):`,
      `- Educado, cordial, profissional e objetivo. Mensagens curtas.`,
      `- Sem ameaças, sem constrangimento, sem excesso de mensagens.`,
      ``,
      `O QUE VOCÊ PODE OFERECER (e nada além disso):`,
      `- Pix: o cliente responde *1*.`,
      `- Boleto: o cliente responde *2*.`,
      ``,
      `PROIBIDO (nunca faça):`,
      `- Oferecer, sugerir ou aceitar desconto, parcelamento, mais prazo, acordo ou qualquer condição diferente.`,
      `- Prometer que um atendente, pessoa ou equipe vai responder ou continuar a conversa por aqui.`,
      `- Pedir comprovante, documentos, senhas, dados de cartão ou qualquer informação.`,
      `- Calcular multa, juros ou valores: use exatamente o valor e o link do contexto (já vêm prontos do Banco Inter).`,
      ``,
      `COMO RESPONDER:`,
      `- Saudação ou mensagem sem conteúdo ("oi", "bom dia", emoji): explique brevemente que este canal é automático,` +
        ` só para boletos e Pix, e que a pessoa pode responder *1* (Pix) ou *2* (boleto). intent = OUTRO, requestHumanHandoff = false.`,
      `- Cliente diz que já pagou: agradeça e explique que a confirmação é automática pelo banco (pode levar até 2 dias` +
        ` úteis no boleto) e que, se já pagou, pode desconsiderar as mensagens. intent = JA_PAGOU, requestHumanHandoff = false.`,
      `- Cliente pede desconto, parcelamento, prazo, acordo, quer falar com alguém, não reconhece a cobrança ou qualquer` +
        ` outro assunto: explique com cordialidade que este canal é automático e serve apenas para envio de boletos e Pix,` +
        ` que ${ondeFalar}, e lembre que pode responder *1* (Pix) ou *2* (boleto).` +
        ` Marque requestHumanHandoff = true (é só um aviso interno para a equipe - NÃO diga ao cliente que alguém vai responder).`,
      `- requestPaymentProof é sempre false.`,
      ``,
      `Link de pagamento, quando precisar informar: ${appUrl}/pagamentos/{id-da-cobranca} (você recebe o link exato no contexto da cobrança abaixo, use-o).`,
    ].join('\n');
  }

  private buildContextBlock(client: Client, charge: Charge | null, history: ConversationMessage[]): string {
    const chargeInfo = charge
      ? `Cobrança em aberto: "${charge.description}", valor ${formatCurrencyBRL(charge.amountCents)}, ` +
        `vencimento ${formatDateBR(charge.dueDate)}, status atual: ${charge.status}. ` +
        `Link de pagamento: ${charge.paymentLink ?? '(gerar via sistema)'}.`
      : 'Não há cobrança específica vinculada a esta conversa no momento.';

    const historyText = history
      .slice(-10)
      .map((m) => `${m.direction === 'INBOUND' ? 'Cliente' : 'Agente'}: ${m.content}`)
      .join('\n');

    return [
      `Cliente: ${client.name}`,
      chargeInfo,
      history.length ? `\nHistórico recente da conversa:\n${historyText}` : '',
    ].join('\n');
  }

  async decide(params: {
    client: Client;
    charge: Charge | null;
    history: ConversationMessage[];
    incomingMessage: string;
    policy: NegotiationPolicy | null;
    appUrl: string;
  }): Promise<AgentDecision> {
    const system = this.buildSystemPrompt(params.policy, params.appUrl);
    const context = this.buildContextBlock(params.client, params.charge, params.history);

    try {
      const response = await this.getClient().messages.create({
        model: 'claude-opus-5',
        max_tokens: 1024,
        system,
        tools: [RESPONDER_TOOL],
        tool_choice: { type: 'tool', name: 'responder_cliente' },
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: `${context}\n\nNova mensagem do cliente: "${params.incomingMessage}"`,
          },
        ],
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        throw new Error('O agente não retornou uma decisão estruturada.');
      }

      const input = toolUse.input as {
        intent: MessageIntent;
        reply: string;
        requestHumanHandoff: boolean;
        requestPaymentProof: boolean;
      };

      return {
        intent: input.intent,
        reply: input.reply,
        requestHumanHandoff: input.requestHumanHandoff,
        requestPaymentProof: input.requestPaymentProof,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao consultar o agente de IA: ${error.message}`);
      // Falha segura: nunca deixa o cliente sem resposta nem promete algo indevido - escala para humano.
      return {
        intent: 'OUTRO',
        reply:
          'Obrigado pela mensagem! Estou encaminhando para um de nossos atendentes te responder o quanto antes.',
        requestHumanHandoff: true,
        requestPaymentProof: false,
      };
    }
  }
}
