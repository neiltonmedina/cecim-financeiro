import { Channel } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService.resolveChannelsForClient', () => {
  const service = new NotificationsService({} as any, {} as any, {} as any);

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

describe('NotificationsService.dispatchCharges - fila indisponível', () => {
  it('envia direto quando o Redis recusa o job, em vez de dar erro no disparo', async () => {
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ch1', clientId: 'c1', status: 'VENCIDA', client: { active: true, whatsappOptIn: true, phoneE164: '+5594992453959' } },
        ]),
        update: jest.fn(),
      },
      notificationLog: { create: jest.fn().mockResolvedValue({ id: 'log1' }) },
    };
    const queue: any = { add: jest.fn().mockRejectedValue(new Error('ERR max requests limit exceeded')) };
    const processor: any = { enviarNotificacao: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationsService(prisma, queue, processor);

    const r = await service.dispatchCharges(['ch1'], { channels: [Channel.WHATSAPP], templateType: 'COBRANCA_PENDENTE' });

    expect(processor.enviarNotificacao).toHaveBeenCalledWith('log1');
    expect(r[0].channelsQueued).toEqual([Channel.WHATSAPP]);
  });
});
