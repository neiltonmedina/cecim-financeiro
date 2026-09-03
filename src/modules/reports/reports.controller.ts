import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** Relatório periódico do agente de cobrança: contatados, respostas, acordos, pagamentos, etc. */
  @Get('cobranca')
  cobranca(@Query('from') from?: string, @Query('to') to?: string) {
    const to_ = to ? new Date(to) : new Date();
    const from_ = from ? new Date(from) : new Date(to_.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (isNaN(from_.getTime()) || isNaN(to_.getTime())) {
      throw new BadRequestException('Datas inválidas. Use o formato ISO (ex: 2026-09-01)');
    }
    return this.reportsService.cobranca(from_, to_);
  }
}
