import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload) {
    // Usuário desativado no painel perde o acesso na hora (sem esperar o token expirar).
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { name: true, role: true, active: true } });
    if (!user?.active) throw new UnauthorizedException('Usuário desativado.');
    return { userId: payload.sub, email: payload.email, role: user.role, name: user.name };
  }
}
