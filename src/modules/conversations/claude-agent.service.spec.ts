import { ClaudeAgentService } from './claude-agent.service';

describe('ClaudeAgentService - canal só para boletos e Pix', () => {
  const comContato = (v: string) => new ClaudeAgentService({ get: () => v } as any) as any;

  it.each([
    ['sem política', null],
    ['com política cadastrada (ignorada)', { maxDiscountPercent: 10, maxInstallments: 3, notes: 'até 10%' }],
  ])('%s: só Pix/boleto, sem negociação e sem prometer atendente', (_, policy) => {
    const prompt: string = comContato('').buildSystemPrompt(policy, 'https://app');
    expect(prompt).toContain('SOMENTE para enviar boletos e códigos Pix');
    expect(prompt).toContain('Prometer que um atendente');
    expect(prompt).toContain('Oferecer, sugerir ou aceitar desconto, parcelamento');
    expect(prompt).not.toContain('10%');
    expect(prompt).not.toContain('Desconto máximo autorizado');
  });

  it('não indica nenhum outro canal de atendimento', () => {
    const prompt: string = comContato('').buildSystemPrompt(null, 'https://app');
    expect(prompt).toContain('Não indique nenhum outro canal');
    expect(prompt).not.toContain('falar com a CECIM');
  });
});

describe('filtrarRespostaDoAgente - trava final contra ofertas', () => {
  const { filtrarRespostaDoAgente, RESPOSTA_SEGURA } = require('./claude-agent.service');

  it.each([
    'Entendo! A cobrança "Mensalidade 10/2026", no valor de R$ 1.600,00, segue em aberto. Se preferir, consigo facilitar: à vista com até 10% de desconto, ou parcelado em até 3x sem desconto.',
    'Podemos parcelar em 2 vezes.',
    'Posso propor um acordo para você.',
    'Um atendente vai continuar a conversa.',
    'Ligue no nosso telefone para resolver.',
    'Podemos prorrogar o vencimento.',
  ])('bloqueia: %s', (texto) => {
    expect(filtrarRespostaDoAgente(texto)).toEqual({ texto: RESPOSTA_SEGURA, bloqueada: true });
  });

  it.each([
    'Olá! Este canal é automático. Responda *1* para receber o Pix ou *2* para receber o boleto.',
    'Obrigado! A confirmação do pagamento é automática pelo banco. Se já pagou, pode desconsiderar.',
    'O valor está de acordo com o boleto emitido pelo banco.',
  ])('deixa passar: %s', (texto) => {
    expect(filtrarRespostaDoAgente(texto)).toEqual({ texto, bloqueada: false });
  });
});
