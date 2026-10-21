import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { AtualizarUsuarioDto, CriarUsuarioDto } from './dto/usuario.dto';

const SEM_SENHA = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

/** Usuários do painel (cada pessoa com o seu login). Só o administrador gerencia. */
@ApiTags('usuarios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  listar() {
    return this.prisma.user.findMany({ select: SEM_SENHA, orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async criar(@Body() dto: CriarUsuarioDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Já existe um usuário com este e-mail.');
    return this.prisma.user.create({
      data: { name: dto.name.trim(), email, role: dto.role ?? 'OPERADOR', passwordHash: await bcrypt.hash(dto.password, 10) },
      select: SEM_SENHA,
    });
  }

  @Patch(':id')
  async atualizar(@Param('id') id: string, @Body() dto: AtualizarUsuarioDto, @Req() req: any) {
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw new NotFoundException('Usuário não encontrado.');
    // O administrador não pode se desativar nem tirar o próprio acesso de administrador.
    if (id === req.user.userId && (dto.active === false || (dto.role && dto.role !== 'ADMIN'))) {
      throw new BadRequestException('Você não pode desativar nem rebaixar o seu próprio usuário.');
    }
    const { password, ...resto } = dto;
    return this.prisma.user.update({
      where: { id },
      data: { ...resto, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
      select: SEM_SENHA,
    });
  }
}
