import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { ChargesService } from './charges.service';
import { AgendarDisparoDto } from './dto/agendar-disparo.dto';

/**
 * Disparos de campanha marcados pelo painel para uma data/hora. Na hora,
 * dispara pelo mesmo caminho do "Confirmar e disparar" (mesmas travas
 * contra envio repetido) e avisa no celular.
 */
@Injectable()
export class DisparosAgendadosService {
  private readonly logger = new Logger(DisparosAgendadosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargesService,
    private readonly push: PushService,
  ) {}

  async agendar(dto: AgendarDisparoDto, criadoPor?: string) {
    const executarEm = new Date(dto.executarEm);
    if (executarEm.getTime() < Date.now() - 60 * 1000) throw new BadRequestException('Escolha uma data e hora no futuro.');
    return this.prisma.disparoAgendado.create({
      data: { chargeIds: dto.chargeIds, intervalDays: dto.intervalDays, executarEm, criadoPor },
    });
  }

  listar() {
    return this.prisma.disparoAgendado.findMany({
      where: { OR: [{ status: 'AGENDADO' }, { executadoEm: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }] },
      orderBy: { executarEm: 'asc' },
    });
  }

  async cancelar(id: string) {
    const { count } = await this.prisma.disparoAgendado.updateMany({ where: { id, status: 'AGENDADO' }, data: { status: 'CANCELADO' } });
    if (!count) throw new NotFoundException('Disparo agendado não encontrado ou já executado.');
    return { cancelado: true };
  }

  /** Executa os disparos cuja hora chegou. Chamado a cada 5 min e pelo ping do cron-job.org. */
  @Cron('*/5 * * * *')
  async executarPendentes(): Promise<number> {
    const pendentes = await this.prisma.disparoAgendado.findMany({ where: { status: 'AGENDADO', executarEm: { lte: new Date() } } });
    let executados = 0;
    for (const d of pendentes) {
      // Reserva atômica: dois processos ao mesmo tempo não disparam duas vezes.
      const { count } = await this.prisma.disparoAgendado.updateMany({ where: { id: d.id, status: 'AGENDADO' }, data: { status: 'EXECUTANDO' } });
      if (!count) continue;
      try {
        // Quem pagou (ou foi cancelado) depois do agendamento fica de fora.
        const abertas = await this.prisma.charge.findMany({
          where: { id: { in: d.chargeIds }, status: { notIn: ['PAGA', 'CANCELADA'] } },
          select: { id: true },
        });
        const result = abertas.length
          ? await this.charges.dispatch({ chargeIds: abertas.map((c) => c.id), channels: ['WHATSAPP'], intervalDays: d.intervalDays, confirmado: true })
          : [];
        const enviadas = result.filter((r) => r.channelsQueued.length).length;
        const resumo = `${enviadas} enviada(s); ${d.chargeIds.length - abertas.length} já paga(s)/cancelada(s); ${result.length - enviadas} não enviada(s).`;
        await this.prisma.disparoAgendado.update({ where: { id: d.id }, data: { status: 'EXECUTADO', executadoEm: new Date(), resultado: resumo } });
        await this.push.notificar('📤 Disparo agendado executado', resumo, 'charges');
        executados++;
      } catch (error: any) {
        this.logger.error(`Falha no disparo agendado ${d.id}: ${error.message}`);
        await this.prisma.disparoAgendado.update({ where: { id: d.id }, data: { status: 'FALHOU', executadoEm: new Date(), resultado: error.message } });
        await this.push.notificar('⚠️ Disparo agendado falhou', error.message, 'charges');
      }
    }
    return executados;
  }
}
