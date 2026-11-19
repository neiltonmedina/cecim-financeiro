import { prepararTextoMeta, situacaoDoModelo, TemplatesService } from './templates.service';

describe('prepararTextoMeta', () => {
  it('converte os campos do painel para {{1}}, {{2}}... na ordem e gera exemplos', () => {
    const r = prepararTextoMeta('Olá, {{cliente}}! Vence em {{vencimentoBoleto}}, valor {{valor}}. Obrigado.');
    expect(r.textoMeta).toBe('Olá, {{1}}! Vence em {{2}}, valor {{3}}. Obrigado.');
    expect(r.params).toEqual(['cliente', 'vencimentoBoleto', 'valor']);
    expect(r.exemplos).toHaveLength(3);
  });

  it('recusa o que a Meta recusaria (começar/terminar com campo, campos colados, campo desconhecido)', () => {
    expect(() => prepararTextoMeta('{{cliente}}, seu boleto.')).toThrow(/comece ou termine/);
    expect(() => prepararTextoMeta('Olá {{cliente}}')).toThrow(/comece ou termine/);
    expect(() => prepararTextoMeta('Olá {{cliente}} {{valor}} ok')).toThrow(/seguidos/);
    expect(() => prepararTextoMeta('Olá {{cpf}} ok')).toThrow(/desconhecido/);
  });
});

describe('situacaoDoModelo - semáforo dos modelos', () => {
  it('verde quando a Meta aprovou', () => {
    expect(situacaoDoModelo('APPROVED', undefined).cor).toBe('verde');
    expect(situacaoDoModelo('NAO_EXISTE', 'APPROVED').cor).toBe('verde');
  });

  it('amarelo enquanto a nova versão está em análise (mesmo com a antiga aprovada ou inexistente)', () => {
    expect(situacaoDoModelo('NAO_EXISTE', 'PENDING').cor).toBe('amarelo');
    const comAntiga = situacaoDoModelo('APPROVED', 'PENDING');
    expect(comAntiga.cor).toBe('amarelo');
    expect(comAntiga.detalhe).toMatch(/versão anterior/);
    expect(situacaoDoModelo('NAO_EXISTE', 'NAO_EXISTE').cor).toBe('amarelo'); // acabou de enviar, a Meta ainda não lista
  });

  it('vermelho quando recusado ou quando o modelo em uso não existe na conta atual', () => {
    const recusado = situacaoDoModelo('APPROVED', 'REJECTED', 'Texto promocional');
    expect(recusado.cor).toBe('vermelho');
    expect(recusado.detalhe).toMatch(/Texto promocional/);
    expect(situacaoDoModelo('PAUSED', undefined).cor).toBe('vermelho');
    expect(situacaoDoModelo('NAO_EXISTE', undefined).cor).toBe('vermelho');
  });

  it('cinza quando nada foi enviado ou a Meta não respondeu', () => {
    expect(situacaoDoModelo(undefined, undefined).cor).toBe('cinza');
    expect(situacaoDoModelo('ERRO', undefined).cor).toBe('cinza');
  });
});

describe('TemplatesService.situacaoNaMeta', () => {
  it('consulta o modelo em uso e o pendente de cada tipo na Meta', async () => {
    const prisma: any = {
      messageTemplate: {
        findMany: jest.fn().mockResolvedValue([
          { type: 'BOLETO_DISPONIVEL', providerTemplateName: 'antigo_1', pendenteNome: 'novo_1', metaMotivo: null },
          { type: 'COBRANCA_PENDENTE', providerTemplateName: 'antigo_2', pendenteNome: null, metaMotivo: null },
          { type: 'CONFIRMACAO_PAGAMENTO', providerTemplateName: null, pendenteNome: null, metaMotivo: null },
        ]),
      },
    };
    const whatsapp: any = {
      consultarModeloMeta: jest.fn(async (nome: string) => (nome === 'novo_1' ? { status: 'pending' } : undefined)),
    };
    const r = await new TemplatesService(prisma, whatsapp).situacaoNaMeta();
    expect(r.map((x) => [x.type, x.cor])).toEqual([
      ['BOLETO_DISPONIVEL', 'amarelo'],
      ['COBRANCA_PENDENTE', 'vermelho'], // antigo_2 não existe na conta atual
      ['CONFIRMACAO_PAGAMENTO', 'cinza'],
    ]);
    expect(whatsapp.consultarModeloMeta).toHaveBeenCalledTimes(3);
  });

  it('se a Meta falha, mostra cinza em vez de derrubar a tela', async () => {
    const prisma: any = { messageTemplate: { findMany: jest.fn().mockResolvedValue([{ type: 'BOLETO_DISPONIVEL', providerTemplateName: 'x', pendenteNome: null, metaMotivo: null }]) } };
    const whatsapp: any = { consultarModeloMeta: jest.fn().mockRejectedValue(new Error('token')) };
    const r = await new TemplatesService(prisma, whatsapp).situacaoNaMeta();
    expect(r[0].cor).toBe('cinza');
  });
});
