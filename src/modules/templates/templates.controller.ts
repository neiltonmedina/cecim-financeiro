import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TemplatesService } from './templates.service';
import { UpdateTemplateDto } from './dto/update-template.dto';

@ApiTags('templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  findAll() {
    return this.templatesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  /** Envia nova versão do texto (WhatsApp) para aprovação da Meta. */
  @Post(':id/enviar-meta')
  enviarParaMeta(@Param('id') id: string, @Body('texto') texto: string) {
    return this.templatesService.enviarParaMeta(id, texto);
  }

  /** Confere na Meta se a versão enviada já foi aprovada (e passa a usá-la). */
  @Post(':id/verificar-meta')
  verificarMeta(@Param('id') id: string) {
    return this.templatesService.verificarMeta(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templatesService.update(id, dto);
  }
}
