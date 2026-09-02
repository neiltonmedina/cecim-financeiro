import { BadRequestException, Body, Controller, Get, Logger, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

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

  /** Recebe status de entrega/leitura das mensagens de WhatsApp enviadas. */
  @Post('whatsapp')
  async receiveWhatsAppEvent(@Body() body: any) {
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const statuses = change.value?.statuses ?? [];
        for (const status of statuses) {
          await this.applyWhatsAppStatus(status.id, status.status, status.errors?.[0]?.title);
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
}
