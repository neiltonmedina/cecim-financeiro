import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AtualizarLoteDto, ConferirLoteDto, CriarLoteDto, GerarLinhaDto } from './dto/lote-mensal.dto';
import { LotesService } from './lotes.service';

@ApiTags('lotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lotes')
export class LotesController {
  constructor(private readonly lotes: LotesService) {}

  /** Confere a planilha (nada é criado). */
  @Post('conferir')
  conferir(@Body() dto: ConferirLoteDto) {
    return this.lotes.conferir(dto.mes, dto.linhas);
  }

  @Post()
  criar(@Body() dto: CriarLoteDto, @Req() req: any) {
    return this.lotes.criarLote(dto, req.user?.userId);
  }

  /** Gera o boleto de uma linha do lote (o painel chama uma por vez, mostrando o andamento). */
  @Post(':id/gerar')
  gerar(@Param('id') id: string, @Body() dto: GerarLinhaDto, @Req() req: any) {
    return this.lotes.gerarLinha(id, dto.linha, req.user?.userId);
  }

  @Get()
  listar() {
    return this.lotes.listar();
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarLoteDto) {
    return this.lotes.atualizar(id, dto.envioAutomatico);
  }
}
