import { NotificationsProcessor } from './notifications.processor';

describe('NotificationsProcessor.enviarNotificacao - duplicatas', () => {
  it('não envia de novo uma cobrança que já foi enviada depois que este envio entrou na fila', async () => {
    const log = { id: 'velho', chargeId: 'ch1', channel: 'WHATSAPP', status: 'QUEUED', queuedAt: new Date('2026-10-13T12:07:00Z'), charge: { client: {} } };
    const prisma: any = {
      notificationLog: {
        findUnique: jest.fn().mockResolvedValue(log),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ id: 'novo', sentAt: new Date('2026-10-13T12:10:00Z') }),
        update: jest.fn(),
      },
    };
    const whatsapp: any = { send: jest.fn() };
    const processor = new NotificationsProcessor(prisma, {} as any, whatsapp, {} as any, {} as any);

    await processor.enviarNotificacao('velho');

    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(prisma.notificationLog.update.mock.calls[0][0].data.status).toBe('SKIPPED');
  });
});
