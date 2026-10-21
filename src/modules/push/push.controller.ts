import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PushService } from './push.service';

@ApiTags('push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('chave-publica')
  async chavePublica() {
    return { chave: await this.push.chavePublica() };
  }

  @Post('inscrever')
  async inscrever(@Body() body: any) {
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      throw new BadRequestException('Inscrição de notificação inválida.');
    }
    await this.push.inscrever(body);
    return { ok: true };
  }

  @Post('teste')
  async teste() {
    const enviados = await this.push.notificar('CECIM Cobrança', 'Notificações ativadas neste aparelho. ✅');
    return { enviados };
  }
}
