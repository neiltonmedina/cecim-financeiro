import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@ApiTags('registro')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('registro-acoes')
export class RegistroController {
  constructor(private readonly prisma: PrismaService) {}

  /** Últimas ações do painel (mais recentes primeiro), opcionalmente de um usuário. */
  @Get()
  listar(@Query('userId') userId?: string) {
    return this.prisma.registroAcao.findMany({ where: { userId: userId || undefined }, orderBy: { createdAt: 'desc' }, take: 300 });
  }
}
