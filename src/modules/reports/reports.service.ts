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
