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
