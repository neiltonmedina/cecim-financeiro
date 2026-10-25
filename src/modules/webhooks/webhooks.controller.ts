import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { BoletosService } from '../boletos/boletos.service';

const ROTULO_TIPO: Record<string, string> = {
  image: 'imagem', audio: 'áudio', video: 'vídeo', document: 'documento', sticker: 'figurinha',
  location: 'localização', contacts: 'contato', reaction: 'reação', order: 'pedido', unsupported: 'não suportada',
};

/** Texto legível de qualquer mensagem recebida (para a caixa de entrada do painel). */
export function resumoDaMensagem(message: any): { tipo: string; texto: string } {
  const tipo = String(message?.type ?? 'text');
  const texto =
    message?.text?.body ?? message?.button?.text ?? message?.interactive?.button_reply?.title ?? message?.interactive?.list_reply?.title;
  if (texto) return { tipo, texto };
  const midia = message?.[tipo];
  const legenda = midia?.caption ?? midia?.filename ?? (tipo === 'reaction' ? midia?.emoji : undefined);
  const rotulo = ROTULO_TIPO[tipo] ?? tipo;
  return { tipo, texto: legenda ? `[${rotulo}] ${legenda}` : `[${rotulo}]` };
}

/** Mapeia os status de entrega da Meta para o enum interno de NotificationLog. */
const WHATSAPP_STATUS_MAP: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/** Mapeia os status de entrega da Twilio para o enum interno de NotificationLog. */
const TWILIO_STATUS_MAP: Record<string, 'SENT' | 'DELIVERED' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  failed: 'FAILED',
  undelivered: 'FAILED',
};

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly conversations: ConversationsService,
    private readonly boletos: BoletosService,
  ) {}

  /** Verificação do webhook exigida pela Meta ao cadastrar a URL no App do WhatsApp. */
  @Get('whatsapp')
  verifyWhatsAppWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('whatsapp.verifyToken');
    if (mode === 'subscribe' && token === expected) {
      return res.status(200).send(challenge);
    }
    throw new BadRequestException('Token de verificação inválido');
  }

  /**
   * Recebe status de entrega/leitura das mensagens enviadas, e também as
   * mensagens recebidas dos clientes - que alimentam o agente de cobrança.
   */
  @Post('whatsapp')
  @HttpCode(200)
  receiveWhatsAppEvent(@Body() body: any, @Req() req?: any) {
    this.conferirAssinaturaMeta(req);
    // Responde à Meta imediatamente e processa em segundo plano: se a resposta
    // demora, a Meta reenvia o mesmo evento (o que gerava respostas repetidas).
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const statuses = change.value?.statuses ?? [];
        for (const status of statuses) {
          const erro = status.errors?.[0];
          const erroTexto = erro ? `${erro.code ? `(#${erro.code}) ` : ''}${erro.title ?? ''}`.trim() : undefined;
          this.applyWhatsAppStatus(status.id, status.status, erroTexto).catch((err) => {
            this.logger.error(`Erro ao atualizar status de WhatsApp: ${err.message}`);
          });
        }

        const messages = change.value?.messages ?? [];
        const nomes = new Map<string, string>((change.value?.contacts ?? []).map((c: any) => [String(c.wa_id), c.profile?.name]));
        for (const message of messages) {
          // Caixa de entrada: guarda tudo o que chega (inclusive número não cadastrado e mídia).
          if (message.id && message.from) {
            const { tipo, texto } = resumoDaMensagem(message);
            this.prisma.mensagemRecebida
              .createMany({
                data: [{ id: message.id, de: String(message.from), nomePerfil: nomes.get(String(message.from)) ?? null, tipo, texto: texto.slice(0, 2000) }],
                skipDuplicates: true,
              })
              .catch((err) => this.logger.warn(`Mensagem recebida não gravada na caixa de entrada: ${err.message}`));
          }
          // Texto digitado, toque em botão de resposta rápida de template (type "button")
          // ou de mensagem interativa (type "interactive").
          const text = message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title;
          const payload = message.button?.payload ?? message.interactive?.button_reply?.id;
          if (message.from && text) {
            this.conversations.handleInboundWhatsApp(message.from, text, message.id, payload).catch((err) => {
              this.logger.error(`Erro ao processar mensagem do agente: ${err.message}`);
            });
          }
        }
      }
    }
    return { received: true };
  }

  private async applyWhatsAppStatus(providerMessageId: string, status: string, errorMessage?: string) {
    const mapped = WHATSAPP_STATUS_MAP[status];
    if (!mapped) return;

    const log = await this.prisma.notificationLog.findFirst({ where: { providerMessageId } });
    if (!log) {
      this.logger.warn(`Status de WhatsApp recebido para mensagem desconhecida: ${providerMessageId}`);
      return;
    }

    // Os avisos da Meta podem chegar fora de ordem: "entregue" depois de "lida" não volta o status.
    const ORDEM = ['SENT', 'DELIVERED', 'READ'];
    if (ORDEM.indexOf(mapped) >= 0 && ORDEM.indexOf(mapped) < ORDEM.indexOf(log.status)) return;

    const data: any = { status: mapped };
    if (mapped === 'DELIVERED') data.deliveredAt = new Date();
    if (mapped === 'READ') data.readAt = new Date();
    if (mapped === 'FAILED') {
      data.failedAt = new Date();
      data.errorMessage = errorMessage ?? 'Falha reportada pela Meta';
    }

    await this.prisma.notificationLog.update({ where: { id: log.id }, data });
  }

  /** Callback de status de entrega de SMS enviado via Twilio. */
  @Post('sms/twilio/status')
  async receiveTwilioStatus(@Body() body: { MessageSid?: string; MessageStatus?: string; ErrorMessage?: string }) {
    const { MessageSid, MessageStatus, ErrorMessage } = body;
    if (!MessageSid || !MessageStatus) {
      return { received: true };
    }

    const mapped = TWILIO_STATUS_MAP[MessageStatus.toLowerCase()];
    if (!mapped) return { received: true };

    const log = await this.prisma.notificationLog.findFirst({ where: { providerMessageId: MessageSid } });
    if (!log) {
      this.logger.warn(`Status de SMS recebido para mensagem desconhecida: ${MessageSid}`);
      return { received: true };
    }

    const data: any = { status: mapped };
    if (mapped === 'DELIVERED') data.deliveredAt = new Date();
    if (mapped === 'FAILED') {
      data.failedAt = new Date();
      data.errorMessage = ErrorMessage ?? 'Falha reportada pela Twilio';
    }

    await this.prisma.notificationLog.update({ where: { id: log.id }, data });
    return { received: true };
  }

  /**
   * Recebe a confirmação de pagamento (baixa) do boleto/Pix pelo Banco Inter.
   * Marca a cobrança como PAGA e encerra automaticamente a régua/conversa
   * daquele cliente - sem precisar de nenhuma ação manual no painel.
   *
   * ⚠️ O formato exato do payload deve ser confirmado ao registrar o webhook
   * no Inter (o parser abaixo aceita as variações mais comuns: situacao
   * "RECEBIDO"/"MARCADO_RECEBIDO"/"PAGO" e o codigoSolicitacao em diferentes
   * posições do corpo).
   */
  @Post('inter/cobranca')
  async receiveInterPaymentEvent(@Body() body: any) {
    const eventos = Array.isArray(body) ? body : [body];
    for (const evento of eventos) {
      const codigoSolicitacao = evento?.codigoSolicitacao ?? evento?.cobranca?.codigoSolicitacao;
      const situacao: string = (evento?.situacao ?? evento?.cobranca?.situacao ?? '').toUpperCase();
      const situacoesPagas = ['RECEBIDO', 'MARCADO_RECEBIDO', 'PAGO', 'LIQUIDADO'];

      if (!codigoSolicitacao || !situacoesPagas.includes(situacao)) continue;

      const charge = await this.prisma.charge.findFirst({ where: { boletoCodigoSolicitacao: codigoSolicitacao } });
      if (!charge) {
        this.logger.warn(`Webhook do Inter recebido para cobrança desconhecida: ${codigoSolicitacao}`);
        continue;
      }
      // A URL é pública: só dá baixa se o próprio Inter confirmar o pagamento.
      const confirmado = await this.boletos.pagamentoNoInter(codigoSolicitacao).catch((e) => {
        this.logger.warn(`Não foi possível confirmar no Inter o pagamento de ${codigoSolicitacao}: ${e.message}`);
        return { pago: false, valorRecebidoCents: undefined };
      });
      if (!confirmado.pago) {
        this.logger.warn(`Aviso de pagamento de ${codigoSolicitacao} não confirmado pelo Inter - ignorado.`);
        continue;
      }
      if (!(await this.conversations.registrarPagamento(charge.id, confirmado.valorRecebidoCents))) continue; // já processado antes
      this.logger.log(`Cobrança ${charge.id} marcada como PAGA via webhook do Inter (${situacao}).`);
    }
    return { received: true };
  }

  /**
   * Confere que o evento veio mesmo da Meta (cabeçalho X-Hub-Signature-256 =
   * HMAC-SHA256 do corpo com o App Secret). Sem WHATSAPP_APP_SECRET configurado,
   * só avisa no log - para não parar o WhatsApp antes de a chave ser cadastrada.
   */
  private conferirAssinaturaMeta(req: any) {
    const segredo = this.config.get<string>('whatsapp.appSecret');
    if (!segredo) {
      if (!this.avisouSemSegredo) {
        this.logger.warn('WHATSAPP_APP_SECRET não definido: assinatura da Meta não conferida no webhook. Defina no Render.');
        this.avisouSemSegredo = true;
      }
      return;
    }
    const recebida = String(req?.headers?.['x-hub-signature-256'] ?? '');
    const esperada = 'sha256=' + createHmac('sha256', segredo).update(req?.rawBody ?? '').digest('hex');
    const a = Buffer.from(recebida);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Evento do WhatsApp com assinatura inválida - ignorado.');
      throw new ForbiddenException('Assinatura inválida.');
    }
  }

  private avisouSemSegredo = false;
}
