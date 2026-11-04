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
      origem: 'INTER',
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

  it('usa o telefone digitado no painel para o boleto', async () => {
    const { service, prisma } = setup([{ id: 'c1', name: 'Empresa', document: '04301559000102', phoneE164: null }]);
    await service.importarBoletosInter(['cod-1'], { 'cod-1': '+5594981606586' });
    expect(prisma.client.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { phoneE164: '+5594981606586' } });
  });

  it('lista só os boletos em aberto', async () => {
    const { service } = setup();
    const lista = await service.listarBoletosInter('2026-10-01', '2026-10-31');
    expect(lista.map((b: any) => b.codigoSolicitacao)).toEqual(['a']);
    expect(lista[0]).toMatchObject({ valorCents: 15050, jaNoPainel: false, telefone: '+5594992453959' });
  });
});

describe('Dados do cliente para o Inter', () => {
  const { normalizarUf } = require('./inter-boleto.provider');
  const { traduzirErroInter } = require('./boletos.service');

  it('converte o estado para a sigla que o Inter exige', () => {
    expect(normalizarUf('Pará')).toBe('PA');
    expect(normalizarUf(' pa ')).toBe('PA');
    expect(normalizarUf('São Paulo')).toBe('SP');
    expect(normalizarUf('XX')).toBeUndefined();
  });

  it('traduz a recusa do Inter dizendo qual dado do cliente corrigir', () => {
    const erro = { response: { data: { title: 'Dados inválidos.', violacoes: [{ razao: 'O valor não pode ser nulo', propriedade: 'incluirCobrancaAsync.body.pagador.uf' }] } } };
    expect(traduzirErroInter(erro)).toBe(
      'Dado do cliente inválido para o Inter - UF (estado): O valor não pode ser nulo. Corrija no cadastro do cliente (Clientes > Editar).',
    );
  });
});

describe('BoletosService.vincularBoletoExistente - não duplicar boleto já criado no Inter', () => {
  const charge: any = { id: 'ch-1', amountCents: 44500, dueDate: new Date('2026-11-05T00:00:00Z'), boletoDataVencimento: null };
  const client: any = { document: '43610462000133' };
  const item = (codigo: string, extra: any = {}) => ({
    cobranca: { codigoSolicitacao: codigo, situacao: 'A_RECEBER', valorNominal: 445, dataVencimento: '2026-11-05', pagador: {}, ...extra },
    boleto: { linhaDigitavel: 'LINHA' },
    pix: { pixCopiaECola: 'PIX' },
  });
  function setup(itens: any[], dono: any = null) {
    const prisma: any = {
      charge: { findFirst: jest.fn().mockResolvedValue(dono), update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...charge, ...data })) },
    };
    const inter: any = { isConfigured: () => true, listarCobrancas: jest.fn().mockResolvedValue(itens), baixarPdf: jest.fn().mockResolvedValue('PDF') };
    const { BoletosService } = require('./boletos.service');
    return { service: new BoletosService(prisma, inter, { get: () => 'https://app' } as any), prisma, inter };
  }

  it('acha o boleto do mesmo pagador, vencimento e valor e liga à cobrança', async () => {
    const { service, inter, prisma } = setup([item('cancelado', { situacao: 'CANCELADO' }), item('outro-valor', { valorNominal: 500 }), item('certo')]);
    const r = await service.vincularBoletoExistente(charge, client);
    expect(inter.listarCobrancas).toHaveBeenCalledWith({ dataInicial: '2026-11-05', dataFinal: '2026-11-05', cpfCnpj: '43610462000133' });
    expect(prisma.charge.update.mock.calls[0][0].data).toMatchObject({ boletoCodigoSolicitacao: 'certo', linhaDigitavel: 'LINHA', boletoPdfBase64: 'PDF', boletoErro: null });
    expect(r.boletoCodigoSolicitacao).toBe('certo');
  });

  it('não pega boleto que já pertence a outra cobrança do painel', async () => {
    const { service, prisma } = setup([item('certo')], { id: 'outra' });
    expect(await service.vincularBoletoExistente(charge, client)).toBeNull();
    expect(prisma.charge.update).not.toHaveBeenCalled();
  });
});

describe('BoletosService - Inter recusa por cobrança igual recente', () => {
  it('liga ao boleto que o Inter diz que já existe, em vez de guardar erro', async () => {
    const charge: any = { id: 'ch-1', amountCents: 44500, dueDate: new Date('2026-11-05T00:00:00Z'), boletoDataVencimento: null };
    const prisma: any = {
      charge: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...charge, ...data })) },
    };
    const recusa = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { title: 'Requisição inválida', detail: 'Não será possível emitir a cobrança. Pois, existe uma cobrança emitida há poucos minutos com os mesmos dados com a situação "a receber" com código de solicitação: d039c7ae' } },
    });
    const inter: any = {
      isConfigured: () => true,
      createBoleto: jest.fn().mockRejectedValue(recusa),
      listarCobrancas: jest.fn().mockResolvedValue([{ cobranca: { codigoSolicitacao: 'd039c7ae', situacao: 'A_RECEBER', valorNominal: 445, dataVencimento: '2026-11-05', pagador: {} }, boleto: { linhaDigitavel: 'L' } }]),
      baixarPdf: jest.fn().mockResolvedValue('PDF'),
    };
    const { BoletosService } = require('./boletos.service');
    const service = new BoletosService(prisma, inter, { get: () => 'https://app' } as any);
    const r = await service.gerarBoletoParaCobranca(charge, { document: '43610462000133' });
    expect(r.boletoCodigoSolicitacao).toBe('d039c7ae');
    expect(prisma.charge.update.mock.calls.every((c: any) => !c[0].data.boletoErro)).toBe(true);
  });

  it('procura em lote só liga o que existe e nunca cria boleto', async () => {
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', amountCents: 44500, dueDate: new Date('2026-11-05T00:00:00Z'), boletoDataVencimento: null, client: { name: 'KATIA', document: '43610462000133' } },
          { id: 'b', amountCents: 10000, dueDate: new Date('2026-11-06T00:00:00Z'), boletoDataVencimento: null, client: { name: 'AGS', document: '26371128000155' } },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    const inter: any = {
      isConfigured: () => true,
      createBoleto: jest.fn(),
      listarCobrancas: jest.fn().mockImplementation(({ cpfCnpj }: any) =>
        Promise.resolve(cpfCnpj === '43610462000133' ? [{ cobranca: { codigoSolicitacao: 'k1', situacao: 'A_RECEBER', valorNominal: 445, dataVencimento: '2026-11-05', pagador: {} } }] : []),
      ),
      baixarPdf: jest.fn().mockResolvedValue('PDF'),
    };
    const { BoletosService } = require('./boletos.service');
    const r = await new BoletosService(prisma, inter, { get: () => 'https://app' } as any).recuperarBoletosCriados();
    expect(r).toEqual({ vinculados: ['KATIA'], naoEncontrados: ['AGS'], erros: [] });
    expect(inter.createBoleto).not.toHaveBeenCalled();
  });
});

describe('BoletosService.conferirBoletosNoInter', () => {
  it('separa pagos, desliga cancelados e atualiza Pix desatualizado', async () => {
    const abertas = [
      { id: 'pago', boletoCodigoSolicitacao: 'c-pago', pixCopiaECola: 'P', linhaDigitavel: 'L', client: { name: 'A' } },
      { id: 'cancelado', boletoCodigoSolicitacao: 'c-canc', pixCopiaECola: 'P', linhaDigitavel: 'L', client: { name: 'KATIA' } },
      { id: 'velho', boletoCodigoSolicitacao: 'c-velho', pixCopiaECola: 'PIX-VELHO', linhaDigitavel: 'L', client: { name: 'C' } },
      { id: 'ok', boletoCodigoSolicitacao: 'c-ok', pixCopiaECola: 'P', linhaDigitavel: 'L', client: { name: 'D' } },
    ];
    const situacoes: Record<string, any> = {
      'c-pago': { situacao: 'RECEBIDO', valorTotalRecebido: 455 },
      'c-canc': { situacao: 'CANCELADO' },
      'c-velho': { situacao: 'A_RECEBER' },
      'c-ok': { situacao: 'A_RECEBER' },
    };
    const prisma: any = { charge: { findMany: jest.fn().mockResolvedValue(abertas), update: jest.fn() } };
    const inter: any = {
      isConfigured: () => true,
      consultarBruto: jest.fn().mockImplementation((cod: string) =>
        Promise.resolve({ cobranca: { codigoSolicitacao: cod, ...situacoes[cod] }, boleto: { linhaDigitavel: 'L' }, pix: { pixCopiaECola: cod === 'c-velho' ? 'PIX-NOVO' : 'P' } }),
      ),
    };
    const { BoletosService } = require('./boletos.service');
    const r = await new BoletosService(prisma, inter, { get: () => '' } as any).conferirBoletosNoInter();

    expect(r).toEqual({ pagas: [{ chargeId: 'pago', valorRecebidoCents: 45500 }], cancelados: ['KATIA'], atualizados: ['C'] });
    const atualizacoes = Object.fromEntries(prisma.charge.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data]));
    expect(atualizacoes.cancelado).toMatchObject({ boletoCodigoSolicitacao: null, pixCopiaECola: null, linhaDigitavel: null });
    expect(atualizacoes.velho).toMatchObject({ pixCopiaECola: 'PIX-NOVO' });
    expect(atualizacoes.ok).toBeUndefined();
  });
});
