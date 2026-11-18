import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
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
  /** De quem é a conta do WhatsApp do painel (portfólio dono na Meta). Só o administrador. */
  @Get('conta')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  conta() {
    return this.whatsapp.contaNaMeta();
  }

  @Post('subscribe-app')
  subscribeApp(@Body('wabaId') wabaId: string) {
    return this.whatsapp.subscribeApp(wabaId);
  }
}
