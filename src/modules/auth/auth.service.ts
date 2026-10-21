import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /** Tentativas erradas por e-mail: 5 erros bloqueiam o login por 15 minutos. */
  private readonly tentativas = new Map<string, { erros: number; bloqueadoAte: number }>();

  async login(email: string, password: string) {
    const chave = String(email ?? '').trim().toLowerCase();
    const t = this.tentativas.get(chave);
    if (t && t.bloqueadoAte > Date.now()) {
      throw new HttpException('Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // E-mail sem diferença de maiúsculas/espaços ("Marcelo@..." = "marcelo@...").
    const user = await this.prisma.user.findFirst({ where: { email: { equals: chave, mode: 'insensitive' } } });
    const passwordOk = !!user && user.active && (await bcrypt.compare(password, user.passwordHash));
    if (!passwordOk) {
      // Bloqueio anterior já vencido: recomeça a contagem.
      const erros = (t && !t.bloqueadoAte ? t.erros : 0) + 1;
      if (this.tentativas.size > 10000) this.tentativas.clear();
      this.tentativas.set(chave, { erros, bloqueadoAte: erros >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      throw new UnauthorizedException('Credenciais inválidas');
    }
    this.tentativas.delete(chave);

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  /** Troca a senha do usuário logado - exige a senha atual correta. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');

    const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentOk) throw new UnauthorizedException('Senha atual incorreta');

    if (newPassword.length < 8) {
      throw new BadRequestException('A nova senha deve ter pelo menos 8 caracteres');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { success: true };
  }
}
