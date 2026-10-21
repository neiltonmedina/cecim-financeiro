import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';

const CHAVE_VAPID = 'vapid';

/**
 * Notificações no celular (painel instalado como app). As chaves VAPID são
 * geradas na primeira vez e guardadas no banco - não precisa configurar nada
 * no Render.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private chaves?: { publicKey: string; privateKey: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async obterChaves() {
    if (this.chaves) return this.chaves;
    const salva = await this.prisma.appSetting.findUnique({ where: { key: CHAVE_VAPID } });
    if (salva) {
      this.chaves = JSON.parse(salva.value);
    } else {
      const novas = webpush.generateVAPIDKeys();
      // upsert: se duas instâncias gerarem ao mesmo tempo, fica a primeira gravada.
      const gravada = await this.prisma.appSetting.upsert({
        where: { key: CHAVE_VAPID },
        create: { key: CHAVE_VAPID, value: JSON.stringify(novas) },
        update: {},
      });
      this.chaves = JSON.parse(gravada.value);
    }
    return this.chaves!;
  }

  async chavePublica(): Promise<string> {
    return (await this.obterChaves()).publicKey;
  }

  async inscrever(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  /** Avisa todos os aparelhos inscritos. Nunca lança erro (aviso não pode travar o fluxo). */
  async notificar(titulo: string, corpo: string, aba?: string): Promise<number> {
    try {
      const inscritos = await this.prisma.pushSubscription.findMany();
      if (!inscritos.length) return 0;
      const { publicKey, privateKey } = await this.obterChaves();
      // A Apple exige contato https: ou mailto: (fora do Render o APP_URL é http).
      const appUrl = this.config.get<string>('appUrl') ?? '';
      const subject = appUrl.startsWith('https:') ? appUrl : 'mailto:admin@cecim.com.br';
      const opcoes = { vapidDetails: { subject, publicKey, privateKey } };
      const payload = JSON.stringify({ titulo, corpo, aba });
      let enviados = 0;
      for (const s of inscritos) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, opcoes);
          enviados++;
        } catch (error: any) {
          // 404/410: o aparelho desativou as notificações ou removeu o app.
          if (error.statusCode === 404 || error.statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Falha ao enviar notificação push: ${error.message}`);
          }
        }
      }
      return enviados;
    } catch (error: any) {
      this.logger.warn(`Notificações push indisponíveis: ${error.message}`);
      return 0;
    }
  }
}
