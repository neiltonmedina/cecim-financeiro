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
