import { TELEFONE_VALIDO } from './create-client.dto';

describe('TELEFONE_VALIDO', () => {
  it('aceita celular e fixo brasileiros com DDD', () => {
    expect(TELEFONE_VALIDO.test('+5594991234567')).toBe(true); // celular, 9 dígitos
    expect(TELEFONE_VALIDO.test('+559433461234')).toBe(true); // fixo, 8 dígitos
  });

  it('recusa número brasileiro incompleto', () => {
    expect(TELEFONE_VALIDO.test('+55942122886')).toBe(false); // DDD 94 + só 7 dígitos
    expect(TELEFONE_VALIDO.test('94991234567')).toBe(false); // sem +55
  });

  it('continua aceitando número estrangeiro', () => {
    expect(TELEFONE_VALIDO.test('+14155552671')).toBe(true);
  });
});
