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
