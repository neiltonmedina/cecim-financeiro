import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly prisma: PrismaService) {}

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
}
