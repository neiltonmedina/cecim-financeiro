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
      scope: 'boleto-cobranca.read boleto-cobranca.write',
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
        // Endereço não é obrigatório em todos os casos, mas o Inter recomenda informar.
        endereco: 'Não informado',
        bairro: 'Não informado',
        cidade: 'Não informado',
        uf: 'SP',
        cep: '00000000',
        numero: 'SN',
      },
    };

    if (cfg.multaPercentual > 0) {
      payload.multa = { codigoMulta: 'PERCENTUAL', taxa: cfg.multaPercentual };
    } else {
      payload.multa = { codigoMulta: 'NAOTEMMULTA' };
    }

    if (cfg.moraTaxaMensal > 0) {
      payload.mora = { codigoMora: 'TAXAMENSAL', taxa: cfg.moraTaxaMensal };
    } else {
      payload.mora = { codigoMora: 'ISENTO' };
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

    return { codigoSolicitacao, pdfBase64 };
  }
}
