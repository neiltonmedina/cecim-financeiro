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
      notificationLog: { create: jest.fn().mockResolvedValue({ id: 'log1' }), findFirst: jest.fn().mockResolvedValue(null) },
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
    const prisma: any = { notificationLog: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]), updateMany: jest.fn() } };
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

describe('NotificationsService - proteção contra envio repetido', () => {
  it('bloqueia novo disparo da mesma cobrança enviada há poucos minutos', async () => {
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ch1', clientId: 'c1', status: 'VENCIDA', linhaDigitavel: '0779', client: { name: 'J E L', active: true, whatsappOptIn: true, phoneE164: '+5594999999999' } },
        ]),
        update: jest.fn(),
      },
      notificationLog: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'anterior', status: 'SENT' }) },
    };
    const service = new NotificationsService(prisma, { add: jest.fn() } as any, {} as any);

    const r = await service.dispatchCharges(['ch1'], { channels: [Channel.WHATSAPP], templateType: 'COBRANCA_PENDENTE' });

    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    expect(r[0].skipped[0]).toContain('envio repetido bloqueado');
  });

  it('descarta tentativas paradas na fila há mais de 2 horas em vez de enviar', async () => {
    const prisma: any = { notificationLog: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) } };
    const processor: any = { enviarNotificacao: jest.fn() };
    await new NotificationsService(prisma, {} as any, processor).reenviarParadasNaFila();

    expect(prisma.notificationLog.updateMany.mock.calls[0][0].data.status).toBe('SKIPPED');
    expect(processor.enviarNotificacao).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.lembretesDoDiaDoVencimento', () => {
  function setup(modelo: any) {
    const prisma: any = {
      messageTemplate: { findUnique: jest.fn().mockResolvedValue(modelo) },
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', client: { phoneE164: '+5594990000001', telefonesExtras: ['+5594990000002'] } },
        ]),
      },
      notificationLog: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'log-' + data.destination })) },
    };
    const service = new NotificationsService(prisma, {} as any, {} as any);
    (service as any).enfileirarOuEnviar = jest.fn();
    return { service, prisma };
  }

  it('não envia nada enquanto o modelo não for aprovado pela Meta pelo painel', async () => {
    const { service, prisma } = setup({ active: true, providerTemplateName: 'lembrete_vencimento_cecim', metaStatus: null });
    expect(await service.lembretesDoDiaDoVencimento()).toBe(0);
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });

  it('com o modelo aprovado, lembra todos os telefones da empresa', async () => {
    const { service, prisma } = setup({ active: true, providerTemplateName: 'vence_hoje_cecim_1', metaStatus: 'APPROVED' });
    expect(await service.lembretesDoDiaDoVencimento()).toBe(2);
    expect(prisma.notificationLog.create.mock.calls.map((c: any) => [c[0].data.destination, c[0].data.templateType])).toEqual([
      ['+5594990000001', 'LEMBRETE_VENCIMENTO'],
      ['+5594990000002', 'LEMBRETE_VENCIMENTO'],
    ]);
  });
});
