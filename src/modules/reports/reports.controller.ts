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

  /** Números consolidados para o dashboard do painel (carteira, recebimentos, régua e envios). */
  @Get('dashboard')
  dashboard() {
    return this.reportsService.dashboard();
  }

  /** Mensagens do agente que ofereceram desconto/parcelamento/acordo. */
  @Get('ofertas-negociacao')
  ofertasNegociacao() {
    return this.reportsService.ofertasNegociacao();
  }

  /** Relatório do mês (vencimentos no mês) + clientes que mais atrasam. mes = AAAA-MM */
  @Get('mensal')
  mensal(@Query('mes') mes?: string) {
    if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new BadRequestException('Informe o mês no formato AAAA-MM.');
    return this.reportsService.mensal(mes);
  }

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
