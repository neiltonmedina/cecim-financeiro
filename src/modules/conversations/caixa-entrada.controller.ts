import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/** Variações do mesmo celular (com e sem o 9 depois do DDD), como o WhatsApp às vezes entrega. */
export function variacoesDoNumero(digitos: string): string[] {
  const m = digitos.match(/^55(\d{2})(\d{8,9})$/);
  const base = `+${digitos}`;
  if (!m) return [base];
  const [, ddd, n] = m;
  return [base, n.length === 9 ? `+55${ddd}${n.slice(1)}` : `+55${ddd}9${n}`];
}

@ApiTags('caixa-entrada')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('caixa-entrada')
export class CaixaEntradaController {
  constructor(private readonly prisma: PrismaService) {}

  /** Últimas mensagens recebidas no WhatsApp da CECIM, com o cliente quando o número está cadastrado. */
  @Get()
  async listar() {
    const mensagens = await this.prisma.mensagemRecebida.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const numeros = [...new Set(mensagens.flatMap((m) => variacoesDoNumero(m.de)))];
    const clientes = numeros.length
      ? await this.prisma.client.findMany({
          where: { OR: [{ phoneE164: { in: numeros } }, { telefonesExtras: { hasSome: numeros } }] },
          select: { name: true, phoneE164: true, telefonesExtras: true },
        })
      : [];
    const porNumero = new Map<string, string>();
    for (const c of clientes) for (const t of [c.phoneE164, ...c.telefonesExtras]) if (t) porNumero.set(t, c.name);
    return mensagens.map((m) => ({
      ...m,
      cliente: variacoesDoNumero(m.de).map((v) => porNumero.get(v)).find(Boolean) ?? null,
    }));
  }
}
