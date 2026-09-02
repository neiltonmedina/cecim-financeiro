import { buildTemplateContext, formatCurrencyBRL, formatDateBR, renderTemplate } from './template-renderer.util';

describe('template-renderer.util', () => {
  it('formata valores em centavos para BRL', () => {
    expect(formatCurrencyBRL(15000)).toBe('R$ 150,00');
  });

  it('formata datas no padrão brasileiro', () => {
    expect(formatDateBR(new Date('2026-03-10T12:00:00Z'))).toBe('10/03/2026');
  });

  it('monta o contexto do template a partir de cliente e cobrança', () => {
    const client: any = { name: 'Maria Souza' };
    const charge: any = {
      id: 'charge-1',
      amountCents: 25000,
      dueDate: new Date('2026-04-01T12:00:00Z'),
      paymentLink: null,
      description: 'Mensalidade Abril',
    };

    const context = buildTemplateContext(client, charge, 'https://app.example.com');

    expect(context).toEqual({
      cliente: 'Maria Souza',
      valor: 'R$ 250,00',
      vencimento: '01/04/2026',
      linkPagamento: 'https://app.example.com/pagamentos/charge-1',
      descricao: 'Mensalidade Abril',
    });
  });

  it('renderiza os placeholders no corpo do template', () => {
    const rendered = renderTemplate('Olá {{cliente}}, valor {{valor}}, vence {{vencimento}}.', {
      cliente: 'João',
      valor: 'R$ 100,00',
      vencimento: '05/05/2026',
      linkPagamento: 'https://x',
      descricao: 'teste',
    });
    expect(rendered).toBe('Olá João, valor R$ 100,00, vence 05/05/2026.');
  });
});
