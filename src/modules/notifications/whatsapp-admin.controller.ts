import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WhatsAppProvider } from './providers/whatsapp.provider';

@ApiTags('whatsapp-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('whatsapp-admin')
export class WhatsAppAdminController {
  constructor(private readonly whatsapp: WhatsAppProvider) {}

  /**
   * Inscreve este app no recebimento de mensagens/status de uma conta do
   * WhatsApp Business (WABA) - passo separado de só marcar "messages" como
   * assinado na tela de Webhooks do app. Rodar uma vez após configurar um
   * número novo (ou se as respostas dos clientes não estiverem chegando).
   */
  @Post('subscribe-app')
  subscribeApp(@Body('wabaId') wabaId: string) {
    return this.whatsapp.subscribeApp(wabaId);
  }
}
