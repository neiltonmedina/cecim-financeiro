import { ClaudeAgentService } from './claude-agent.service';

describe('ClaudeAgentService - agente não negocia (só Pix ou boleto)', () => {
  const service: any = new ClaudeAgentService({} as any);

  it.each([
    ['sem política', null],
    ['com política cadastrada (ignorada)', { maxDiscountPercent: 10, maxInstallments: 3, notes: 'até 10%' }],
  ])('%s: só oferece Pix/boleto e encaminha pedidos de desconto/parcelamento', (_, policy) => {
    const prompt: string = service.buildSystemPrompt(policy, 'https://app');
    expect(prompt).toContain('Você NÃO negocia');
    expect(prompt).toContain('As únicas opções que você oferece são: Pix');
    expect(prompt).toContain('requestHumanHandoff = true');
    expect(prompt).not.toContain('Desconto máximo autorizado');
    expect(prompt).not.toContain('10%');
  });
});
