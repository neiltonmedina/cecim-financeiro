import { InterBoletoProvider } from './inter-boleto.provider';

describe('InterBoletoProvider.createBoleto - Inter ainda processando o PDF', () => {
  const charge: any = { id: 'ch-1', amountCents: 44500, dueDate: new Date('2026-11-05T00:00:00Z'), seuNumero: 'BOL-018', diasAgenda: 30 };
  const client: any = { name: 'KATIA ALVES', document: '43610462000133', cep: '68515000', endereco: 'Rua', numero: 'S/N', bairro: 'Centro', cidade: 'Parauapebas', uf: 'PA' };

  function setup(get: jest.Mock) {
    const provider = new InterBoletoProvider({ get: () => ({ multaPercentual: 2, moraTaxaMensal: 1 }) } as any);
    (provider as any).getAccessToken = jest.fn().mockResolvedValue('token');
    const post = jest.fn().mockResolvedValue({ data: { codigoSolicitacao: 'cod-1' } });
    (provider as any).client = { post, get };
    // Sem esperar de verdade entre as tentativas.
    jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => { cb(); return 0 as any; }) as any);
    return { provider, post };
  }
  afterEach(() => jest.restoreAllMocks());

  it('tenta o PDF de novo até o Inter terminar de processar', async () => {
    const processando = Object.assign(new Error('400'), { response: { status: 400 } });
    const get = jest.fn()
      .mockRejectedValueOnce(processando)
      .mockRejectedValueOnce(processando)
      .mockResolvedValueOnce({ data: { pdf: 'PDF' } })
      .mockResolvedValueOnce({ data: { boleto: { linhaDigitavel: 'LINHA' }, pix: { pixCopiaECola: 'PIX' } } });
    const { provider, post } = setup(get);
    const r = await provider.createBoleto(charge, client);
    expect(post).toHaveBeenCalledTimes(1); // um boleto só
    expect(r).toEqual({ codigoSolicitacao: 'cod-1', pdfBase64: 'PDF', pixCopiaECola: 'PIX', linhaDigitavel: 'LINHA' });
  });

  it('se o PDF não vier, devolve o boleto criado (sem falhar, para não gerar outro)', async () => {
    const get = jest.fn().mockImplementation((url: string) =>
      url.endsWith('/pdf') ? Promise.reject(new Error('em processamento')) : Promise.resolve({ data: { boleto: { linhaDigitavel: 'LINHA' } } }),
    );
    const { provider, post } = setup(get);
    const r = await provider.createBoleto(charge, client);
    expect(post).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ codigoSolicitacao: 'cod-1', linhaDigitavel: 'LINHA' });
    expect(r.pdfBase64).toBeUndefined();
  });
});
