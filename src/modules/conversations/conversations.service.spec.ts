import { ConversationsService } from './conversations.service';

function setup() {
  const prisma: any = {
    processedWhatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
    client: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const whatsapp: any = { send: jest.fn() };
  const service = new ConversationsService(prisma, whatsapp, {} as any, {} as any, {} as any);
  return { service, prisma, whatsapp };
}

describe('ConversationsService - entregas duplicadas da Meta', () => {
  it('ignora uma mensagem cujo ID já foi processado', async () => {
    const { service, prisma } = setup();
    prisma.processedWhatsAppMessage.create.mockRejectedValue({ code: 'P2002' });

    await service.handleInboundWhatsApp('5599991646386', 'oi', 'wamid.DUPLICADA');

    // Parou antes de qualquer processamento (nem buscou o cliente).
    expect(prisma.client.findFirst).not.toHaveBeenCalled();
  });

  it('processa normalmente a primeira entrega de uma mensagem', async () => {
    const { service, prisma } = setup();

    await service.handleInboundWhatsApp('5599991646386', 'oi', 'wamid.NOVA');

    expect(prisma.processedWhatsAppMessage.create).toHaveBeenCalledWith({ data: { id: 'wamid.NOVA' } });
    expect(prisma.client.findFirst).toHaveBeenCalled();
  });
});

describe('ConversationsService - opções 1 (Pix) e 2 (boleto)', () => {
  const charge = {
    id: 'charge-1',
    pixCopiaECola: '00020101021226980014BR.GOV.BCB.PIX-codigo-pix',
    linhaDigitavel: '07790001161206142039908513267545515860000000500',
    paymentLink: 'https://cecim-financeiro.onrender.com/boletos/charge-1',
  };

  function setupConversa() {
    const prisma: any = {
      processedWhatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
      client: { findFirst: jest.fn().mockResolvedValue({ id: 'cli-1', name: 'Cliente' }) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-1', chargeId: 'charge-1', messages: [] }),
        update: jest.fn(),
      },
      charge: { findUnique: jest.fn().mockResolvedValue(charge) },
      conversationMessage: { create: jest.fn() },
    };
    const whatsapp: any = { send: jest.fn().mockResolvedValue({}) };
    const service = new ConversationsService(prisma, whatsapp, {} as any, {} as any, {} as any);
    return { service, whatsapp };
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
