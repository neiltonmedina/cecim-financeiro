import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeStatus, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConversationsService } from '../conversations/conversations.service';
import { BoletosService } from '../boletos/boletos.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { CreateBulkChargesDto } from './dto/create-bulk-charges.dto';
import { DispatchChargesDto } from './dto/dispatch-charges.dto';
import { UpdateChargeDto } from './dto/update-charge.dto';

@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly conversationsService: ConversationsService,
    private readonly boletosService: BoletosService,
  ) {}

  async create(dto: CreateChargeDto, createdBy?: string) {
    const charge = await this.prisma.charge.create({
      data: { ...dto, dueDate: new Date(dto.dueDate), createdBy },
    });
    if (this.boletosService.isConfigured() && !dto.paymentLink) {
      const client = await this.prisma.client.findUnique({ where: { id: charge.clientId } });
      if (client) return this.boletosService.gerarBoletoParaCobranca(charge, client);
    }
    return charge;
  }

  /** Emite a mesma cobrança para todos os clientes selecionados de uma vez. */
  async createBulk(dto: CreateBulkChargesDto, createdBy?: string) {
    const clients = await this.prisma.client.findMany({ where: { id: { in: dto.clientIds }, active: true } });
    if (!clients.length) {
      throw new BadRequestException('Nenhum cliente ativo encontrado para os IDs informados');
    }

    let charges = await this.prisma.$transaction(
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

    // Gera boleto no Inter (quando configurado) para cada cobrança sem link próprio já definido.
    if (this.boletosService.isConfigured() && !dto.paymentLinkBase) {
      const clientsById = new Map(clients.map((c) => [c.id, c]));
      charges = await Promise.all(
        charges.map((charge) => this.boletosService.gerarBoletoParaCobranca(charge, clientsById.get(charge.clientId)!)),
      );
    }

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

  /**
   * Atualiza dados básicos da cobrança (útil para corrigir data/valor de
   * cobranças de teste ou importadas errado). Se a data de vencimento mudar
   * e o boleto já tiver sido gerado no Inter, regenera o boleto com a nova
   * data.
   */
  async update(id: string, dto: UpdateChargeDto) {
    const existing = await this.findOne(id);
    const dueDateChanged = dto.dueDate && new Date(dto.dueDate).getTime() !== existing.dueDate.getTime();

    const charge = await this.prisma.charge.update({
      where: { id },
      data: {
        description: dto.description,
        amountCents: dto.amountCents,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });

    if (dueDateChanged && this.boletosService.isConfigured()) {
      const client = await this.prisma.client.findUnique({ where: { id: charge.clientId } });
      if (client) return this.boletosService.gerarBoletoParaCobranca(charge, client);
    }
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
    if (!dto.confirmado) {
      throw new BadRequestException(
        'É necessário confirmar explicitamente a campanha (confirmado: true) antes de disparar - seleção manual é obrigatória.',
      );
    }

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
    const intervalDays = dto.intervalDays ?? 5;
    const results = await this.notificationsService.dispatchCharges(dto.chargeIds, {
      channels: dto.channels,
      templateType,
    });

    // Para os disparos que incluíram WhatsApp, abre a conversa do agente de cobrança
    // já com o intervalo da régua definido no painel.
    for (const result of results) {
      if (result.channelsQueued.includes('WHATSAPP')) {
        await this.conversationsService.ensureConversationForCharge(result.clientId, result.chargeId, intervalDays);
      }
    }

    return results;
  }
}
