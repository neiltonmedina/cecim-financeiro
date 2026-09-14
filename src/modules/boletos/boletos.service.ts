import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Charge, Client } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InterBoletoProvider } from './inter-boleto.provider';

@Injectable()
export class BoletosService {
  private readonly logger = new Logger(BoletosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inter: InterBoletoProvider,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return this.inter.isConfigured();
  }

  /** Registra no Inter a URL de callback que recebe a confirmação de pagamento. */
  async registrarWebhookPagamento() {
    if (!this.inter.isConfigured()) {
      throw new Error('Integração com o Inter não configurada.');
    }
    const appUrl = this.config.get<string>('appUrl');
    const webhookUrl = `${appUrl}/webhooks/inter/cobranca`;
    await this.inter.registrarWebhook(webhookUrl);
    return { webhookUrl, registrado: true };
  }

  /** Consulta qual URL de webhook está registrada hoje no Inter. */
  async consultarWebhookPagamento() {
    if (!this.inter.isConfigured()) {
      throw new Error('Integração com o Inter não configurada.');
    }
    return this.inter.consultarWebhook();
  }

  /**
   * Gera o boleto no Inter para a cobrança e salva o link interno
   * (que serve o PDF) no campo paymentLink. Nunca lança erro para quem
   * chamou - se falhar, registra o motivo em boletoErro e a cobrança
   * segue sem boleto (o link de pagamento fica em branco).
   */
  async gerarBoletoParaCobranca(charge: Charge, client: Client): Promise<Charge> {
    if (!this.inter.isConfigured()) {
      return charge;
    }
    try {
      const { codigoSolicitacao, pdfBase64, pixCopiaECola, linhaDigitavel } = await this.inter.createBoleto(charge, client);
      const appUrl = this.config.get<string>('appUrl');
      return this.prisma.charge.update({
        where: { id: charge.id },
        data: {
          boletoCodigoSolicitacao: codigoSolicitacao,
          boletoPdfBase64: pdfBase64,
          pixCopiaECola: pixCopiaECola ?? null,
          linhaDigitavel: linhaDigitavel ?? null,
          boletoErro: null,
          paymentLink: `${appUrl}/boletos/${charge.id}`,
          externalRef: codigoSolicitacao,
        },
      });
    } catch (error: any) {
      const message = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Falha ao gerar boleto no Inter para cobrança ${charge.id}: ${message}`);
      return this.prisma.charge.update({
        where: { id: charge.id },
        data: { boletoErro: message?.toString().slice(0, 500) },
      });
    }
  }

  /**
   * Garante que a cobrança tem a linha digitável salva localmente, buscando
   * no Inter quando já existe um boleto criado mas a linha digitável nunca
   * foi capturada (cobranças antigas, anteriores a esse campo existir).
   * Importante: sem isso, o disparo por WhatsApp cai no fallback do Pix no
   * lugar da linha digitável no template, o que fica errado/confuso pro
   * cliente - por isso isso deve rodar antes de qualquer disparo.
   */
  async garantirLinhaDigitavel(charge: Charge): Promise<Charge> {
    if (charge.linhaDigitavel || !charge.boletoCodigoSolicitacao || !this.inter.isConfigured()) {
      return charge;
    }
    try {
      const { pixCopiaECola, linhaDigitavel } = await this.inter.consultarDetalhes(charge.boletoCodigoSolicitacao);
      if (!linhaDigitavel) return charge;
      return this.prisma.charge.update({
        where: { id: charge.id },
        data: {
          linhaDigitavel,
          pixCopiaECola: pixCopiaECola ?? charge.pixCopiaECola,
        },
      });
    } catch (error: any) {
      this.logger.warn(`Não foi possível completar linha digitável da cobrança ${charge.id}: ${error.message}`);
      return charge;
    }
  }
}
