import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Endpoint público (sem login) para o cliente abrir/baixar o PDF do boleto
 * a partir do link enviado por WhatsApp/SMS/E-mail. O ID da cobrança (UUID)
 * já funciona como um token não-adivinhável.
 */
@ApiTags('boletos')
@Controller('boletos')
export class BoletosController {
  constructor(private readonly prisma: PrismaService) {}

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
