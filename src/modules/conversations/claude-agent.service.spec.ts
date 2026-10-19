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
