import { ConversationsService } from './conversations.service';

function setup() {
  const prisma: any = {
    processedWhatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
    client: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const whatsapp: any = { send: jest.fn() };
  const service = new ConversationsService(prisma, whatsapp, {} as any, {} as any, {} as any, {} as any);
  return { service, prisma, whatsapp };
}

describe('ConversationsService - entregas duplicadas da Meta', () => {
  it('ignora uma mensagem cujo ID já foi processado', async () => {
    const { service, prisma } = setup();
    prisma.processedWhatsAppMessage.create.mockRejectedValue({ code: 'P2002' });

    await service.handleInboundWhatsApp('5599991646386', 'oi', 'wamid.DUPLICADA');

    // Parou antes de qualquer processamento (nem buscou o cliente).
    expect(prisma.client.findMany).not.toHaveBeenCalled();
  });

  it('processa normalmente a primeira entrega de uma mensagem', async () => {
    const { service, prisma } = setup();

    await service.handleInboundWhatsApp('5599991646386', 'oi', 'wamid.NOVA');

    expect(prisma.processedWhatsAppMessage.create).toHaveBeenCalledWith({ data: { id: 'wamid.NOVA' } });
    expect(prisma.client.findMany).toHaveBeenCalled();
  });
});

describe('ConversationsService - opções 1 (Pix) e 2 (boleto)', () => {
  const charge = {
    id: 'charge-1',
    pixCopiaECola: '00020101021226980014BR.GOV.BCB.PIX-codigo-pix',
    linhaDigitavel: '07790001161206142039908513267545515860000000500',
    paymentLink: 'https://cecim-financeiro.onrender.com/boletos/charge-1',
    amountCents: 500,
  };

  function setupConversa() {
    const prisma: any = {
      processedWhatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
      client: { findMany: jest.fn().mockResolvedValue([{ id: 'cli-1', name: 'Cliente' }]) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-1', clientId: 'cli-1', chargeId: 'charge-1', messages: [] }),
        update: jest.fn(),
      },
      charge: { findUnique: jest.fn().mockResolvedValue(charge) },
      conversationMessage: { create: jest.fn() },
    };
    const whatsapp: any = { send: jest.fn().mockResolvedValue({}) };
    const boletos: any = {
      gerarSegundaViaAtualizada: jest.fn().mockResolvedValue({
        charge,
        valor: { diasAtraso: 0, multaCents: 0, jurosCents: 0, totalCents: 500 },
        atualizado: false,
      }),
    };
    const service = new ConversationsService(prisma, whatsapp, {} as any, {} as any, {} as any, boletos);
    return { service, whatsapp, boletos };
  }

  it('opção 1: manda o Pix sozinho numa mensagem separada (fácil de copiar)', async () => {
    const { service, whatsapp } = setupConversa();
    await service.handleInboundWhatsApp('5599991646386', '1', 'wamid.1');

    expect(whatsapp.send).toHaveBeenCalledTimes(2);
    expect(whatsapp.send.mock.calls[1][0].body).toBe(charge.pixCopiaECola);
  });

  it('opção 2: manda o link do boleto e depois a linha digitável sozinha', async () => {
    const { service, whatsapp } = setupConversa();
    await service.handleInboundWhatsApp('5599991646386', '2', 'wamid.2');

    expect(whatsapp.send).toHaveBeenCalledTimes(2);
    expect(whatsapp.send.mock.calls[0][0].body).toContain(charge.paymentLink);
    expect(whatsapp.send.mock.calls[1][0].body).toBe(charge.linhaDigitavel);
  });
});

describe('ConversationsService - opção 2 com boleto vencido', () => {
  it('manda a segunda via com o valor atualizado (multa + juros)', async () => {
    const original = { id: 'charge-1', paymentLink: 'https://x/boletos/charge-1', linhaDigitavel: 'LINHA-ANTIGA', amountCents: 500 };
    const novo = { ...original, linhaDigitavel: 'LINHA-NOVA' };
    const prisma: any = {
      processedWhatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
      client: { findMany: jest.fn().mockResolvedValue([{ id: 'cli-1', name: 'Cliente' }]) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-1', clientId: 'cli-1', chargeId: 'charge-1', messages: [] }),
        update: jest.fn(),
      },
      charge: { findUnique: jest.fn().mockResolvedValue(original) },
      conversationMessage: { create: jest.fn() },
    };
    const whatsapp: any = { send: jest.fn().mockResolvedValue({}) };
    const boletos: any = {
      gerarSegundaViaAtualizada: jest.fn().mockResolvedValue({
        charge: novo,
        valor: { diasAtraso: 30, multaCents: 10, jurosCents: 5, totalCents: 515 },
        atualizado: true,
      }),
    };
    const service = new ConversationsService(prisma, whatsapp, {} as any, {} as any, {} as any, boletos);

    await service.handleInboundWhatsApp('5599991646386', '2', 'wamid.3');

    expect(whatsapp.send.mock.calls[0][0].body).toContain('R$');
    expect(whatsapp.send.mock.calls[0][0].body).toContain('5,15');
    expect(whatsapp.send.mock.calls[1][0].body).toBe('LINHA-NOVA');
  });
});

describe('ConversationsService.ensureConversationForCharge - intervalo da régua', () => {
  function setup(existing: any) {
    const prisma: any = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    return { prisma, service: new ConversationsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any) };
  }

  it('reenvio sem intervalo mantém o intervalo que a régua já tinha', async () => {
    const { service, prisma } = setup({ id: 'c', intervalDays: 3 });
    const r = await service.ensureConversationForCharge('cli', 'ch');
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(r.intervalDays).toBe(3);
  });

  it('intervalo informado substitui o atual; conversa nova sem intervalo usa 5 dias', async () => {
    const a = setup({ id: 'c', intervalDays: 3 });
    expect((await a.service.ensureConversationForCharge('cli', 'ch', 7)).intervalDays).toBe(7);
    const b = setup(null);
    expect((await b.service.ensureConversationForCharge('cli', 'ch')).intervalDays).toBe(5);
  });
});

describe('ConversationsService - mesmo WhatsApp para duas empresas', () => {
  it('responde pela empresa da conversa com envio mais recente e põe o nome dela no topo', async () => {
    const prisma: any = {
      processedWhatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
      client: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', name: 'CONSTRUMAQ' },
          { id: 'b', name: 'DRAT ENGENHARIA' },
        ]),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-b', clientId: 'b', chargeId: 'ch-b', messages: [] }),
        update: jest.fn(),
      },
      charge: { findUnique: jest.fn().mockResolvedValue({ id: 'ch-b', pixCopiaECola: 'PIX-DA-DRAT' }) },
      conversationMessage: { create: jest.fn() },
    };
    const whatsapp: any = { send: jest.fn().mockResolvedValue({}) };
    const service = new ConversationsService(prisma, whatsapp, {} as any, {} as any, {} as any, {} as any);

    await service.handleInboundWhatsApp('5594988060316', '1', 'wamid.x');

    const busca = prisma.conversation.findFirst.mock.calls[0][0];
    expect(busca.where.clientId.in).toEqual(['a', 'b']);
    expect(busca.orderBy[0]).toEqual({ lastOutboundAt: { sort: 'desc', nulls: 'last' } });
    expect(whatsapp.send.mock.calls[0][0].body.startsWith('*DRAT ENGENHARIA*')).toBe(true);
    expect(whatsapp.send.mock.calls[1][0].body).toBe('PIX-DA-DRAT');
  });
});

describe('ConversationsService - botões Pix e Boleto', () => {
  const chargeA = {
    id: 'charge-A', clientId: 'cli-A', status: 'ENVIADA',
    pixCopiaECola: 'PIX-DA-EMPRESA-A', linhaDigitavel: 'LINHA-A',
    paymentLink: 'https://x/boletos/charge-A', amountCents: 500,
  };

  function setupBotoes(cobranca: any = chargeA) {
    const prisma: any = {
      processedWhatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
      // Mesmo telefone em duas empresas.
      client: { findMany: jest.fn().mockResolvedValue([{ id: 'cli-A', name: 'Empresa A' }, { id: 'cli-B', name: 'Empresa B' }]) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-A', clientId: 'cli-A', chargeId: 'charge-A', messages: [] }),
        update: jest.fn(),
        create: jest.fn(),
      },
      charge: { findFirst: jest.fn().mockResolvedValue(cobranca), findUnique: jest.fn().mockResolvedValue(cobranca) },
      conversationMessage: { create: jest.fn() },
    };
    const whatsapp: any = { send: jest.fn().mockResolvedValue({}), sendDocument: jest.fn().mockResolvedValue({}) };
    const boletos: any = {
      gerarSegundaViaAtualizada: jest.fn().mockResolvedValue({
        charge: cobranca, valor: { diasAtraso: 0, multaCents: 0, jurosCents: 0, totalCents: 500 }, atualizado: false,
      }),
    };
    const service = new ConversationsService(prisma, whatsapp, {} as any, {} as any, {} as any, boletos);
    return { service, prisma, whatsapp };
  }

  it('botão Pix: usa a cobrança do payload, mesmo com telefone compartilhado', async () => {
    const { service, prisma, whatsapp } = setupBotoes();
    await service.handleInboundWhatsApp('5599991646386', 'Pix', 'wamid.b1', 'PIX:charge-A');

    expect(prisma.charge.findFirst).toHaveBeenCalledWith({
      where: { id: 'charge-A', clientId: { in: ['cli-A', 'cli-B'] } },
    });
    expect(prisma.conversation.findFirst.mock.calls[0][0].where.chargeId).toBe('charge-A');
    expect(whatsapp.send.mock.calls[0][0].body).toContain('*Empresa A*');
    expect(whatsapp.send.mock.calls[1][0].body).toBe('PIX-DA-EMPRESA-A');
  });

  it('botão Boleto: manda o PDF anexado e depois a linha digitável sozinha', async () => {
    const { service, whatsapp } = setupBotoes();
    await service.handleInboundWhatsApp('5599991646386', 'Boleto', 'wamid.b2', 'BOLETO:charge-A');

    expect(whatsapp.sendDocument).toHaveBeenCalledWith('+5599991646386', chargeA.paymentLink, 'Boleto CECIM - Empresa A.pdf');
    expect(whatsapp.send.mock.calls.at(-1)[0].body).toBe('LINHA-A');
  });

  it('cobrança já paga: avisa e não manda Pix nem boleto', async () => {
    const { service, whatsapp } = setupBotoes({ ...chargeA, status: 'PAGA' });
    await service.handleInboundWhatsApp('5599991646386', 'Pix', 'wamid.b3', 'PIX:charge-A');

    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send.mock.calls[0][0].body).toContain('paga');
  });
});
