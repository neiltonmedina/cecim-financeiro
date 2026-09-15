import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WhatsAppProvider } from '../notifications/providers/whatsapp.provider';
import { SmsTwilioProvider } from '../notifications/providers/sms-twilio.provider';
import { EmailSmtpProvider } from '../notifications/providers/email-smtp.provider';
import { BoletosService } from '../boletos/boletos.service';

@ApiTags('system')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('system')
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppProvider,
    private readonly sms: SmsTwilioProvider,
    private readonly email: EmailSmtpProvider,
    private readonly boletos: BoletosService,
  ) {}

  /**
   * Status de configuração de cada integração externa - pra ver de cara no
   * painel o que está funcionando sem precisar caçar erro nos logs.
   */
  @Get('health')
  health() {
    return {
      whatsapp: this.whatsapp.isConfigured(),
      inter: this.boletos.isConfigured(),
      anthropic: !!this.config.get<string>('anthropic.apiKey'),
      sms: this.sms.isConfigured(),
      email: this.email.isConfigured(),
    };
  }
}
