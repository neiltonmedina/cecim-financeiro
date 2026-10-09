import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';

/**
 * Consulta dados públicos de um CNPJ (Receita Federal) via BrasilAPI, gratuita
 * e sem chave, para pré-preencher o cadastro de cliente no painel.
 */
@Injectable()
export class CnpjConsultaService {
  private readonly logger = new Logger(CnpjConsultaService.name);

  async consultar(cnpjRaw: string) {
    const cnpj = (cnpjRaw || '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      throw new BadRequestException('CNPJ deve ter 14 dígitos.');
    }
    let d: any;
    try {
      ({ data: d } = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 15000 }));
    } catch (error: any) {
      if (error.response?.status === 404) throw new NotFoundException('CNPJ não encontrado na Receita.');
      this.logger.warn(`Falha ao consultar CNPJ ${cnpj}: ${error.message}`);
      throw new BadRequestException('Não foi possível consultar o CNPJ agora - tente de novo em instantes.');
    }

    const tipo = (d.descricao_tipo_de_logradouro || '').trim();
    const logradouro = (d.logradouro || '').trim();
    const endereco =
      tipo && !logradouro.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${logradouro}` : logradouro;
    const telefone = (d.ddd_telefone_1 || '').replace(/\D/g, '');

    return {
      nome: d.razao_social || '',
      nomeFantasia: d.nome_fantasia || '',
      situacao: d.descricao_situacao_cadastral || '',
      cep: String(d.cep || '').replace(/\D/g, ''),
      endereco,
      numero: d.numero || '',
      bairro: d.bairro || '',
      cidade: d.municipio || '',
      uf: d.uf || '',
      email: (d.email || '').toLowerCase(),
      telefone: telefone ? `+55${telefone}` : '',
    };
  }
}
