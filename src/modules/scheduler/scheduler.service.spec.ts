import { SchedulerService } from './scheduler.service';

const DIA = 24 * 60 * 60 * 1000;

function makeConversation(overrides: any = {}) {
  return {
    id: 'conv-1',
    stage: 'INICIADA',
    intervalDays: 5,
    lastInboundAt: null,
    lastOutboundAt: new Date(Date.now() - 6 * DIA),
    client: { name: 'Cliente Teste', phoneE164: '+5599999990000' },
    charge: {
      status: 'ENVIADA',
      dueDate: new Date(Date.now() - 10 * DIA),
      linhaDigitavel: '07790001161206142039908513267545515860000000500',
      pixCopiaECola: null,
    },
    ...overrides,
  };
}

function setup(conversations: any[]) {
  const prisma: any = {
    conversation: { findMany: jest.fn().mockResolvedValue(conversations), update: jest.fn() },
    conversationMessage: { create: jest.fn() },
    charge: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const whatsapp: any = { send: jest.fn().mockResolvedValue({ providerMessageId: 'x' }) };
  const service = new SchedulerService(prisma, {} as any, whatsapp);
  return { service, prisma, whatsapp };
}

describe('SchedulerService - régua automática', () => {
  it('envia o lembrete pelo template aprovado (texto livre é rejeitado fora da janela de 24h)', async () => {
    const { service, prisma, whatsapp } = setup([makeConversation()]);

    await service.runDailyReminders();

    expect(whatsapp.send).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: '+5599999990000',
        providerTemplateName: 'cobranca_cecim',
        templateParams: ['Cliente Teste', '07790001161206142039908513267545515860000000500'],
      }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: 'LEMBRETE_ENVIADO' }) }),
    );
  });

  it('não envia antes de passar o intervalo configurado', async () => {
    const { service, whatsapp } = setup([makeConversation({ lastOutboundAt: new Date(Date.now() - 2 * DIA) })]);
    await service.runDailyReminders();
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('encerra a conversa (sem enviar) quando a cobrança já foi paga', async () => {
    const conv = makeConversation();
    conv.charge.status = 'PAGA';
    const { service, prisma, whatsapp } = setup([conv]);

    await service.runDailyReminders();

    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv-1' }, data: { stage: 'ENCERRADA' } });
  });

  it('não envia se o cliente respondeu depois do último contato', async () => {
    const { service, whatsapp } = setup([makeConversation({ lastInboundAt: new Date(Date.now() - 1 * DIA) })]);
    await service.runDailyReminders();
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('marca como vencidas também as cobranças já enviadas', async () => {
    const { service, prisma } = setup([]);
    await service.runDailyReminders();
    expect(prisma.charge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['PENDENTE', 'ENVIADA'] } }) }),
    );
  });
});
