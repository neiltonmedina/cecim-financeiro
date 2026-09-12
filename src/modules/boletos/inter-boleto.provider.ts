import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { Charge, Client } from '@prisma/client';

interface InterTokenResponse {
  access_token: string;
  expires_in: number;
}

export interface InterBoletoResult {
  codigoSolicitacao: string;
  pdfBase64: string;
  pixCopiaECola?: string;
  linhaDigitavel?: string;
}

/**
 * Integração com a API de Cobrança (boleto) do Banco Inter.
 *
 * Autenticação: OAuth2 client_credentials + certificado mTLS (obrigatório
 * pelo Inter). O boleto é criado via POST /cobranca/v3/cobrancas e o PDF é
 * obtido separadamente, em base64, via GET .../{codigoSolicitacao}/pdf -
 * o Inter não fornece um link público pronto como outros gateways.
 *
 * Baseado na integração de referência já validada pela empresa
 * (projeto "Boletosenv"), com adição de multa e juros de mora.
 */
@Injectable()
export class InterBoletoProvider {
  private readonly logger = new Logger(InterBoletoProvider.name);
  private client: AxiosInstance | null = null;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const c = this.config.get('inter');
    return !!(c?.clientId && c?.clientSecret && c?.certBase64 && c?.keyBase64);
  }

  private getClient(): AxiosInstance {
    if (!this.client) {
      const cfg = this.config.get('inter');
      if (!this.isConfigured()) {
        throw new Error(
          'Integração com o Inter não configurada: defina INTER_CLIENT_ID, INTER_CLIENT_SECRET, INTER_CERT_BASE64 e INTER_KEY_BASE64',
        );
      }
      const cert = Buffer.from(cfg.certBase64, 'base64');
      const key = Buffer.from(cfg.keyBase64, 'base64');
      this.client = axios.create({
        baseURL: cfg.baseUrl,
        httpsAgent: new https.Agent({ cert, key }),
      });
    }
    return this.client;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }
    const cfg = this.config.get('inter');
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'client_credentials',
      // Escopos de webhook incluídos aqui também - não afeta a emissão de boleto,
      // só amplia o que o token pode fazer (necessário para registrar o webhook de pagamento).
      scope: 'boleto-cobranca.read boleto-cobranca.write webhook-cobranca.read webhook-cobranca.write',
    });

    const response = await this.getClient().post<InterTokenResponse>('/oauth/v2/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.cachedToken = {
      value: response.data.access_token,
      expiresAt: Date.now() + (response.data.expires_in - 30) * 1000,
    };
    return this.cachedToken.value;
  }

  private splitName(fullName: string): string {
    return fullName.trim().slice(0, 100);
  }

  private onlyDigits(value: string): string {
    return (value || '').replace(/\D/g, '');
  }

  /** Cria o boleto no Inter para a cobrança e já baixa o PDF (em base64). */
  async createBoleto(charge: Charge, client: Client): Promise<InterBoletoResult> {
    const token = await this.getAccessToken();
    const cfg = this.config.get('inter');

    const documento = this.onlyDigits(client.document ?? '');
    if (!documento) {
      throw new Error('Cliente sem CPF/CNPJ cadastrado - obrigatório para gerar boleto no Inter');
    }
    // O Inter valida o CEP contra uma base real de endereços - um CEP inventado
    // (ex: 00000000) é rejeitado. É obrigatório cadastrar o endereço real do cliente.
    const cep = this.onlyDigits(client.cep ?? '');
    if (!cep || !client.endereco || !client.bairro || !client.cidade || !client.uf) {
      throw new Error(
        'Cliente sem endereço completo cadastrado (cep, endereco, bairro, cidade, uf) - obrigatório para gerar boleto no Inter',
      );
    }
    const tipoPessoa = documento.length > 11 ? 'JURIDICA' : 'FISICA';

    const payload: Record<string, any> = {
      seuNumero: charge.id.slice(0, 15),
      valorNominal: Number((charge.amountCents / 100).toFixed(2)),
      dataVencimento: charge.dueDate.toISOString().slice(0, 10),
      numDiasAgenda: 60,
      pagador: {
        cpfCnpj: documento,
        tipoPessoa,
        nome: this.splitName(client.name),
        email: client.email ?? undefined,
        endereco: client.endereco,
        bairro: client.bairro,
        cidade: client.cidade,
        uf: client.uf,
        cep,
        numero: client.numero ?? 'SN',
      },
    };

    // A API do Inter usa a chave "codigo" (não "codigoMulta"/"codigoMora") dentro
    // dos objetos multa/mora, e sempre com os três campos (codigo, taxa e valor)
    // presentes, mesmo quando um deles não é usado - confirmado na implementação
    // de referência (renatojdev/bancointer-python, classes Multa/Mora).
    if (cfg.multaPercentual > 0) {
      payload.multa = { codigo: 'PERCENTUAL', taxa: cfg.multaPercentual, valor: 0 };
    } else {
      payload.multa = { codigo: 'NAOTEMMULTA', taxa: 0, valor: 0 };
    }

    if (cfg.moraTaxaMensal > 0) {
      payload.mora = { codigo: 'TAXAMENSAL', taxa: cfg.moraTaxaMensal, valor: 0 };
    } else {
      payload.mora = { codigo: 'ISENTO', taxa: 0, valor: 0 };
    }

    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await this.getClient().post('/cobranca/v3/cobrancas', payload, { headers });
    const codigoSolicitacao = createResponse.data?.codigoSolicitacao;
    if (!codigoSolicitacao) {
      throw new Error('O Inter não retornou o código da cobrança criada.');
    }

    const pdfResponse = await this.getClient().get(`/cobranca/v3/cobrancas/${codigoSolicitacao}/pdf`, { headers });
    const pdfBase64 = pdfResponse.data?.pdf;
    if (!pdfBase64) {
      throw new Error('O boleto foi criado, mas não foi possível obter o PDF.');
    }

    // Consulta os detalhes da cobrança para obter o Pix copia-e-cola e a linha
    // digitável do boleto (quando disponíveis).
    let pixCopiaECola: string | undefined;
    let linhaDigitavel: string | undefined;
    try {
      const detalhes = await this.getClient().get(`/cobranca/v3/cobrancas/${codigoSolicitacao}`, { headers });
      pixCopiaECola = detalhes.data?.pix?.pixCopiaECola;
      linhaDigitavel = detalhes.data?.boleto?.linhaDigitavel;
    } catch (error: any) {
      this.logger.warn(`Não foi possível obter o Pix/linha digitável da cobrança ${codigoSolicitacao}: ${error.message}`);
    }

    return { codigoSolicitacao, pdfBase64, pixCopiaECola, linhaDigitavel };
  }

  /**
   * Registra a URL de callback de pagamento no Inter (uma vez só, configuração
   * inicial). Se o Inter já tiver outra URL registrada, isso a substitui.
   *
   * ⚠️ Endpoint baseado no padrão documentado da API de Cobrança do Inter -
   * se retornar 404/400, o corpo da resposta normalmente indica o formato
   * esperado; encaminhe o erro para ajuste.
   */
  async registrarWebhook(webhookUrl: string): Promise<void> {
    const token = await this.getAccessToken();
    await this.getClient().put(
      '/cobranca/v3/cobrancas/webhook',
      { webhookUrl },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }

  /** Consulta a URL de webhook atualmente registrada no Inter. */
  async consultarWebhook(): Promise<unknown> {
    const token = await this.getAccessToken();
    const response = await this.getClient().get('/cobranca/v3/cobrancas/webhook', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }
}
