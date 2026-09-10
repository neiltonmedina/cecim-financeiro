import { Controller, Get, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
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
