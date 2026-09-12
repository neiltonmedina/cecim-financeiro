import { buildTemplateContext, calcularDiasAtraso, formatCurrencyBRL, formatDateBR, renderTemplate } from './template-renderer.util';

// Node formata moeda pt-BR com espaco normal ou non-breaking space, dependendo
// da versao/dados de ICU disponiveis - normaliza qualquer espaco antes de comparar.
function norm(text: string): string {
  return text.replace(/\s/g, ' ');
}

describe('template-renderer.util', () => {
  it('formata valores em centavos para BRL', () => {
    expect(norm(formatCurrencyBRL(15000))).toBe('R$ 150,00');
  });

  it('formata datas no padrão brasileiro', () => {
    expect(formatDateBR(new Date('2026-03-10T12:00:00Z'))).toBe('10/03/2026');
  });

  it('calcula dias de atraso a partir do vencimento', () => {
    expect(calcularDiasAtraso(new Date(Date.now() + 24 * 60 * 60 * 1000))).toBe(0); // ainda não venceu
    expect(calcularDiasAtraso(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))).toBeGreaterThanOrEqual(2);
  });

  it('monta o contexto do template a partir de cliente e cobrança', () => {
    const client: any = { name: 'Maria Souza' };
    const charge: any = {
      id: 'charge-1',
      amountCents: 25000,
      dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      paymentLink: null,
      description: 'Mensalidade Abril',
      pixCopiaECola: null,
      linhaDigitavel: null,
    };

    const context = buildTemplateContext(client, charge, 'https://app.example.com');

    expect(norm(context.valor)).toBe('R$ 250,00');
    expect(context).toEqual({
      cliente: 'Maria Souza',
      valor: context.valor,
      vencimento: formatDateBR(charge.dueDate),
      linkPagamento: 'https://app.example.com/pagamentos/charge-1',
      descricao: 'Mensalidade Abril',
      diasAtraso: 0,
      pix: '',
      linhaDigitavel: '',
    });
  });

  it('renderiza os placeholders no corpo do template', () => {
    const rendered = renderTemplate('Olá {{cliente}}, valor {{valor}}, vence {{vencimento}}.', {
      cliente: 'João',
      valor: 'R$ 100,00',
      vencimento: '05/05/2026',
      linkPagamento: 'https://x',
      descricao: 'teste',
      diasAtraso: 0,
      pix: '',
      linhaDigitavel: '',
    });
    expect(rendered).toBe('Olá João, valor R$ 100,00, vence 05/05/2026.');
  });
});
