import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientsService } from './clients.service';
import { BoletoLeituraService } from './boleto-leitura.service';
import { CnpjConsultaService } from './cnpj-consulta.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@ApiTags('clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly boletoLeitura: BoletoLeituraService,
    private readonly cnpjConsulta: CnpjConsultaService,
  ) {}

  /** Dados públicos do CNPJ (razão social, endereço) para pré-preencher o cadastro. */
  @Get('cnpj/:cnpj')
  consultarCnpj(@Param('cnpj') cnpj: string) {
    return this.cnpjConsulta.consultar(cnpj);
  }

  /** Lê um boleto (PDF ou foto) e devolve os dados do pagador para pré-preencher o cadastro. */
  @Post('ler-boleto')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  lerBoleto(@UploadedFile() arquivo?: { buffer: Buffer; mimetype: string }) {
    if (!arquivo) throw new BadRequestException('Nenhum arquivo enviado.');
    return this.boletoLeitura.lerBoleto(arquivo.buffer, arquivo.mimetype);
  }

  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  findAll(@Query('search') search?: string, @Query('active') active?: string) {
    return this.clientsService.findAll({
      search,
      active: active === undefined ? undefined : active === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }
}
