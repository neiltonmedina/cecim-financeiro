import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { ChannelProvider, ChannelSendInput, ChannelSendResult } from '../interfaces/channel-provider.interface';

/**
 * Integração com Twilio para envio de SMS usando o número/chip novo
 * (TWILIO_FROM_NUMBER) contratado para a operação de cobrança.
 */
@Injectable()
export class SmsTwilioProvider implements ChannelProvider {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(SmsTwilioProvider.name);
  private client: Twilio | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Twilio {
    if (!this.client) {
      const accountSid = this.config.get<string>('twilio.accountSid');
      const authToken = this.config.get<string>('twilio.authToken');
      if (!accountSid || !authToken) {
        throw new Error('SMS não configurado: defina TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN');
      }
      this.client = new Twilio(accountSid, authToken);
    }
    return this.client;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const from = this.config.get<string>('twilio.fromNumber');
    const statusCallback = this.config.get<string>('twilio.statusCallbackUrl');
    if (!from) {
      throw new Error('SMS não configurado: defina TWILIO_FROM_NUMBER com o número do novo chip');
    }

    try {
      const message = await this.getClient().messages.create({
        to: input.destination,
        from,
        body: input.body,
        statusCallback: statusCallback || undefined,
      });
      return { providerMessageId: message.sid, raw: message };
    } catch (error: any) {
      this.logger.error(`Erro ao enviar SMS para ${input.destination}: ${error.message}`);
      throw new Error(error.message ?? 'Falha ao enviar SMS via Twilio');
    }
  }
}
