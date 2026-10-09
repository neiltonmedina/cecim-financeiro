import { calcularValorAtualizado, hojeSaoPaulo } from './boletos.service';

describe('calcularValorAtualizado', () => {
  it('não acrescenta nada antes ou no dia do vencimento', () => {
    expect(calcularValorAtualizado(500, '2026-09-01', '2026-09-01', 2, 1).totalCents).toBe(500);
    expect(calcularValorAtualizado(500, '2026-09-10', '2026-09-01', 2, 1).totalCents).toBe(500);
  });

  it('aplica multa única + juros proporcionais aos dias de atraso', () => {
    // 30 dias: multa 2% (10) + juros 1%/mês (5)
    expect(calcularValorAtualizado(500, '2026-09-01', '2026-10-01', 2, 1)).toEqual({
      diasAtraso: 30,
      multaCents: 10,
      jurosCents: 5,
      totalCents: 515,
    });
  });

  it('sem multa/juros configurados mantém o valor original', () => {
    expect(calcularValorAtualizado(500, '2026-09-01', '2026-10-01', 0, 0).totalCents).toBe(500);
  });
});

describe('hojeSaoPaulo', () => {
  it('usa o fuso de São Paulo (02:00 UTC ainda é o dia anterior)', () => {
    expect(hojeSaoPaulo(new Date('2026-10-08T02:00:00Z'))).toBe('2026-10-07');
  });
});

describe('BoletosService - importar boletos já gerados no Inter', () => {
  const itemInter = (codigo: string, extra: any = {}) => ({
    cobranca: {
      codigoSolicitacao: codigo,
      seuNumero: '123',
      situacao: 'A_RECEBER',
      valorNominal: 150.5,
      dataVencimento: '2099-10-10',
      pagador: { nome: 'EMPRESA X LTDA', cpfCnpj: '04.301.559/0001-02', ddd: '94', telefone: '992453959', cep: '68515-000', endereco: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Parauapebas', uf: 'PA' },
      ...extra,
    },
    boleto: { linhaDigitavel: '0779000' },
    pix: { pixCopiaECola: '000201pix' },
  });

  function setup(clientesExistentes: any[] = []) {
    const prisma: any = {
      client: {
        findMany: jest.fn().mockResolvedValue(clientesExistentes),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'novo', ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...clientesExistentes[0], ...data })),
      },
      charge: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ch-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const inter: any = {
      isConfigured: () => true,
      consultarBruto: jest.fn().mockImplementation((c: string) => Promise.resolve(itemInter(c))),
      baixarPdf: jest.fn().mockResolvedValue('PDFBASE64'),
      createBoleto: jest.fn(),
      listarCobrancas: jest.fn().mockResolvedValue([itemInter('a'), itemInter('b', { situacao: 'RECEBIDO' })]),
    };
    const config: any = { get: (k: string) => (k === 'appUrl' ? 'https://app' : undefined) };
    const { BoletosService } = require('./boletos.service');
    return { service: new BoletosService(prisma, inter, config), prisma, inter };
  }

  it('cria cliente e cobrança ligada ao boleto existente, sem gerar boleto novo', async () => {
    const { service, prisma, inter } = setup();
    const r = await service.importarBoletosInter(['cod-1']);

    expect(r).toMatchObject({ importadas: 1, clientesCriados: 1, semTelefone: [] });
    expect(inter.createBoleto).not.toHaveBeenCalled();
    expect(prisma.client.create.mock.calls[0][0].data).toMatchObject({
      document: '04301559000102',
      phoneE164: '+5594992453959',
      cep: '68515000',
    });
    expect(prisma.charge.create.mock.calls[0][0].data).toMatchObject({
      amountCents: 15050,
      boletoCodigoSolicitacao: 'cod-1',
      linhaDigitavel: '0779000',
      pixCopiaECola: '000201pix',
      status: 'PENDENTE',
    });
    expect(prisma.charge.update).toHaveBeenCalledWith({ where: { id: 'ch-1' }, data: { paymentLink: 'https://app/boletos/ch-1' } });
  });

  it('reaproveita o cliente pelo CPF/CNPJ e não importa o mesmo boleto duas vezes', async () => {
    const { service, prisma } = setup([{ id: 'c1', name: 'Empresa', document: '04301559000102', phoneE164: '+5594999999999' }]);
    prisma.charge.findFirst.mockResolvedValueOnce({ id: 'ja' }).mockResolvedValueOnce(null);

    const r = await service.importarBoletosInter(['cod-ja', 'cod-2']);

    expect(r).toMatchObject({ importadas: 1, jaExistiam: 1, clientesCriados: 0 });
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.charge.create.mock.calls[0][0].data.clientId).toBe('c1');
  });

  it('lista só os boletos em aberto', async () => {
    const { service } = setup();
    const lista = await service.listarBoletosInter('2026-10-01', '2026-10-31');
    expect(lista.map((b: any) => b.codigoSolicitacao)).toEqual(['a']);
    expect(lista[0]).toMatchObject({ valorCents: 15050, jaNoPainel: false, telefone: '+5594992453959' });
  });
});
