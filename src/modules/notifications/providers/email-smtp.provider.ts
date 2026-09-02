import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { ChannelProvider, ChannelSendInput, ChannelSendResult } from '../interfaces/channel-provider.interface';

@Injectable()
export class EmailSmtpProvider implements ChannelProvider {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger(EmailSmtpProvider.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      const host = this.config.get<string>('smtp.host');
      const user = this.config.get<string>('smtp.user');
      if (!host || !user) {
        throw new Error('E-mail não configurado: defina SMTP_HOST, SMTP_USER e SMTP_PASSWORD');
      }
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('smtp.port'),
        secure: this.config.get<boolean>('smtp.secure'),
        auth: {
          user,
          pass: this.config.get<string>('smtp.password'),
        },
      });
    }
    return this.transporter;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const fromName = this.config.get<string>('smtp.fromName');
    const fromEmail = this.config.get<string>('smtp.fromEmail');

    try {
      const info = await this.getTransporter().sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: input.destination,
        subject: input.subject ?? 'Cobrança',
        html: input.body,
      });
      return { providerMessageId: info.messageId, raw: info };
    } catch (error: any) {
      this.logger.error(`Erro ao enviar e-mail para ${input.destination}: ${error.message}`);
      throw new Error(error.message ?? 'Falha ao enviar e-mail via SMTP');
    }
  }
}
