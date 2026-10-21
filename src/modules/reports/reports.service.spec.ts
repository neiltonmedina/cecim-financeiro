import { ReportsService } from './reports.service';

describe('ReportsService.mensal', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  // paidAt em UTC: 2026-10-10T15:00Z = 10/10 12h em São Paulo.
  const charges = [
    { clientId: 'a', client: { name: 'Ana', document: '1' }, description: 'Out', dueDate: d('2026-10-10'), amountCents: 500, status: 'PAGA', paidAt: new Date('2026-10-10T15:00:00Z'), valorPagoCents: 500 },
    { clientId: 'b', client: { name: 'Bia', document: '2' }, description: 'Out', dueDate: d('2026-10-05'), amountCents: 500, status: 'PAGA', paidAt: new Date('2026-10-12T15:00:00Z'), valorPagoCents: 517 },
    { clientId: 'c', client: { name: 'Caio', document: '3' }, description: 'Out', dueDate: d('2026-10-01'), amountCents: 1000, status: 'VENCIDA', paidAt: null, valorPagoCents: null },
  ];

  it('separa pagas em dia, com atraso (com juros) e em atraso', async () => {
    const prisma: any = { charge: { findMany: jest.fn().mockResolvedValue(charges) } };
    jest.useFakeTimers().setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const r = await new ReportsService(prisma).mensal('2026-10');
    jest.useRealTimers();

    expect(r.linhas.map((l) => l.situacao)).toEqual(['Paga em dia', 'Paga com atraso', 'Em atraso']);
    expect(r.linhas[1]).toMatchObject({ diasAtraso: 7, jurosCents: 17 });
    expect(r.resumo).toMatchObject({ emitidoCents: 2000, recebidoCents: 1017, jurosRecebidosCents: 17, emAtrasoCents: 1000, taxaRecebimento: 67 });
    expect(r.maisAtrasam.map((x) => x.cliente)).toEqual(['Caio', 'Bia']);
    expect(r.maisAtrasam[0]).toMatchObject({ emAtraso: 1, mediaDiasAtraso: 20 });
  });
});
