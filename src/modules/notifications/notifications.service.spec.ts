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
          { id: 'ch1', clientId: 'c1', status: 'VENCIDA', linhaDigitavel: '0779', client: { active: true, whatsappOptIn: true, phoneE164: '+5594992453959' } },
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

describe('NotificationsService.reenviarParadasNaFila', () => {
  it('envia direto as notificações paradas na fila há mais de 10 minutos', async () => {
    const prisma: any = { notificationLog: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) } };
    const processor: any = { enviarNotificacao: jest.fn().mockRejectedValueOnce(new Error('falhou')).mockResolvedValue(undefined) };
    const service = new NotificationsService(prisma, {} as any, processor);

    await service.reenviarParadasNaFila();

    expect(prisma.notificationLog.findMany.mock.calls[0][0].where.status).toBe('QUEUED');
    expect(processor.enviarNotificacao).toHaveBeenCalledTimes(2); // uma falha não interrompe as demais
  });
});

describe('NotificationsService.dispatchCharges - cobrança sem boleto', () => {
  it('não envia WhatsApp sem linha digitável/Pix (a Meta recusaria com #131008)', async () => {
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ch1', clientId: 'c1', status: 'PENDENTE', linhaDigitavel: null, pixCopiaECola: null, client: { name: 'CEVIA', active: true, whatsappOptIn: true, phoneE164: '+5594981904333' } },
        ]),
        update: jest.fn(),
      },
      notificationLog: { create: jest.fn() },
    };
    const service = new NotificationsService(prisma, { add: jest.fn() } as any, {} as any);

    const r = await service.dispatchCharges(['ch1'], { channels: [Channel.WHATSAPP], templateType: 'COBRANCA_PENDENTE' });

    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    expect(r[0].channelsQueued).toEqual([]);
    expect(r[0].skipped[0]).toContain('sem boleto');
  });
});
