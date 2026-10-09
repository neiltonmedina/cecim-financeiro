import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoletosService } from './boletos.service';

@ApiTags('boletos')
@Controller('boletos')
export class BoletosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boletosService: BoletosService,
  ) {}

  /**
   * Registra (uma vez, configuração inicial) a URL que o Inter deve chamar
   * quando um boleto/Pix for pago - é o que permite o encerramento
   * automático da régua. Requer login.
   */
  @Post('webhook/registrar')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  registrarWebhook() {
    return this.boletosService.registrarWebhookPagamento();
  }

  /** Consulta qual URL de webhook está registrada hoje no Inter. */
  @Get('webhook/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  consultarWebhook() {
    return this.boletosService.consultarWebhookPagamento();
  }

  /** Lista os boletos em aberto no Inter no período (vencimento), para importar os que foram gerados fora do painel. */
  @Get('inter/em-aberto')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listarInter(
    @Query('dataInicial') dataInicial: string,
    @Query('dataFinal') dataFinal: string,
    @Query('cpfCnpj') cpfCnpj?: string,
  ) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(dataInicial ?? '') || !iso.test(dataFinal ?? '')) {
      throw new BadRequestException('Informe dataInicial e dataFinal no formato AAAA-MM-DD.');
    }
    return this.boletosService.listarBoletosInter(dataInicial, dataFinal, cpfCnpj);
  }

  /** Importa para o painel boletos que já existem no Inter (não gera boleto novo, não envia nada). */
  @Post('inter/importar')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  importarInter(@Body() body: { codigos?: string[]; telefones?: Record<string, string> }) {
    const codigos = Array.isArray(body?.codigos) ? body.codigos.filter((c) => typeof c === 'string' && c) : [];
    if (!codigos.length) throw new BadRequestException('Selecione ao menos um boleto.');
    const telefones = body?.telefones && typeof body.telefones === 'object' ? body.telefones : {};
    return this.boletosService.importarBoletosInter(codigos, telefones);
  }

  /** Consulta bruta no Inter por código de solicitação - pra investigar webhooks/pagamentos não reconhecidos. */
  @Get('consulta-inter/:codigoSolicitacao')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  consultarInter(@Param('codigoSolicitacao') codigoSolicitacao: string) {
    return this.boletosService.consultarBruto(codigoSolicitacao);
  }

  /**
   * Endpoint público (sem login) para o cliente abrir/baixar o PDF do boleto
   * a partir do link enviado por WhatsApp/SMS/E-mail. O ID da cobrança (UUID)
   * já funciona como um token não-adivinhável.
   */
  @Get(':chargeId')
  async download(@Param('chargeId') chargeId: string, @Res() res: Response) {
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!charge || !charge.boletoPdfBase64) {
      throw new NotFoundException('Boleto não encontrado ou ainda não gerado.');
    }
    const buffer = Buffer.from(charge.boletoPdfBase64, 'base64');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="boleto-${chargeId}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }
}
