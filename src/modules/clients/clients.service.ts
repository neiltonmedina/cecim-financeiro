import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizarUf } from '../boletos/inter-boleto.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClientDto) {
    const aviso = await this.checkDuplicate(dto.document, dto.phoneE164);
    if (dto.document) dto.document = dto.document.replace(/\D/g, '');
    const client = await this.prisma.client.create({ data: { ...dto, uf: dto.uf ? (normalizarUf(dto.uf) ?? dto.uf) : dto.uf } });
    return { ...client, aviso };
  }

  /**
   * O cliente é identificado pelo CPF/CNPJ: outro cadastro ativo com o mesmo
   * documento é bloqueado (é a mesma empresa - edite o existente). Telefone
   * repetido é permitido (ex: o mesmo dono com duas empresas usa um só
   * WhatsApp) e só gera um aviso. Devolve o texto do aviso, ou undefined.
   */
  private async checkDuplicate(document?: string, phoneE164?: string, excludeId?: string) {
    const docDigits = document?.replace(/\D/g, '');
    if (!docDigits && !phoneE164) return undefined;
    const outros = await this.prisma.client.findMany({
      where: {
        active: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [...(docDigits ? [{ document: { not: null } }] : []), ...(phoneE164 ? [{ phoneE164 }] : [])],
      },
    });
    // Compara só os dígitos: cadastros antigos podem ter o CNPJ com pontos/barra.
    const mesmoDocumento = docDigits ? outros.find((e) => e.document?.replace(/\D/g, '') === docDigits) : undefined;
    if (mesmoDocumento) {
      throw new ConflictException(
        `Já existe um cliente com este CPF/CNPJ: ${mesmoDocumento.name}. Edite o cadastro existente em vez de criar outro.`,
      );
    }
    const mesmoTelefone = phoneE164 ? outros.filter((e) => e.phoneE164 === phoneE164) : [];
    if (!mesmoTelefone.length) return undefined;
    return `Telefone compartilhado com: ${mesmoTelefone.map((e) => e.name).join(', ')}. O cadastro foi salvo normalmente.`;
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
    // Grava a UF como sigla (o Inter recusa "Pará", "pa" etc.).
    if (dto.uf) dto.uf = normalizarUf(dto.uf) ?? dto.uf;
    if (dto.document || dto.phoneE164) {
      const aviso = await this.checkDuplicate(dto.document, dto.phoneE164, id);
      if (dto.document) dto.document = dto.document.replace(/\D/g, '');
      const client = await this.prisma.client.update({ where: { id }, data: dto });
      return { ...client, aviso };
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
