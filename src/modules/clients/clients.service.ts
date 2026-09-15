import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClientDto) {
    await this.checkDuplicate(dto.document, dto.phoneE164);
    return this.prisma.client.create({ data: dto });
  }

  /**
   * Impede cadastrar um cliente ativo com o mesmo CPF/CNPJ ou telefone de
   * outro já cadastrado - evita duplicidade (já aconteceu de criar dois
   * cadastros pra mesma pessoa por engano, um deles sem boleto/histórico).
   */
  private async checkDuplicate(document?: string, phoneE164?: string, excludeId?: string) {
    const docDigits = document?.replace(/\D/g, '');
    const orConditions: any[] = [];
    if (docDigits) orConditions.push({ document: docDigits });
    if (phoneE164) orConditions.push({ phoneE164 });
    if (!orConditions.length) return;

    const existing = await this.prisma.client.findFirst({
      where: { active: true, OR: orConditions, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) {
      const campo = existing.document === docDigits ? 'CPF/CNPJ' : 'telefone';
      throw new ConflictException(
        `Já existe um cliente ativo (${existing.name}) cadastrado com esse mesmo ${campo}.`,
      );
    }
  }

  findAll(params: { search?: string; active?: boolean }) {
    return this.prisma.client.findMany({
      where: {
        active: params.active,
        OR: params.search
          ? [
              { name: { contains: params.search, mode: 'insensitive' } },
              { email: { contains: params.search, mode: 'insensitive' } },
              { phoneE164: { contains: params.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Cliente não encontrado');
    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.findOne(id);
    if (dto.document || dto.phoneE164) {
      await this.checkDuplicate(dto.document, dto.phoneE164, id);
    }
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    // soft delete: apenas inativa, para preservar histórico de cobranças
    return this.prisma.client.update({ where: { id }, data: { active: false } });
  }

  findManyByIds(ids: string[]) {
    return this.prisma.client.findMany({ where: { id: { in: ids } } });
  }
}
