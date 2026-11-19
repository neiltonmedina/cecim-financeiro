import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Channel, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppProvider } from '../notifications/providers/whatsapp.provider';
import { PushService } from '../push/push.service';
import { BOTOES_COBRANCA, RODAPE_COBRANCA, VARIAVEIS_MODELO } from '../notifications/utils/template-renderer.util';
import { UpdateTemplateDto } from './dto/update-template.dto';

export type CorModelo = 'verde' | 'amarelo' | 'vermelho' | 'cinza';

/**
 * Semáforo de cada modelo (verde = aprovado pela Meta, amarelo = em análise,
 * vermelho = recusado ou inutilizável, cinza = ainda não enviado/sem consulta).
 * `emUso`: situação, na Meta, do modelo que os envios usam hoje; `pendente`: da nova
 * versão enviada para aprovação. Valores: o status da Meta (APPROVED, PENDING,
 * REJECTED...), NAO_EXISTE (a conta atual da Meta não tem esse nome) ou ERRO.
 */
export function situacaoDoModelo(emUso?: string, pendente?: string, motivo?: string | null): { cor: CorModelo; texto: string; detalhe: string } {
  const recusado = (s?: string) => s === 'REJECTED' || s === 'DISABLED' || s === 'PAUSED' || s === 'FLAGGED';
  if (pendente) {
    if (recusado(pendente)) {
      return { cor: 'vermelho', texto: 'Recusado pela Meta', detalhe: motivo ? `Motivo: ${motivo}. Ajuste o texto e envie de novo.` : 'Ajuste o texto e envie de novo.' };
    }
    if (pendente === 'APPROVED') {
      return { cor: 'verde', texto: 'Aprovado pela Meta', detalhe: 'O painel passa a usar este modelo em instantes.' };
    }
    if (pendente === 'ERRO') {
      return { cor: 'cinza', texto: 'Sem consulta', detalhe: 'Não foi possível consultar a Meta agora. Tente atualizar.' };
    }
    return {
      cor: 'amarelo',
      texto: 'Em análise na Meta',
      detalhe: emUso === 'APPROVED' ? 'Enquanto isso continua valendo a versão anterior, já aprovada.' : 'A Meta costuma responder em minutos ou algumas horas.',
    };
  }
  if (!emUso) return { cor: 'cinza', texto: 'Ainda não enviado', detalhe: 'Envie o texto para aprovação da Meta.' };
  if (emUso === 'ERRO') return { cor: 'cinza', texto: 'Sem consulta', detalhe: 'Não foi possível consultar a Meta agora. Tente atualizar.' };
  if (emUso === 'APPROVED') return { cor: 'verde', texto: 'Aprovado pela Meta', detalhe: 'Em uso nos envios.' };
  if (emUso === 'NAO_EXISTE') {
    return { cor: 'vermelho', texto: 'Não existe na conta da Meta', detalhe: 'Este modelo não existe na conta do WhatsApp atual. Envie o texto para aprovação.' };
  }
  if (recusado(emUso)) return { cor: 'vermelho', texto: 'Recusado ou pausado pela Meta', detalhe: motivo ?? 'Ajuste o texto e envie de novo.' };
  return { cor: 'amarelo', texto: 'Em análise na Meta', detalhe: 'A Meta costuma responder em minutos ou algumas horas.' };
}

/** Nome-base do modelo na Meta por tipo (cada nova versão ganha um sufixo de data). */
const NOME_BASE: Partial<Record<TemplateType, string>> = {
  BOLETO_DISPONIVEL: 'boleto_a_vencer_cecim',
  COBRANCA_PENDENTE: 'boleto_vencido_cecim',
  CONFIRMACAO_PAGAMENTO: 'pagamento_confirmado_cecim',
  LEMBRETE_VENCIMENTO: 'vence_hoje_cecim',
};

/**
 * Converte o texto do painel ({{cliente}}, {{valor}}...) para o formato da
 * Meta ({{1}}, {{2}}...), devolvendo também a ordem das variáveis e os exemplos.
 */
export function prepararTextoMeta(texto: string) {
  const params: string[] = [];
  const textoMeta = texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave: string) => {
    if (!(chave in VARIAVEIS_MODELO)) throw new BadRequestException(`Campo desconhecido no texto: {{${chave}}}`);
    params.push(chave);
    return `{{${params.length}}}`;
  });
  const limpo = textoMeta.trim();
  if (!params.length) throw new BadRequestException('O texto precisa ter ao menos um campo automático (ex: nome do cliente).');
  if (/^\{\{\d+\}\}/.test(limpo) || /\{\{\d+\}\}$/.test(limpo)) {
    throw new BadRequestException('A Meta não aceita texto que comece ou termine com um campo automático. Coloque uma palavra antes/depois.');
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(limpo)) {
    throw new BadRequestException('A Meta não aceita dois campos automáticos seguidos. Coloque texto entre eles.');
  }
  if (limpo.length > 1024) throw new BadRequestException('Texto muito longo: a Meta aceita até 1024 caracteres.');
  return { textoMeta: limpo, params, exemplos: params.map((p) => VARIAVEIS_MODELO[p]) };
}

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppProvider,
    private readonly push: PushService,
  ) {}

  private titulo(tipo: TemplateType): string {
    return { BOLETO_DISPONIVEL: 'Boleto a vencer', LEMBRETE_VENCIMENTO: 'Vence hoje', COBRANCA_PENDENTE: 'Boleto vencido', CONFIRMACAO_PAGAMENTO: 'Pagamento confirmado' }[tipo as string] ?? 'Modelo';
  }

  findAll() {
    return this.prisma.messageTemplate.findMany({ orderBy: [{ channel: 'asc' }, { type: 'asc' }] });
  }

  async findOne(id: string) {
    const template = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template não encontrado');
    return template;
  }

  async findByChannelAndType(channel: Channel, type: TemplateType) {
    const template = await this.prisma.messageTemplate.findUnique({
      where: { channel_type: { channel, type } },
    });
    if (!template || !template.active) {
      throw new NotFoundException(`Template ativo não encontrado para ${channel}/${type}`);
    }
    return template;
  }

  async update(id: string, dto: UpdateTemplateDto) {
    await this.findOne(id);
    return this.prisma.messageTemplate.update({ where: { id }, data: dto });
  }

  /**
   * Envia uma nova versão do texto para aprovação da Meta. A versão em uso
   * continua sendo enviada até a nova ser aprovada.
   */
  async enviarParaMeta(id: string, texto: string) {
    const template = await this.findOne(id);
    const base = template.channel === 'WHATSAPP' ? NOME_BASE[template.type] : undefined;
    if (!base) throw new BadRequestException('Este modelo não pode ser enviado para a Meta pelo painel.');
    const { textoMeta, params, exemplos } = prepararTextoMeta(texto ?? '');
    const nome = `${base}_${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}`;
    const botoes = BOTOES_COBRANCA[template.type] ?? [];
    let resposta: { id: string; status: string };
    try {
      // Modelos de cobrança levam os botões Pix e Boleto (o cliente toca em vez de digitar 1/2).
      resposta = await this.whatsapp.criarModeloMeta(nome, textoMeta, exemplos, botoes, RODAPE_COBRANCA[template.type]);
    } catch (error: any) {
      throw new BadRequestException('A Meta recusou o envio: ' + error.message);
    }
    this.logger.log(`Modelo ${nome} enviado para a Meta (status ${resposta.status}).`);
    await this.prisma.messageTemplate.update({
      where: { id },
      data: {
        pendenteNome: nome,
        pendenteTexto: texto.trim(),
        pendenteParams: params,
        pendenteBotoes: botoes,
        pendenteEnviadoEm: new Date(),
        metaStatus: 'PENDING',
        metaMotivo: null,
      },
    });
    return this.verificarMeta(id);
  }

  /** Semáforo de cada modelo do WhatsApp, conferido agora na Meta (conta configurada no Render). */
  async situacaoNaMeta() {
    const modelos = await this.prisma.messageTemplate.findMany({ where: { channel: 'WHATSAPP' } });
    const nomes = [...new Set(modelos.flatMap((m) => [m.providerTemplateName, m.pendenteNome]).filter((n): n is string => !!n))];
    const status = new Map<string, string>();
    await Promise.all(
      nomes.map(async (nome) => {
        try {
          const modelo = await this.whatsapp.consultarModeloMeta(nome);
          status.set(nome, modelo?.status?.toUpperCase() ?? 'NAO_EXISTE');
        } catch (error: any) {
          this.logger.warn(`Não foi possível consultar o modelo ${nome} na Meta: ${error.message}`);
          status.set(nome, 'ERRO');
        }
      }),
    );
    return modelos.map((m) => ({
      type: m.type,
      ...situacaoDoModelo(
        m.providerTemplateName ? status.get(m.providerTemplateName) : undefined,
        m.pendenteNome ? status.get(m.pendenteNome) : undefined,
        m.metaMotivo,
      ),
    }));
  }

  /** Consulta a Meta; se a versão pendente foi aprovada, ela passa a ser a usada nos envios. */
  async verificarMeta(id: string) {
    const template = await this.findOne(id);
    if (!template.pendenteNome) return template;
    const meta = await this.whatsapp.consultarModeloMeta(template.pendenteNome).catch((e) => {
      this.logger.warn(`Não foi possível consultar o modelo ${template.pendenteNome}: ${e.message}`);
      return undefined;
    });
    const status = meta?.status?.toUpperCase();
    if (status === 'APPROVED') {
      this.logger.log(`Modelo ${template.pendenteNome} aprovado pela Meta - passa a ser usado.`);
      await this.push.notificar('🟢 Modelo aprovado pela Meta', `"${this.titulo(template.type)}" foi aprovado e já está em uso.`, 'messages');
      return this.prisma.messageTemplate.update({
        where: { id },
        data: {
          providerTemplateName: template.pendenteNome,
          body: template.pendenteTexto ?? template.body,
          providerParams: template.pendenteParams,
          providerBotoes: template.pendenteBotoes,
          active: true,
          metaStatus: 'APPROVED',
          metaMotivo: null,
          pendenteNome: null,
          pendenteTexto: null,
          pendenteParams: [],
          pendenteBotoes: [],
        },
      });
    }
    if (status === 'REJECTED' || status === 'DISABLED') {
      // Avisa só na primeira vez (o botão "Verificar aprovação" pode consultar de novo).
      if (template.metaStatus !== 'REJECTED') {
        await this.push.notificar('🔴 Modelo recusado pela Meta', `"${this.titulo(template.type)}": ${meta?.rejected_reason || 'veja o motivo no painel'}.`, 'messages');
      }
      return this.prisma.messageTemplate.update({
        where: { id },
        data: { metaStatus: 'REJECTED', metaMotivo: meta?.rejected_reason || 'Motivo não informado pela Meta' },
      });
    }
    return template;
  }

  /** De 15 em 15 min confere os modelos aguardando aprovação. */
  @Cron('*/15 * * * *')
  async verificarPendentes() {
    const pendentes = await this.prisma.messageTemplate.findMany({ where: { pendenteNome: { not: null }, metaStatus: 'PENDING' } });
    for (const t of pendentes) await this.verificarMeta(t.id).catch(() => undefined);
  }
}
