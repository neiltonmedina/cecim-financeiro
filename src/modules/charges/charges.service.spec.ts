import { ChargesService } from './charges.service';

describe('ChargesService.problemas', () => {
  it('separa as cobranças em aberto que não foram ou não podem ser enviadas', async () => {
    const cobranca = (id: string, extra: any) => ({
      id, linhaDigitavel: '0779', pixCopiaECola: null, notifications: [], client: { phoneE164: '+5594999999999' }, ...extra,
    });
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          cobranca('ok', { notifications: [{ status: 'SENT' }] }),
          cobranca('falhou', { notifications: [{ status: 'FAILED' }] }),
          cobranca('sem-boleto', { linhaDigitavel: null }),
          cobranca('sem-telefone', { client: { phoneE164: null } }),
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
