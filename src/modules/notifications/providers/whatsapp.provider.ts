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
    // Nunca cai num template "padrão" por conta própria: fora do disparo inicial (que
    // sempre informa providerTemplateName explicitamente), estamos dentro da janela de
    // 24h de conversa e o envio deve ser texto livre - um template teria parâmetros
    // fixos que não batem com o texto dinâmico da conversa (agente/opções 1 e 2).
    const templateName = input.providerTemplateName;

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

  /**
   * Inscreve formalmente este app no recebimento de eventos (mensagens e
   * status) da conta do WhatsApp Business informada. Isso é diferente de
   * apenas marcar o campo "messages" como assinado na tela de Webhooks do
   * app - sem essa chamada, mensagens reais de clientes não chegam no
   * nosso webhook mesmo com o campo aparecendo "Assinado".
   */
  async subscribeApp(wabaId: string): Promise<unknown> {
    const accessToken = this.config.get<string>('whatsapp.accessToken');
    const version = this.config.get<string>('whatsapp.apiVersion');
    if (!accessToken) {
      throw new Error('WhatsApp não configurado: defina WHATSAPP_ACCESS_TOKEN');
    }

    const response = await fetch(`https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      const errMsg = data?.error?.message ?? `Falha HTTP ${response.status} ao inscrever o app na conta do WhatsApp`;
      this.logger.error(`Erro ao inscrever app na WABA ${wabaId}: ${errMsg}`);
      throw new Error(errMsg);
    }
    this.logger.log(`App inscrito com sucesso na conta do WhatsApp ${wabaId}.`);
    return data;
  }
}
