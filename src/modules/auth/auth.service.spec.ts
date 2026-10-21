import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService.login - limite de tentativas', () => {
  async function setup() {
    const user = { id: 'u1', email: 'a@a.com', name: 'A', role: 'ADMIN', active: true, passwordHash: await bcrypt.hash('senha-certa', 4) };
    const prisma: any = { user: { findFirst: jest.fn().mockResolvedValue(user) } };
    const jwt: any = { signAsync: jest.fn().mockResolvedValue('token') };
    return new AuthService(prisma, jwt);
  }

  it('bloqueia depois de 5 senhas erradas, mesmo com a senha certa', async () => {
    const service = await setup();
    for (let i = 0; i < 5; i++) await expect(service.login('a@a.com', 'errada')).rejects.toThrow('Credenciais inválidas');
    await expect(service.login('a@a.com', 'senha-certa')).rejects.toThrow('Muitas tentativas');
  });

  it('acertar a senha zera as tentativas erradas', async () => {
    const service = await setup();
    for (let i = 0; i < 4; i++) await expect(service.login('a@a.com', 'errada')).rejects.toThrow();
    await expect(service.login('a@a.com', 'senha-certa')).resolves.toMatchObject({ accessToken: 'token' });
    await expect(service.login('a@a.com', 'errada')).rejects.toThrow('Credenciais inválidas');
  });
});

describe('AuthService.login - e-mail', () => {
  it('aceita o e-mail com maiúsculas e espaços', async () => {
    const user = { id: 'u1', email: 'marcelo@teste.com', name: 'Marcelo', role: 'OPERADOR', active: true, passwordHash: await bcrypt.hash('senha-certa', 4) };
    const prisma: any = { user: { findFirst: jest.fn().mockResolvedValue(user) } };
    const service = new AuthService(prisma, { signAsync: jest.fn().mockResolvedValue('t') } as any);
    await service.login('  Marcelo@Teste.com ', 'senha-certa');
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: { equals: 'marcelo@teste.com', mode: 'insensitive' } } });
  });
});
