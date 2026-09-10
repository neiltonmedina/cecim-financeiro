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
      const { codigoSolicitacao, pdfBase64, pixCopiaECola } = await this.inter.createBoleto(charge, client);
      const appUrl = this.config.get<string>('appUrl');
      return this.prisma.charge.update({
        where: { id: charge.id },
        data: {
          boletoCodigoSolicitacao: codigoSolicitacao,
          boletoPdfBase64: pdfBase64,
          pixCopiaECola: pixCopiaECola ?? null,
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
}
