import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeStatus, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { CreateBulkChargesDto } from './dto/create-bulk-charges.dto';
import { DispatchChargesDto } from './dto/dispatch-charges.dto';

@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  create(dto: CreateChargeDto, createdBy?: string) {
    return this.prisma.charge.create({
      data: { ...dto, dueDate: new Date(dto.dueDate), createdBy },
    });
  }

  /** Emite a mesma cobrança para todos os clientes selecionados de uma vez. */
  async createBulk(dto: CreateBulkChargesDto, createdBy?: string) {
    const clients = await this.prisma.client.findMany({ where: { id: { in: dto.clientIds }, active: true } });
    if (!clients.length) {
      throw new BadRequestException('Nenhum cliente ativo encontrado para os IDs informados');
    }

    const charges = await this.prisma.$transaction(
      clients.map((client) =>
        this.prisma.charge.create({
          data: {
            clientId: client.id,
            description: dto.description,
            amountCents: dto.amountCents,
            dueDate: new Date(dto.dueDate),
            paymentLink: dto.paymentLinkBase ? `${dto.paymentLinkBase}?cliente=${client.id}` : undefined,
            createdBy,
          },
        }),
      ),
    );

    return { criadas: charges.length, charges };
  }

  findAll(params: { status?: ChargeStatus; clientId?: string }) {
    return this.prisma.charge.findMany({
      where: { status: params.status, clientId: params.clientId },
      include: { client: true },
      orderBy: { dueDate: 'asc' },
    });
  }

  async findOne(id: string) {
    const charge = await this.prisma.charge.findUnique({
      where: { id },
      include: { client: true, notifications: { orderBy: { queuedAt: 'desc' } } },
    });
    if (!charge) throw new NotFoundException('Cobrança não encontrada');
    return charge;
  }

  async markAsPaid(id: string) {
    await this.findOne(id);
    return this.prisma.charge.update({ where: { id }, data: { status: 'PAGA', paidAt: new Date() } });
  }

  async cancel(id: string) {
    await this.findOne(id);
    return this.prisma.charge.update({ where: { id }, data: { status: 'CANCELADA', canceledAt: new Date() } });
  }

  /**
   * Dispara (emite) a cobrança pelos canais habilitados — SMS, WhatsApp e
   * E-mail — para os clientes selecionados via IDs de cobrança.
   */
  async dispatch(dto: DispatchChargesDto) {
    const charges = await this.prisma.charge.findMany({ where: { id: { in: dto.chargeIds } } });
    if (charges.length !== dto.chargeIds.length) {
      throw new NotFoundException('Uma ou mais cobranças informadas não foram encontradas');
    }

    const invalid = charges.filter((c) => c.status === 'PAGA' || c.status === 'CANCELADA');
    if (invalid.length) {
      throw new BadRequestException(
        `Não é possível notificar cobranças pagas ou canceladas: ${invalid.map((c) => c.id).join(', ')}`,
      );
    }

    const templateType = dto.templateType ?? TemplateType.COBRANCA_PENDENTE;
    return this.notificationsService.dispatchCharges(dto.chargeIds, {
      channels: dto.channels,
      templateType,
    });
  }
}
