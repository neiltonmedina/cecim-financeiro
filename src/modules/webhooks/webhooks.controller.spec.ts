import { WebhooksController } from './webhooks.controller';

function setup(pago: boolean) {
  const prisma: any = { charge: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', status: 'VENCIDA' }) } };
  const conversations: any = { registrarPagamento: jest.fn().mockResolvedValue(true) };
  const boletos: any = { pagamentoNoInter: jest.fn().mockResolvedValue({ pago, valorRecebidoCents: 517 }) };
  const controller = new WebhooksController(prisma, {} as any, conversations, boletos);
  return { controller, conversations };
}

describe('WebhooksController - aviso de pagamento do Inter', () => {
  it('dá baixa quando o Inter confirma o pagamento', async () => {
    const { controller, conversations } = setup(true);
    await controller.receiveInterPaymentEvent({ codigoSolicitacao: 'abc', situacao: 'RECEBIDO' });
    expect(conversations.registrarPagamento).toHaveBeenCalledWith('c1', 517);
  });

  it('ignora aviso falso (o Inter não confirma o pagamento)', async () => {
    const { controller, conversations } = setup(false);
    await controller.receiveInterPaymentEvent({ codigoSolicitacao: 'abc', situacao: 'RECEBIDO' });
    expect(conversations.registrarPagamento).not.toHaveBeenCalled();
  });
});

describe('WebhooksController - status de leitura do WhatsApp', () => {
  function setupStatus(atual: string) {
    const prisma: any = {
      notificationLog: { findFirst: jest.fn().mockResolvedValue({ id: 'l1', status: atual }), update: jest.fn() },
    };
    return { controller: new WebhooksController(prisma, {} as any, {} as any, {} as any), prisma };
  }

  it('marca como lida', async () => {
    const { controller, prisma } = setupStatus('DELIVERED');
    await (controller as any).applyWhatsAppStatus('wamid.1', 'read');
    expect(prisma.notificationLog.update.mock.calls[0][0].data.status).toBe('READ');
  });

  it('"entregue" que chega atrasado não desfaz o "lida"', async () => {
    const { controller, prisma } = setupStatus('READ');
    await (controller as any).applyWhatsAppStatus('wamid.1', 'delivered');
    expect(prisma.notificationLog.update).not.toHaveBeenCalled();
  });
});

describe('WebhooksController - assinatura da Meta', () => {
  const { createHmac } = require('crypto');
  const corpo = JSON.stringify({ entry: [] });
  function setupAssinatura(segredo: string) {
    const config: any = { get: jest.fn().mockReturnValue(segredo) };
    return new WebhooksController({} as any, config, {} as any, {} as any);
  }
  const req = (assinatura?: string) => ({ rawBody: Buffer.from(corpo), headers: assinatura ? { 'x-hub-signature-256': assinatura } : {} });

  it('aceita evento assinado pela Meta', () => {
    const controller = setupAssinatura('segredo');
    const ok = 'sha256=' + createHmac('sha256', 'segredo').update(corpo).digest('hex');
    expect(() => controller.receiveWhatsAppEvent(JSON.parse(corpo), req(ok))).not.toThrow();
  });

  it('recusa evento sem assinatura ou com assinatura falsa', () => {
    const controller = setupAssinatura('segredo');
    expect(() => controller.receiveWhatsAppEvent(JSON.parse(corpo), req())).toThrow('Assinatura inválida');
    expect(() => controller.receiveWhatsAppEvent(JSON.parse(corpo), req('sha256=falsa'))).toThrow('Assinatura inválida');
  });

  it('sem App Secret configurado, continua aceitando (só avisa no log)', () => {
    const controller = setupAssinatura('');
    expect(() => controller.receiveWhatsAppEvent(JSON.parse(corpo), req())).not.toThrow();
  });
});

describe('WebhooksController - caixa de entrada do WhatsApp', () => {
  const { resumoDaMensagem } = require('./webhooks.controller');

  it('resume texto, botão e mídia', () => {
    expect(resumoDaMensagem({ type: 'text', text: { body: 'oi' } })).toEqual({ tipo: 'text', texto: 'oi' });
    expect(resumoDaMensagem({ type: 'button', button: { text: 'Pix', payload: 'PIX:1' } })).toEqual({ tipo: 'button', texto: 'Pix' });
    expect(resumoDaMensagem({ type: 'image', image: { caption: 'comprovante' } })).toEqual({ tipo: 'image', texto: '[imagem] comprovante' });
    expect(resumoDaMensagem({ type: 'audio', audio: {} })).toEqual({ tipo: 'audio', texto: '[áudio]' });
  });

  it('guarda a mensagem de qualquer número, mesmo não cadastrado e mesmo sem ser texto', () => {
    const createMany = jest.fn().mockResolvedValue({});
    const prisma: any = { mensagemRecebida: { createMany } };
    const controller = new WebhooksController(prisma, { get: () => '' } as any, { handleInboundWhatsApp: jest.fn() } as any, {} as any);
    controller.receiveWhatsAppEvent({
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: '5594988887777', profile: { name: 'Fulano' } }],
        messages: [{ id: 'wamid.X', from: '5594988887777', type: 'image', image: { caption: 'boleto' } }],
      } }] }],
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ id: 'wamid.X', de: '5594988887777', nomePerfil: 'Fulano', tipo: 'image', texto: '[imagem] boleto' }],
      skipDuplicates: true,
    });
  });
});
