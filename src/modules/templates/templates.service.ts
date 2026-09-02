import { Injectable, NotFoundException } from '@nestjs/common';
import { Channel, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

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
}
