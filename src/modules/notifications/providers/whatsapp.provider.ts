import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelProvider, ChannelSendInput, ChannelSendResult } from '../interfaces/channel-provider.interface';

/**
 * Integração com a WhatsApp Business Cloud API (Meta), usando o número/chip
 * novo cadastrado como WHATSAPP_PHONE_NUMBER_ID.
 *
 * Fora da janela de 24h de conversa, o WhatsApp exige o uso de um template de
 * mensagem pré-aprovado (providerTemplateName). Dentro da janela, é possível
 * enviar texto livre.
 */
@Injectable()
export class WhatsAppProvider implements ChannelProvider {
  readonly channel = 'WHATSAPP' as const;
  private readonly logger = new Logger(WhatsAppProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get apiUrl(): string {
    const version = this.config.get<string>('whatsapp.apiVersion');
    const phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const accessToken = this.config.get<string>('whatsapp.accessToken');
    if (!accessToken || !this.config.get<string>('whatsapp.phoneNumberId')) {
      throw new Error('WhatsApp não configurado: defina WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID');
    }

    const to = input.destination.replace('+', '');
    const templateName = input.providerTemplateName ?? this.config.get<string>('whatsapp.templateName');

    const payload = templateName
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: input.templateLanguage ?? this.config.get<string>('whatsapp.templateLanguage') },
            components: input.templateParams?.length
              ? [
                  {
                    type: 'body',
                    parameters: input.templateParams.map((text) => ({ type: 'text', text })),
                  },
                ]
              : undefined,
          },
        }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: input.body, preview_url: true },
        };

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as any;

    if (!response.ok) {
      const errMsg = data?.error?.message ?? `Falha HTTP ${response.status} ao enviar WhatsApp`;
      this.logger.error(`Erro ao enviar WhatsApp para ${to}: ${errMsg}`);
      throw new Error(errMsg);
    }

    const providerMessageId = data?.messages?.[0]?.id ?? `whatsapp-${Date.now()}`;
    return { providerMessageId, raw: data };
  }
}
