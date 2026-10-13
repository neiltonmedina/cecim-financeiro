import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CobrancaReport {
  periodo: { de: Date; ate: Date };
  clientesContatados: number;
  clientesQueResponderam: number;
  acordosRealizados: number;
  pagamentosConfirmados: number;
  clientesQuePediramNegociacao: number;
  clientesEncaminhadosParaHumano: number;
  semResposta: number;
  valorRecuperadoCentavos: number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Números do dashboard: carteira em aberto/vencida, recebimentos do mês,
   * distribuição por status e por origem (painel x Inter), vencimentos por
   * semana, maiores devedores, situação da régua e envios/respostas diários.
   */
  async dashboard() {
    const DIA = 24 * 60 * 60 * 1000;
    const agora = new Date();
    const hoje = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
    const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
    const ha30dias = new Date(hoje.getTime() - 29 * DIA);
    const EM_ABERTO = ['PENDENTE', 'ENVIADA', 'VENCIDA'];

    const [charges, conversas, envios, respostas] = await Promise.all([
      this.prisma.charge.findMany({
        select: {
          clientId: true,
          amountCents: true,
          dueDate: true,
          status: true,
          paidAt: true,
          origem: true,
          client: { select: { name: true } },
        },
      }),
      this.prisma.conversation.findMany({ select: { stage: true, humanRequested: true } }),
      this.prisma.notificationLog.findMany({
        where: { channel: 'WHATSAPP', sentAt: { gte: ha30dias } },
        select: { sentAt: true },
      }),
      this.prisma.conversationMessage.findMany({
        where: { direction: 'INBOUND', createdAt: { gte: ha30dias } },
        select: { createdAt: true },
      }),
    ]);

    const soma = (lista: { amountCents: number }[]) => lista.reduce((t, c) => t + c.amountCents, 0);
    const abertas = charges.filter((c) => EM_ABERTO.includes(c.status));
    const vencidas = abertas.filter((c) => c.dueDate < hoje);
    const pagas = charges.filter((c) => c.status === 'PAGA');
    const pagasMes = pagas.filter((c) => c.paidAt && c.paidAt >= inicioMes);
    const totalCarteira = soma(pagas) + soma(abertas);

    const porStatus = ['PENDENTE', 'ENVIADA', 'VENCIDA', 'PAGA', 'CANCELADA'].map((status) => {
      const doStatus = charges.filter((c) => c.status === status);
      return { status, quantidade: doStatus.length, valorCents: soma(doStatus) };
    });
    const porOrigem = ['PAINEL', 'INTER'].map((origem) => {
      const daOrigem = abertas.filter((c) => c.origem === origem);
      return { origem, quantidade: daOrigem.length, valorCents: soma(daOrigem) };
    });

    // Semanas (segunda a domingo) de 8 semanas atrás até 4 à frente.
    const inicioSemana = new Date(hoje.getTime() - ((hoje.getUTCDay() + 6) % 7) * DIA);
    const vencimentosPorSemana = Array.from({ length: 13 }, (_, i) => {
      const inicio = new Date(inicioSemana.getTime() + (i - 8) * 7 * DIA);
      const fim = new Date(inicio.getTime() + 7 * DIA);
      const daSemana = abertas.filter((c) => c.dueDate >= inicio && c.dueDate < fim);
      return { inicio: inicio.toISOString().slice(0, 10), quantidade: daSemana.length, valorCents: soma(daSemana), atual: i === 8 };
    });

    const porCliente = new Map<string, { nome: string; valorCents: number; quantidade: number; maisAntiga: Date }>();
    for (const c of abertas) {
      const atual = porCliente.get(c.clientId) ?? { nome: c.client.name, valorCents: 0, quantidade: 0, maisAntiga: c.dueDate };
      atual.valorCents += c.amountCents;
      atual.quantidade++;
      if (c.dueDate < atual.maisAntiga) atual.maisAntiga = c.dueDate;
      porCliente.set(c.clientId, atual);
    }
    const maioresDevedores = [...porCliente.values()]
      .sort((a, b) => b.valorCents - a.valorCents)
      .slice(0, 6)
      .map(({ maisAntiga, ...d }) => ({ ...d, diasAtraso: Math.max(0, Math.floor((hoje.getTime() - maisAntiga.getTime()) / DIA)) }));

    const etapas = ['INICIADA', 'LEMBRETE_ENVIADO', 'TERCEIRA_TENTATIVA', 'NEGOCIACAO', 'AGUARDANDO_PAGAMENTO', 'AGUARDANDO_HUMANO'];
    const regua = etapas.map((stage) => ({ etapa: stage, quantidade: conversas.filter((c) => c.stage === stage).length }));

    const dias = Array.from({ length: 30 }, (_, i) => new Date(ha30dias.getTime() + i * DIA).toISOString().slice(0, 10));
    const contarPorDia = (datas: (Date | null)[]) => {
      const mapa = new Map(dias.map((d) => [d, 0]));
      for (const d of datas) {
        const k = d?.toISOString().slice(0, 10);
        if (k && mapa.has(k)) mapa.set(k, mapa.get(k)! + 1);
      }
      return dias.map((d) => mapa.get(d)!);
    };

    return {
      geradoEm: agora,
      kpis: {
        emAberto: { valorCents: soma(abertas), quantidade: abertas.length },
        vencido: { valorCents: soma(vencidas), quantidade: vencidas.length },
        recebidoMes: { valorCents: soma(pagasMes), quantidade: pagasMes.length },
        taxaRecebimento: totalCarteira ? soma(pagas) / totalCarteira : 0,
        conversasAtivas: conversas.filter((c) => c.stage !== 'ENCERRADA').length,
        aguardandoHumano: conversas.filter((c) => c.humanRequested && c.stage !== 'ENCERRADA').length,
        enviadas30d: envios.length,
        respostas30d: respostas.length,
      },
      porStatus,
      porOrigem,
      vencimentosPorSemana,
      maioresDevedores,
      regua,
      atividade: { dias, enviadas: contarPorDia(envios.map((e) => e.sentAt)), respostas: contarPorDia(respostas.map((r) => r.createdAt)) },
    };
  }

  async cobranca(from: Date, to: Date): Promise<CobrancaReport> {
    const conversations = await this.prisma.conversation.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { messages: true },
    });

    const clientesContatados = conversations.length;
    const clientesQueResponderam = conversations.filter((c) => c.messages.some((m) => m.direction === 'INBOUND')).length;
    const semResposta = clientesContatados - clientesQueResponderam;
    const clientesEncaminhadosParaHumano = conversations.filter((c) => c.humanRequested).length;
    const clientesQuePediramNegociacao = conversations.filter((c) =>
      c.messages.some((m) => m.intent === 'QUER_NEGOCIAR'),
    ).length;

    const [acordosRealizados, pagamentosConfirmados, valorRecuperado] = await Promise.all([
      this.prisma.agreement.count({ where: { confirmedAt: { gte: from, lte: to } } }),
      this.prisma.charge.count({ where: { status: 'PAGA', paidAt: { gte: from, lte: to } } }),
      this.prisma.charge.aggregate({
        where: { status: 'PAGA', paidAt: { gte: from, lte: to } },
        _sum: { amountCents: true },
      }),
    ]);

    return {
      periodo: { de: from, ate: to },
      clientesContatados,
      clientesQueResponderam,
      acordosRealizados,
      pagamentosConfirmados,
      clientesQuePediramNegociacao,
      clientesEncaminhadosParaHumano,
      semResposta,
      valorRecuperadoCentavos: valorRecuperado._sum.amountCents ?? 0,
    };
  }
}
