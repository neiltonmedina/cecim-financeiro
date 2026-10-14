import { prepararTextoMeta } from './templates.service';

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
