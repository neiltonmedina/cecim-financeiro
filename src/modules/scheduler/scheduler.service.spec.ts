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
    notificationLog: { findFirst: jest.fn().mockResolvedValue(null) },
    messageTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const whatsapp: any = { send: jest.fn().mockResolvedValue({ providerMessageId: 'x' }) };
  const conversationsService: any = { sincronizarPagamentosInter: jest.fn().mockResolvedValue(0) };
  const service = new SchedulerService(prisma, { lembretesDoDiaDoVencimento: jest.fn().mockResolvedValue(0) } as any, whatsapp, conversationsService);
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

  it('recupera a data do primeiro envio de conversas antigas (sem lastOutboundAt) e envia o lembrete', async () => {
    const enviadoEm = new Date(Date.now() - 7 * DIA);
    const { service, prisma, whatsapp } = setup([makeConversation({ lastOutboundAt: null, chargeId: 'charge-1' })]);
    prisma.notificationLog.findFirst.mockResolvedValueOnce({ sentAt: enviadoEm }).mockResolvedValue(null);

    await service.runDailyReminders();

    expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv-1' }, data: { lastOutboundAt: enviadoEm } });
    expect(whatsapp.send).toHaveBeenCalled();
  });

  it('marca como vencidas também as cobranças já enviadas', async () => {
    const { service, prisma } = setup([]);
    await service.runDailyReminders();
    expect(prisma.charge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['PENDENTE', 'ENVIADA'] } }) }),
    );
  });
});

describe('SchedulerService - modelo da régua (a vencer x vencido)', () => {
  it('boleto ainda no prazo usa o modelo "a vencer" aprovado, com os campos na ordem dele', async () => {
    const conv = makeConversation({
      charge: { status: 'ENVIADA', dueDate: new Date(Date.now() + 5 * DIA), linhaDigitavel: '0779', pixCopiaECola: null, amountCents: 15000 },
    });
    const { service, prisma, whatsapp } = setup([conv]);
    prisma.messageTemplate.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.type === 'BOLETO_DISPONIVEL' ? { providerTemplateName: 'boleto_a_vencer_cecim_1', providerParams: ['cliente', 'valor', 'linhaDigitavel'] } : null),
    );

    await service.runDailyReminders();

    expect(whatsapp.send).toHaveBeenCalledWith(
      expect.objectContaining({ providerTemplateName: 'boleto_a_vencer_cecim_1', templateParams: ['Cliente Teste', expect.stringMatching(/R\$\s150,00/), '0779'] }),
    );
  });
});

describe('SchedulerService - vários telefones da mesma empresa', () => {
  it('manda o lembrete para o telefone principal e para os extras', async () => {
    const conv = makeConversation({ client: { name: 'Empresa', phoneE164: '+5599999990000', telefonesExtras: ['+5599999991111'] } });
    const { service, whatsapp } = setup([conv]);

    await service.runDailyReminders();

    expect(whatsapp.send.mock.calls.map((c: any) => c[0].destination)).toEqual(['+5599999990000', '+5599999991111']);
  });
});

describe('SchedulerService - não manda duas mensagens no mesmo dia', () => {
  it('pula a régua se a cobrança já recebeu mensagem hoje (ex: lembrete do vencimento)', async () => {
    const { service, prisma, whatsapp } = setup([makeConversation({ chargeId: 'charge-1' })]);
    prisma.notificationLog.findFirst.mockResolvedValue({ id: 'log-hoje', queuedAt: new Date() });

    await service.runDailyReminders();

    expect(whatsapp.send).not.toHaveBeenCalled();
  });
});
