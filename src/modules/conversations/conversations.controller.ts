import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConversationsService } from './conversations.service';

class SetPausedDto {
  @IsBoolean()
  paused: boolean;
}

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Get()
  findAll(@Query('humanRequested') humanRequested?: string) {
    return this.prisma.conversation.findMany({
      where: humanRequested === undefined ? undefined : { humanRequested: humanRequested === 'true' },
      include: { client: true, charge: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        client: true,
        charge: true,
        messages: { orderBy: { createdAt: 'asc' } },
        agreements: true,
      },
    });
  }

  /** Pausa ou retoma manualmente a régua/respostas automáticas dessa conversa (ação do painel). */
  @Patch(':id/pause')
  setPaused(@Param('id') id: string, @Body() dto: SetPausedDto) {
    return this.conversationsService.setPaused(id, dto.paused);
  }
}
