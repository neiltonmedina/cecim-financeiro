export interface ChannelSendResult {
  providerMessageId: string;
  raw?: unknown;
}

export interface ChannelSendInput {
  destination: string;
  /** Corpo já renderizado (texto para SMS, HTML para e-mail, texto para WhatsApp de sessão). */
  body: string;
  /** Assunto, usado apenas por e-mail. */
  subject?: string;
  /**
   * Nome do template pré-aprovado na Meta (WhatsApp Business API), necessário para
   * iniciar conversa fora da janela de 24h. Ignorado pelos demais canais.
   */
  providerTemplateName?: string;
  templateLanguage?: string;
  /** Parâmetros posicionais para preencher o template aprovado do WhatsApp. */
  templateParams?: string[];
  /**
   * Payload de cada botão de resposta rápida do template, na ordem dos botões
   * (ex: ["PIX:<id-da-cobrança>", "BOLETO:<id>"]) - volta no webhook quando o
   * cliente toca no botão, identificando a cobrança exata.
   */
  templateButtonPayloads?: string[];
}

export interface ChannelProvider {
  readonly channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}
