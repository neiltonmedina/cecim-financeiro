import { DisparosAgendadosService } from './disparos-agendados.service';

function setup(claim = 1) {
  const prisma: any = {
    disparoAgendado: {
      findMany: jest.fn().mockResolvedValue([{ id: 'd1', chargeIds: ['c1', 'c2'], intervalDays: 5 }]),
      updateMany: jest.fn().mockResolvedValue({ count: claim }),
      update: jest.fn(),
    },
    // c2 foi paga depois do agendamento.
    charge: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
  };
  const charges: any = { dispatch: jest.fn().mockResolvedValue([{ chargeId: 'c1', channelsQueued: ['WHATSAPP'], skipped: [] }]) };
  const push: any = { notificar: jest.fn() };
  return { service: new DisparosAgendadosService(prisma, charges, push), prisma, charges, push };
}

describe('DisparosAgendadosService.executarPendentes', () => {
  it('dispara só as cobranças ainda em aberto e avisa no celular', async () => {
    const { service, prisma, charges, push } = setup();
    expect(await service.executarPendentes()).toBe(1);
    expect(charges.dispatch).toHaveBeenCalledWith({ chargeIds: ['c1'], channels: ['WHATSAPP'], intervalDays: 5, confirmado: true });
    expect(prisma.disparoAgendado.update.mock.calls[0][0].data).toMatchObject({ status: 'EXECUTADO', resultado: expect.stringContaining('1 enviada(s); 1 já paga') });
    expect(push.notificar).toHaveBeenCalled();
  });

  it('não dispara duas vezes se outro processo já pegou o agendamento', async () => {
    const { service, charges } = setup(0);
    expect(await service.executarPendentes()).toBe(0);
    expect(charges.dispatch).not.toHaveBeenCalled();
  });
});
