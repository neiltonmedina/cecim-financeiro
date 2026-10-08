import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface DadosBoleto {
  nome: string;
  documento: string;
  cep: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  valor: string;
  vencimento: string;
  linhaDigitavel: string;
}

const CAMPOS: (keyof DadosBoleto)[] = [
  'nome',
  'documento',
  'cep',
  'endereco',
  'numero',
  'bairro',
  'cidade',
  'uf',
  'valor',
  'vencimento',
  'linhaDigitavel',
];

const TIPOS_IMAGEM = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type TipoImagem = (typeof TIPOS_IMAGEM)[number];

const INSTRUCOES =
  'Este arquivo é um boleto bancário brasileiro. Extraia os dados do PAGADOR (o cliente que deve pagar - ' +
  'nunca do beneficiário/cedente) e da cobrança. Regras:\n' +
  '- documento: CPF ou CNPJ do pagador, só números.\n' +
  '- cep: só números. uf: sigla de 2 letras.\n' +
  '- endereco: só o logradouro (rua/avenida), sem número, bairro ou cidade. numero: o número do imóvel, ou "" se não houver.\n' +
  '- valor: valor do documento em reais com ponto decimal, ex: "150.00".\n' +
  '- vencimento: data de vencimento no formato AAAA-MM-DD.\n' +
  '- linhaDigitavel: só os números da linha digitável.\n' +
  '- Se um campo não aparecer no boleto, devolva "" - nunca invente.';

/**
 * Lê um boleto (PDF ou foto) e extrai os dados do pagador para pré-preencher
 * o cadastro de cliente no painel. Usa o Claude, que lê qualquer layout de
 * banco (inclusive boleto escaneado/fotografado), em vez de um parser por banco.
 */
@Injectable()
export class BoletoLeituraService {
  private readonly logger = new Logger(BoletoLeituraService.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = this.config.get<string>('anthropic.apiKey');
      if (!apiKey) {
        throw new BadRequestException('Leitura de boleto indisponível: defina ANTHROPIC_API_KEY no Render.');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async lerBoleto(arquivo: Buffer, mimeType: string): Promise<DadosBoleto> {
    const data = arquivo.toString('base64');
    let anexo: Anthropic.ContentBlockParam;
    if (mimeType === 'application/pdf') {
      anexo = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
    } else if ((TIPOS_IMAGEM as readonly string[]).includes(mimeType)) {
      anexo = { type: 'image', source: { type: 'base64', media_type: mimeType as TipoImagem, data } };
    } else {
      throw new BadRequestException('Envie o boleto em PDF ou como imagem (PNG/JPG).');
    }

    const response = await this.getClient().messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: Object.fromEntries(CAMPOS.map((c) => [c, { type: 'string' }])),
            required: CAMPOS,
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content: [anexo, { type: 'text', text: INSTRUCOES }] }],
    });

    if (response.stop_reason === 'refusal') {
      throw new BadRequestException('Não foi possível ler esse arquivo.');
    }
    const texto = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (!texto) {
      throw new BadRequestException('Não foi possível ler os dados do boleto.');
    }
    const dados = JSON.parse(texto) as DadosBoleto;
    this.logger.log(`Boleto lido: pagador ${dados.nome || '(sem nome)'}.`);
    return dados;
  }
}
