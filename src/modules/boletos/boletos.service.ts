import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Charge, Client } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InterBoletoProvider } from './inter-boleto.provider';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

/**
 * Valor atualizado de uma cobrança vencida, com as mesmas regras configuradas
 * no boleto do Inter: multa percentual única + juros de mora mensais
 * proporcionais aos dias de atraso (taxa mensal / 30 por dia, juros simples).
 * Sempre calculado sobre o valor e o vencimento ORIGINAIS da cobrança - assim
 * pedir a segunda via várias vezes nunca gera juros sobre juros.
 */
export function calcularValorAtualizado(
  valorCents: number,
  vencimentoISO: string,
  hojeISO: string,
  multaPercentual: number,
  moraTaxaMensal: number,
) {
  const diasAtraso = Math.max(0, Math.round((Date.parse(hojeISO) - Date.parse(vencimentoISO)) / DIA_MS));
  if (diasAtraso === 0) return { diasAtraso, multaCents: 0, jurosCents: 0, totalCents: valorCents };
  const multaCents = Math.round((valorCents * multaPercentual) / 100);
  const jurosCents = Math.round((valorCents * (moraTaxaMensal / 100) * diasAtraso) / 30);
  return { diasAtraso, multaCents, jurosCents, totalCents: valorCents + multaCents + jurosCents };
}

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

  /** Consulta bruta no Inter por código de solicitação - útil pra investigar webhooks não reconhecidos. */
  consultarBruto(codigoSolicitacao: string) {
    return this.inter.consultarBruto(codigoSolicitacao);
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
          // Data que foi de fato enviada e aceita pelo Inter nesta criação -
          // é o que o boleto real tem registrado, independente do que
          // `dueDate` vier a ser depois (ver comentário no schema).
          boletoDataVencimento: charge.dueDate,
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

  /**
   * Segunda via atualizada: se o boleto atual já venceu, gera um boleto novo
   * no Inter com o valor atualizado (multa + juros até hoje) e vencimento
   * hoje, e cancela o antigo (pra não ser pago em dobro). O PDF do boleto
   * vencido mostra o valor original - por isso o cliente que pede o boleto
   * recebe sempre um atualizado. Se o boleto ainda não venceu, devolve o atual.
   *
   * Em caso de falha ao gerar o novo, devolve a cobrança como estava (o
   * boleto antigo continua válido) e `atualizado = false`.
   */
  async gerarSegundaViaAtualizada(charge: Charge, client: Client) {
    const hoje = hojeSaoPaulo();
    const cfg = this.config.get('inter');
    const valor = calcularValorAtualizado(
      charge.amountCents,
      charge.dueDate.toISOString().slice(0, 10),
      hoje,
      cfg?.multaPercentual ?? 0,
      cfg?.moraTaxaMensal ?? 0,
    );

    const vencimentoBoletoAtual = (charge.boletoDataVencimento ?? charge.dueDate).toISOString().slice(0, 10);
    if (vencimentoBoletoAtual >= hoje || !charge.boletoCodigoSolicitacao || !this.inter.isConfigured()) {
      return { charge, valor, atualizado: false };
    }

    const novoVencimento = new Date(`${hoje}T00:00:00.000Z`);
    let novo;
    try {
      novo = await this.inter.createBoleto({ ...charge, amountCents: valor.totalCents, dueDate: novoVencimento }, client);
    } catch (error: any) {
      const message = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Falha ao gerar segunda via da cobrança ${charge.id}: ${message}`);
      return { charge, valor, atualizado: false };
    }

    try {
      await this.inter.cancelarBoleto(charge.boletoCodigoSolicitacao, 'Substituído por segunda via atualizada');
    } catch (error: any) {
      const message = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      // O novo já foi gerado: segue com ele, mas o antigo ainda pode ser pago - precisa de baixa manual.
      this.logger.error(
        `ATENÇÃO: boleto antigo ${charge.boletoCodigoSolicitacao} (cobrança ${charge.id}) não foi cancelado ` +
          `no Inter e continua pagável - cancele manualmente. Erro: ${message}`,
      );
    }

    const atualizada = await this.prisma.charge.update({
      where: { id: charge.id },
      data: {
        boletoCodigoSolicitacao: novo.codigoSolicitacao,
        boletoPdfBase64: novo.pdfBase64,
        pixCopiaECola: novo.pixCopiaECola ?? null,
        linhaDigitavel: novo.linhaDigitavel ?? null,
        externalRef: novo.codigoSolicitacao,
        boletoDataVencimento: novoVencimento,
        boletoErro: null,
      },
    });
    this.logger.log(
      `Segunda via gerada para cobrança ${charge.id}: R$ ${(valor.totalCents / 100).toFixed(2)} ` +
        `(${valor.diasAtraso} dia(s) de atraso).`,
    );
    return { charge: atualizada, valor, atualizado: true };
  }
}
