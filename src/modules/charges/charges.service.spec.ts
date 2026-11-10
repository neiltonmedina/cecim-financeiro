import { ChargesService } from './charges.service';

describe('ChargesService.problemas', () => {
  it('separa as cobranças em aberto que não foram ou não podem ser enviadas', async () => {
    const cobranca = (id: string, extra: any) => ({
      id, linhaDigitavel: '0779', pixCopiaECola: null, notifications: [], client: { phoneE164: '+5594999999999', whatsappOptIn: true }, ...extra,
    });
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          cobranca('ok', { notifications: [{ status: 'SENT' }] }),
          cobranca('falhou', { notifications: [{ status: 'FAILED' }] }),
          cobranca('sem-boleto', { linhaDigitavel: null }),
          cobranca('sem-telefone', { client: { phoneE164: null, whatsappOptIn: true } }),
          // Marcado como "não usa WhatsApp": não aparece como problema.
          cobranca('ignorado', { client: { phoneE164: null, whatsappOptIn: false } }),
        ]),
      },
    };
    const service = new ChargesService(prisma, {} as any, {} as any, {} as any);

    const r: any[] = await service.problemas();

    expect(r.map((c) => [c.id, c.problema])).toEqual([
      ['falhou', 'FALHA_ENVIO'],
      ['sem-boleto', 'SEM_BOLETO'],
      ['sem-telefone', 'SEM_TELEFONE'],
    ]);
    expect(prisma.charge.findMany.mock.calls[0][0].where.status.in).toEqual(['PENDENTE', 'ENVIADA', 'VENCIDA']);
  });
});

describe('ChargesService.limparAvisos', () => {
  it('tira sem telefone e falha de envio sem apagar cobrança; sem boleto fica', async () => {
    const cobranca = (id: string, extra: any) => ({
      id, clientId: 'cli-' + id, linhaDigitavel: '0779', pixCopiaECola: null, notifications: [], avisoDispensadoEm: null,
      client: { phoneE164: '+5594999999999', whatsappOptIn: true }, ...extra,
    });
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          cobranca('falhou', { notifications: [{ status: 'FAILED', queuedAt: new Date('2026-11-01') }] }),
          cobranca('sem-boleto', { linhaDigitavel: null }),
          cobranca('sem-telefone', { client: { phoneE164: null, whatsappOptIn: true } }),
        ]),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      client: { updateMany: jest.fn() },
    };
    const service = new ChargesService(prisma, {} as any, {} as any, {} as any);
    expect(await service.limparAvisos()).toEqual({ semTelefone: 1, falhas: 1, semBoletoMantidos: 1 });
    expect(prisma.client.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['cli-sem-telefone'] } }, data: { whatsappOptIn: false } });
    expect(prisma.charge.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['falhou'] } });
    expect(prisma.charge.delete).not.toHaveBeenCalled();
  });

  it('falha limpa não volta; falha nova (depois da limpeza) volta a aparecer', async () => {
    const limpoEm = new Date('2026-11-02T12:00:00Z');
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'antiga', linhaDigitavel: 'L', notifications: [{ status: 'FAILED', queuedAt: new Date('2026-11-01') }], avisoDispensadoEm: limpoEm, client: { phoneE164: '+5594999999999', whatsappOptIn: true } },
          { id: 'nova', linhaDigitavel: 'L', notifications: [{ status: 'FAILED', queuedAt: new Date('2026-11-03') }], avisoDispensadoEm: limpoEm, client: { phoneE164: '+5594999999999', whatsappOptIn: true } },
        ]),
      },
    };
    const r: any[] = await new ChargesService(prisma, {} as any, {} as any, {} as any).problemas();
    expect(r.map((c) => c.id)).toEqual(['nova']);
  });
});

describe('ChargesService.dispatch - boleto recém-criado', () => {
  function setup(charges: any[]) {
    const prisma: any = {
      charge: {
        findMany: jest.fn(async ({ where }: any) => charges.filter((c) => where.id.in.includes(c.id))),
        findUnique: jest.fn(async ({ where }: any) => charges.find((c) => c.id === where.id)),
      },
      client: { findMany: jest.fn().mockResolvedValue([]) },
      disparoAgendado: { create: jest.fn() },
    };
    const notifications: any = {
      dispatchCharges: jest.fn(async (ids: string[]) => ids.map((chargeId) => ({ chargeId, clientId: 'cli', channelsQueued: ['WHATSAPP'], skipped: [] }))),
    };
    const boletos: any = { isConfigured: () => false };
    return { service: new ChargesService(prisma, notifications, {} as any, boletos), prisma, notifications };
  }
  const cobranca = (id: string, minutosDoBoleto: number | null) => ({
    id, clientId: 'cli', status: 'PENDENTE', linhaDigitavel: '0779',
    boletoCriadoEm: minutosDoBoleto === null ? null : new Date(Date.now() - minutosDoBoleto * 60 * 1000),
  });

  it('segura o boleto criado há menos de 10 min (agenda sozinho) e envia os demais na hora', async () => {
    const { service, prisma, notifications } = setup([cobranca('novo', 2), cobranca('antigo', 60), cobranca('importado', null)]);

    const r: any[] = await service.dispatch({ chargeIds: ['novo', 'antigo', 'importado'], channels: ['WHATSAPP'], intervalDays: 5, confirmado: true } as any);

    const agendado = prisma.disparoAgendado.create.mock.calls[0][0].data;
    expect(agendado).toMatchObject({ chargeIds: ['novo'], intervalDays: 5 });
    // Sai quando o boleto completar 10 min (faltam ~8).
    expect(Math.round((agendado.executarEm.getTime() - Date.now()) / 60000)).toBe(8);
    expect(notifications.dispatchCharges.mock.calls[0][0]).toEqual(['antigo', 'importado']);
    expect(r.find((x) => x.chargeId === 'novo')).toMatchObject({ channelsQueued: [], agendadoPara: agendado.executarEm.toISOString() });
    expect(r.filter((x) => x.channelsQueued.length).map((x) => x.chargeId)).toEqual(['antigo', 'importado']);
  });

  it('na hora marcada (semEspera) envia sem agendar de novo', async () => {
    const { service, prisma, notifications } = setup([cobranca('novo', 2)]);
    await service.dispatch({ chargeIds: ['novo'], channels: ['WHATSAPP'], confirmado: true } as any, { semEspera: true });
    expect(prisma.disparoAgendado.create).not.toHaveBeenCalled();
    expect(notifications.dispatchCharges).toHaveBeenCalled();
  });
});
