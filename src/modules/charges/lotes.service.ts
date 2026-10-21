import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Client } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BoletosService, hojeSaoPaulo } from '../boletos/boletos.service';
import { normalizarUf } from '../boletos/inter-boleto.provider';
import { PushService } from '../push/push.service';
import { telefonesDoCliente } from '../clients/telefones.util';
import { ChargesService } from './charges.service';
import { CriarLoteDto, LinhaPlanilhaDto } from './dto/lote-mensal.dto';

/** Endereço usado quando a planilha não traz (o mesmo do agente de boletos). */
const ENDERECO_PADRAO = { endereco: 'RUA PARAUAPEBAS PARA', numero: 'S/N', bairro: 'CENTRO', cidade: 'PARAUAPEBAS', uf: 'PA', cep: '68515000' };

/** Dias para pagar depois do vencimento (igual ao agente de boletos). */
const DIAS_AGENDA = 30;

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export function cpfValido(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (const i of [9, 10]) {
    let soma = 0;
    for (let n = 0; n < i; n++) soma += Number(cpf[n]) * (i + 1 - n);
    if (((soma * 10) % 11) % 10 !== Number(cpf[i])) return false;
  }
  return true;
}

export function cnpjValido(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const [pesos, pos] of [[pesos1, 12], [[6, ...pesos1], 13]] as [number[], number][]) {
    const soma = pesos.reduce((t, p, i) => t + Number(cnpj[i]) * p, 0);
    const resto = soma % 11;
    if ((resto < 2 ? 0 : 11 - resto) !== Number(cnpj[pos])) return false;
  }
  return true;
}

/** "1.795,00", "1795,00", "930", "R$ 690" -> centavos. */
export function valorEmCentavos(bruto: string | undefined): number | null {
  let t = String(bruto ?? '').replace(/[R$\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Dia da planilha + mês de referência; dia que não existe no mês vira o último dia (31 -> 30/11). */
export function vencimentoDoMes(diaBruto: string | undefined, mes: string): string | null {
  const dia = Math.trunc(Number(String(diaBruto ?? '').trim().replace(',', '.')));
  if (!dia || dia < 1 || dia > 31) return null;
  const [ano, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

export interface LinhaNormalizada {
  seuNumero: string;
  nome: string;
  documento: string;
  valorCents: number | null;
  vencimento: string | null;
  endereco: { cep: string; endereco: string; numero: string; bairro: string; cidade: string; uf: string };
  erros: string[];
}

export function normalizarLinha(l: LinhaPlanilhaDto, mes: string, hoje = hojeSaoPaulo()): LinhaNormalizada {
  const erros: string[] = [];
  const nome = String(l.nome ?? '').trim();
  let documento = soDigitos(l.documento);
  if (!nome) erros.push('sem nome do pagador');
  if (!documento) erros.push('sem CPF/CNPJ');
  else if (documento.length <= 11) {
    documento = documento.padStart(11, '0'); // Excel tira os zeros da frente
    if (!cpfValido(documento)) erros.push(`CPF inválido: ${documento}`);
  } else {
    documento = documento.padStart(14, '0');
    if (!cnpjValido(documento)) erros.push(`CNPJ inválido: ${documento}`);
  }
  const valorCents = valorEmCentavos(l.valor);
  if (!valorCents || valorCents <= 0) erros.push('valor inválido');
  const vencimento = vencimentoDoMes(l.dia, mes);
  if (!vencimento) erros.push('dia de vencimento inválido (use 1 a 31)');
  else if (vencimento < hoje) erros.push(`vencimento ${vencimento.split('-').reverse().join('/')} já passou (o Inter não aceita data passada)`);
  return {
    seuNumero: String(l.seuNumero ?? '').trim().slice(0, 15),
    nome,
    documento,
    valorCents,
    vencimento,
    endereco: {
      cep: soDigitos(l.cep) || ENDERECO_PADRAO.cep,
      endereco: String(l.logradouro ?? '').trim() || ENDERECO_PADRAO.endereco,
      numero: String(l.numero ?? '').trim() || ENDERECO_PADRAO.numero,
      bairro: String(l.bairro ?? '').trim() || ENDERECO_PADRAO.bairro,
      cidade: String(l.cidade ?? '').trim() || ENDERECO_PADRAO.cidade,
      uf: normalizarUf(String(l.uf ?? '').trim()) ?? ENDERECO_PADRAO.uf,
    },
    erros,
  };
}

/**
 * Boletos do mês: a planilha que ia para o agente do Inter. O painel confere,
 * gera os boletos (um por um, sem duplicar) e avisa cada cliente X dias antes
 * do vencimento. Nada é enviado na geração.
 */
@Injectable()
export class LotesService {
  private readonly logger = new Logger(LotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly boletos: BoletosService,
    private readonly charges: ChargesService,
    private readonly push: PushService,
  ) {}

  private async clientesPorDocumento(): Promise<Map<string, Client>> {
    const clientes = await this.prisma.client.findMany({ where: { document: { not: null }, active: true } });
    return new Map(clientes.map((c) => [soDigitos(c.document), c]));
  }

  /** Boleto deste cliente com o mesmo vencimento e valor já existe (não cancelado)? */
  private jaGerado(clientId: string, vencimento: string, valorCents: number) {
    return this.prisma.charge.findFirst({
      where: { clientId, dueDate: new Date(`${vencimento}T00:00:00.000Z`), amountCents: valorCents, status: { not: 'CANCELADA' } },
      select: { id: true, boletoCodigoSolicitacao: true },
    });
  }

  /** Conferência antes de gerar: nada é criado aqui. */
  async conferir(mes: string, linhas: LinhaPlanilhaDto[]) {
    const porDoc = await this.clientesPorDocumento();
    const vistas = new Set<string>();
    const resultado: Record<string, unknown>[] = [];
    for (const [i, bruta] of linhas.entries()) {
      const l = normalizarLinha(bruta, mes);
      if (!l.nome && !l.documento) continue; // linha vazia / totalizador
      const cliente = porDoc.get(l.documento);
      const chave = `${l.documento}|${l.vencimento}|${l.valorCents}`;
      const repetidaNaPlanilha = vistas.has(chave);
      vistas.add(chave);
      const existente = cliente && l.vencimento && l.valorCents ? await this.jaGerado(cliente.id, l.vencimento, l.valorCents) : null;
      resultado.push({
        indice: i,
        seuNumero: l.seuNumero,
        nome: l.nome,
        documento: l.documento,
        valorCents: l.valorCents,
        vencimento: l.vencimento,
        cliente: cliente ? { id: cliente.id, nome: cliente.name, telefones: telefonesDoCliente(cliente).length } : null,
        jaGerado: !!existente,
        // Cobrança criada, mas o boleto falhou no Inter: resolve em "Com problema" (Gerar boleto).
        semBoleto: !!existente && !existente.boletoCodigoSolicitacao,
        erros: repetidaNaPlanilha ? [...l.erros, 'linha repetida na planilha (mesmo CPF/CNPJ, vencimento e valor)'] : l.erros,
      });
    }
    return resultado;
  }

  criarLote(dto: CriarLoteDto, criadoPor?: string) {
    return this.prisma.loteMensal.create({ data: { ...dto, criadoPor } });
  }

  /** Gera o boleto de uma linha. Seguro para repetir: se já existe, não gera de novo. */
  async gerarLinha(loteId: string, bruta: LinhaPlanilhaDto, createdBy?: string) {
    const lote = await this.prisma.loteMensal.findUnique({ where: { id: loteId } });
    if (!lote) throw new NotFoundException('Lote não encontrado.');
    const l = normalizarLinha(bruta, lote.mes);
    if (l.erros.length) throw new BadRequestException(l.erros.join('; '));

    let cliente = (await this.clientesPorDocumento()).get(l.documento);
    if (!cliente) {
      cliente = await this.prisma.client.create({ data: { name: l.nome, document: l.documento, ...l.endereco, whatsappOptIn: true } });
    } else if (!cliente.cep || !cliente.endereco || !cliente.bairro || !cliente.cidade || !cliente.uf) {
      // Cliente do painel sem endereço completo: completa com o da planilha (o Inter exige).
      cliente = await this.prisma.client.update({ where: { id: cliente.id }, data: l.endereco });
    }

    const existente = await this.jaGerado(cliente.id, l.vencimento!, l.valorCents!);
    if (existente) return { status: 'JA_GERADO', chargeId: existente.id, cliente: cliente.name };

    const [ano, m] = lote.mes.split('-');
    const charge = await this.prisma.charge.create({
      data: {
        clientId: cliente.id,
        description: `Mensalidade ${m}/${ano}`,
        amountCents: l.valorCents!,
        dueDate: new Date(`${l.vencimento}T00:00:00.000Z`),
        origem: 'MENSAL',
        seuNumero: l.seuNumero || null,
        diasAgenda: DIAS_AGENDA,
        loteId,
        createdBy,
      },
    });
    const comBoleto = await this.boletos.gerarBoletoParaCobranca(charge, cliente);
    if (comBoleto.boletoErro || !comBoleto.boletoCodigoSolicitacao) {
      return { status: 'ERRO_BOLETO', chargeId: charge.id, cliente: cliente.name, erro: comBoleto.boletoErro ?? 'boleto não gerado' };
    }
    return { status: 'OK', chargeId: charge.id, cliente: cliente.name, temTelefone: telefonesDoCliente(cliente).length > 0 };
  }

  async listar() {
    const lotes = await this.prisma.loteMensal.findMany({ orderBy: { createdAt: 'desc' }, take: 24 });
    const contagens = await this.prisma.charge.groupBy({ by: ['loteId', 'status'], where: { loteId: { in: lotes.map((l) => l.id) } }, _count: true });
    return lotes.map((l) => {
      const porStatus = Object.fromEntries(contagens.filter((c) => c.loteId === l.id).map((c) => [c.status, c._count]));
      return { ...l, porStatus, total: Object.values(porStatus).reduce((a: number, b: any) => a + b, 0) };
    });
  }

  async atualizar(id: string, envioAutomatico: boolean) {
    return this.prisma.loteMensal.update({ where: { id }, data: { envioAutomatico } });
  }

  /**
   * Rotina diária: manda o "boleto a vencer" para cada boleto do mês quando faltam
   * `diasAntes` dias para o vencimento (ou já passou, se o boleto saiu atrasado).
   * Só boletos ainda nunca enviados; o disparo usa as mesmas travas do manual.
   */
  async enviarAvisosAutomaticos(): Promise<number> {
    const hoje = hojeSaoPaulo();
    const candidatas = await this.prisma.charge.findMany({
      where: {
        loteId: { not: null },
        lote: { envioAutomatico: true },
        status: { in: ['PENDENTE', 'VENCIDA'] },
        OR: [{ linhaDigitavel: { not: null } }, { pixCopiaECola: { not: null } }],
        notifications: { none: { channel: 'WHATSAPP' } },
        client: { active: true, whatsappOptIn: true },
      },
      select: { id: true, dueDate: true, lote: { select: { diasAntes: true, intervalDays: true } }, client: { select: { phoneE164: true, telefonesExtras: true } } },
    });
    const porIntervalo = new Map<number, string[]>();
    for (const c of candidatas) {
      if (!telefonesDoCliente(c.client).length) continue;
      const dataAviso = new Date(c.dueDate.getTime() - c.lote!.diasAntes * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (dataAviso > hoje) continue;
      porIntervalo.set(c.lote!.intervalDays, [...(porIntervalo.get(c.lote!.intervalDays) ?? []), c.id]);
    }
    let enviadas = 0;
    for (const [intervalDays, chargeIds] of porIntervalo) {
      const r = await this.charges.dispatch({ chargeIds, channels: ['WHATSAPP'], intervalDays, confirmado: true });
      enviadas += r.filter((x) => x.channelsQueued.length).length;
    }
    if (enviadas) {
      this.logger.log(`${enviadas} aviso(s) automático(s) de boleto do mês enviado(s).`);
      await this.push.notificar('📤 Boletos do mês', `${enviadas} cliente(s) receberam hoje o aviso do boleto.`, 'mensal');
    }
    return enviadas;
  }
}
