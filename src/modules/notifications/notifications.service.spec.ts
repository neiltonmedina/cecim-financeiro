import { Channel } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService.resolveChannelsForClient', () => {
  const service = new NotificationsService({} as any, {} as any);

  it('inclui apenas canais com opt-in e dado de contato disponível', () => {
    const client: any = {
      whatsappOptIn: true,
      smsOptIn: false,
      emailOptIn: true,
      phoneE164: '+5511999998888',
      email: 'cliente@example.com',
    };

    const channels = service.resolveChannelsForClient(client);
    expect(channels.sort()).toEqual([Channel.EMAIL, Channel.WHATSAPP].sort());
  });

  it('não inclui WhatsApp/SMS se o cliente não tiver telefone cadastrado', () => {
    const client: any = {
      whatsappOptIn: true,
      smsOptIn: true,
      emailOptIn: true,
      phoneE164: null,
      email: 'cliente@example.com',
    };

    expect(service.resolveChannelsForClient(client)).toEqual([Channel.EMAIL]);
  });

  it('respeita a lista de canais solicitados explicitamente', () => {
    const client: any = {
      whatsappOptIn: true,
      smsOptIn: true,
      emailOptIn: true,
      phoneE164: '+5511999998888',
      email: 'cliente@example.com',
    };

    expect(service.resolveChannelsForClient(client, [Channel.SMS])).toEqual([Channel.SMS]);
  });
});
