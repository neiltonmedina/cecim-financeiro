import { LotesService, normalizarLinha, vencimentoDoMes } from './lotes.service';

// Linhas como estão na planilha BOLETOS_COMPLETO.xlsx (o painel manda tudo como texto).
const ELIO = { seuNumero: 'BOL-002', nome: 'ELIO', documento: '4301559000102', valor: '690', dia: '20', cep: '68514999', logradouro: 'RUA PARAUAPEBAS PARA', numero: 'S/N', bairro: 'CENTRO', cidade: 'PARAUAPEBAS', uf: 'PA' };
const AGS = { seuNumero: 'BOL-003', nome: 'AGS TELECOM', documento: '26371128000155', valor: '1795,00', dia: '6' };

describe('normalizarLinha (regras do agente de boletos)', () => {
  it('devolve o zero que o Excel tirou do CNPJ e lê o valor', () => {
    const l = normalizarLinha(ELIO, '2026-11', '2026-10-30');
    expect(l).toMatchObject({ documento: '04301559000102', valorCents: 69000, vencimento: '2026-11-20', seuNumero: 'BOL-002', erros: [] });
  });

  it('valor com vírgula e endereço padrão quando a planilha não traz', () => {
    const l = normalizarLinha(AGS, '2026-11', '2026-10-30');
    expect(l.valorCents).toBe(179500);
    expect(l.endereco).toMatchObject({ cidade: 'PARAUAPEBAS', uf: 'PA', cep: '68515000' });
  });

  it('dia 30/31 em mês curto vira o último dia do mês', () => {
    expect(vencimentoDoMes('31', '2026-11')).toBe('2026-11-30');
    expect(vencimentoDoMes('30', '2027-02')).toBe('2027-02-28');
  });

  it('recusa CNPJ inválido e vencimento que já passou', () => {
    const l = normalizarLinha({ ...ELIO, documento: '11111111000111' }, '2026-10', '2026-10-30');
    expect(l.erros.join(' ')).toMatch(/CNPJ inválido/);
    expect(l.erros.join(' ')).toMatch(/já passou/);
  });
});

describe('LotesService.gerarLinha - sem boleto duplicado', () => {
  function setup(existente: any) {
    const prisma: any = {
      loteMensal: { findUnique: jest.fn().mockResolvedValue({ id: 'L1', mes: '2099-11' }) },
      client: { findMany: jest.fn().mockResolvedValue([{ id: 'cli', name: 'ELIO', document: '04301559000102', cep: '1', endereco: 'r', bairro: 'b', cidade: 'c', uf: 'PA', phoneE164: '+559499', telefonesExtras: [] }]) },
      charge: { findFirst: jest.fn().mockResolvedValue(existente), create: jest.fn().mockResolvedValue({ id: 'nova' }) },
    };
    const boletos: any = { gerarBoletoParaCobranca: jest.fn().mockResolvedValue({ id: 'nova', boletoCodigoSolicitacao: 'cod' }) };
    return { service: new LotesService(prisma, boletos, {} as any, {} as any), prisma, boletos };
  }

  it('gera boleto com seu_numero da planilha, 30 dias para pagar e origem MENSAL', async () => {
    const { service, prisma, boletos } = setup(null);
    expect(await service.gerarLinha('L1', ELIO)).toMatchObject({ status: 'OK' });
    expect(prisma.charge.create.mock.calls[0][0].data).toMatchObject({
      clientId: 'cli', amountCents: 69000, origem: 'MENSAL', seuNumero: 'BOL-002', diasAgenda: 30, loteId: 'L1', description: 'Mensalidade 11/2099',
    });
    expect(boletos.gerarBoletoParaCobranca).toHaveBeenCalled();
  });

  it('se o boleto do mês já existe, não gera de novo', async () => {
    const { service, prisma, boletos } = setup({ id: 'antiga' });
    expect(await service.gerarLinha('L1', ELIO)).toMatchObject({ status: 'JA_GERADO', chargeId: 'antiga' });
    expect(prisma.charge.create).not.toHaveBeenCalled();
    expect(boletos.gerarBoletoParaCobranca).not.toHaveBeenCalled();
  });
});

describe('LotesService.enviarAvisosAutomaticos', () => {
  it('avisa só quem chegou na data (vencimento - dias antes)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-15T12:00:00Z'));
    const cliente = { phoneE164: '+5594', telefonesExtras: [] };
    const prisma: any = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'vence20', dueDate: new Date('2026-11-20T00:00:00Z'), lote: { diasAntes: 5, intervalDays: 5 }, client: cliente },
          { id: 'vence30', dueDate: new Date('2026-11-30T00:00:00Z'), lote: { diasAntes: 5, intervalDays: 5 }, client: cliente },
        ]),
      },
    };
    const charges: any = { dispatch: jest.fn().mockResolvedValue([{ channelsQueued: ['WHATSAPP'] }]) };
    const push: any = { notificar: jest.fn() };
    await new LotesService(prisma, {} as any, charges, push).enviarAvisosAutomaticos();
    jest.useRealTimers();
    expect(charges.dispatch).toHaveBeenCalledWith({ chargeIds: ['vence20'], channels: ['WHATSAPP'], intervalDays: 5, confirmado: true });
  });
});

describe('Boletos do mês - telefone digitado na conferência', () => {
  it('aceita DDD + número e recusa telefone incompleto', () => {
    expect(normalizarLinha({ ...ELIO, telefone: '94 99111-2222' }, '2026-11', '2026-10-30')).toMatchObject({ telefone: '+5594991112222', erros: [] });
    expect(normalizarLinha({ ...ELIO, telefone: '1234' }, '2026-11', '2026-10-30').erros.join()).toMatch(/telefone inválido/);
  });

  it('cliente já cadastrado sem telefone recebe o telefone digitado (o existente nunca é trocado)', async () => {
    const prisma: any = {
      loteMensal: { findUnique: jest.fn().mockResolvedValue({ id: 'L1', mes: '2099-11' }) },
      client: {
        findMany: jest.fn().mockResolvedValue([{ id: 'cli', name: 'ELIO', document: '04301559000102', cep: '1', endereco: 'r', bairro: 'b', cidade: 'c', uf: 'PA', phoneE164: null, telefonesExtras: [] }]),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cli', name: 'ELIO', ...data, telefonesExtras: [] })),
      },
      charge: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'nova' }) },
    };
    const boletos: any = { gerarBoletoParaCobranca: jest.fn().mockResolvedValue({ boletoCodigoSolicitacao: 'cod' }) };
    const r = await new LotesService(prisma, boletos, {} as any, {} as any).gerarLinha('L1', { ...ELIO, telefone: '94991112222' });
    expect(prisma.client.update).toHaveBeenCalledWith({ where: { id: 'cli' }, data: { phoneE164: '+5594991112222' } });
    expect(r).toMatchObject({ status: 'OK', temTelefone: true });
  });
});
